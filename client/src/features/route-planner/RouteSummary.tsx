import { For, Show } from 'solid-js'
import Icon from '../../components/Icon'
import { numberLocale, t } from '../../lib/i18n'
import type { RouteOption, RouteResult } from './domain'
import { formatDistance, formatDuration } from './domain'

export default function RouteSummary(props: { result: RouteResult; selected?: RouteOption; onSelect: (id: string) => void }) {
  const warnings = () => [...props.result.warnings, ...(props.selected?.warnings ?? [])]
  return (
    <section class="route-summary" aria-label={t('Risultato del calcolo')}>
      <Show when={props.result.status === 'ok'} fallback={<div class="no-route"><Icon name="info" /><h3>{t('Nessun percorso trovato')}</h3><p>{t('Prova con altri punti.')}</p></div>}>
        <Show when={props.result.routes.length > 1}>
          <div class="route-options" role="group" aria-label={t('Alternative di percorso')}><For each={props.result.routes}>{(route) => <button type="button" aria-pressed={props.selected?.id === route.id} onClick={() => props.onSelect(route.id)}>{t(route.name)}</button>}</For></div>
        </Show>
        <Show when={props.selected}>{(route) => <>
          <dl class="route-metrics">
            <div><dt><Icon name="distance" size={16} />{t('Distanza')}</dt><dd>{formatDistance(route().distanceMeters, numberLocale(), t('Non disponibile'))}</dd></div>
            <div><dt><Icon name="clock" size={16} />{t('Durata stimata')}</dt><dd>{formatDuration(route().durationSeconds, t('Non disponibile'))}</dd></div>
          </dl>
        </>}</Show>
      </Show>
      <Show when={props.result.mode === 'unknown'}><p class="notice"><Icon name="info" size={16} />{t('La modalità dei dati non è stata dichiarata dal backend.')}</p></Show>
      <Show when={warnings().length}><div class="route-warnings"><ul><For each={warnings()}>{(warning) => <li>{t(warning)}</li>}</For></ul></div></Show>
      <Show when={props.result.vehicle}>{(vehicle) => <details class="vehicle-details"><summary>{t('Profilo veicolo applicato')}</summary><p>{vehicle().id} · v{vehicle().version}</p><dl><For each={[
        ['Altezza', vehicle().heightMeters, 'm'], ['Larghezza', vehicle().widthMeters, 'm'],
        ['Lunghezza', vehicle().lengthMeters, 'm'], ['Massa', vehicle().massKg, 'kg'],
      ] as const}>{([label, value, unit]) => <div><dt>{t(label)}</dt><dd>{value === null ? t('Non disponibile') : `${new Intl.NumberFormat(numberLocale()).format(value)} ${unit}`}</dd></div>}</For></dl></details>}</Show>
    </section>
  )
}
