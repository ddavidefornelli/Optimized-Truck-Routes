import { For, Show } from 'solid-js'
import Icon from '../../components/Icon'
import type { RouteOption, RouteResult } from './domain'
import { formatDistance, formatDuration } from './domain'

export default function RouteSummary(props: { result: RouteResult; selected?: RouteOption; onSelect: (id: string) => void }) {
  const warnings = () => [...props.result.warnings, ...(props.selected?.warnings ?? [])]
  return (
    <section class="route-summary" aria-label="Risultato del calcolo">
      <Show when={props.result.status === 'ok'} fallback={<div class="no-route"><Icon name="info" /><h3>Nessun percorso trovato</h3><p>Non è stato trovato un percorso nel grafo disponibile. Prova con altri punti senza modificare i vincoli del camion.</p></div>}>
        <div class="section-heading"><h3>{props.result.mode === 'demo' ? 'Il tuo percorso di esempio' : 'Il tuo percorso'}</h3><span class="result-check"><Icon name="check" size={15} /> Calcolato</span></div>
        <Show when={props.result.routes.length > 1}>
          <div class="route-options" role="group" aria-label="Alternative di percorso"><For each={props.result.routes}>{(route) => <button type="button" aria-pressed={props.selected?.id === route.id} onClick={() => props.onSelect(route.id)}>{route.name}</button>}</For></div>
        </Show>
        <Show when={props.selected}>{(route) => <>
          <p class="route-name">{route().name}</p>
          <dl class="route-metrics">
            <div><dt><Icon name="distance" size={16} />Distanza</dt><dd>{formatDistance(route().distanceMeters)}</dd></div>
            <div><dt><Icon name="clock" size={16} />Durata stimata</dt><dd>{formatDuration(route().durationSeconds)}</dd></div>
          </dl>
        </>}</Show>
      </Show>
      <Show when={props.result.mode === 'unknown'}><p class="notice"><Icon name="info" size={16} />La modalità dei dati non è stata dichiarata dal backend.</p></Show>
      <Show when={warnings().length}><div class="route-warnings"><h4><Icon name="info" size={16} />Da tenere presente</h4><ul><For each={warnings()}>{(warning) => <li>{warning}</li>}</For></ul></div></Show>
      <Show when={props.result.vehicle}>{(vehicle) => <details class="vehicle-details"><summary>Profilo veicolo applicato</summary><p>{vehicle().id} · v{vehicle().version}</p><dl><For each={[
        ['Altezza', vehicle().heightMeters, 'm'], ['Larghezza', vehicle().widthMeters, 'm'],
        ['Lunghezza', vehicle().lengthMeters, 'm'], ['Massa', vehicle().massKg, 'kg'],
      ] as const}>{([label, value, unit]) => <div><dt>{label}</dt><dd>{value === null ? 'Non disponibile' : `${new Intl.NumberFormat('it-IT').format(value)} ${unit}`}</dd></div>}</For></dl></details>}</Show>
    </section>
  )
}
