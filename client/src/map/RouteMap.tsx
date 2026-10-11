import { createEffect, createSignal, onCleanup, onMount, Show } from 'solid-js'
import type { GeoJSONSource, Map as MapLibreMap, Marker } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import Icon from '../components/Icon'
import { language, t } from '../lib/i18n'
import type { Coordinates, RouteOption } from '../features/route-planner/domain'
import type { StopKey } from '../features/route-planner/createRoutePlanner'
import { offlineStyle } from './offlineStyle'

const DEFAULT_MAP_STYLE_URL = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'
const configuredStyle = import.meta.env.VITE_MAP_STYLE_URL?.trim()
const mapStyleUrl = configuredStyle || DEFAULT_MAP_STYLE_URL

interface Props {
  points: { origin: Coordinates | null; destination: Coordinates | null }
  routes: RouteOption[]
  selected?: RouteOption
  picking: StopKey | null
  loading: boolean
  demo: boolean
  onPick: (point: Coordinates) => void
}

export default function RouteMap(props: Props) {
  let container!: HTMLDivElement
  let map: MapLibreMap | undefined
  let disposed = false
  let markers: Marker[] = []
  const [ready, setReady] = createSignal(false)
  const [unavailable, setUnavailable] = createSignal(false)
  const [offline, setOffline] = createSignal(false)
  const [notice, setNotice] = createSignal('')

  onMount(async () => {
    try {
      const lib = await import('maplibre-gl')
      if (disposed) return
      // Vite relocates the ESM bundle: the v6 worker URL must be explicit.
      lib.setWorkerUrl(workerUrl)
      map = new lib.Map({
        container, style: mapStyleUrl,
        locale: {
          'NavigationControl.ZoomIn': t('Zoom in'),
          'NavigationControl.ZoomOut': t('Zoom out'),
          'AttributionControl.ToggleAttribution': language() === 'fi' ? 'Näytä kartan lähteet' : 'Toggle attribution',
        },
        center: [25.25, 60.3], zoom: 8.6, minZoom: 2, maxZoom: 18,
        attributionControl: {
          compact: true,
          customAttribution: configuredStyle ? undefined : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        },
        renderWorldCopies: false,
      })
      map.addControl(new lib.NavigationControl({ showCompass: false }), 'top-right')
      map.addControl(new lib.ScaleControl({ unit: 'metric' }), 'bottom-right')
      map.on('error', () => {
        if (!offline()) {
          setOffline(true)
          setNotice('Le strade non sono disponibili. Percorso su griglia geografica.')
          setReady(false)
          map?.setStyle(offlineStyle())
        }
      })
      map.on('load', () => setReady(true))
      map.on('style.load', () => {
        if (!map || disposed) return
        if (!map.getSource('routes')) {
          map.addSource('routes', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
          map.addSource('selected-route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
          map.addLayer({ id: 'alternatives', type: 'line', source: 'routes', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#9caebc', 'line-width': 4, 'line-dasharray': [2, 2] } })
          map.addLayer({ id: 'route-outline', type: 'line', source: 'selected-route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 9 } })
          map.addLayer({ id: 'route', type: 'line', source: 'selected-route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#005670', 'line-width': 5 } })
        }
        setReady(true)
      })
      map.on('click', (event) => {
        if (props.picking) props.onPick({ longitude: event.lngLat.lng, latitude: event.lngLat.lat })
      })
      const resize = new ResizeObserver(() => {
        map?.resize()
        fitViewport(0)
      })
      resize.observe(container)
      onMapCleanup = () => resize.disconnect()

      createMarkers = (points) => {
        markers.forEach((marker) => marker.remove())
        markers = []
        for (const [key, point] of Object.entries(points)) {
          if (!point || !map) continue
          const element = document.createElement('div')
          element.className = `map-pin ${key}`
          element.textContent = key === 'origin' ? 'A' : 'B'
          element.title = t(key === 'origin' ? 'Partenza' : 'Arrivo')
          markers.push(new lib.Marker({ element }).setLngLat([point.longitude, point.latitude]).addTo(map))
        }
      }
      // Functions used by reactive effects must be ready before the ready signal.
      if (map.isStyleLoaded()) setReady(true)
    } catch {
      if (!disposed) setUnavailable(true)
    }
  })

  let createMarkers: (points: Props['points']) => void = () => {}
  let onMapCleanup = () => {}

  function fitViewport(duration = 600) {
    if (!map || !ready()) return
    const coordinates = props.selected
      ? props.selected.geometry.type === 'LineString' ? props.selected.geometry.coordinates : props.selected.geometry.coordinates.flat()
      : Object.values(props.points).filter((point): point is Coordinates => Boolean(point)).map((point) => [point.longitude, point.latitude])
    if (coordinates.length >= 2) {
      const bounds = coordinates.reduce((box, point) => [Math.min(box[0], point[0]), Math.min(box[1], point[1]), Math.max(box[2], point[0]), Math.max(box[3], point[1])], [Infinity, Infinity, -Infinity, -Infinity])
      map.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], { padding: 75, maxZoom: 12, duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : duration })
    } else if (coordinates.length === 1) {
      map.easeTo({ center: [coordinates[0][0], coordinates[0][1]], duration: 0 })
    }
  }

  createEffect(() => {
    if (!ready() || !map) return
    // MapLibre control labels are not reactive; update them when the UI language changes.
    language()
    for (const [selector, key] of [['.maplibregl-ctrl-zoom-in', 'Zoom in'], ['.maplibregl-ctrl-zoom-out', 'Zoom out']] as const) {
      const button = container.querySelector<HTMLButtonElement>(selector)
      button?.setAttribute('aria-label', t(key))
      button?.setAttribute('title', t(key))
    }
    const attribution = container.querySelector<HTMLButtonElement>('.maplibregl-ctrl-attrib-button')
    const label = language() === 'fi' ? 'Näytä kartan lähteet' : 'Toggle attribution'
    attribution?.setAttribute('aria-label', label)
    attribution?.setAttribute('title', label)
    map.getCanvas().style.cursor = props.picking ? 'crosshair' : ''
  })

  createEffect(() => {
    if (!ready() || !map) return
    createMarkers(props.points)
    const features = props.routes.map((route) => ({ type: 'Feature' as const, properties: { id: route.id }, geometry: route.geometry }))
    ;(map.getSource('routes') as GeoJSONSource).setData({ type: 'FeatureCollection', features })
    ;(map.getSource('selected-route') as GeoJSONSource).setData({ type: 'FeatureCollection', features: features.filter((feature) => feature.properties.id === props.selected?.id) })

    fitViewport()
  })

  onCleanup(() => {
    disposed = true
    onMapCleanup()
    markers.forEach((marker) => marker.remove())
    map?.remove()
  })

  return (
    <section id="route-map" class="map-panel" aria-label={t('Mappa del percorso')}>
      <div ref={container} class="map-canvas" data-ready={ready()} />
      <Show when={props.picking && !unavailable()}><div class="map-pick-notice" role="status"><Icon name="pin" size={18} />{t(props.picking === 'origin' ? 'Tocca la mappa per scegliere la partenza.' : 'Tocca la mappa per scegliere l’arrivo.')}</div></Show>
      <Show when={props.loading}><div class="map-loading" role="status"><span class="spinner" />{t('Calcolo in corso…')}</div></Show>
      <Show when={unavailable()}><div class="map-unavailable" role="status"><Icon name="info" size={20} /><p>{t('Mappa non disponibile')}</p></div></Show>
      <Show when={notice()}><p class="map-notice" role="status">{t(notice())}</p></Show>
      <Show when={offline() || props.demo}><div class="map-footer"><span class="map-basemap-label">{t(offline() ? 'Griglia geografica · senza strade' : 'Percorso sintetico')}</span></div></Show>
    </section>
  )
}
