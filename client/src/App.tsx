import { createEffect, Show } from 'solid-js'
import { language, setLanguage, t } from './lib/i18n'
import Icon from './components/Icon'
import { createRoutePlanner } from './features/route-planner/createRoutePlanner'
import type { AddressSearch } from './features/route-planner/address'
import { createGeoapifySearch } from './lib/api/geoapify'
import type { StopKey } from './features/route-planner/createRoutePlanner'
import type { RouteService } from './features/route-planner/domain'
import StopField from './features/route-planner/StopField'
import RouteSummary from './features/route-planner/RouteSummary'
import { createApiRouteService } from './lib/api/routes-v1'
import RouteMap from './map/RouteMap'
import './App.css'

export default function App(props: { service?: RouteService; addressSearch?: AddressSearch } = {}) {
  const addressSearch = props.addressSearch ?? (import.meta.env.VITE_GEOAPIFY_API_KEY?.trim()
    ? createGeoapifySearch(import.meta.env.VITE_GEOAPIFY_API_KEY.trim(), fetch, language) : undefined)
  const planner = createRoutePlanner(props.service ?? createApiRouteService({
    baseUrl: import.meta.env.VITE_API_BASE_URL,
    endpoint: import.meta.env.VITE_ROUTES_ENDPOINT,
  }))
  createEffect(() => {
    document.documentElement.lang = language()
    document.title = `Valio Aimo — ${t('Percorsi autisti')}`
    document.querySelector('meta[name="description"]')?.setAttribute('content', language() === 'fi'
      ? 'Suunnittele kuorma-auton reitti Suomessa. Lähtöpaikka, määränpää ja reittikartta.'
      : 'Plan your truck route in Finland. Starting point, destination and route map.')
  })
  const isDemo = () => planner.mode() === 'demo' || planner.result()?.mode === 'demo'

  function submit(event: SubmitEvent & { currentTarget: HTMLFormElement }) {
    event.preventDefault()
    void planner.calculate()
    event.currentTarget.querySelector<HTMLInputElement>('input[aria-invalid="true"]')?.focus()
  }

  function pickOnMap(kind: StopKey) {
    planner.togglePicking(kind)
    if (planner.picking() && window.matchMedia('(max-width: 759px)').matches) {
      document.getElementById('route-map')?.scrollIntoView({ block: 'start' })
    }
  }

  return (
    <div class="app-shell">
      <a class="skip-link" href="#planner">{t('Vai alla pianificazione')}</a>
      <header class="app-header">
        <a class="brand" href="/" aria-label={t('Valio Aimo, pagina iniziale')}><img src="/valio-aimo.svg" alt="Valio Aimo" width="120" height="40" /></a>
        <h1 class="app-title">{t('Percorsi autisti')}</h1>
        <div class="language-switch" role="group" aria-label={language() === 'fi' ? 'Kieli' : 'Language'}>
          <button type="button" lang="fi" aria-label="Suomi" aria-pressed={language() === 'fi'} onClick={() => setLanguage('fi')}>FI</button>
          <button type="button" lang="en" aria-label="English" aria-pressed={language() === 'en'} onClick={() => setLanguage('en')}>EN</button>
        </div>

      </header>

      <main>
        <div class="workspace">
          <aside class="planner-panel" id="planner" aria-label={t('Pianificazione del viaggio')}>
            <form onSubmit={submit} novalidate>
              <StopField kind="origin" value={planner.origin()} search={addressSearch} resolved={Boolean(planner.addresses().origin)} onSelect={(suggestion) => planner.selectAddress('origin', suggestion)} error={planner.errors().origin} picking={planner.picking() === 'origin'} onInput={(value) => planner.update('origin', value)} onPick={() => pickOnMap('origin')} />
              <div class="stop-connector"><span /><button type="button" class="icon-button swap-button" aria-label={t('Inverti partenza e arrivo')} title={t('Inverti partenza e arrivo')} onClick={planner.swap}><Icon name="swap" size={17} /></button></div>
              <StopField kind="destination" value={planner.destination()} search={addressSearch} resolved={Boolean(planner.addresses().destination)} onSelect={(suggestion) => planner.selectAddress('destination', suggestion)} error={planner.errors().destination} picking={planner.picking() === 'destination'} onInput={(value) => planner.update('destination', value)} onPick={() => pickOnMap('destination')} />
              <Show when={!addressSearch}><p class="coordinate-hint">{t('Latitudine, longitudine')}</p></Show>

              <button type="submit" class="primary-button" disabled={planner.loading()}><Show when={planner.loading()} fallback={<>{t('Calcola percorso')}<Icon name="arrow" size={19} /></>}><span class="spinner" />{t('Calcolo in corso…')}</Show></button>
              <Show when={planner.loading()}><button type="button" class="text-button cancel-button" onClick={planner.cancel}>{t('Annulla calcolo')}</button></Show>
              <Show when={planner.error()}><div class="error-notice" role="alert"><Icon name="info" size={18} /><p>{t(planner.error() ?? '')}</p></div></Show>
            </form>

            <Show when={isDemo()}><div class="demo-banner" role="status"><strong>{t('Modalità demo')}</strong><p>{t('Dati sintetici, non utilizzabili per la guida.')}</p><Show when={planner.mode() === 'demo'}><button type="button" class="text-button" onClick={planner.exitDemo}>{t('Esci dalla demo')}<Icon name="arrow" size={14} /></button></Show></div></Show>

            <div aria-live="polite" aria-atomic="true"><Show when={planner.result()} fallback={<Show when={!planner.loading()}><div class="demo-action"><button type="button" class="text-button demo-button" onClick={() => void planner.showDemo()}>{t('Prova un esempio')}<Icon name="arrow" size={15} /></button></div></Show>}>{(result) => <RouteSummary result={result()} selected={planner.selectedRoute()} onSelect={planner.selectRoute} />}</Show></div>
          </aside>

          <RouteMap points={planner.points()} routes={planner.result()?.routes ?? []} selected={planner.selectedRoute()} picking={planner.picking()} loading={planner.loading()} demo={isDemo()} onPick={planner.pick} />
        </div>
        <footer class="page-footer">{t('Segui sempre segnaletica e norme vigenti.')}</footer>
      </main>
    </div>
  )
}
