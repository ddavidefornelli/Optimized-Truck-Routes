import { Show } from 'solid-js'
import Icon from './components/Icon'
import { createRoutePlanner } from './features/route-planner/createRoutePlanner'
import type { RouteService } from './features/route-planner/domain'
import StopField from './features/route-planner/StopField'
import RouteSummary from './features/route-planner/RouteSummary'
import { createApiRouteService } from './lib/api/routes-v1'
import RouteMap from './map/RouteMap'
import './App.css'

export default function App(props: { service?: RouteService } = {}) {
  const planner = createRoutePlanner(props.service ?? createApiRouteService({
    baseUrl: import.meta.env.VITE_API_BASE_URL,
    endpoint: import.meta.env.VITE_ROUTES_ENDPOINT,
  }))
  const isDemo = () => planner.mode() === 'demo' || planner.result()?.mode === 'demo'

  function submit(event: SubmitEvent & { currentTarget: HTMLFormElement }) {
    event.preventDefault()
    void planner.calculate()
    event.currentTarget.querySelector<HTMLInputElement>('input[aria-invalid="true"]')?.focus()
  }

  return (
    <div class="app-shell">
      <a class="skip-link" href="#planner">Vai alla pianificazione</a>
      <header class="app-header">
        <a class="brand" href="/" aria-label="Truck Routes, pagina iniziale"><span class="brand-mark"><Icon name="route" size={25} /></span><span>truck<span class="brand-light">routes</span><span class="brand-dot">.</span></span></a>
        <span class="header-divider" /><span class="header-section">Pianificazione</span>
        <div class="region-tag"><span class="small-dot" />Finlandia<span class="region-detail"> · area pilota</span></div>
      </header>

      <main>
        <section class="page-intro"><div><p class="eyebrow">IL PROSSIMO VIAGGIO, CON CHIAREZZA</p><h1>Una rotta. Meno incertezze.</h1><p class="intro-copy">Dalla partenza alla consegna, pianifica il percorso per il tuo camion.</p></div><span class="intro-note"><Icon name="route" size={19} />Progettato per i mezzi pesanti</span></section>

        <div class="workspace">
          <aside class="planner-panel" id="planner" aria-label="Pianificazione del viaggio">
            <div class="panel-title"><div><p class="eyebrow">PIANIFICA</p><h2>Il tuo viaggio</h2></div><span class="step-tag">01 — 02</span></div>
            <form onSubmit={submit} novalidate>
              <StopField kind="origin" value={planner.origin()} error={planner.errors().origin} picking={planner.picking() === 'origin'} onInput={(value) => planner.update('origin', value)} onPick={() => planner.togglePicking('origin')} />
              <div class="stop-connector"><span /><button type="button" class="icon-button swap-button" aria-label="Inverti partenza e arrivo" title="Inverti partenza e arrivo" onClick={planner.swap}><Icon name="swap" size={17} /></button></div>
              <StopField kind="destination" value={planner.destination()} error={planner.errors().destination} picking={planner.picking() === 'destination'} onInput={(value) => planner.update('destination', value)} onPick={() => planner.togglePicking('destination')} />
              <p class="coordinate-hint">Latitudine, longitudine <span>·</span> oppure scegli sulla mappa.<br />Gli indirizzi saranno supportati in una versione futura.</p>

              <div class="vehicle-card"><span class="vehicle-icon"><Icon name="truck" size={23} /></span><div><strong>Camion standard</strong><span>Profilo e restrizioni applicati dal backend</span></div></div>

              <button type="submit" class="primary-button" disabled={planner.loading()}><Show when={planner.loading()} fallback={<>Calcola percorso<Icon name="arrow" size={19} /></>}><span class="spinner" />Calcolo in corso…</Show></button>
              <Show when={planner.loading()}><button type="button" class="text-button cancel-button" onClick={planner.cancel}>Annulla calcolo</button></Show>
              <Show when={planner.error()}><div class="error-notice" role="alert"><Icon name="info" size={18} /><p>{planner.error()}</p></div></Show>
            </form>

            <Show when={isDemo()}><div class="demo-banner" role="status"><strong>Modalità demo</strong><p>Dati sintetici, non utilizzabili per la guida.</p><Show when={planner.mode() === 'demo'}><button type="button" class="text-button" onClick={planner.exitDemo}>Esci dalla demo<Icon name="arrow" size={14} /></button></Show></div></Show>

            <div aria-live="polite" aria-atomic="true"><Show when={planner.result()} fallback={<Show when={!planner.loading()}><div class="empty-summary"><span class="empty-summary-icon"><Icon name="route" size={23} /></span><h3>Ogni viaggio inizia da qui.</h3><p>Il percorso, la distanza e la durata stimata appariranno dopo il calcolo.</p><button type="button" class="text-button demo-button" onClick={() => void planner.showDemo()}>Prova un esempio<Icon name="arrow" size={15} /></button></div></Show>}>{(result) => <RouteSummary result={result()} selected={planner.selectedRoute()} onSelect={planner.selectRoute} />}</Show></div>
          </aside>

          <RouteMap points={planner.points()} routes={planner.result()?.routes ?? []} selected={planner.selectedRoute()} picking={planner.picking()} loading={planner.loading()} demo={isDemo()} onPick={planner.pick} />
        </div>
        <footer class="page-footer"><p><Icon name="info" size={15} />Il percorso è una raccomandazione, non una garanzia di transitabilità. Segui sempre segnaletica e norme vigenti.</p><span>Optimized Truck Routes</span></footer>
      </main>
    </div>
  )
}
