import { Show } from 'solid-js'
import Icon from '../../components/Icon'
import type { StopKey } from './createRoutePlanner'

interface Props {
  kind: StopKey
  value: string
  error?: string
  picking: boolean
  onInput: (value: string) => void
  onPick: () => void
}

export default function StopField(props: Props) {
  const label = () => props.kind === 'origin' ? 'Punto di partenza' : 'Punto di arrivo'
  return (
    <div class="stop-field">
      <label for={props.kind} class="field-label"><span class={`stop-dot ${props.kind}`} />{label()}</label>
      <div class="coordinate-input" classList={{ invalid: Boolean(props.error), picking: props.picking }}>
        <input id={props.kind} name={props.kind} type="text" value={props.value} placeholder={props.kind === 'origin' ? '60.16990, 24.93840' : '60.39290, 25.66390'} autocomplete="off" spellcheck={false} aria-invalid={Boolean(props.error)} aria-describedby={`${props.kind}-hint${props.error ? ` ${props.kind}-error` : ''}`} onInput={(event) => props.onInput(event.currentTarget.value)} />
        <button type="button" class="icon-button pick-button" aria-label={`Scegli ${props.kind === 'origin' ? 'partenza' : 'arrivo'} sulla mappa`} aria-pressed={props.picking} title="Seleziona sulla mappa" onClick={props.onPick}><Icon name="pin" size={18} /></button>
      </div>
      <span id={`${props.kind}-hint`} class="sr-only">Coordinate nel formato latitudine, longitudine, con il punto per i decimali.</span>
      <Show when={props.error}><p id={`${props.kind}-error`} class="field-error">{props.error}</p></Show>
    </div>
  )
}
