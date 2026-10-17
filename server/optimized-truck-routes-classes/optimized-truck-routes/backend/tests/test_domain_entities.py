from __future__ import annotations

import pytest

from truck_routes.domain.entities import Curva, Nodo, NodoStradale, ProfiloCamion, StatoDato, Strada, TipoSuperficie


def test_nodo_salva_i_campi_richiesti_e_aggiorna_strada() -> None:
    nodo = Nodo(
        id_nodo="camion-1",
        tipo_camion="articolato",
        peso_camion=18000,
        nome_compagnia="Demo Logistics",
        strada_attuale="road-1",
        larghezza_camion_m=2.55,
    )

    assert nodo.peso_camion == 18000
    assert nodo.strada_attuale == "road-1"
    nodo.aggiorna_strada("road-2")
    assert nodo.strada_attuale == "road-2"


def test_profilo_camion_non_inventa_dimensioni_mancanti() -> None:
    nodo = Nodo("cam-1", "rigido", 12000, "Demo", "r-1")
    profile = ProfiloCamion.da_nodo(nodo)
    assert profile.peso_totale_kg == 12000
    assert profile.larghezza_m is None
    assert profile.validato is False


def test_strada_accetta_attributi_noti_e_sconosciuti_separatamente() -> None:
    strada = Strada(
        id_strada="road-1",
        strade_incidenti=["road-2"],
        lunghezza_strada_m=250,
        larghezza_strada_m=5.5,
        nodo_origine_id="n1",
        nodo_destinazione_id="n2",
        superficie=TipoSuperficie.ASFALTO,
        stato_superficie=StatoDato.NOTO,
    )
    assert strada.superficie == TipoSuperficie.ASFALTO
    assert strada.stato_illuminazione == StatoDato.SCONOSCIUTO


def test_strada_rifiuta_lunghezza_non_positiva() -> None:
    with pytest.raises(ValueError, match="lunghezza_strada_m"):
        Strada("bad", [], 0, 4.0, "n1", "n2")


def test_curva_stima_passabilita_senza_spacciarla_per_verifica() -> None:
    curva = Curva(
        id_curva="curve-1",
        raggio_m=24,
        strada_compresa=["r1", "r2"],
    )
    assert curva.stima_passabilita(15) is True  # 24 >= 15 * 1.2
    assert curva.stima_passabilita(None) is None


def test_nodo_stradale_valida_coordinate() -> None:
    with pytest.raises(ValueError, match="latitudine"):
        NodoStradale("n1", 24.9, 95.0)


def test_stato_noto_non_puo_coesistere_con_larghezza_ignota() -> None:
    with pytest.raises(ValueError, match="stato_larghezza='known'"):
        Strada(
            id_strada="bad-width",
            strade_incidenti=[],
            lunghezza_strada_m=100,
            larghezza_strada_m=None,
            nodo_origine_id="n1",
            nodo_destinazione_id="n2",
            stato_larghezza=StatoDato.NOTO,
        )


def test_curva_non_puo_dichiarare_verificata_una_passabilita_ignota() -> None:
    with pytest.raises(ValueError, match="passabilita_verificata"):
        Curva(
            id_curva="bad-curve",
            raggio_m=20,
            strada_compresa=["r1", "r2"],
            passabile_camion=None,
            passabilita_verificata=True,
        )
