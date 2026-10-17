"""Dijkstra router operating directly on the Italian domain entities.

The implementation is a transparent MVP. It enforces known hard restrictions, takes turn
rules into account by keeping the incoming road in the search state, and scores routes with
non-negative costs. It does not certify the physical passability or legal suitability of a road.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
import heapq
import math
from typing import Literal, Sequence

from truck_routes.domain.entities import (
    AccessoCamion,
    Curva,
    ModalitaPreferenza,
    NodoStradale,
    ProfiloCamion,
    ProfiloPercorso,
    RegolaSvolta,
    RestrizioneStradale,
    SensoDiMarcia,
    StatoDato,
    Strada,
    TipoRestrizione,
    TipoSuperficie,
)
from truck_routes.routing.costs import is_dark_at


class ReteNonValidaError(ValueError):
    """La rete in memoria contiene riferimenti topologici incoerenti."""


class PercorsoNonTrovatoError(ValueError):
    """Non è stato trovato un percorso ammissibile nel grafo disponibile."""


@dataclass(slots=True)
class PreferenzePercorso:
    sterrato: ModalitaPreferenza = ModalitaPreferenza.EVITA
    strade_strette: ModalitaPreferenza = ModalitaPreferenza.EVITA
    zone_urbane: ModalitaPreferenza = ModalitaPreferenza.EVITA
    curve_strette: ModalitaPreferenza = ModalitaPreferenza.EVITA
    non_illuminate_al_buio: ModalitaPreferenza = ModalitaPreferenza.EVITA
    restrizioni_critiche_sconosciute: Literal["warn", "exclude"] = "warn"

    def __post_init__(self) -> None:
        self.sterrato = ModalitaPreferenza(self.sterrato)
        self.strade_strette = ModalitaPreferenza(self.strade_strette)
        self.zone_urbane = ModalitaPreferenza(self.zone_urbane)
        self.curve_strette = ModalitaPreferenza(self.curve_strette)
        self.non_illuminate_al_buio = ModalitaPreferenza(self.non_illuminate_al_buio)
        if self.restrizioni_critiche_sconosciute not in {"warn", "exclude"}:
            raise ValueError("restrizioni_critiche_sconosciute deve essere 'warn' o 'exclude'")


@dataclass(slots=True)
class PesiRouting:
    """Pesi di costo, iniziali e calibrabili; non sono soglie di sicurezza certificate."""

    versione: str = "domain-cost-v1"
    velocita_riferimento_m_s: float = 13.8888888889
    velocita_sconosciuta_kmh: float = 30.0
    k_superficie_s_m: float = 0.85
    k_larghezza_s_m: float = 2.0
    k_urbano_s_m: float = 0.65
    k_curva_s_m: float = 1.8
    k_buio_s_m: float = 1.0
    k_dato_sconosciuto_s_m: float = 0.35
    k_pericolo_documentato_s_m: float = 3.0
    moltiplicatore_evita: float = 1.7
    moltiplicatore_comfort: float = 1.8
    penalita_svolta_standard_s: float = 4.0
    margine_larghezza_camion_m: float = 1.2
    larghezza_penalita_riferimento_m: float = 1.5
    soglia_esclusione_strettezza: float = 0.8
    soglia_esclusione_urbana: float = 0.85
    soglia_esclusione_curva: float = 0.85
    penalita_restrizione_sconosciuta_s: float = 20.0
    penalty_profilo_bilanciato_tempo: float = 1.0
    penalty_profilo_bilanciato_distanza: float = 0.25
    penalty_profilo_comfort_tempo: float = 0.85
    penalty_profilo_comfort_distanza: float = 0.10

    def __post_init__(self) -> None:
        if not self.versione.strip():
            raise ValueError("versione dei pesi non può essere vuota")
        for name in (
            "velocita_riferimento_m_s",
            "velocita_sconosciuta_kmh",
            "larghezza_penalita_riferimento_m",
        ):
            raw_value = getattr(self, name)
            if isinstance(raw_value, bool) or not isinstance(raw_value, (int, float)):
                raise ValueError(f"{name} deve essere numerico")
            value = float(raw_value)
            if not math.isfinite(value) or value <= 0:
                raise ValueError(f"{name} deve essere un numero finito maggiore di zero")
        for name in (
            "k_superficie_s_m",
            "k_larghezza_s_m",
            "k_urbano_s_m",
            "k_curva_s_m",
            "k_buio_s_m",
            "k_dato_sconosciuto_s_m",
            "k_pericolo_documentato_s_m",
            "penalita_svolta_standard_s",
            "penalita_restrizione_sconosciuta_s",
            "margine_larghezza_camion_m",
            "penalty_profilo_bilanciato_tempo",
            "penalty_profilo_bilanciato_distanza",
            "penalty_profilo_comfort_tempo",
            "penalty_profilo_comfort_distanza",
        ):
            raw_value = getattr(self, name)
            if isinstance(raw_value, bool) or not isinstance(raw_value, (int, float)):
                raise ValueError(f"{name} deve essere numerico")
            value = float(raw_value)
            if not math.isfinite(value) or value < 0:
                raise ValueError(f"{name} deve essere un numero finito non negativo")
        for name in ("moltiplicatore_evita", "moltiplicatore_comfort"):
            raw_value = getattr(self, name)
            if isinstance(raw_value, bool) or not isinstance(raw_value, (int, float)):
                raise ValueError(f"{name} deve essere numerico")
            value = float(raw_value)
            if not math.isfinite(value) or value < 1:
                raise ValueError(f"{name} deve essere un numero finito almeno 1")
        for name in (
            "soglia_esclusione_strettezza",
            "soglia_esclusione_urbana",
            "soglia_esclusione_curva",
        ):
            raw_value = getattr(self, name)
            if isinstance(raw_value, bool) or not isinstance(raw_value, (int, float)):
                raise ValueError(f"{name} deve essere numerico")
            value = float(raw_value)
            if not math.isfinite(value) or not 0 <= value <= 1:
                raise ValueError(f"{name} deve essere compreso tra 0 e 1")


@dataclass(slots=True)
class DettaglioCosto:
    distanza_m: float = 0.0
    tempo_stimato_s: float = 0.0
    equivalente_distanza_s: float = 0.0
    penalita_superficie_s: float = 0.0
    penalita_larghezza_s: float = 0.0
    penalita_urbana_s: float = 0.0
    penalita_curve_s: float = 0.0
    penalita_buio_s: float = 0.0
    penalita_dati_sconosciuti_s: float = 0.0
    penalita_pericolo_s: float = 0.0
    penalita_svolte_s: float = 0.0
    costo_totale: float = 0.0

    def aggiungi(self, other: "DettaglioCosto") -> None:
        for field_name in self.__dataclass_fields__:
            setattr(self, field_name, getattr(self, field_name) + getattr(other, field_name))

    def as_dict(self) -> dict[str, float]:
        return {name: round(float(getattr(self, name)), 3) for name in self.__dataclass_fields__}


@dataclass(slots=True)
class RisultatoPercorso:
    id_percorso: str
    profilo: ProfiloPercorso
    id_nodi: list[str]
    id_strade: list[str]
    direzioni: list[Literal["forward", "reverse"]]
    distanza_totale_m: float
    tempo_stimato_secondi: float
    costo_totale: float
    dettaglio_costi: DettaglioCosto
    compatibilita: Literal["not_verified", "partially_verified", "verified"]
    avvisi: list[str] = field(default_factory=list)
    motivi: list[str] = field(default_factory=list)
    pesi_versione: str = "domain-cost-v1"


@dataclass(slots=True, frozen=True)
class _Arco:
    id_arco: str
    origine: str
    destinazione: str
    strada: Strada
    inverso: bool = False


@dataclass(slots=True)
class _ValutazioneTratto:
    costo_ottimizzazione: float
    dettaglio: DettaglioCosto
    avvisi: list[str]
    motivi: list[str]


class RouterOggetti:
    """Calcola percorsi fra nodi stradali, usando Strada, Curva e RegolaSvolta."""

    def __init__(
        self,
        nodi: Sequence[NodoStradale],
        strade: Sequence[Strada],
        curve: Sequence[Curva] = (),
        regole_svolta: Sequence[RegolaSvolta] = (),
        pesi: PesiRouting | None = None,
    ) -> None:
        self.nodi = {node.id_nodo_stradale: node for node in nodi}
        if len(self.nodi) != len(nodi):
            raise ReteNonValidaError("Sono presenti ID di nodo stradale duplicati")
        self.strade = {road.id_strada: road for road in strade}
        if len(self.strade) != len(strade):
            raise ReteNonValidaError("Sono presenti ID di strada duplicati")
        self.curve = list(curve)
        self.regole_svolta = list(regole_svolta)
        self.pesi = pesi or PesiRouting()
        self._outgoing: dict[str, list[_Arco]] = {node_id: [] for node_id in self.nodi}
        self._validate_and_build_arcs()
        self._curve_by_id = {curve.id_curva: curve for curve in self.curve}

    def _validate_and_build_arcs(self) -> None:
        for road in self.strade.values():
            if road.nodo_origine_id not in self.nodi:
                raise ReteNonValidaError(
                    f"La strada {road.id_strada} fa riferimento a un nodo origine inesistente: "
                    f"{road.nodo_origine_id}"
                )
            if road.nodo_destinazione_id not in self.nodi:
                raise ReteNonValidaError(
                    f"La strada {road.id_strada} fa riferimento a un nodo destinazione inesistente: "
                    f"{road.nodo_destinazione_id}"
                )
            if road.senso_marcia in (SensoDiMarcia.AVANTI, SensoDiMarcia.DOPPIO_SENSO):
                arc = _Arco(
                    id_arco=f"{road.id_strada}:forward",
                    origine=road.nodo_origine_id,
                    destinazione=road.nodo_destinazione_id,
                    strada=road,
                    inverso=False,
                )
                self._outgoing[arc.origine].append(arc)
            if road.senso_marcia in (SensoDiMarcia.INDIETRO, SensoDiMarcia.DOPPIO_SENSO):
                arc = _Arco(
                    id_arco=f"{road.id_strada}:reverse",
                    origine=road.nodo_destinazione_id,
                    destinazione=road.nodo_origine_id,
                    strada=road,
                    inverso=True,
                )
                self._outgoing[arc.origine].append(arc)

        for arcs in self._outgoing.values():
            arcs.sort(key=lambda arc: (arc.destinazione, arc.strada.id_strada, arc.inverso))

        for rule in self.regole_svolta:
            if rule.id_strada_entrante not in self.strade or rule.id_strada_uscente not in self.strade:
                raise ReteNonValidaError(
                    f"La regola di svolta {rule.id_regola} punta a una strada inesistente"
                )
        for road in self.strade.values():
            for restriction in road.restrizioni:
                if restriction.id_strada is not None and restriction.id_strada != road.id_strada:
                    raise ReteNonValidaError(
                        f"La restrizione {restriction.id_restrizione} è assegnata a {road.id_strada} "
                        f"ma dichiara id_strada={restriction.id_strada}"
                    )

        for curve in self.curve:
            unknown = set(curve.strada_compresa) - set(self.strade)
            if unknown:
                raise ReteNonValidaError(
                    f"La curva {curve.id_curva} punta a strade inesistenti: {sorted(unknown)}"
                )
            if curve.id_nodo_stradale and curve.id_nodo_stradale not in self.nodi:
                raise ReteNonValidaError(
                    f"La curva {curve.id_curva} punta a un nodo inesistente: {curve.id_nodo_stradale}"
                )

    def calcola_percorso(
        self,
        origine_id: str,
        destinazione_id: str,
        veicolo: ProfiloCamion,
        profilo: ProfiloPercorso = ProfiloPercorso.BILANCIATO,
        preferenze: PreferenzePercorso | None = None,
        partenza_il: datetime | None = None,
    ) -> RisultatoPercorso:
        """Trova il percorso con costo minimo nel grafo attualmente caricato.

        ``partenza_il`` deve avere timezone. Gli attributi dinamici vengono congelati per la
        richiesta; l'illuminazione usa la posizione del tratto e l'istante iniziale, quindi
        la stima per i tratti molto lontani nel tempo è approssimata.
        """
        profilo = ProfiloPercorso(profilo)
        preferenze = preferenze or PreferenzePercorso()
        when = partenza_il or datetime.now(timezone.utc)
        if when.tzinfo is None or when.utcoffset() is None:
            raise ValueError("partenza_il deve includere il fuso orario")
        if origine_id not in self.nodi:
            raise ReteNonValidaError(f"Nodo di partenza non presente: {origine_id}")
        if destinazione_id not in self.nodi:
            raise ReteNonValidaError(f"Nodo di destinazione non presente: {destinazione_id}")

        if origine_id == destinazione_id:
            blank = DettaglioCosto()
            return RisultatoPercorso(
                id_percorso=f"{origine_id}-{destinazione_id}-{profilo.value}",
                profilo=profilo,
                id_nodi=[origine_id],
                id_strade=[],
                direzioni=[],
                distanza_totale_m=0.0,
                tempo_stimato_secondi=0.0,
                costo_totale=0.0,
                dettaglio_costi=blank,
                compatibilita="verified" if veicolo.validato else "not_verified",
                avvisi=[] if veicolo.validato else ["Il profilo camion non è stato validato."],
                motivi=["Partenza e destinazione coincidono."],
                pesi_versione=self.pesi.versione,
            )

        # Search state contains the incoming arc, so turn restrictions and turn costs are
        # represented explicitly instead of pretending the cost depends only on a road node.
        initial_state = (origine_id, "")
        distance: dict[tuple[str, str], float] = {initial_state: 0.0}
        predecessor: dict[tuple[str, str], tuple[tuple[str, str], _Arco]] = {}
        arc_by_state_id: dict[str, _Arco] = {
            arc.id_arco: arc for arcs in self._outgoing.values() for arc in arcs
        }
        queue: list[tuple[float, str, str]] = [(0.0, origine_id, "")]
        final_state: tuple[str, str] | None = None

        while queue:
            current_cost, current_node, incoming_arc_id = heapq.heappop(queue)
            state = (current_node, incoming_arc_id)
            if current_cost > distance.get(state, math.inf) + 1e-9:
                continue
            if current_node == destinazione_id:
                final_state = state
                break
            incoming_arc = arc_by_state_id.get(incoming_arc_id)
            for outgoing_arc in self._outgoing.get(current_node, []):
                evaluated = self._evaluate_arc(
                    outgoing_arc,
                    veicolo,
                    profilo,
                    preferenze,
                    when,
                    incoming_arc,
                    current_node,
                )
                if evaluated is None:
                    continue
                candidate_cost = current_cost + evaluated.costo_ottimizzazione
                next_state = (outgoing_arc.destinazione, outgoing_arc.id_arco)
                old_cost = distance.get(next_state, math.inf)
                if candidate_cost < old_cost - 1e-9:
                    distance[next_state] = candidate_cost
                    predecessor[next_state] = (state, outgoing_arc)
                    heapq.heappush(
                        queue, (candidate_cost, outgoing_arc.destinazione, outgoing_arc.id_arco)
                    )

        if final_state is None:
            raise PercorsoNonTrovatoError(
                "Nessun percorso ammissibile trovato nel grafo caricato dopo l'applicazione "
                "dei sensi di marcia, delle restrizioni note e delle preferenze in modalità exclude."
            )

        path_arcs: list[_Arco] = []
        state = final_state
        while state != initial_state:
            previous = predecessor.get(state)
            if previous is None:
                raise PercorsoNonTrovatoError("Ricostruzione del percorso incompleta nel grafo.")
            previous_state, arc = previous
            path_arcs.append(arc)
            state = previous_state
        path_arcs.reverse()

        total = DettaglioCosto()
        warnings: list[str] = []
        reasons: list[str] = []
        incoming_arc = None
        current_node = origine_id
        for arc in path_arcs:
            evaluated = self._evaluate_arc(
                arc,
                veicolo,
                profilo,
                preferenze,
                when,
                incoming_arc,
                current_node,
            )
            if evaluated is None:
                raise PercorsoNonTrovatoError("Vincoli cambiati durante la ricostruzione del percorso.")
            total.aggiungi(evaluated.dettaglio)
            warnings.extend(evaluated.avvisi)
            reasons.extend(evaluated.motivi)
            incoming_arc = arc
            current_node = arc.destinazione

        # Distanza e durata sono metriche indipendenti dal costo usato per scegliere il percorso.
        # Il campo tempo_stimato_s è già incluso nei dettagli dei tratti.
        total.costo_totale = distance[final_state]
        total.distanza_m = sum(arc.strada.lunghezza_strada_m for arc in path_arcs)
        unique_warnings = list(dict.fromkeys(warnings))
        unique_reasons = list(dict.fromkeys(reasons))
        compatibility = self._compatibility_status(path_arcs, veicolo)
        if not veicolo.validato:
            unique_warnings.append(
                "Profilo camion non validato: i risultati sono esplorativi e non certificano la transitabilità."
            )
            unique_warnings = list(dict.fromkeys(unique_warnings))
        if any(self._road_compatibility_uncertain(arc.strada, veicolo) for arc in path_arcs):
            compatibility = "not_verified" if not veicolo.validato else "partially_verified"
        for incoming, outgoing in zip(path_arcs, path_arcs[1:]):
            has_unverified_curve = any(
                incoming.strada.id_strada in curve.strada_compresa
                and outgoing.strada.id_strada in curve.strada_compresa
                and (curve.id_nodo_stradale is None or curve.id_nodo_stradale == incoming.destinazione)
                and not curve.passabilita_verificata
                for curve in self.curve
            )
            if has_unverified_curve:
                compatibility = "not_verified" if not veicolo.validato else "partially_verified"

        return RisultatoPercorso(
            id_percorso=f"{origine_id}-{destinazione_id}-{profilo.value}",
            profilo=profilo,
            id_nodi=[origine_id] + [arc.destinazione for arc in path_arcs],
            id_strade=[arc.strada.id_strada for arc in path_arcs],
            direzioni=["reverse" if arc.inverso else "forward" for arc in path_arcs],
            distanza_totale_m=round(total.distanza_m, 1),
            tempo_stimato_secondi=round(total.tempo_stimato_s, 1),
            costo_totale=round(total.costo_totale, 3),
            dettaglio_costi=total,
            compatibilita=compatibility,
            avvisi=unique_warnings,
            motivi=unique_reasons,
            pesi_versione=self.pesi.versione,
        )

    def _evaluate_arc(
        self,
        arc: _Arco,
        vehicle: ProfiloCamion,
        profile: ProfiloPercorso,
        preferences: PreferenzePercorso,
        when: datetime,
        incoming_arc: _Arco | None,
        current_node: str,
    ) -> _ValutazioneTratto | None:
        road = arc.strada
        warnings: list[str] = []
        reasons: list[str] = []
        extra_turn_cost = 0.0

        exclusion = self._road_exclusion_reason(road, vehicle, preferences, when)
        if exclusion:
            return None

        if road.accesso_camion == AccessoCamion.SCONOSCIUTO:
            warnings.append(f"Accesso camion non documentato su {road.id_strada}.")
        if road.stato_restrizioni != StatoDato.NOTO:
            warnings.append(f"Restrizioni critiche non verificate su {road.id_strada}.")
        if road.stato_chiusura != StatoDato.NOTO or road.chiusa is None:
            warnings.append(f"Stato chiusure sconosciuto su {road.id_strada}.")
        traffic_present = road.velocita_traffico_kmh is not None or road.ritardo_traffico_secondi is not None
        traffic_fresh = (
            road.traffico_osservato_il is not None
            and road.traffico_valido_fino_a is not None
            and road.traffico_osservato_il <= when <= road.traffico_valido_fino_a
        )
        if traffic_present and not traffic_fresh:
            warnings.append(
                f"Osservazione traffico assente o scaduta su {road.id_strada}; la durata usa i dati statici disponibili."
            )
        if road.limite_velocita_kmh is None and not traffic_fresh:
            warnings.append(
                f"Limite di velocità sconosciuto su {road.id_strada}; usata la velocità di fallback configurata."
            )
        if road.stato_superficie != StatoDato.NOTO or road.superficie == TipoSuperficie.SCONOSCIUTA:
            warnings.append(f"Fondo stradale non documentato su {road.id_strada}.")
        if road.stato_larghezza != StatoDato.NOTO or road.larghezza_strada_m is None:
            warnings.append(f"Larghezza non documentata su {road.id_strada}.")
        if road.stato_illuminazione != StatoDato.NOTO or road.illuminata is None:
            warnings.append(f"Copertura del dato sull'illuminazione incompleta su {road.id_strada}.")
        if road.severita_urbana is None:
            warnings.append(f"Indicatore di area urbana sconosciuto su {road.id_strada}.")
        if road.severita_curva is None:
            warnings.append(f"Indicatore geometrico delle curve sconosciuto su {road.id_strada}.")
        if road.stato_pericolo != StatoDato.NOTO:
            warnings.append(f"Copertura eventi/condizioni critiche incompleta su {road.id_strada}.")
        elif road.pericolo_documentato:
            warnings.append(f"Condizione potenzialmente critica documentata su {road.id_strada}.")
        for name, vehicle_dimension, road_limit in (
            ("altezza", vehicle.altezza_m, road.altezza_massima_m),
            ("larghezza legale", vehicle.larghezza_m, road.larghezza_massima_m),
            ("lunghezza", vehicle.lunghezza_m, road.lunghezza_massima_m),
            ("massa", vehicle.peso_totale_kg, road.peso_massimo_kg),
        ):
            if road_limit is not None and vehicle_dimension is None:
                warnings.append(
                    f"Compatibilità del camion con il limite di {name} su {road.id_strada} "
                    "non verificabile: manca il dato del profilo."
                )
        if road.carichi_assi_massimi_kg:
            for axle in road.carichi_assi_massimi_kg:
                if vehicle.carichi_assi_kg is None or axle not in vehicle.carichi_assi_kg:
                    warnings.append(
                        f"Compatibilità del carico sull'asse {axle} su {road.id_strada} non verificabile."
                    )
        for restriction in road.restrizioni:
            if restriction.stato != StatoDato.NOTO and self._restriction_applies(restriction, vehicle):
                warnings.append(
                    f"Restrizione {restriction.id_restrizione} ({restriction.tipo.value}) non verificata su {road.id_strada}."
                )
            elif (
                restriction.stato == StatoDato.NOTO
                and self._restriction_applies(restriction, vehicle)
                and restriction.tipo in {
                    TipoRestrizione.ALTEZZA,
                    TipoRestrizione.LARGHEZZA,
                    TipoRestrizione.LUNGHEZZA,
                    TipoRestrizione.PESO_TOTALE,
                    TipoRestrizione.CARICO_ASSE,
                }
                and self._dimensione_veicolo_per_restrizione(restriction, vehicle) is None
            ):
                warnings.append(
                    f"Compatibilità con la restrizione {restriction.tipo.value} su {road.id_strada} "
                    "non verificabile: manca una dimensione del profilo camion."
                )

        dark = self._is_dark_on_road(road, when)
        detail = self._score_road(road, vehicle, profile, preferences, dark, when)
        if incoming_arc is not None:
            turn = self._evaluate_turn(
                incoming_arc, arc, current_node, vehicle, profile, preferences, when
            )
            if turn is None:
                return None
            extra_turn_cost, turn_warnings, turn_reasons = turn
            warnings.extend(turn_warnings)
            reasons.extend(turn_reasons)
            if profile != ProfiloPercorso.PIU_BREVE:
                detail.penalita_svolte_s += extra_turn_cost
        if profile == ProfiloPercorso.PIU_BREVE:
            detail.costo_totale = road.lunghezza_strada_m
            # Nel profilo "shortest" distanza e non durata/comfort è l'obiettivo.
            optimisation_cost = road.lunghezza_strada_m
        else:
            detail.costo_totale += extra_turn_cost
            optimisation_cost = detail.costo_totale

        if road.superficie == TipoSuperficie.STERRATO and road.stato_superficie == StatoDato.NOTO:
            reasons.append(f"Il segmento {road.id_strada} è sterrato.")
        if detail.penalita_larghezza_s > 0:
            reasons.append(f"La larghezza di {road.id_strada} introduce una penalità per mezzi pesanti.")
        if dark and road.illuminata is False:
            reasons.append(f"Il segmento {road.id_strada} è non illuminato all'orario iniziale stimato.")
        return _ValutazioneTratto(
            costo_ottimizzazione=optimisation_cost,
            dettaglio=detail,
            avvisi=warnings,
            motivi=reasons,
        )

    def _road_exclusion_reason(
        self,
        road: Strada,
        vehicle: ProfiloCamion,
        pref: PreferenzePercorso,
        when: datetime,
    ) -> str | None:
        if road.chiusa is True and self._in_validity(
            when, road.chiusura_valida_da, road.chiusura_valida_fino_a
        ):
            return f"Strada chiusa: {road.id_strada}"
        if road.accesso_camion == AccessoCamion.VIETATO:
            return f"Accesso camion vietato su {road.id_strada}"
        if pref.restrizioni_critiche_sconosciute == "exclude" and self._road_has_unknown_critical_data(road):
            return f"Restrizioni critiche sconosciute su {road.id_strada}"

        for dimension, limit, label in (
            (vehicle.altezza_m, road.altezza_massima_m, "altezza"),
            (vehicle.larghezza_m, road.larghezza_massima_m, "larghezza legale"),
            (vehicle.lunghezza_m, road.lunghezza_massima_m, "lunghezza"),
            (vehicle.peso_totale_kg, road.peso_massimo_kg, "massa totale"),
        ):
            if dimension is not None and limit is not None and dimension > limit:
                return f"Limite di {label} incompatibile su {road.id_strada}"
            if limit is not None and dimension is None and pref.restrizioni_critiche_sconosciute == "exclude":
                return f"Dimensione del camion necessaria ma sconosciuta per {road.id_strada}"

        if road.carichi_assi_massimi_kg:
            for axle, max_load in road.carichi_assi_massimi_kg.items():
                load = vehicle.carichi_assi_kg.get(axle) if vehicle.carichi_assi_kg else None
                if load is not None and load > max_load:
                    return f"Limite di carico asse {axle} incompatibile su {road.id_strada}"
                if load is None and pref.restrizioni_critiche_sconosciute == "exclude":
                    return f"Carico asse {axle} non verificabile su {road.id_strada}"

        for restriction in road.restrizioni:
            if not self._restriction_applies(restriction, vehicle):
                continue
            if not self._in_validity(when, restriction.valida_da, restriction.valida_fino_a):
                continue
            if restriction.stato != StatoDato.NOTO:
                if pref.restrizioni_critiche_sconosciute == "exclude":
                    return f"Restrizione {restriction.id_restrizione} non verificata su {road.id_strada}"
                continue
            dimension_value = self._dimensione_veicolo_per_restrizione(restriction, vehicle)
            if (
                restriction.tipo in {
                    TipoRestrizione.ALTEZZA,
                    TipoRestrizione.LARGHEZZA,
                    TipoRestrizione.LUNGHEZZA,
                    TipoRestrizione.PESO_TOTALE,
                    TipoRestrizione.CARICO_ASSE,
                }
                and dimension_value is None
                and pref.restrizioni_critiche_sconosciute == "exclude"
            ):
                return f"Il profilo non ha il dato necessario per la restrizione {restriction.tipo.value} su {road.id_strada}"
            if self._generic_restriction_violated(restriction, vehicle):
                return f"Restrizione {restriction.tipo.value} incompatibile su {road.id_strada}"

        surface_known = road.stato_superficie == StatoDato.NOTO and road.superficie != TipoSuperficie.SCONOSCIUTA
        if pref.sterrato == ModalitaPreferenza.ESCLUDI and surface_known and road.superficie in (
            TipoSuperficie.STERRATO,
            TipoSuperficie.GHIAIA,
        ):
            return f"Fondo non asfaltato escluso su {road.id_strada}"
        dark = self._is_dark_on_road(road, when)
        if pref.non_illuminate_al_buio == ModalitaPreferenza.ESCLUDI and dark and road.illuminata is False:
            return f"Strada non illuminata esclusa su {road.id_strada}"

        if pref.strade_strette == ModalitaPreferenza.ESCLUDI:
            severity = self._width_severity(road, vehicle)
            if severity is not None and severity >= self.pesi.soglia_esclusione_strettezza:
                return f"Strada troppo stretta secondo il modello su {road.id_strada}"
        if pref.zone_urbane == ModalitaPreferenza.ESCLUDI and road.severita_urbana is not None:
            if road.severita_urbana >= self.pesi.soglia_esclusione_urbana:
                return f"Zona urbana esclusa dalle preferenze su {road.id_strada}"
        if pref.curve_strette == ModalitaPreferenza.ESCLUDI and road.severita_curva is not None:
            if road.severita_curva >= self.pesi.soglia_esclusione_curva:
                return f"Tratto con curve strette escluso su {road.id_strada}"
        return None

    def _score_road(
        self,
        road: Strada,
        vehicle: ProfiloCamion,
        profile: ProfiloPercorso,
        pref: PreferenzePercorso,
        dark: bool,
        when: datetime,
    ) -> DettaglioCosto:
        distance = road.lunghezza_strada_m
        travel_seconds = self._estimated_seconds(road, when)
        surface_severity = self._surface_severity(road)
        width_severity = self._width_severity(road, vehicle)
        urban_severity = road.severita_urbana
        curve_severity = road.severita_curva
        dark_severity: float | None
        if road.stato_illuminazione == StatoDato.NOTO and road.illuminata is not None:
            dark_severity = 1.0 if dark and not road.illuminata else 0.0
        else:
            dark_severity = None
        hazard_severity = road.severita_pericolo if road.stato_pericolo == StatoDato.NOTO else None
        if hazard_severity is None and road.stato_pericolo == StatoDato.NOTO and road.pericolo_documentato:
            hazard_severity = 0.7

        detail = DettaglioCosto(distanza_m=distance, tempo_stimato_s=travel_seconds)
        if profile == ProfiloPercorso.PIU_BREVE:
            w_time = 0.0
            w_distance = 0.0
            profile_multiplier = 1.0
        elif profile == ProfiloPercorso.BILANCIATO:
            w_time = self.pesi.penalty_profilo_bilanciato_tempo
            w_distance = self.pesi.penalty_profilo_bilanciato_distanza
            profile_multiplier = 1.0
        else:
            w_time = self.pesi.penalty_profilo_comfort_tempo
            w_distance = self.pesi.penalty_profilo_comfort_distanza
            profile_multiplier = self.pesi.moltiplicatore_comfort

        detail.equivalente_distanza_s = w_distance * distance / self.pesi.velocita_riferimento_m_s
        detail.costo_totale = w_time * travel_seconds + detail.equivalente_distanza_s

        surface_pref = self._avoid_multiplier(pref.sterrato)
        if surface_severity is not None:
            detail.penalita_superficie_s = (
                distance * self.pesi.k_superficie_s_m * surface_severity * surface_pref * profile_multiplier
            )
        width_pref = self._avoid_multiplier(pref.strade_strette)
        if width_severity is not None:
            detail.penalita_larghezza_s = (
                distance * self.pesi.k_larghezza_s_m * width_severity * width_pref * profile_multiplier
            )
        urban_pref = self._avoid_multiplier(pref.zone_urbane)
        if urban_severity is not None:
            detail.penalita_urbana_s = (
                distance * self.pesi.k_urbano_s_m * urban_severity * urban_pref * profile_multiplier
            )
        curve_pref = self._avoid_multiplier(pref.curve_strette)
        if curve_severity is not None:
            detail.penalita_curve_s = (
                distance * self.pesi.k_curva_s_m * curve_severity * curve_pref * profile_multiplier
            )
        darkness_pref = self._avoid_multiplier(pref.non_illuminate_al_buio)
        if dark_severity is not None:
            detail.penalita_buio_s = (
                distance * self.pesi.k_buio_s_m * dark_severity * darkness_pref * profile_multiplier
            )
        if hazard_severity is not None:
            detail.penalita_pericolo_s = (
                distance * self.pesi.k_pericolo_documentato_s_m * hazard_severity * profile_multiplier
            )

        unknown_count = self._unknown_attribute_count(road, vehicle)
        detail.penalita_dati_sconosciuti_s = (
            distance * self.pesi.k_dato_sconosciuto_s_m * unknown_count * profile_multiplier
        )
        detail.costo_totale += sum(
            (
                detail.penalita_superficie_s,
                detail.penalita_larghezza_s,
                detail.penalita_urbana_s,
                detail.penalita_curve_s,
                detail.penalita_buio_s,
                detail.penalita_dati_sconosciuti_s,
                detail.penalita_pericolo_s,
            )
        )
        if profile == ProfiloPercorso.PIU_BREVE:
            # Le penalità vengono esposte per spiegare il tratto, ma non alterano l'obiettivo shortest.
            detail.costo_totale = distance
        return detail

    def _evaluate_turn(
        self,
        incoming: _Arco,
        outgoing: _Arco,
        node_id: str,
        vehicle: ProfiloCamion,
        profile: ProfiloPercorso,
        pref: PreferenzePercorso,
        when: datetime,
    ) -> tuple[float, list[str], list[str]] | None:
        penalty = 0.0
        warnings: list[str] = []
        reasons: list[str] = []
        active_rules = [
            rule
            for rule in self.regole_svolta
            if rule.id_strada_entrante == incoming.strada.id_strada
            and rule.id_strada_uscente == outgoing.strada.id_strada
            and (
                rule.direzione_arco_entrante is None
                or rule.direzione_arco_entrante == ("reverse" if incoming.inverso else "forward")
            )
            and (
                rule.direzione_arco_uscente is None
                or rule.direzione_arco_uscente == ("reverse" if outgoing.inverso else "forward")
            )
            and rule.attiva_a(when)
        ]
        for rule in active_rules:
            if rule.stato != StatoDato.NOTO:
                if pref.restrizioni_critiche_sconosciute == "exclude":
                    return None
                warnings.append(f"Regola di svolta {rule.id_regola} non verificata.")
                penalty += self.pesi.penalita_restrizione_sconosciuta_s
            elif rule.vietata:
                return None
            elif profile != ProfiloPercorso.PIU_BREVE:
                penalty += rule.penalita_secondi
                if rule.penalita_secondi:
                    reasons.append(f"Svolta {rule.id_regola} con penalità documentata.")

        relevant_curves = [
            curve
            for curve in self.curve
            if incoming.strada.id_strada in curve.strada_compresa
            and outgoing.strada.id_strada in curve.strada_compresa
            and (curve.id_nodo_stradale is None or curve.id_nodo_stradale == node_id)
        ]
        for curve in relevant_curves:
            if not curve.passabilita_verificata:
                warnings.append(
                    f"Transitabilità della curva {curve.id_curva} non verificata per il camion; "
                    "la geometria disponibile non garantisce il passaggio fisico."
                )
            if curve.passabilita_verificata and curve.passabile_camion is False:
                return None
            severity = curve.severita
            # Il raggio minimo del camion dà una stima della compatibilità, non una prova di manovrabilità.
            estimated_passability = curve.stima_passabilita(vehicle.raggio_minimo_svolta_m)
            if pref.curve_strette == ModalitaPreferenza.ESCLUDI and (
                (severity is not None and severity >= self.pesi.soglia_esclusione_curva)
                or estimated_passability is False
                or curve.passabile_camion is False
            ):
                return None
            if estimated_passability is False and severity is None:
                severity = 0.8
                warnings.append(
                    f"Il raggio della curva {curve.id_curva} risulta stretto rispetto al parametro camion; "
                    "è solo una stima preliminare, non una verifica della traiettoria spazzata."
                )
            if profile != ProfiloPercorso.PIU_BREVE:
                if severity is not None:
                    turn_cost = (
                        self.pesi.penalita_svolta_standard_s
                        * max(1.0, min(4.0, 1.0 + (curve.angolo_gradi or 0.0) / 90.0))
                        * severity
                    )
                    if pref.curve_strette == ModalitaPreferenza.EVITA:
                        turn_cost *= self.pesi.moltiplicatore_evita
                    penalty += turn_cost
                elif curve.raggio_m is None or not curve.passabilita_verificata:
                    warnings.append(
                        f"Compatibilità della curva {curve.id_curva} non verificata; il raggio da solo "
                        "non certifica la manovrabilità del camion."
                    )
                    penalty += self.pesi.penalita_restrizione_sconosciuta_s
            if curve.passabile_camion is False and not curve.passabilita_verificata:
                warnings.append(
                    f"La curva {curve.id_curva} è indicata come potenzialmente non transitabile, "
                    "ma il dato non è verificato; è necessaria una verifica indipendente."
                )
                if profile != ProfiloPercorso.PIU_BREVE:
                    penalty += self.pesi.penalita_restrizione_sconosciuta_s
        return penalty, warnings, reasons

    def _is_dark_on_road(self, road: Strada, when: datetime) -> bool:
        if road.stato_illuminazione == StatoDato.NOTO and road.illuminata is True:
            return False
        if road.geometria:
            lon = (road.geometria[0][0] + road.geometria[-1][0]) / 2
            lat = (road.geometria[0][1] + road.geometria[-1][1]) / 2
        else:
            source = self.nodi[road.nodo_origine_id]
            target = self.nodi[road.nodo_destinazione_id]
            lon = (source.longitudine + target.longitudine) / 2
            lat = (source.latitudine + target.latitudine) / 2
        return is_dark_at(lon, lat, when)

    def _estimated_seconds(self, road: Strada, when: datetime) -> float:
        fresh_traffic = (
            road.traffico_osservato_il is not None
            and road.traffico_valido_fino_a is not None
            and road.traffico_osservato_il <= when <= road.traffico_valido_fino_a
        )
        if fresh_traffic and road.velocita_traffico_kmh is not None:
            speed_kmh = road.velocita_traffico_kmh
            delay_s = 0.0  # non aggiungere una seconda volta il ritardo già riflesso nella velocità osservata
        else:
            speed_kmh = road.limite_velocita_kmh or self.pesi.velocita_sconosciuta_kmh
            delay_s = road.ritardo_traffico_secondi if fresh_traffic and road.ritardo_traffico_secondi else 0.0
        return road.lunghezza_strada_m / max(1.0, speed_kmh / 3.6) + max(0.0, delay_s)

    def _width_severity(self, road: Strada, vehicle: ProfiloCamion) -> float | None:
        if road.stato_larghezza != StatoDato.NOTO or road.larghezza_strada_m is None:
            return None
        if vehicle.larghezza_m is None:
            return None
        required = vehicle.larghezza_m + self.pesi.margine_larghezza_camion_m
        if road.larghezza_strada_m >= required + self.pesi.larghezza_penalita_riferimento_m:
            return 0.0
        value = (required - road.larghezza_strada_m) / self.pesi.larghezza_penalita_riferimento_m
        return max(0.0, min(1.0, value))

    @staticmethod
    def _surface_severity(road: Strada) -> float | None:
        if road.stato_superficie != StatoDato.NOTO:
            return None
        return {
            TipoSuperficie.ASFALTO: 0.0,
            TipoSuperficie.STERRATO: 1.0,
            TipoSuperficie.GHIAIA: 0.65,
            TipoSuperficie.ALTRO: 0.4,
            TipoSuperficie.SCONOSCIUTA: None,
        }[road.superficie]

    def _avoid_multiplier(self, preference: ModalitaPreferenza) -> float:
        # "allow" mantiene il costo di base; "avoid" accentua la penalità; "exclude" è già filtrato.
        return self.pesi.moltiplicatore_evita if preference == ModalitaPreferenza.EVITA else 1.0

    def _unknown_attribute_count(self, road: Strada, vehicle: ProfiloCamion) -> int:
        checks = [
            road.stato_superficie != StatoDato.NOTO or road.superficie == TipoSuperficie.SCONOSCIUTA,
            road.stato_larghezza != StatoDato.NOTO or road.larghezza_strada_m is None or vehicle.larghezza_m is None,
            road.severita_urbana is None,
            road.severita_curva is None,
            road.stato_illuminazione != StatoDato.NOTO or road.illuminata is None,
            road.stato_pericolo != StatoDato.NOTO,
            road.stato_restrizioni != StatoDato.NOTO,
            road.stato_chiusura != StatoDato.NOTO or road.chiusa is None,
            road.accesso_camion == AccessoCamion.SCONOSCIUTO,
        ]
        missing_direct_constraint = any(
            limit is not None and dimension is None
            for dimension, limit in (
                (vehicle.altezza_m, road.altezza_massima_m),
                (vehicle.larghezza_m, road.larghezza_massima_m),
                (vehicle.lunghezza_m, road.lunghezza_massima_m),
                (vehicle.peso_totale_kg, road.peso_massimo_kg),
            )
        )
        missing_axle_constraint = any(
            vehicle.carichi_assi_kg is None or axle not in vehicle.carichi_assi_kg
            for axle in (road.carichi_assi_massimi_kg or {})
        )
        missing_vehicle_constraint = any(
            restriction.stato == StatoDato.NOTO
            and restriction.tipo in {
                TipoRestrizione.ALTEZZA,
                TipoRestrizione.LARGHEZZA,
                TipoRestrizione.LUNGHEZZA,
                TipoRestrizione.PESO_TOTALE,
                TipoRestrizione.CARICO_ASSE,
            }
            and self._dimensione_veicolo_per_restrizione(restriction, vehicle) is None
            for restriction in road.restrizioni
        )
        return sum(checks) + int(missing_vehicle_constraint) + int(missing_direct_constraint) + int(missing_axle_constraint)

    @staticmethod
    def _road_has_unknown_critical_data(road: Strada) -> bool:
        return (
            road.stato_restrizioni != StatoDato.NOTO
            or road.stato_chiusura != StatoDato.NOTO
            or road.chiusa is None
            or road.accesso_camion == AccessoCamion.SCONOSCIUTO
        )

    def _road_compatibility_uncertain(self, road: Strada, vehicle: ProfiloCamion) -> bool:
        if self._road_has_unknown_critical_data(road):
            return True
        if any(
            limit is not None and dimension is None
            for dimension, limit in (
                (vehicle.altezza_m, road.altezza_massima_m),
                (vehicle.larghezza_m, road.larghezza_massima_m),
                (vehicle.lunghezza_m, road.lunghezza_massima_m),
                (vehicle.peso_totale_kg, road.peso_massimo_kg),
            )
        ):
            return True
        if road.carichi_assi_massimi_kg and any(
            vehicle.carichi_assi_kg is None or axle not in vehicle.carichi_assi_kg
            for axle in road.carichi_assi_massimi_kg
        ):
            return True
        return any(
            restriction.stato != StatoDato.NOTO
            or (
                restriction.tipo in {
                    TipoRestrizione.ALTEZZA,
                    TipoRestrizione.LARGHEZZA,
                    TipoRestrizione.LUNGHEZZA,
                    TipoRestrizione.PESO_TOTALE,
                    TipoRestrizione.CARICO_ASSE,
                }
                and self._dimensione_veicolo_per_restrizione(restriction, vehicle) is None
            )
            for restriction in road.restrizioni
        )

    @staticmethod
    def _in_validity(when: datetime, start: datetime | None, end: datetime | None) -> bool:
        if start is not None and when < start:
            return False
        if end is not None and when > end:
            return False
        return True

    @staticmethod
    def _restriction_applies(restriction: RestrizioneStradale, vehicle: ProfiloCamion) -> bool:
        if not restriction.veicoli_applicabili:
            return True
        return vehicle.tipo_camion in restriction.veicoli_applicabili

    @staticmethod
    def _dimensione_veicolo_per_restrizione(
        restriction: RestrizioneStradale, vehicle: ProfiloCamion
    ) -> float | None:
        if restriction.tipo == TipoRestrizione.CARICO_ASSE:
            if restriction.nome_asse is None or vehicle.carichi_assi_kg is None:
                return None
            return vehicle.carichi_assi_kg.get(restriction.nome_asse)
        return {
            TipoRestrizione.ALTEZZA: vehicle.altezza_m,
            TipoRestrizione.LARGHEZZA: vehicle.larghezza_m,
            TipoRestrizione.LUNGHEZZA: vehicle.lunghezza_m,
            TipoRestrizione.PESO_TOTALE: vehicle.peso_totale_kg,
        }.get(restriction.tipo)

    @staticmethod
    def _generic_restriction_violated(restriction: RestrizioneStradale, vehicle: ProfiloCamion) -> bool:
        value = restriction.valore
        fields = {
            TipoRestrizione.ALTEZZA: vehicle.altezza_m,
            TipoRestrizione.LARGHEZZA: vehicle.larghezza_m,
            TipoRestrizione.LUNGHEZZA: vehicle.lunghezza_m,
            TipoRestrizione.PESO_TOTALE: vehicle.peso_totale_kg,
        }
        if restriction.tipo in fields:
            vehicle_value = fields[restriction.tipo]
            return vehicle_value is not None and float(vehicle_value) > float(value)
        if restriction.tipo == TipoRestrizione.ACCESSO_CAMION:
            return str(value).lower() in {"forbidden", "vietato", "false", "no"}
        if restriction.tipo == TipoRestrizione.CHIUSURA:
            return value is True or str(value).lower() in {"true", "closed", "chiusa"}
        if restriction.tipo == TipoRestrizione.CARICO_ASSE:
            if restriction.nome_asse is None or not vehicle.carichi_assi_kg:
                return False
            axle_load = vehicle.carichi_assi_kg.get(restriction.nome_asse)
            return axle_load is not None and axle_load > float(value)
        return False

    def _compatibility_status(
        self, path: Sequence[_Arco], vehicle: ProfiloCamion
    ) -> Literal["not_verified", "partially_verified", "verified"]:
        if not vehicle.validato:
            return "not_verified"
        if any(self._road_compatibility_uncertain(arc.strada, vehicle) for arc in path):
            return "partially_verified"
        if any(arc.strada.stato_superficie != StatoDato.NOTO for arc in path):
            return "partially_verified"
        if any(arc.strada.stato_larghezza != StatoDato.NOTO for arc in path):
            return "partially_verified"
        return "verified"
