import { createEffect, createSignal, For, onCleanup, Show } from 'solid-js'
import Icon from '../../components/Icon'
import { t } from '../../lib/i18n'
import type { StopKey } from './createRoutePlanner'
import type { AddressSearch, AddressSuggestion } from './address'
import { parseCoordinates } from './domain'

interface Props {
  kind: StopKey
  value: string
  error?: string
  picking: boolean
  resolved: boolean
  search?: AddressSearch
  onInput: (value: string) => void
  onSelect: (suggestion: AddressSuggestion) => void
  onPick: () => void
}

export default function StopField(props: Props) {
  const label = () => t(props.kind === 'origin' ? 'Punto di partenza' : 'Punto di arrivo')
  const [focused, setFocused] = createSignal(false)
  const [suggestions, setSuggestions] = createSignal<AddressSuggestion[]>([])
  const [active, setActive] = createSignal(-1)
  const [loading, setLoading] = createSignal(false)
  const [message, setMessage] = createSignal('')
  const [dismissed, setDismissed] = createSignal(false)
  const expanded = () => focused() && !dismissed() && (loading() || Boolean(message()) || suggestions().length > 0)
  let generation = 0
  let blurTimer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(blurTimer))

  createEffect(() => {
    const text = props.value.trim()
    const search = props.search
    const shouldSearch = search && focused() && !dismissed() && !props.picking && !props.resolved && !parseCoordinates(text) && text.length >= 3
    const request = ++generation
    const controller = new AbortController()
    setSuggestions([])
    setActive(-1)
    setMessage('')
    setLoading(false)
    let timer: ReturnType<typeof setTimeout> | undefined
    if (shouldSearch) {
      setLoading(true)
      timer = setTimeout(async () => {
        const timeout = setTimeout(() => controller.abort(), 8000)
        try {
          const results = await search.search(text, controller.signal)
          if (request !== generation || controller.signal.aborted) return
          setSuggestions(results)
          if (!results.length) setMessage('Nessun indirizzo trovato.')
        } catch {
          if (request === generation) setMessage('Ricerca non disponibile. Riprova o scegli sulla mappa.')
        } finally {
          clearTimeout(timeout)
          if (request === generation) setLoading(false)
        }
      }, 300)
    }
    onCleanup(() => {
      generation++
      clearTimeout(timer)
      controller.abort()
    })
  })

  function select(suggestion: AddressSuggestion) {
    setDismissed(true)
    props.onSelect(suggestion)
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      setDismissed(true)
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setDismissed(false)
      const length = suggestions().length
      if (length) setActive((index) => event.key === 'ArrowDown' ? (index + 1) % length : (index <= 0 ? length - 1 : index - 1))
    }
    if (event.key === 'Enter' && expanded()) {
      event.preventDefault()
      const suggestion = suggestions()[active()]
      if (suggestion) select(suggestion)
    }
  }

  return (
    <div class="stop-field">
      <label for={props.kind} class="field-label"><span class={`stop-dot ${props.kind}`} />{label()}</label>
      <div class="coordinate-input" classList={{ invalid: Boolean(props.error), picking: props.picking }}>
        <input id={props.kind} name={props.kind} type="text" value={props.value}
          placeholder={props.search ? t('Indirizzo o coordinate') : (props.kind === 'origin' ? '60.16990, 24.93840' : '60.39290, 25.66390')}
          autocomplete="off" spellcheck={false} role={props.search ? 'combobox' : undefined}
          aria-autocomplete={props.search ? 'list' : undefined} aria-expanded={props.search ? Boolean(expanded()) : undefined}
          aria-controls={props.search ? `${props.kind}-suggestions` : undefined}
          aria-activedescendant={expanded() && active() >= 0 ? `${props.kind}-option-${active()}` : undefined}
          aria-invalid={Boolean(props.error)} aria-describedby={`${props.kind}-hint${props.error ? ` ${props.kind}-error` : ''}`}
          onFocus={() => { clearTimeout(blurTimer); setFocused(true); setDismissed(false) }}
          // Keep layout stable until the pointer click finishes on the next control.
          onBlur={() => { blurTimer = setTimeout(() => setFocused(false), 150) }}
          onKeyDown={onKeyDown} onInput={(event) => { setDismissed(false); props.onInput(event.currentTarget.value) }} />
        <button type="button" class="icon-button pick-button" aria-label={t(props.kind === 'origin' ? 'Scegli partenza sulla mappa' : 'Scegli arrivo sulla mappa')} aria-pressed={props.picking} title={t('Seleziona sulla mappa')} onClick={props.onPick}><Icon name="pin" size={18} /></button>
      </div>
      <span id={`${props.kind}-hint`} class="sr-only">{t(props.search ? 'Cerca un indirizzo in Finlandia e seleziona un suggerimento, oppure inserisci latitudine, longitudine.' : 'Coordinate nel formato latitudine, longitudine, con il punto per i decimali.')}</span>
      <div class="address-results" hidden={!expanded()}>
        <Show when={loading()}><p role="status">{t('Ricerca…')}</p></Show>
        <Show when={message()}><p role="status">{t(message())}</p></Show>
        <ul id={`${props.kind}-suggestions`} role="listbox" aria-label={`${t('Suggerimenti')}: ${label()}`}>
          <For each={suggestions()}>{(suggestion, index) => <li id={`${props.kind}-option-${index()}`} role="option"
            aria-selected={active() === index()} classList={{ active: active() === index() }}
            onPointerDown={(event) => event.preventDefault()} onClick={() => select(suggestion)}>{suggestion.label}</li>}</For>
        </ul>
        <a href="https://www.geoapify.com/" target="_blank" rel="noreferrer" onPointerDown={(event) => event.preventDefault()}>Powered by Geoapify</a>
      </div>
      <Show when={props.error}><p id={`${props.kind}-error`} class="field-error">{t(props.error ?? '')}</p></Show>
    </div>
  )
}
