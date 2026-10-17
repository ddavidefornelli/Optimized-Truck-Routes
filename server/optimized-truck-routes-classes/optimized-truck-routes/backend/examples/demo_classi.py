"""Demo sintetica delle classi di dominio e di RouterOggetti.

Eseguire da backend dopo ``python -m pip install -e '.[dev]'``:
    python examples/demo_classi.py

Le coordinate e i segmenti sono fittizi e non rappresentano strade reali.
"""

from datetime import datetime
from zoneinfo import ZoneInfo

from truck_routes.domain import (
    AccessoCamion,
    Curva,
    NodoStradale,
    ProfiloCamion,
    ProfiloPercorso,
    RegolaSvolta,
    StatoDato,
    Strada,
    TipoSuperficie,
)
from truck_routes.routing import PreferenzePercorso, RouterOggetti


def crea_strada(
    id_strada: str,
    origine: str,
    destinazione: str,
    lunghezza_m: float,
    *,
    larghezza_m: float = 7.0,
    superficie: TipoSuperficie = TipoSuperficie.ASFALTO,
    severita_urbana: float = 0.1,
    severita_curva: float = 0.1,
) -> Strada:
    return Strada(
        id_strada=id_strada,
        strade_incidenti=[],
        lunghezza_strada_m=lunghezza_m,
        larghezza_strada_m=larghezza_m,
        nodo_origine_id=origine,
        nodo_destinazione_id=destinazione,
        classe_strada="demo",
        limite_velocita_kmh=50,
        superficie=superficie,
        stato_superficie=StatoDato.NOTO,
        stato_larghezza=StatoDato.NOTO,
        accesso_camion=AccessoCamion.CONSENTITO,
        stato_restrizioni=StatoDato.NOTO,
        chiusa=False,
        stato_chiusura=StatoDato.NOTO,
        illuminata=True,
        stato_illuminazione=StatoDato.NOTO,
        severita_urbana=severita_urbana,
        severita_curva=severita_curva,
        pericolo_documentato=False,
        severita_pericolo=0.0,
        stato_pericolo=StatoDato.NOTO,
        fonte_dato="demo sintetica, non usare per navigazione reale",
    )


def main() -> None:
    # Topologia fittizia: itinerario diretto e itinerario alternativo.
    nodi = [
        NodoStradale("start", 24.90, 60.17),
        NodoStradale("inner-junction", 24.91, 60.175),
        NodoStradale("outer-junction", 24.915, 60.165),
        NodoStradale("destination", 24.93, 60.18),
    ]
    strade = [
        crea_strada(
            "inner-1", "start", "inner-junction", 500,
            larghezza_m=3.7, severita_urbana=0.8, severita_curva=0.7,
        ),
        crea_strada(
            "inner-2", "inner-junction", "destination", 550,
            larghezza_m=3.4, superficie=TipoSuperficie.STERRATO,
            severita_urbana=0.8, severita_curva=0.85,
        ),
        crea_strada("outer-1", "start", "outer-junction", 900, larghezza_m=8.0),
        crea_strada("outer-2", "outer-junction", "destination", 950, larghezza_m=8.0),
    ]
    curve = [
        Curva(
            id_curva="tight-inner-turn",
            raggio_m=8.0,
            angolo_gradi=90.0,
            strada_compresa=["inner-1", "inner-2"],
            id_nodo_stradale="inner-junction",
            severita=0.9,
            passabile_camion=None,
            passabilita_verificata=False,
        )
    ]
    # Nessun divieto di svolta di esempio; il parametro è pronto per regole provenienti dai dati.
    regole_svolta: list[RegolaSvolta] = []
    router = RouterOggetti(nodi, strade, curve=curve, regole_svolta=regole_svolta)
    camion = ProfiloCamion(
        id_profilo="example-truck",
        versione="0.1-demo",
        tipo_camion="articolato",
        peso_totale_kg=18000,
        larghezza_m=2.55,
        altezza_m=3.8,
        lunghezza_m=12,
        raggio_minimo_svolta_m=12,
        validato=False,
        note="Valori inventati solo per la demo.",
    )
    preferences = PreferenzePercorso()
    departure = datetime(2026, 10, 11, 12, 0, tzinfo=ZoneInfo("Europe/Helsinki"))

    for profile in (ProfiloPercorso.PIU_BREVE, ProfiloPercorso.BILANCIATO, ProfiloPercorso.COMFORT_STRADA):
        result = router.calcola_percorso(
            "start", "destination", camion, profile, preferences, departure
        )
        print(f"\nProfilo: {profile.value}")
        print(f"  Strade: {' -> '.join(result.id_strade)}")
        print(f"  Distanza: {result.distanza_totale_m:.0f} m")
        print(f"  Durata stimata: {result.tempo_stimato_secondi / 60:.1f} min")
        print(f"  Costo modello: {result.costo_totale:.2f}")
        print(f"  Compatibilità: {result.compatibilita}")
        print(f"  Scomposizione costi: {result.dettaglio_costi.as_dict()}")
        for warning in result.avvisi[:3]:
            print(f"  AVVISO: {warning}")

    print("\nATTENZIONE: è un grafo sintetico e non va usato per navigazione reale.")


if __name__ == "__main__":
    main()
