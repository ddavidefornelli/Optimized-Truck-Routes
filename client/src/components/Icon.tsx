import { Switch, Match } from 'solid-js'

export type IconName = 'route' | 'arrow' | 'pin' | 'truck' | 'swap' | 'shield' | 'clock' | 'distance' | 'close' | 'check' | 'info'

export default function Icon(props: { name: IconName; size?: number; class?: string }) {
  return (
    <svg width={props.size ?? 20} height={props.size ?? 20} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class={props.class}>
      <Switch>
        <Match when={props.name === 'route'}><circle cx="6" cy="5" r="2" /><circle cx="18" cy="19" r="2" /><path d="M6 7v8a4 4 0 0 0 4 4h6M18 17V9a4 4 0 0 0-4-4h-2" /></Match>
        <Match when={props.name === 'arrow'}><path d="M5 12h14m-6-6 6 6-6 6" /></Match>
        <Match when={props.name === 'pin'}><path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></Match>
        <Match when={props.name === 'truck'}><path d="M3 5h11v12H3zM14 9h4l3 4v4h-7" /><circle cx="7" cy="18" r="2" /><circle cx="17" cy="18" r="2" /><path d="M14 13h7" /></Match>
        <Match when={props.name === 'swap'}><path d="M8 3v17m-4-4 4 4 4-4M16 21V4m-4 4 4-4 4 4" /></Match>
        <Match when={props.name === 'shield'}><path d="m12 3 8 3v5c0 5-8 10-8 10S4 16 4 11V6l8-3Z" /><path d="m8.5 11.5 2.5 2.5 4.5-4.5" /></Match>
        <Match when={props.name === 'clock'}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Match>
        <Match when={props.name === 'distance'}><path d="M4 19 20 5M4 13v6h6M14 5h6v6" /></Match>
        <Match when={props.name === 'close'}><path d="m6 6 12 12M6 18 18 6" /></Match>
        <Match when={props.name === 'check'}><path d="m5 12 4 4L19 6" /></Match>
        <Match when={props.name === 'info'}><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7h.01" /></Match>
      </Switch>
    </svg>
  )
}
