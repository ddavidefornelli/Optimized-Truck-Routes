"""Domain entities for truck-aware road routing.

All distances are metres, speeds are km/h, masses are kilograms, coordinates use
(longitude, latitude) in WGS84 (EPSG:4326). Missing knowledge is represented explicitly;
``None`` never means "safe" or "allowed".
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
import math
from typing import Any


def _non_empty(value: str, field_name: str) -> None:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field_name} deve essere una stringa non vuota")


def _positive(value: float | None, field_name: str, *, allow_zero: bool = False) -> None:
    if value is None:
        return
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{field_name} deve essere numerico")
    numeric = float(value)
    if not math.isfinite(numeric):
        raise ValueError(f"{field_name} deve essere un numero finito")
    if allow_zero and numeric == 0:
        return
    if numeric <= 0:
        operator = ">= 0" if allow_zero else "> 0"
        raise ValueError(f"{field_name} deve essere {operator}")


def _severity(value: float | None, field_name: str) -> None:
    if value is None:
        return
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{field_name} deve essere numerico")
    numeric = float(value)
    if not math.isfinite(numeric) or not 0.0 <= numeric <= 1.0:
        raise ValueError(f"{field_name} deve essere un valore finito compreso tra 0 e 1")


def _timezone_aware(value: datetime | None, field_name: str) -> None:
    if value is not None and (value.tzinfo is None or value.utcoffset() is None):
        raise ValueError(f"{field_name} deve includere il fuso orario")


class StatoDato(StrEnum):
    NOTO = "known"
    SCONOSCIUTO = "unknown"
    NON_APPLICABILE = "not_applicable"


class TipoSuperficie(StrEnum):
    ASFALTO = "asphalt"
    STERRATO = "unpaved"
    GHIAIA = "gravel"
    ALTRO = "other"
    SCONOSCIUTA = "unknown"


class SensoDiMarcia(StrEnum):
    AVANTI = "forward"  # dall'origine alla destinazione dichiarata
    INDIETRO = "reverse"  # dalla destinazione all'origine dichiarata
    DOPPIO_SENSO = "both"


class AccessoCamion(StrEnum):
    CONSENTITO = "allowed"
    VIETATO = "forbidden"
    SCONOSCIUTO = "unknown"


class ModalitaPreferenza(StrEnum):
    CONSENTI = "allow"
    EVITA = "avoid"
    ESCLUDI = "exclude"


class ProfiloPercorso(StrEnum):
    PIU_BREVE = "shortest"
    BILANCIATO = "balanced"
    COMFORT_STRADA = "road_comfort"


class TipoRestrizione(StrEnum):
    ALTEZZA = "height"
    LARGHEZZA = "width"
    LUNGHEZZA = "length"
    PESO_TOTALE = "gross_weight"
    CARICO_ASSE = "axle_load"
    ACCESSO_CAMION = "truck_access"
    CHIUSURA = "closed"
    ALTRO = "other"


@dataclass(slots=True)
class Nodo:
    """Record del camion durante la navigazione, con i campi richiesti.

    ``peso_camion`` è la massa totale in kg; ``strada_attuale`` contiene l'ID della
    strada/segmento corrente, non il nome visualizzato sulla mappa. Questo oggetto non è
    il vertice topologico condiviso del grafo: per quello esiste ``NodoStradale``.
    """

    id_nodo: str
    tipo_camion: str
    peso_camion: float
    nome_compagnia: str
    strada_attuale: str | None = None
    larghezza_camion_m: float | None = None
    altezza_camion_m: float | None = None
    lunghezza_camion_m: float | None = None
    carichi_assi_kg: dict[str, float] | None = None

    def __post_init__(self) -> None:
        _non_empty(self.id_nodo, "id_nodo")
        _non_empty(self.tipo_camion, "tipo_camion")
        _non_empty(self.nome_compagnia, "nome_compagnia")
        _positive(self.peso_camion, "peso_camion")
        for name in ("larghezza_camion_m", "altezza_camion_m", "lunghezza_camion_m"):
            _positive(getattr(self, name), name)
        if self.strada_attuale is not None:
            _non_empty(self.strada_attuale, "strada_attuale")
        if self.carichi_assi_kg is not None:
            for axle, load in self.carichi_assi_kg.items():
                _non_empty(axle, "nome asse")
                _positive(load, f"carichi_assi_kg[{axle}]")

    def aggiorna_strada(self, id_strada: str) -> None:
        """Aggiorna il segmento in cui il camion risulta attualmente posizionato."""
        _non_empty(id_strada, "id_strada")
        self.strada_attuale = id_strada


@dataclass(slots=True)
class NodoStradale:
    """Vertice topologico della rete (incrocio, estremità o nodo virtuale).

    Due strade sono connesse solo se condividono l'ID di un nodo stradale. Coordinate
    coincidenti da sole non creano una connessione: questo evita di unire per errore
    ponti, tunnel e strade che si incrociano a livelli diversi.
    """

    id_nodo_stradale: str
    longitudine: float
    latitudine: float
    livello_topologico: int = 0
    id_nodo_fonte: str | None = None

    def __post_init__(self) -> None:
        _non_empty(self.id_nodo_stradale, "id_nodo_stradale")
        if not -180.0 <= self.longitudine <= 180.0:
            raise ValueError("longitudine deve essere compresa tra -180 e 180")
        if not -90.0 <= self.latitudine <= 90.0:
            raise ValueError("latitudine deve essere compresa tra -90 e 90")
        if not isinstance(self.livello_topologico, int) or isinstance(self.livello_topologico, bool):
            raise ValueError("livello_topologico deve essere un intero")
        if self.id_nodo_fonte is not None:
            _non_empty(self.id_nodo_fonte, "id_nodo_fonte")


@dataclass(slots=True)
class ProfiloCamion:
    """Parametri del veicolo usati dal motore, distinti dalle preferenze di percorso."""

    id_profilo: str
    versione: str
    tipo_camion: str
    peso_totale_kg: float | None = None
    larghezza_m: float | None = None
    altezza_m: float | None = None
    lunghezza_m: float | None = None
    carichi_assi_kg: dict[str, float] | None = None
    raggio_minimo_svolta_m: float | None = None
    validato: bool = False
    note: str = "Profilo non ancora validato per l'impiego reale."

    def __post_init__(self) -> None:
        _non_empty(self.id_profilo, "id_profilo")
        _non_empty(self.versione, "versione")
        _non_empty(self.tipo_camion, "tipo_camion")
        for name in (
            "peso_totale_kg",
            "larghezza_m",
            "altezza_m",
            "lunghezza_m",
            "raggio_minimo_svolta_m",
        ):
            _positive(getattr(self, name), name)
        if self.carichi_assi_kg is not None:
            for axle, load in self.carichi_assi_kg.items():
                _non_empty(axle, "nome asse")
                _positive(load, f"carichi_assi_kg[{axle}]")

    @classmethod
    def da_nodo(cls, nodo: Nodo, *, versione: str = "1", validato: bool = False) -> "ProfiloCamion":
        """Crea un profilo dai dati del nodo/mezzo; le dimensioni mancanti restano ignote."""
        return cls(
            id_profilo=f"camion-{nodo.id_nodo}",
            versione=versione,
            tipo_camion=nodo.tipo_camion,
            peso_totale_kg=nodo.peso_camion,
            larghezza_m=nodo.larghezza_camion_m,
            altezza_m=nodo.altezza_camion_m,
            lunghezza_m=nodo.lunghezza_camion_m,
            carichi_assi_kg=nodo.carichi_assi_kg,
            validato=validato,
            note="Creato dai dati del nodo; le dimensioni non fornite non sono state inferite.",
        )


@dataclass(slots=True)
class RestrizioneStradale:
    """Restrizione attribuita a un segmento, conservando fonte e validità temporale."""

    id_restrizione: str
    tipo: TipoRestrizione
    valore: float | str | bool
    unita: str | None = None
    id_strada: str | None = None
    veicoli_applicabili: list[str] = field(default_factory=list)
    valida_da: datetime | None = None
    valida_fino_a: datetime | None = None
    stato: StatoDato = StatoDato.NOTO
    fonte: str | None = None
    nome_asse: str | None = None

    def __post_init__(self) -> None:
        _non_empty(self.id_restrizione, "id_restrizione")
        self.tipo = TipoRestrizione(self.tipo)
        self.stato = StatoDato(self.stato)
        if self.nome_asse is not None:
            _non_empty(self.nome_asse, "nome_asse")
        numeric_restrictions = {
            TipoRestrizione.ALTEZZA,
            TipoRestrizione.LARGHEZZA,
            TipoRestrizione.LUNGHEZZA,
            TipoRestrizione.PESO_TOTALE,
            TipoRestrizione.CARICO_ASSE,
        }
        if self.tipo in numeric_restrictions and self.stato == StatoDato.NOTO:
            try:
                numeric_value = float(self.valore)
            except (TypeError, ValueError) as exc:
                raise ValueError(f"il valore della restrizione {self.tipo.value} deve essere numerico") from exc
            _positive(numeric_value, f"valore restrizione {self.tipo.value}")
        if self.tipo == TipoRestrizione.CARICO_ASSE and self.stato == StatoDato.NOTO and self.nome_asse is None:
            raise ValueError("nome_asse è necessario per una restrizione di carico asse nota")
        if self.id_strada is not None:
            _non_empty(self.id_strada, "id_strada")
        if self.fonte is not None:
            _non_empty(self.fonte, "fonte")
        _timezone_aware(self.valida_da, "valida_da")
        _timezone_aware(self.valida_fino_a, "valida_fino_a")
        if self.valida_da and self.valida_fino_a and self.valida_da > self.valida_fino_a:
            raise ValueError("valida_da non può essere successiva a valida_fino_a")


@dataclass(slots=True)
class Strada:
    """Un tratto omogeneo della rete stradale e dei suoi attributi.

    ``strade_incidenti`` è un elenco informativo di ID di altri segmenti che si collegano
    in incroci noti; la topologia del grafo deriva invece dai nodi origine/destinazione.
    Gli attributi con stato ``unknown`` non vengono mai interpretati come assenza di rischio.
    """

    id_strada: str
    strade_incidenti: list[str]
    lunghezza_strada_m: float
    larghezza_strada_m: float | None
    nodo_origine_id: str
    nodo_destinazione_id: str
    senso_marcia: SensoDiMarcia = SensoDiMarcia.AVANTI
    geometria: tuple[tuple[float, float], ...] = ()
    classe_strada: str | None = None
    limite_velocita_kmh: float | None = None
    superficie: TipoSuperficie = TipoSuperficie.SCONOSCIUTA
    stato_superficie: StatoDato = StatoDato.SCONOSCIUTO
    stato_larghezza: StatoDato = StatoDato.SCONOSCIUTO
    altezza_massima_m: float | None = None
    larghezza_massima_m: float | None = None
    lunghezza_massima_m: float | None = None
    peso_massimo_kg: float | None = None
    carichi_assi_massimi_kg: dict[str, float] | None = None
    accesso_camion: AccessoCamion = AccessoCamion.SCONOSCIUTO
    stato_restrizioni: StatoDato = StatoDato.SCONOSCIUTO
    chiusa: bool | None = None
    stato_chiusura: StatoDato = StatoDato.SCONOSCIUTO
    chiusura_valida_da: datetime | None = None
    chiusura_valida_fino_a: datetime | None = None
    velocita_traffico_kmh: float | None = None
    ritardo_traffico_secondi: float | None = None
    traffico_osservato_il: datetime | None = None
    traffico_valido_fino_a: datetime | None = None
    confidenza_traffico: float | None = None
    illuminata: bool | None = None
    stato_illuminazione: StatoDato = StatoDato.SCONOSCIUTO
    severita_urbana: float | None = None
    severita_curva: float | None = None
    pericolo_documentato: bool | None = None
    severita_pericolo: float | None = None
    stato_pericolo: StatoDato = StatoDato.SCONOSCIUTO
    curva_ids: list[str] = field(default_factory=list)
    restrizioni: list[RestrizioneStradale] = field(default_factory=list)
    id_strada_fonte: str | None = None
    fonte_dato: str | None = None
    attributi_extra: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        _non_empty(self.id_strada, "id_strada")
        _non_empty(self.nodo_origine_id, "nodo_origine_id")
        _non_empty(self.nodo_destinazione_id, "nodo_destinazione_id")
        if self.nodo_origine_id == self.nodo_destinazione_id:
            raise ValueError("Una strada non può collegare il nodo a se stesso")
        _positive(self.lunghezza_strada_m, "lunghezza_strada_m")
        for name in (
            "larghezza_strada_m",
            "limite_velocita_kmh",
            "altezza_massima_m",
            "larghezza_massima_m",
            "lunghezza_massima_m",
            "peso_massimo_kg",
            "velocita_traffico_kmh",
        ):
            _positive(getattr(self, name), name)
        if self.carichi_assi_massimi_kg is not None:
            for axle, maximum in self.carichi_assi_massimi_kg.items():
                _non_empty(axle, "nome asse")
                _positive(maximum, f"carichi_assi_massimi_kg[{axle}]")
        _positive(self.ritardo_traffico_secondi, "ritardo_traffico_secondi", allow_zero=True)
        for name in ("severita_urbana", "severita_curva", "severita_pericolo", "confidenza_traffico"):
            _severity(getattr(self, name), name)
        self.senso_marcia = SensoDiMarcia(self.senso_marcia)
        self.superficie = TipoSuperficie(self.superficie)
        self.stato_superficie = StatoDato(self.stato_superficie)
        self.stato_larghezza = StatoDato(self.stato_larghezza)
        self.accesso_camion = AccessoCamion(self.accesso_camion)
        self.stato_restrizioni = StatoDato(self.stato_restrizioni)
        self.stato_chiusura = StatoDato(self.stato_chiusura)
        self.stato_illuminazione = StatoDato(self.stato_illuminazione)
        self.stato_pericolo = StatoDato(self.stato_pericolo)
        # A known state must not silently coexist with a missing/unknown value.
        if self.stato_superficie == StatoDato.NOTO and self.superficie == TipoSuperficie.SCONOSCIUTA:
            raise ValueError("stato_superficie='known' richiede una superficie nota")
        if self.stato_larghezza == StatoDato.NOTO and self.larghezza_strada_m is None:
            raise ValueError("stato_larghezza='known' richiede larghezza_strada_m")
        if self.stato_chiusura == StatoDato.NOTO and self.chiusa is None:
            raise ValueError("stato_chiusura='known' richiede chiusa=True/False")
        if self.stato_illuminazione == StatoDato.NOTO and self.illuminata is None:
            raise ValueError("stato_illuminazione='known' richiede illuminata=True/False")
        if self.stato_pericolo == StatoDato.NOTO and self.pericolo_documentato is None:
            raise ValueError("stato_pericolo='known' richiede pericolo_documentato=True/False")
        if self.classe_strada is not None:
            _non_empty(self.classe_strada, "classe_strada")
        if self.id_strada_fonte is not None:
            _non_empty(self.id_strada_fonte, "id_strada_fonte")
        for when_name in (
            "chiusura_valida_da",
            "chiusura_valida_fino_a",
            "traffico_osservato_il",
            "traffico_valido_fino_a",
        ):
            _timezone_aware(getattr(self, when_name), when_name)
        if (
            self.chiusura_valida_da
            and self.chiusura_valida_fino_a
            and self.chiusura_valida_da > self.chiusura_valida_fino_a
        ):
            raise ValueError("La validità della chiusura non è un intervallo valido")
        if self.traffico_osservato_il and self.traffico_valido_fino_a:
            if self.traffico_osservato_il > self.traffico_valido_fino_a:
                raise ValueError("Il traffico non può scadere prima di essere osservato")
        for longitude, latitude in self.geometria:
            if not -180 <= longitude <= 180 or not -90 <= latitude <= 90:
                raise ValueError("Le coordinate della geometria non sono WGS84 valide")


@dataclass(slots=True)
class Curva:
    """Curva o svolta associata a uno o più segmenti.

    ``raggio_m`` descrive la dimensione geometrica stimata della curva. Il confronto con il
    raggio minimo del camion è una stima preliminare: da solo non prova che la traiettoria del
    veicolo sia fisicamente o legalmente transitabile. ``strada_compresa`` contiene gli ID dei
    segmenti da valutare insieme per la transizione all'incrocio.
    """

    id_curva: str
    raggio_m: float | None
    strada_compresa: list[str]
    angolo_gradi: float | None = None
    id_nodo_stradale: str | None = None
    passabile_camion: bool | None = None
    passabilita_verificata: bool = False
    severita: float | None = None
    fonte: str | None = None

    def __post_init__(self) -> None:
        _non_empty(self.id_curva, "id_curva")
        _positive(self.raggio_m, "raggio_m")
        if self.angolo_gradi is not None and not 0 <= self.angolo_gradi <= 180:
            raise ValueError("angolo_gradi deve essere compreso tra 0 e 180")
        if self.id_nodo_stradale is not None:
            _non_empty(self.id_nodo_stradale, "id_nodo_stradale")
        if self.fonte is not None:
            _non_empty(self.fonte, "fonte")
        _severity(self.severita, "severita")
        if self.passabilita_verificata and self.passabile_camion is None:
            raise ValueError("passabilita_verificata=True richiede passabile_camion=True/False")
        if len(self.strada_compresa) < 2:
            raise ValueError("strada_compresa deve indicare almeno due segmenti coinvolti")
        if len(set(self.strada_compresa)) != len(self.strada_compresa):
            raise ValueError("strada_compresa non può contenere duplicati")
        for road_id in self.strada_compresa:
            _non_empty(road_id, "strada_compresa")

    def stima_passabilita(self, raggio_minimo_camion_m: float | None, margine: float = 1.2) -> bool | None:
        """Stima semplice della compatibilità del raggio; restituisce None se ignota.

        Non sostituisce analisi della traiettoria spazzata, interasse, sbalzi o verifica sul posto.
        """
        if self.passabilita_verificata and self.passabile_camion is not None:
            return self.passabile_camion
        if self.raggio_m is None or raggio_minimo_camion_m is None:
            return None
        _positive(raggio_minimo_camion_m, "raggio_minimo_camion_m")
        if margine < 1.0:
            raise ValueError("margine deve essere almeno 1.0")
        return self.raggio_m >= raggio_minimo_camion_m * margine


@dataclass(slots=True)
class RegolaSvolta:
    """Regola applicata alla transizione fra strada entrante e uscente."""

    id_regola: str
    id_strada_entrante: str
    id_strada_uscente: str
    vietata: bool = False
    penalita_secondi: float = 0.0
    valida_da: datetime | None = None
    valida_fino_a: datetime | None = None
    stato: StatoDato = StatoDato.NOTO
    fonte: str | None = None
    direzione_arco_entrante: str | None = None
    direzione_arco_uscente: str | None = None

    def __post_init__(self) -> None:
        for name in ("id_regola", "id_strada_entrante", "id_strada_uscente"):
            _non_empty(getattr(self, name), name)
        _positive(self.penalita_secondi, "penalita_secondi", allow_zero=True)
        self.stato = StatoDato(self.stato)
        for name in ("direzione_arco_entrante", "direzione_arco_uscente"):
            direction = getattr(self, name)
            if direction is not None and direction not in {"forward", "reverse"}:
                raise ValueError(f"{name} deve essere 'forward', 'reverse' o None")
        _timezone_aware(self.valida_da, "valida_da")
        _timezone_aware(self.valida_fino_a, "valida_fino_a")
        if self.valida_da and self.valida_fino_a and self.valida_da > self.valida_fino_a:
            raise ValueError("La validità della regola di svolta non è un intervallo valido")

    def attiva_a(self, quando: datetime) -> bool:
        if self.valida_da and quando < self.valida_da:
            return False
        if self.valida_fino_a and quando > self.valida_fino_a:
            return False
        return True
