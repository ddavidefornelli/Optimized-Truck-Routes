from __future__ import annotations

from datetime import datetime, timezone

import pytest

from truck_routes.domain.entities import (
    AccessoCamion,
    Curva,
    ModalitaPreferenza,
    NodoStradale,
    ProfiloCamion,
    ProfiloPercorso,
    RegolaSvolta,
    SensoDiMarcia,
    StatoDato,
    Strada,
    TipoSuperficie,
)
from truck_routes.routing.domain_router import (
    PercorsoNonTrovatoError,
    PreferenzePercorso,
    RouterOggetti,
)


WHEN = datetime(2026, 10, 11, 12, 0, tzinfo=timezone.utc)


def road(
    road_id: str,
    source: str,
    target: str,
    length: float,
    *,
    surface: TipoSuperficie = TipoSuperficie.ASFALTO,
    width: float = 7.0,
    urban: float = 0.1,
    curve_severity: float = 0.1,
    illuminated: bool = True,
    access: AccessoCamion = AccessoCamion.CONSENTITO,
    max_weight: float | None = None,
    closed: bool | None = False,
    direction: SensoDiMarcia = SensoDiMarcia.AVANTI,
    restriction_status: StatoDato = StatoDato.NOTO,
    closure_status: StatoDato = StatoDato.NOTO,
) -> Strada:
    return Strada(
        id_strada=road_id,
        strade_incidenti=[],
        lunghezza_strada_m=length,
        larghezza_strada_m=width,
        nodo_origine_id=source,
        nodo_destinazione_id=target,
        senso_marcia=direction,
        classe_strada="residential",
        limite_velocita_kmh=50,
        superficie=surface,
        stato_superficie=StatoDato.NOTO,
        stato_larghezza=StatoDato.NOTO,
        peso_massimo_kg=max_weight,
        accesso_camion=access,
        stato_restrizioni=restriction_status,
        chiusa=closed,
        stato_chiusura=closure_status,
        illuminata=illuminated,
        stato_illuminazione=StatoDato.NOTO,
        severita_urbana=urban,
        severita_curva=curve_severity,
        pericolo_documentato=False,
        severita_pericolo=0,
        stato_pericolo=StatoDato.NOTO,
    )


def node(node_id: str, lon: float, lat: float = 60.17) -> NodoStradale:
    return NodoStradale(node_id, lon, lat)


def vehicle(**overrides) -> ProfiloCamion:
    data = dict(
        id_profilo="truck-demo-v1",
        versione="1",
        tipo_camion="articolato",
        peso_totale_kg=18000,
        larghezza_m=2.55,
        altezza_m=3.8,
        lunghezza_m=12.0,
        raggio_minimo_svolta_m=12,
        validato=True,
        note="Profilo sintetico esclusivamente per i test.",
    )
    data.update(overrides)
    return ProfiloCamion(**data)


def test_shortest_and_road_comfort_can_choose_different_routes() -> None:
    nodes = [node("s", 24.90), node("a", 24.91), node("b", 24.92), node("t", 24.93)]
    roads = [
        road("short-1", "s", "a", 600, width=3.4, urban=0.8),
        road("short-2", "a", "t", 600, surface=TipoSuperficie.STERRATO, width=3.2, urban=0.8, curve_severity=0.8),
        road("long-1", "s", "b", 1200, width=8.0, urban=0.1),
        road("long-2", "b", "t", 1200, width=8.0, urban=0.05),
    ]
    router = RouterOggetti(nodes, roads)

    shortest = router.calcola_percorso("s", "t", vehicle(), ProfiloPercorso.PIU_BREVE, partenza_il=WHEN)
    comfort = router.calcola_percorso("s", "t", vehicle(), ProfiloPercorso.COMFORT_STRADA, partenza_il=WHEN)

    assert shortest.id_strade == ["short-1", "short-2"]
    assert comfort.id_strade == ["long-1", "long-2"]
    assert shortest.distanza_totale_m == 1200
    assert comfort.distanza_totale_m == 2400
    assert any("sterrato" in reason for reason in shortest.motivi)


def test_one_way_is_respected() -> None:
    nodes = [node("s", 24.90), node("t", 24.91)]
    router = RouterOggetti(nodes, [road("one-way", "s", "t", 100, direction=SensoDiMarcia.AVANTI)])
    with pytest.raises(PercorsoNonTrovatoError):
        router.calcola_percorso("t", "s", vehicle(), partenza_il=WHEN)


def test_reverse_only_direction_is_respected() -> None:
    nodes = [node("s", 24.90), node("t", 24.91)]
    router = RouterOggetti(nodes, [road("reverse", "s", "t", 100, direction=SensoDiMarcia.INDIETRO)])
    result = router.calcola_percorso("t", "s", vehicle(), partenza_il=WHEN)
    assert result.id_strade == ["reverse"]
    assert result.direzioni == ["reverse"]


