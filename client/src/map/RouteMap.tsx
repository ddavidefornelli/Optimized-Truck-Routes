import { createEffect, createSignal, onCleanup, onMount, Show } from 'solid-js'
import type { GeoJSONSource, Map as MapLibreMap, Marker } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import Icon from '../components/Icon'
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
          setNotice('Le strade non sono disponibili. Visualizziamo il percorso sulla griglia geografica.')
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
          map.addLayer({ id: 'route', type: 'line', source: 'selected-route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#234f78', 'line-width': 5 } })
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
          element.title = key === 'origin' ? 'Partenza' : 'Arrivo'
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
    <section class="map-panel" aria-label="Mappa del percorso">
      <div ref={container} class="map-canvas" data-ready={ready()} />
      <div class="map-heading"><span class="map-heading-icon"><Icon name="route" size={17} /></span><div><strong>Vista del percorso</strong><span>{props.demo ? 'Dati dimostrativi' : 'Finlandia · WGS84'}</span></div></div>
      <Show when={!props.selected && !props.picking && !props.loading && !unavailable()}>
        <div class="map-empty"><div class="map-empty-icon"><Icon name="pin" size={29} /></div><h2>Da dove partiamo?</h2><p>Inserisci partenza e arrivo.<br />Il tuo percorso prenderà forma qui.</p><div class="map-empty-rule" /><span>Un punto di partenza. Una nuova direzione.</span></div>
      </Show>
      <Show when={props.picking && !unavailable()}><div class="map-pick-notice" role="status"><Icon name="pin" size={18} />Clicca sulla mappa per scegliere {props.picking === 'origin' ? 'la partenza' : 'l’arrivo'}.</div></Show>
      <Show when={props.loading}><div class="map-loading" role="status"><span class="spinner" />Calcolo del percorso in corso…</div></Show>
      <Show when={unavailable()}><div class="map-empty map-unavailable" role="status"><Icon name="info" size={30} /><h2>Mappa non disponibile</h2><p>Il browser non supporta la mappa o non è stato possibile caricarla. Puoi comunque inserire le coordinate e leggere il risultato.</p></div></Show>
      <Show when={notice()}><p class="map-notice" role="status">{notice()}</p></Show>
      <div class="map-footer"><span class="map-basemap-label"><span class="small-dot" />{offline() ? 'Griglia geografica · senza strade' : (configuredStyle ? 'Mappa di base configurata' : 'CARTO Positron · OpenStreetMap')}</span><Show when={props.selected}><span class="map-legend"><span class="legend-line" />{props.demo ? 'Percorso sintetico' : 'Percorso selezionato'}</span></Show></div>
    </section>
  )
}
