import { createEffect, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { language, numberLocale, setLanguage } from '../../lib/i18n'
import { FINISH, initialState, SCENARIOS, START, TRUCK } from './driving'
import type { DriveState, Scenario } from './driving'
import type { SimulationEngine } from './scene'
import { text } from './messages'
import './Simulation.css'

type Phase = 'loading' | 'ready' | 'running' | 'paused' | 'finished' | 'error'
const Arrow = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>

export default function Simulation() {
  const [scenario, setScenario] = createSignal<Scenario>('narrow')
  const [phase, setPhase] = createSignal<Phase>('loading')
  const [telemetry, setTelemetry] = createSignal(initialState('narrow'))
  const [lookMode, setLookMode] = createSignal<'locked' | 'drag'>('locked')
  const [results, setResults] = createSignal<Partial<Record<Scenario, DriveState>>>({})
  const [coarsePointer, setCoarsePointer] = createSignal(false)
  let canvas!: HTMLCanvasElement
  let mainAction: HTMLButtonElement | undefined
  let engine: SimulationEngine | undefined
  let mounted = true
  const format = (value: number, digits = 0) => new Intl.NumberFormat(numberLocale(), { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)
  const status = () => text(phase() === 'running' ? 'driving' : phase() === 'finished' ? 'complete' : phase() === 'paused' ? 'paused' : phase() === 'error' ? 'unavailable' : phase() === 'loading' ? 'loading' : 'seat')

  createEffect(() => {
    document.documentElement.lang = language()
    document.title = `Valio Aimo — ${text('title')}`
    document.querySelector('meta[name="description"]')?.setAttribute('content', text('subtitle'))
  })
  function focusAction() { queueMicrotask(() => { if (mounted) mainAction?.focus({ preventScroll: true }) }) }
  onMount(async () => {
    setCoarsePointer(window.matchMedia('(pointer: coarse)').matches)
    try {
      const { createSimulation } = await import('./scene')
      if (!mounted) return
      engine = createSimulation(canvas, {
        tick: setTelemetry,
        paused: () => { setPhase('paused'); focusAction() },
        finished: (state) => {
          setResults((previous) => ({ ...previous, [scenario()]: state }))
          setPhase('finished'); focusAction()
        },
        lookMode: setLookMode,
        error: () => { setPhase('error'); focusAction() },
      })
      setPhase('ready')
    } catch {
      if (mounted) setPhase('error')
    }
  })
  onCleanup(() => { mounted = false; engine?.dispose() })

  function start() {
    if (!engine || !['ready', 'paused'].includes(phase())) return
    setPhase('running'); engine.start()
  }
  function reset(next: Scenario = scenario()) {
    if (!engine || phase() === 'error') return
    setScenario(next); engine.reset(next); setLookMode('locked'); setPhase('ready')
  }

  return (
    <div class="simulation-page">
      <a class="sim-skip" href="#simulation">{text('skip')}</a>
      <header class="sim-header">
        <a class="sim-brand" href="/" aria-label={text('home')}><img src="/valio-aimo.svg" alt="Valio Aimo" width="120" height="40" /></a>
        <h1>{text('title')}</h1>
        <a class="sim-back" href="/" aria-label={text('back')}><span aria-hidden="true">←</span> {text('back')}</a>
        <div class="sim-language" role="group" aria-label={language() === 'fi' ? 'Kieli' : 'Language'}>
          <button type="button" lang="fi" aria-label="Suomi" aria-pressed={language() === 'fi'} onClick={() => setLanguage('fi')}>FI</button>
          <button type="button" lang="en" aria-label="English" aria-pressed={language() === 'en'} onClick={() => setLanguage('en')}>EN</button>
        </div>
      </header>
      <main class="sim-main" id="simulation">
        <div class="sim-intro">
          <div><p class="sim-eyebrow">PORVOO · {language() === 'fi' ? 'SUOMI' : 'FINLAND'}</p><h2>{text('place')}</h2><p class="sim-subtitle">{text('subtitle')}</p></div>
          <div class="sim-scenarios" role="group" aria-label={text('conditions')}>
            <For each={['narrow', 'wide'] as const}>{(mode) =>
              <button type="button" class="sim-scenario" aria-pressed={scenario() === mode} disabled={phase() === 'loading' || phase() === 'error'} onClick={() => { if (scenario() !== mode) reset(mode) }}>
                <span class="sim-scenario-title"><span class="sim-radio" aria-hidden="true" />{text(mode)}</span>
                <span class="sim-scenario-detail">{format(SCENARIOS[mode].width, 1)} {text(mode === 'narrow' ? 'cobbles' : 'asphalt')}</span>
              </button>
            }</For>
          </div>
        </div>
        <section class="sim-stage" classList={{ 'sim-is-running': phase() === 'running' }} aria-label={text('title')}>
          <canvas ref={canvas} class="sim-canvas" tabindex="0" role="application" aria-label={text('canvas')} aria-describedby="simulation-controls" data-phase={phase()} data-scenario={scenario()} />
          <div class="sim-scene-top"><span class="sim-scene-tag"><span aria-hidden="true" />{text('demo')}</span><Show when={phase() === 'running'}><button type="button" class="sim-pause" onClick={() => engine?.pause()} aria-label={text('pause')}><svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4 3h3v10H4zm5 0h3v10H9z" /></svg>{text('pause')} <kbd>Esc</kbd></button></Show></div>
          <Show when={phase() !== 'running'}>
            <div class="sim-overlay">
              <div class="sim-start-card">
                <Show when={phase() === 'ready' || phase() === 'paused'}>
                  <div class="sim-road-symbol" aria-hidden="true"><svg width="38" height="38" viewBox="0 0 40 40" fill="none"><path d="m7 33 5-26m21 26L28 7M20 8v5m0 5v5m0 5v5" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg></div>
                </Show>
                <h3>{status()}</h3>
                <Show when={phase() === 'loading'}><div class="sim-loader" aria-hidden="true" /></Show>
                <Show when={phase() === 'error'}><p>{text('errorHint')}</p><button ref={mainAction} type="button" class="sim-primary" onClick={() => window.location.reload()}>{text('reload')}<Arrow /></button></Show>
                <Show when={phase() === 'ready' || phase() === 'paused'}>
                  <p>{text(phase() === 'paused' ? 'pausedHint' : 'objective')}</p>
                  <div class="sim-control-preview">
                    <div class="sim-key-grid" aria-hidden="true"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></div>
                    <div class="sim-drive-legend"><span><b>W</b> {text('throttle')}</span><span><b>S</b> {text('reverse')}</span><span><b>A / D</b> {text('steer')}</span></div>
                    <div class="sim-mouse-preview"><svg width="24" height="32" viewBox="0 0 24 32" fill="none" aria-hidden="true"><rect x="3" y="1" width="18" height="28" rx="9" stroke="currentColor" stroke-width="1.5" /><path d="M12 6v5" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg><span>{text('mouse')}<small>{text('look')}</small></span></div>
                  </div>
                  <button ref={mainAction} type="button" class="sim-primary" onClick={start}>{text(phase() === 'paused' ? 'resume' : 'drive')}<Arrow /></button>
                  <Show when={phase() === 'paused'}><button type="button" class="sim-secondary" onClick={() => reset()}>{text('restart')}</button></Show>
                </Show>
                <Show when={phase() === 'finished'}>
                  <p>{text('compare')}</p>
                  <table class="sim-results"><caption class="sr-only">{text('results')}</caption><thead><tr><th scope="col">{text('conditions')}</th><th scope="col">{text('time')}</th><th scope="col">{text('contacts')}</th></tr></thead><tbody><For each={['narrow', 'wide'] as const}>{(mode) => <tr><th scope="row">{text(mode)}</th><td>{results()[mode] ? `${format(results()[mode]!.elapsed, 1)} s` : '—'}<Show when={!results()[mode]}><span class="sr-only">{text('notDriven')}</span></Show></td><td>{results()[mode] ? format(results()[mode]!.contacts) : '—'}</td></tr>}</For></tbody></table>
                  <button ref={mainAction} type="button" class="sim-primary" onClick={() => reset(scenario() === 'narrow' ? 'wide' : 'narrow')}>{text(scenario() === 'narrow' ? 'tryWide' : 'tryNarrow')}<Arrow /></button>
                  <button type="button" class="sim-secondary" onClick={() => reset()}>{text('restart')}</button>
                </Show>
              </div>
            </div>
          </Show>
          <Show when={phase() === 'running' && telemetry().contactFlash > 0}><div class="sim-contact" role="status">{text('contact')}</div></Show>
          <Show when={phase() === 'running' && lookMode() === 'drag'}><div class="sim-drag-hint">{text('drag')}</div></Show>
          <Show when={phase() !== 'loading' && phase() !== 'error'}>
            <div class="sim-hud">
              <dl><div><dt>{text('speed')}</dt><dd data-testid="sim-speed">{format(Math.abs(telemetry().speed) * 3.6)} <small>km/h</small></dd></div><div><dt>{text('clearance')}</dt><dd data-testid="sim-clearance">{format(Math.max(0, telemetry().clearance), 2)} <small>m</small></dd></div><div><dt>{text('contacts')}</dt><dd data-testid="sim-contacts">{format(telemetry().contacts)}</dd></div></dl>
              <div class="sim-progress"><span>{format(Math.round(telemetry().progress * (FINISH - START)))} <span>/ {format(FINISH - START)} m</span></span><progress aria-label={text('progress')} max="1" value={telemetry().progress} /></div>
            </div>
          </Show>
        </section>
        <div class="sim-controls" id="simulation-controls"><span><kbd>W</kbd> {text('throttle')} · <kbd>S</kbd> {text('reverse')} · <kbd>A</kbd><kbd>D</kbd> {text('steer')}</span><span>{text('mouse')}: {text('look').toLocaleLowerCase(numberLocale())}</span><span>{text('brake')} · {text('escape')} · {text('reset')}</span></div>
        <Show when={coarsePointer()}><p class="sim-desktop-note">{text('desktop')}</p></Show>
        <footer class="sim-footer"><p>{text('disclaimer')} <a href="https://www.visitporvoo.fi/en/sights/old-porvoo/" target="_blank" rel="noreferrer">{text('source')} ↗</a></p><span>{text('truck')}: {format(TRUCK.width, 2)} × {format(TRUCK.length)} m</span></footer>
        <div class="sr-only" role="status" aria-live="polite">{status()}</div>
      </main>
    </div>
  )
}
