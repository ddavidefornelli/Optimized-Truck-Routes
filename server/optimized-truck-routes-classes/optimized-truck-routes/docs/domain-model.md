# Modello a oggetti del routing

Questo modulo introduce un secondo entry point, indipendente dall'API HTTP esistente:
`truck_routes.routing.domain_router.RouterOggetti`. È pensato per verificare il modello a oggetti
prima di collegarlo all'API e all'adattatore Supabase.

## Classi principali

| Classe | Significato | Campi e unità importanti |
|---|---|---|
| `Nodo` | Stato/contesto del camion richiesto dall'applicazione | `id_nodo`, `tipo_camion`, `peso_camion` (kg), `nome_compagnia`, `strada_attuale`; dimensioni opzionali |
| `NodoStradale` | Vertice topologico della rete: incrocio, estremità o nodo virtuale | `id_nodo_stradale`, longitudine/latitudine, `livello_topologico` |
| `Strada` | Segmento stradale omogeneo, orientato fra due nodi stradali | ID, `strade_incidenti`, origine/destinazione, lunghezza/larghezza in m, direzione, superficie, velocità, restrizioni, traffico, illuminazione, severità urbana/curve/eventi, fonte |
| `Curva` | Curva o svolta associata a più segmenti in un punto topologico | raggio in m, angolo in gradi, `strada_compresa`, severità, eventuale transitabilità verificata |
| `ProfiloCamion` | Parametri del mezzo usati per controllare i limiti | altezza/larghezza/lunghezza in m, massa e carichi assi in kg, raggio minimo di svolta opzionale, stato di validazione |
| `RegolaSvolta` | Regola per una transizione entrante → uscente | divieto, penalità in secondi, fonte e validità temporale |
| `RestrizioneStradale` | Restrizione tipizzata legata a un segmento | tipo/valore/unità, veicoli applicabili, `nome_asse` per limiti di carico su un asse, validità, stato e fonte |

## Nodo camion e nodo stradale sono diversi

`Nodo` mantiene i campi richiesti (camion, compagnia e strada attuale). Per non inserire i dati di
un veicolo dentro ogni incrocio, il grafo usa `NodoStradale`. Il motore accetta anche `ProfiloCamion`
separatamente: le dimensioni mancanti rimangono `None`, non vengono inventate.

`strade_incidenti` è un'informazione ausiliaria; non crea da sola un collegamento. Il routing segue
solo gli ID origine/destinazione. Due geometrie che si incrociano alle stesse coordinate, ma a
livelli topologici distinti (per esempio ponte e strada sottostante), restano disconnesse a meno che
i dati non dichiarino lo stesso nodo di connessione.

## Come viene calcolato il percorso

`RouterOggetti` genera archi diretti e applica Dijkstra sullo stato `(nodo_corrente, arco_entrante)`.
In questo modo le regole di svolta e le curve che collegano due tratti possono influenzare la
transizione, non soltanto il costo dei singoli segmenti.

- `shortest`: minimizza i metri, mantenendo attivi i vincoli rigidi e le preferenze `exclude`.
- `balanced`: combina tempo stimato, distanza equivalente e penalità.
- `road_comfort`: dà maggiore importanza alle penalità di strada.

Le penalità modellate includono superficie, larghezza relativa al camion, proxy urbana, curvatura,
tratti non illuminati al momento stimato, pericoli documentati e dati sconosciuti. Pesi e soglie sono
ipotesi iniziali configurabili da `PesiRouting`, non limiti certificati.

### Restrizioni e dati non noti

Sensi unici, chiusure attive, accesso vietato, limiti dimensionali/massa noti, regole di svolta
vietate e opzione `exclude` sono vincoli rigidi. `restrizioni_critiche_sconosciute="exclude"` scarta
anche i tratti in cui accesso/restrizioni/chiusure critiche non sono documentati; con `warn`, il
motore può proporre un percorso ma riporta avvisi.

Lo stato `known / unknown / not_applicable` è distinto dal valore dell'attributo. Per esempio,
illuminazione sconosciuta non è equivalente a strada non illuminata e superficie sconosciuta non è
considerata automaticamente asfaltata.

### Curva e manovrabilità

`Curva.stima_passabilita()` confronta il raggio disponibile con il raggio minimo fornito dal profilo,
con un margine prudenziale configurabile. È un filtro euristico: la reale manovrabilità dipende anche
da interasse, sbalzi, geometria, larghezza all'incrocio e traiettoria spazzata. Solo un valore
marcato `passabilita_verificata=True` può rendere una curva esplicitamente non transitabile un vincolo
rigido. La curvatura non classifica una curva come cieca.

## Eseguire l'esempio

Da `backend/`, dopo aver installato il progetto:

```bash
python examples/demo_classi.py
```

La rete dell'esempio è sintetica. Il router a oggetti è testato ma, in questa fase, non sostituisce
ancora il motore usato dall'endpoint HTTP `/api/v1/routes`; il collegamento richiederà un adattatore
esplicito fra i modelli API/database e queste classi.
