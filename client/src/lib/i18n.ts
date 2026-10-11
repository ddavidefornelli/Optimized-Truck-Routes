import { createSignal } from 'solid-js'

export type Language = 'fi' | 'en'
const storageKey = 'valio-aimo-language'
function savedLanguage(): Language {
  try { return localStorage.getItem(storageKey) === 'en' ? 'en' : 'fi' } catch { return 'fi' }
}
const [language, updateLanguage] = createSignal<Language>(savedLanguage())
export { language }
export const numberLocale = () => language() === 'fi' ? 'fi-FI' : 'en-GB'
export function setLanguage(value: Language) {
  updateLanguage(value)
  try { localStorage.setItem(storageKey, value) } catch { /* Storage can be disabled. */ }
}

// Legacy Italian messages are lookup keys only, never a selectable UI language.
// Unknown backend-authored labels/warnings are preserved rather than mistranslated.
const messages: Record<string, readonly [string, string]> = {
  'Percorsi autisti': ['Kuljettajan reitit', 'Driver routes'],
  'Vai alla pianificazione': ['Siirry reittisuunnitteluun', 'Skip to route planner'],
  'Valio Aimo, pagina iniziale': ['Valio Aimo, etusivu', 'Valio Aimo, home'],
  'Pianificazione del viaggio': ['Reittisuunnittelu', 'Route planner'],
  'Punto di partenza': ['Lähtöpaikka', 'Starting point'],
  'Punto di arrivo': ['Määränpää', 'Destination'],
  'Inverti partenza e arrivo': ['Vaihda lähtöpaikka ja määränpää', 'Swap start and destination'],
  'Latitudine, longitudine': ['Leveysaste, pituusaste', 'Latitude, longitude'],
  'Calcola percorso': ['Laske reitti', 'Calculate route'],
  'Calcolo in corso…': ['Lasketaan reittiä…', 'Calculating route…'],
  'Annulla calcolo': ['Peruuta laskenta', 'Cancel calculation'],
  'Modalità demo': ['Demotila', 'Demo mode'],
  'Dati sintetici, non utilizzabili per la guida.': ['Esimerkkitietoja. Ei ajokäyttöön.', 'Synthetic data. Not for driving.'],
  'Esci dalla demo': ['Poistu demosta', 'Exit demo'],
  'Prova un esempio': ['Kokeile esimerkkiä', 'Try an example'],
  'Segui sempre segnaletica e norme vigenti.': ['Noudata aina liikennemerkkejä ja voimassa olevia sääntöjä.', 'Always follow road signs and current regulations.'],
  'Indirizzo o coordinate': ['Osoite tai koordinaatit', 'Address or coordinates'],
  'Scegli partenza sulla mappa': ['Valitse lähtöpaikka kartalta', 'Choose start on map'],
  'Scegli arrivo sulla mappa': ['Valitse määränpää kartalta', 'Choose destination on map'],
  'Seleziona sulla mappa': ['Valitse kartalta', 'Choose on map'],
  'Cerca un indirizzo in Finlandia e seleziona un suggerimento, oppure inserisci latitudine, longitudine.': ['Hae osoitetta Suomessa ja valitse ehdotus tai syötä leveysaste ja pituusaste.', 'Search for an address in Finland and select a suggestion, or enter latitude, longitude.'],
  'Coordinate nel formato latitudine, longitudine, con il punto per i decimali.': ['Syötä leveysaste, pituusaste. Käytä pistettä desimaalierottimena.', 'Enter latitude, longitude, using a decimal point.'],
  'Ricerca…': ['Haetaan…', 'Searching…'],
  'Suggerimenti': ['Osoite-ehdotukset', 'Suggestions'],
  'Nessun indirizzo trovato.': ['Osoitteita ei löytynyt.', 'No addresses found.'],
  'Ricerca non disponibile. Riprova o scegli sulla mappa.': ['Haku ei ole käytettävissä. Yritä uudelleen tai valitse kartalta.', 'Search unavailable. Try again or choose on the map.'],
  'Seleziona un indirizzo dai suggerimenti o scegli sulla mappa.': ['Valitse osoite ehdotuksista tai kartalta.', 'Select an address from the suggestions or choose on the map.'],
  'Inserisci latitudine, longitudine valide.': ['Syötä kelvollinen leveysaste ja pituusaste.', 'Enter a valid latitude and longitude.'],
  'L’arrivo deve essere diverso dalla partenza.': ['Määränpään on oltava eri kuin lähtöpaikka.', 'Destination must differ from the starting point.'],
  'Si è verificato un errore durante il calcolo. Riprova.': ['Reitin laskenta epäonnistui. Yritä uudelleen.', 'Route calculation failed. Try again.'],
  'Il backend non ha accettato la richiesta. Controlla i punti inseriti.': ['Palvelin hylkäsi pyynnön. Tarkista valitut paikat.', 'The server rejected the request. Check your points.'],
  'I dati non sono validi per il backend. Controlla coordinate e contratto API.': ['Palvelin ei hyväksy tietoja. Tarkista koordinaatit ja API-sopimus.', 'Invalid server data. Check coordinates and the API contract.'],
  'Troppe richieste. Attendi un momento e riprova.': ['Liian monta pyyntöä. Odota hetki ja yritä uudelleen.', 'Too many requests. Wait a moment and try again.'],
  'Il motore di routing non è ancora pronto. Riprova più tardi.': ['Reitityspalvelu ei ole vielä valmis. Yritä myöhemmin uudelleen.', 'The routing service is not ready yet. Try again later.'],
  'Non è stato possibile calcolare il percorso. Riprova.': ['Reittiä ei voitu laskea. Yritä uudelleen.', 'Could not calculate the route. Try again.'],
  'Il backend ha restituito una risposta non leggibile.': ['Palvelimen vastausta ei voitu lukea.', 'The server returned an unreadable response.'],
  'Il calcolo sta impiegando troppo tempo. Riprova.': ['Reitin laskenta kestää liian kauan. Yritä uudelleen.', 'Route calculation timed out. Try again.'],
  'Backend non raggiungibile. Verifica che il server sia avviato oppure prova la demo.': ['Palvelimeen ei saada yhteyttä. Tarkista palvelin tai kokeile demoa.', 'Server unreachable. Check the server or try the demo.'],
  'La risposta del backend non è compatibile con il contratto di routing configurato.': ['Palvelimen vastaus ei vastaa reitityksen API-sopimusta.', 'The server response does not match the routing API contract.'],
  'Questa versione dell’API supporta una sola consegna per viaggio.': ['Tämä API-versio tukee vain yhtä toimitusta matkaa kohden.', 'This API version supports only one delivery per trip.'],
  'Inserisci due punti validi e distinti.': ['Syötä kaksi kelvollista, eri paikkaa.', 'Enter two valid, distinct points.'],
  'La demo è disponibile solo per i due punti di esempio.': ['Demo on käytettävissä vain kahdelle esimerkkipaikalle.', 'The demo is available only for the two example points.'],
  'Risultato del calcolo': ['Reitin tiedot', 'Route summary'],
  'Nessun percorso trovato': ['Reittiä ei löytynyt', 'No route found'],
  'Prova con altri punti.': ['Kokeile muita paikkoja.', 'Try different points.'],
  'Alternative di percorso': ['Reittivaihtoehdot', 'Route alternatives'],
  'Distanza': ['Matka', 'Distance'],
  'Durata stimata': ['Arvioitu ajoaika', 'Estimated duration'],
  'La modalità dei dati non è stata dichiarata dal backend.': ['Palvelin ei ilmoittanut tietojen tilaa.', 'The server did not declare the data mode.'],
  'Profilo veicolo applicato': ['Käytetty ajoneuvoprofiili', 'Applied vehicle profile'],
  'Altezza': ['Korkeus', 'Height'],
  'Larghezza': ['Leveys', 'Width'],
  'Lunghezza': ['Pituus', 'Length'],
  'Massa': ['Massa', 'Mass'],
  'Non disponibile': ['Ei saatavilla', 'Unavailable'],
  'Bilanciato': ['Tasapainoinen', 'Balanced'],
  'Più breve ammissibile': ['Lyhin sallittu', 'Shortest permitted'],
  'Minori penalità stradali': ['Paremmat tieolosuhteet', 'Better road conditions'],
  'Esempio di percorso': ['Esimerkkireitti', 'Example route'],
  'Percorso sintetico: non segue una rete stradale e non verifica le restrizioni dei camion. Non utilizzarlo per la guida.': ['Esimerkkireitti ei seuraa tieverkkoa eikä tarkista kuorma-autojen rajoituksia. Ei ajokäyttöön.', 'Synthetic route: does not follow roads or check truck restrictions. Do not use for driving.'],
  'Le strade non sono disponibili. Percorso su griglia geografica.': ['Tiekartta ei ole käytettävissä. Reitti näytetään koordinaattiruudukossa.', 'Roads unavailable. Route shown on a geographic grid.'],
  'Mappa del percorso': ['Reittikartta', 'Route map'],
  'Tocca la mappa per scegliere la partenza.': ['Valitse lähtöpaikka napauttamalla karttaa.', 'Tap the map to choose the start.'],
  'Tocca la mappa per scegliere l’arrivo.': ['Valitse määränpää napauttamalla karttaa.', 'Tap the map to choose the destination.'],
  'Mappa non disponibile': ['Kartta ei ole käytettävissä', 'Map unavailable'],
  'Griglia geografica · senza strade': ['Koordinaattiruudukko · ei teitä', 'Geographic grid · no roads'],
  'Percorso sintetico': ['Esimerkkireitti', 'Synthetic route'],
  'Partenza': ['Lähtöpaikka', 'Start'],
  'Arrivo': ['Määränpää', 'Destination'],
  'Zoom in': ['Lähennä', 'Zoom in'],
  'Zoom out': ['Loitonna', 'Zoom out'],
}

export function t(key: string): string {
  return messages[key]?.[language() === 'fi' ? 0 : 1] ?? key
}