def test_known_weight_limit_excludes_incompatible_truck() -> None:
    nodes = [node("s", 24.90), node("t", 24.91)]
    router = RouterOggetti(nodes, [road("bridge", "s", "t", 100, max_weight=10000)])
    with pytest.raises(PercorsoNonTrovatoError):
        router.calcola_percorso("s", "t", vehicle(peso_totale_kg=18000), partenza_il=WHEN)


def test_documented_closed_road_is_excluded() -> None:
    nodes = [node("s", 24.90), node("t", 24.91)]
    router = RouterOggetti(nodes, [road("closed", "s", "t", 100, closed=True)])
    with pytest.raises(PercorsoNonTrovatoError):
        router.calcola_percorso("s", "t", vehicle(), partenza_il=WHEN)


def test_forbidden_turn_is_excluded_even_if_next_segment_exists() -> None:
    nodes = [node("s", 24.90), node("middle", 24.91), node("t", 24.92)]
    roads = [road("r1", "s", "middle", 100), road("r2", "middle", "t", 100)]
    rule = RegolaSvolta("turn-ban", "r1", "r2", vietata=True)
    router = RouterOggetti(nodes, roads, regole_svolta=[rule])
    with pytest.raises(PercorsoNonTrovatoError):
        router.calcola_percorso("s", "t", vehicle(), partenza_il=WHEN)


def test_turn_rule_can_steer_to_an_alternative() -> None:
    nodes = [node("s", 24.90), node("a", 24.91), node("b", 24.915), node("t", 24.92)]
    roads = [
        road("direct-1", "s", "a", 50),
        road("direct-2", "a", "t", 50),
        road("alt-1", "s", "b", 150),
        road("alt-2", "b", "t", 150),
    ]
    rule = RegolaSvolta("ban-direct", "direct-1", "direct-2", vietata=True)
    router = RouterOggetti(nodes, roads, regole_svolta=[rule])
    result = router.calcola_percorso("s", "t", vehicle(), ProfiloPercorso.PIU_BREVE, partenza_il=WHEN)
    assert result.id_strade == ["alt-1", "alt-2"]


def test_verified_impassable_curve_excludes_turn() -> None:
    nodes = [node("s", 24.90), node("m", 24.91), node("t", 24.92)]
    roads = [road("r1", "s", "m", 100), road("r2", "m", "t", 100)]
    curve = Curva(
        id_curva="too-tight",
        raggio_m=4,
        strada_compresa=["r1", "r2"],
        id_nodo_stradale="m",
        passabile_camion=False,
        passabilita_verificata=True,
    )
    router = RouterOggetti(nodes, roads, curve=[curve])
    with pytest.raises(PercorsoNonTrovatoError):
        router.calcola_percorso("s", "t", vehicle(), partenza_il=WHEN)


def test_unknown_critical_restrictions_can_be_excluded_by_policy() -> None:
    nodes = [node("s", 24.90), node("t", 24.91)]
    router = RouterOggetti(
        nodes,
        [road("unknown-restrictions", "s", "t", 100, access=AccessoCamion.SCONOSCIUTO, restriction_status=StatoDato.SCONOSCIUTO)],
    )
    pref = PreferenzePercorso(restrizioni_critiche_sconosciute="exclude")
    with pytest.raises(PercorsoNonTrovatoError):
        router.calcola_percorso("s", "t", vehicle(), preferenze=pref, partenza_il=WHEN)


def test_preference_exclude_removes_unpaved_roads() -> None:
    nodes = [node("s", 24.90), node("t", 24.91)]
    router = RouterOggetti(nodes, [road("dirt", "s", "t", 100, surface=TipoSuperficie.STERRATO)])
    pref = PreferenzePercorso(sterrato=ModalitaPreferenza.ESCLUDI)
    with pytest.raises(PercorsoNonTrovatoError):
        router.calcola_percorso("s", "t", vehicle(), preferenze=pref, partenza_il=WHEN)


def test_geometric_crossing_does_not_create_connection_automatically() -> None:
    # Two nodes have the same coordinates but different topology IDs/levels (e.g. road and bridge).
    nodes = [node("s", 24.90), node("a", 24.91), node("b", 24.91), node("t", 24.92)]
    roads = [road("r1", "s", "a", 100), road("r2", "b", "t", 100)]
    router = RouterOggetti(nodes, roads)
    with pytest.raises(PercorsoNonTrovatoError):
        router.calcola_percorso("s", "t", vehicle(), partenza_il=WHEN)


def test_same_start_and_destination_returns_empty_route() -> None:
    router = RouterOggetti([node("s", 24.90)], [])
    result = router.calcola_percorso("s", "s", vehicle(), partenza_il=WHEN)
    assert result.id_strade == []
    assert result.distanza_totale_m == 0


def test_known_axle_load_limit_is_enforced() -> None:
    nodes = [node("s", 24.90), node("t", 24.91)]
    bridge = road("bridge", "s", "t", 100)
    bridge.carichi_assi_massimi_kg = {"asse1": 8000}
    router = RouterOggetti(nodes, [bridge])
    with pytest.raises(PercorsoNonTrovatoError):
        router.calcola_percorso(
            "s", "t", vehicle(carichi_assi_kg={"asse1": 9000}), partenza_il=WHEN
        )


