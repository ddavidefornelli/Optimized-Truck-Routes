# Fondamenta frontend

## Principi

L'interfaccia è indipendente dai DTO HTTP. Il modello `RoutePlan` contiene una lista **ordinata** di `RouteStop`, con origine e consegne; oggi il form ne espone due. `RouteService` è il punto di integrazione sostituibile, mentre `routes-v1.ts` converte tra dominio e JSON e valida i dati in ingresso come `unknown`, senza affidarsi a cast TypeScript della risposta.

Questo rende localizzati i cambiamenti di contratto, non garantisce compatibilità automatica con JSON arbitrari. Campi aggiuntivi sono ignorati; cambiamenti incompatibili richiedono l'aggiornamento dell'adapter o un nuovo adapter/versione e relativi test, non la riscrittura dei componenti. Un cambio del solo URL è configurabile tramite ambiente.

## Contratto provvisorio `/api/v1/routes`

La specification definisce una richiesta ma solo le categorie della risposta: il backend non esiste ancora. Il seguente è il contratto concreto **proposto dal client**, da confermare quando viene implementato il server.

### Richiesta

`POST`, `Content-Type: application/json`, senza parametri del camion:

```json
{
  "origin": { "longitude": 24.9384, "latitude": 60.1699 },
  "destination": { "longitude": 25.6639, "latitude": 60.3929 },
  "profiles": ["balanced"],
  "preferences": {
    "unpaved": "avoid",
    "narrow_roads": "avoid",
    "urban_areas": "avoid",
    "tight_curves": "avoid",
    "unlit_at_night": "avoid",
    "unknown_critical_restrictions": "warn"
  }
}
```

Il profilo camion standard è risolto dal backend. Nessuna misura del mezzo è hardcoded nel frontend. La UI iniziale richiede il profilo bilanciato con preferenze fisse; eventuali alternative restituite vengono comunque mostrate e selezionate.

### Risposta con percorso

```json
{
  "status": "ok",
  "mode": "real",
  "request_id": "request-123",
  "vehicle_profile": {
    "id": "standard",
    "version": "1",
    "height_m": 4,
    "width_m": 2.55,
    "length_m": 16.5,
    "mass_kg": 32000
  },
  "routes": [
    {
      "id": "route-balanced",
      "profiles": ["balanced"],
      "geometry": {
        "type": "LineString",
        "coordinates": [[24.9384, 60.1699], [25.6639, 60.3929]]
      },
      "distance_m": 58400,
      "duration_s": 3120,
      "warnings": ["Compatibilità non verificata sui tratti con dati mancanti."]
    }
  ],
  "warnings": []
}
```

**Tutti i numeri dell'esempio sono illustrativi**, non parametri approvati del camion né il risultato di routing reale. La linea a due punti documenta il formato e non rappresenta una strada percorribile.

- GeoJSON è WGS84, ordine `[longitudine, latitudine]`, diverso dall'ordine del campo testo della UI. Sono supportati `LineString`, `MultiLineString` e `Feature` che li contiene.
- `status` è obbligatorio: `ok` richiede almeno un percorso, `no_route` non può contenerne.
- `id` di percorso univoco e geometria valida sono obbligatori; la geometria viene validata anche per limiti delle coordinate.
- `name` è un'etichetta facoltativa; senza di essa si usa il primo profilo riconosciuto o “Percorso”.
- `distance_m` e `duration_s` sono facoltativi/null, in metri e secondi, finiti e non negativi. Se mancanti, la UI non inventa stime.
- `mode` può essere `demo` o `real`. L'assenza viene resa come modalità sconosciuta e segnalata, non interpretata come dati reali.
- `warnings` sono liste facoltative di stringhe, globali o per percorso. Avvisi strutturati futuri andranno normalizzati nell'adapter.
- `vehicle_profile` è facoltativo; se presente richiede `id` e `version` stringa. Le dimensioni e la massa possono essere assenti/null. Parametri restituiti sono visualizzati in un dettaglio espandibile. I dati degli assi, quando disponibili, richiederanno un'estensione esplicita del riepilogo.
- `request_id` è una stringa facoltativa conservata nel modello, senza registrare coordinate nei log.
- Campi sconosciuti aggiuntivi non rompono il client; strutture note incompatibili producono un errore leggibile anziché un risultato fuorviante.

### Nessun percorso

```json
{
  "status": "no_route",
  "mode": "real",
  "routes": [],
  "warnings": ["Nessun percorso trovato nel grafo disponibile."]
}
```

Nessun vincolo è rilassato dal frontend. Errori HTTP `422`, `429` e `503` hanno messaggi specifici; altri errori HTTP, JSON incompatibile, rete non raggiungibile e timeout sono distinguibili. Non vengono esposte indiscriminatamente risposte tecniche del server. I futuri errori di dominio strutturati (copertura, snapping, ecc.) vanno aggiunti nell'adapter.

## Lifecycle delle richieste

Ogni modifica dei punti, inversione, uscita dalla demo o cancellazione abortisce la richiesta e invalida il risultato. Un contatore di generazione impedisce a risposte obsolete di aggiornare la UI anche quando un trasporto ignora l'abort. Lo smontaggio abortisce il lavoro residuo. Timeout HTTP: 20 secondi, configurabile nella factory del client.

## Evoluzioni previste

1. **Consegne multiple:** aggiungere campi/reordering della lista di tappe e un adapter per il contratto multi-stop. L'adapter attuale rifiuta più di due tappe: non elimina consegne silenziosamente. Ottimizzazione dell'ordine e VRP rimangono responsabilità del backend, separati dalla semplice lista ordinata.
2. **Indirizzi:** introdurre un servizio di geocoding esplicitamente configurato che converta indirizzi in `Coordinates`, conservando etichette e ambiguità; non inoltrare stringhe non risolte come coordinate.
3. **JSON futuro:** mantenere DTO/versione e conversioni dentro `lib/api`; estendere il dominio solo quando la UI deve rappresentare nuove informazioni.
4. **Fonti e compatibilità:** aggiungere qualità/copertura dei dati, punti di aggancio e riepilogo completo delle restrizioni quando il backend li espone. Il client iniziale non dichiara transitabilità certificata.
5. **Basemap:** configurare un provider MapLibre con attribuzioni e termini appropriati. L'attuale griglia offline non visualizza strade. Fallimenti della basemap sono dichiarati e fanno usare la griglia.

La demo è una fixture locale opt-in, non un algoritmo, non usa reti stradali e non verifica il camion. I cambiamenti dei punti tornano alla modalità API; non esiste un fallback automatico da un errore reale a un risultato demo.