def test_missing_axle_load_is_excluded_under_prudent_policy() -> None:
    nodes = [node("s", 24.90), node("t", 24.91)]
    bridge = road("bridge", "s", "t", 100)
    bridge.carichi_assi_massimi_kg = {"asse1": 8000}
    router = RouterOggetti(nodes, [bridge])
    pref = PreferenzePercorso(restrizioni_critiche_sconosciute="exclude")
    with pytest.raises(PercorsoNonTrovatoError):
        router.calcola_percorso("s", "t", vehicle(carichi_assi_kg=None), preferenze=pref, partenza_il=WHEN)


def test_typed_height_restriction_is_enforced() -> None:
    from truck_routes.domain.entities import RestrizioneStradale, TipoRestrizione

    nodes = [node("s", 24.90), node("t", 24.91)]
    bridge = road("bridge", "s", "t", 100)
    bridge.restrizioni.append(
        RestrizioneStradale(
            id_restrizione="low-clearance",
            id_strada="bridge",
            tipo=TipoRestrizione.ALTEZZA,
            valore=3.5,
            unita="m",
        )
    )
    router = RouterOggetti(nodes, [bridge])
    with pytest.raises(PercorsoNonTrovatoError):
        router.calcola_percorso("s", "t", vehicle(altezza_m=3.8), partenza_il=WHEN)


def test_exclude_tight_turn_uses_curve_severity() -> None:
    nodes = [node("s", 24.90), node("m", 24.91), node("t", 24.92)]
    roads = [road("r1", "s", "m", 100), road("r2", "m", "t", 100)]
    curve = Curva(
        id_curva="tight",
        raggio_m=18,
        strada_compresa=["r1", "r2"],
        id_nodo_stradale="m",
        severita=0.95,
        passabilita_verificata=False,
    )
    router = RouterOggetti(nodes, roads, curve=[curve])
    pref = PreferenzePercorso(curve_strette=ModalitaPreferenza.ESCLUDI)
    with pytest.raises(PercorsoNonTrovatoError):
        router.calcola_percorso("s", "t", vehicle(), preferenze=pref, partenza_il=WHEN)


def test_turn_rule_can_be_scoped_to_direction_of_bidirectional_roads() -> None:
    nodes = [node("s", 24.90), node("m", 24.91), node("t", 24.92)]
    roads = [
        road("r1", "s", "m", 100, direction=SensoDiMarcia.DOPPIO_SENSO),
        road("r2", "m", "t", 100, direction=SensoDiMarcia.DOPPIO_SENSO),
    ]
    # The rule applies only when r1 is entered in reverse, not to s -> m -> t.
    rule = RegolaSvolta(
        "reverse-only-ban",
        "r1",
        "r2",
        vietata=True,
        direzione_arco_entrante="reverse",
        direzione_arco_uscente="forward",
    )
    router = RouterOggetti(nodes, roads, regole_svolta=[rule])
    result = router.calcola_percorso("s", "t", vehicle(), ProfiloPercorso.PIU_BREVE, partenza_il=WHEN)
    assert result.id_strade == ["r1", "r2"]


def test_shortest_still_reports_potential_road_penalties() -> None:
    nodes = [node("s", 24.90), node("t", 24.91)]
    router = RouterOggetti(
        nodes,
        [road("dirt", "s", "t", 100, surface=TipoSuperficie.STERRATO, urban=0.8, curve_severity=0.7)],
    )
    result = router.calcola_percorso("s", "t", vehicle(), ProfiloPercorso.PIU_BREVE, partenza_il=WHEN)
    assert result.costo_totale == 100
    assert result.dettaglio_costi.penalita_superficie_s > 0
    assert result.dettaglio_costi.penalita_urbana_s > 0


def test_unverified_curve_generates_warning_and_partial_compatibility() -> None:
    nodes = [node("s", 24.90), node("m", 24.91), node("t", 24.92)]
    roads = [road("r1", "s", "m", 100), road("r2", "m", "t", 100)]
    curve = Curva(
        id_curva="unverified-turn",
        raggio_m=20,
        strada_compresa=["r1", "r2"],
        id_nodo_stradale="m",
        severita=0.4,
        passabilita_verificata=False,
    )
    result = RouterOggetti(nodes, roads, curve=[curve]).calcola_percorso(
        "s", "t", vehicle(), ProfiloPercorso.BILANCIATO, partenza_il=WHEN
    )
    assert result.compatibilita == "partially_verified"
    assert any("Transitabilità della curva" in warning for warning in result.avvisi)


def test_negative_or_nonfinite_cost_weights_are_rejected() -> None:
    from truck_routes.routing.domain_router import PesiRouting

    with pytest.raises(ValueError, match="k_superficie_s_m"):
        PesiRouting(k_superficie_s_m=-1.0)
    with pytest.raises(ValueError, match="velocita_riferimento_m_s"):
        PesiRouting(velocita_riferimento_m_s=float("nan"))
