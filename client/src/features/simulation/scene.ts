import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { emptyControls, FINISH, initialState, parkedVehicles, ROAD_END, roadFrame, SCENARIOS, stepDriving, TRUCK } from './driving'
import type { Controls, DriveState, Scenario } from './driving'

export interface SimulationHooks {
  tick: (state: DriveState) => void
  paused: () => void
  finished: (state: DriveState) => void
  lookMode: (mode: 'locked' | 'drag') => void
  error: () => void
}
export interface SimulationEngine {
  start: () => void
  pause: () => void
  reset: (scenario: Scenario) => void
  dispose: () => void
}

// All artwork is procedural and local; no map services, models or CDN requests.
function random(seed: number) {
  let value = seed
  return () => { value = (value * 1664525 + 1013904223) >>> 0; return value / 4294967296 }
}
function canvasTexture(width: number, height: number, paint: (ctx: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement('canvas')
  canvas.width = width; canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable')
  paint(ctx)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}
function surfaceTexture(cobbled: boolean) {
  const rand = random(23)
  const texture = canvasTexture(512, 512, (ctx) => {
    ctx.fillStyle = '#233e48'; ctx.fillRect(0, 0, 512, 512)
    if (cobbled) {
      for (let row = -1; row < 17; row++) {
        for (let col = -1; col < 9; col++) {
          const shade = 55 + Math.floor(rand() * 38)
          ctx.fillStyle = `rgb(${shade},${shade + 18},${shade + 22})`
          ctx.beginPath(); ctx.roundRect(col * 64 + (row % 2) * 32 + 2, row * 32 + 2, 59, 27, 5); ctx.fill()
          ctx.strokeStyle = '#a0b6b326'; ctx.stroke()
        }
      }
    }
    for (let i = 0; i < 12000; i++) {
      ctx.fillStyle = rand() > 0.5 ? '#c6dadd0c' : '#001a2220'
      ctx.fillRect(rand() * 512, rand() * 512, 1 + rand() * 2, 1)
    }
  })
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.anisotropy = 4
  return texture
}
function disposeObject(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  const textures = new Set<THREE.Texture>()
  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (mesh.geometry) geometries.add(mesh.geometry)
    if (object instanceof THREE.Light && 'shadow' in object) (object as THREE.SpotLight).shadow?.dispose()
    if (mesh.material) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material)
  })
  for (const material of materials) {
    for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value)
    material.dispose()
  }
  for (const geometry of geometries) geometry.dispose()
  for (const texture of textures) texture.dispose()
}

// Merge static props by material to keep the village cheap to render, even in mirrors.
class Batch {
  private pieces = new Map<THREE.Material, THREE.BufferGeometry[]>()
  private cube = new THREE.BoxGeometry(1, 1, 1)
  private cylinder = new THREE.CylinderGeometry(1, 1, 1, 7)
  add(geometry: THREE.BufferGeometry, material: THREE.Material, position: number[], scale = [1, 1, 1], yaw = 0, parent?: THREE.Matrix4) {
    const matrix = new THREE.Matrix4().compose(new THREE.Vector3(...position), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(...scale))
    if (parent) matrix.premultiply(parent)
    const piece = geometry.clone().applyMatrix4(matrix)
    if (!this.pieces.has(material)) this.pieces.set(material, [])
    this.pieces.get(material)!.push(piece)
  }
  box(material: THREE.Material, position: number[], size: number[], yaw = 0, parent?: THREE.Matrix4) { this.add(this.cube, material, position, size, yaw, parent) }
  pole(material: THREE.Material, position: number[], size: number[], parent?: THREE.Matrix4) { this.add(this.cylinder, material, position, size, 0, parent) }
  flush(group: THREE.Group) {
    for (const [material, pieces] of this.pieces) {
      // Extruded roofs and boxes share position/normal/uv attributes, not indices.
      const normalized = pieces.map((piece) => piece.index ? piece.toNonIndexed() : piece)
      const geometry = mergeGeometries(normalized)
      if (geometry) {
        const mesh = new THREE.Mesh(geometry, material)
        mesh.castShadow = true; mesh.receiveShadow = true
        group.add(mesh)
      }
      for (const piece of new Set([...pieces, ...normalized])) piece.dispose()
    }
    this.cube.dispose(); this.cylinder.dispose(); this.pieces.clear()
  }
}
function roadStrip(left: number, right: number, height: number, material: THREE.Material) {
  const vertices: number[] = [], uv: number[] = [], indices: number[] = []
  let row = 0
  for (let s = -18; s <= ROAD_END + 12; s += 2) {
    for (const offset of [left, right]) {
      const frame = roadFrame(s, offset)
      vertices.push(frame.x, height, frame.z); uv.push(offset / 2, s / 2)
    }
    if (row > 0) { const a = (row - 1) * 2; indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2) }
    row++
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geometry.setIndex(indices); geometry.computeVertexNormals()
  const mesh = new THREE.Mesh(geometry, material)
  mesh.receiveShadow = true
  return mesh
}

function buildStreet(scenario: Scenario) {
  const group = new THREE.Group()
  const batch = new Batch()
  const rand = random(91)
  const wide = scenario === 'wide'
  const half = SCENARIOS[scenario].width / 2
  const material = (color: number, roughness = 0.85) => new THREE.MeshStandardMaterial({ color, roughness })
  const road = new THREE.MeshStandardMaterial({ color: wide ? 0x91a6ad : 0xa0b3b8, map: surfaceTexture(!wide), roughness: 0.92 })
  const stone = material(0x64828b), kerb = material(0x9cabad), trim = material(0xa7bfc5)
  const roof = material(0x203c48), metal = material(0x243f49), timber = material(0x365b68)
  const facades = [0x4d737f, 0x64848b, 0x7a9295, 0x3b6575].map((color) => material(color))
  const glass = new THREE.MeshStandardMaterial({ color: 0x24424e, emissive: 0x6eabb8, emissiveIntensity: 0.23, roughness: 0.3 })
  const litGlass = new THREE.MeshStandardMaterial({ color: 0x8eafb4, emissive: 0x8eafb4, emissiveIntensity: 0.6, roughness: 0.4 })
  const white = new THREE.MeshStandardMaterial({ color: 0xc0d3d8, emissive: 0x40545b, emissiveIntensity: 0.35 })
  const bulb = new THREE.MeshBasicMaterial({ color: 0xe3f7fa })
  group.add(roadStrip(-half, half, 0, road))
  for (const side of [-1, 1]) {
    const pavement = wide ? 1.9 : 1.2
    const offsets = side < 0 ? [-half - pavement, -half] : [half, half + pavement]
    group.add(roadStrip(offsets[0], offsets[1], 0.12, stone))
    const curbOffsets = side < 0 ? [-half - 0.12, -half] : [half, half + 0.12]
    group.add(roadStrip(curbOffsets[0], curbOffsets[1], 0.145, kerb))
    if (wide) {
      const edges = side < 0 ? [-half + 0.12, -half + 0.2] : [half - 0.2, half - 0.12]
      group.add(roadStrip(edges[0], edges[1], 0.012, white))
    }
    for (let s = -4; s < ROAD_END; s += 14) {
      const depth = 5 + rand() * 2, length = 10 + rand() * 2, height = 4.2 + rand() * 1.5
      const frame = roadFrame(s, side * (half + (wide ? 2.2 : 1.6) + depth / 2))
      const matrix = new THREE.Matrix4().compose(new THREE.Vector3(frame.x, 0, frame.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, frame.yaw, 0)), new THREE.Vector3(1, 1, 1))
      batch.box(stone, [0, 0.3, 0], [depth + 0.12, 0.6, length + 0.12], 0, matrix)
      batch.box(facades[Math.floor(rand() * facades.length)], [0, height / 2 + 0.4, 0], [depth, height, length], 0, matrix)
      const shape = new THREE.Shape().moveTo(-depth / 2 - 0.3, 0).lineTo(depth / 2 + 0.3, 0).lineTo(0, 2.1).closePath()
      const roofGeometry = new THREE.ExtrudeGeometry(shape, { depth: length + 0.5, bevelEnabled: false }).translate(0, 0, -(length + 0.5) / 2)
      batch.add(roofGeometry, roof, [0, height + 0.4, 0], [1, 1, 1], 0, matrix); roofGeometry.dispose()
      const front = -side * (depth / 2 + 0.025)
      // Horizontal timber siding and white-framed sash windows.
      for (let y = 0.7; y < height + 0.4; y += 0.45) batch.box(timber, [front, y, 0], [0.025, 0.022, length], 0, matrix)
      for (const z of [-3.3, 0, 3.3]) {
        batch.box(trim, [front - side * 0.06, 2.65, z], [0.12, 1.65, 1.2], 0, matrix)
        batch.box(rand() > 0.65 ? litGlass : glass, [front - side * 0.13, 2.65, z], [0.03, 1.4, 1.02], 0, matrix)
        batch.box(trim, [front - side * 0.16, 2.65, z], [0.035, 1.4, 0.045], 0, matrix)
        batch.box(trim, [front - side * 0.16, 2.65, z], [0.035, 0.045, 1.02], 0, matrix)
      }
      batch.box(metal, [depth / 4, height + 1.7, 2], [0.55, 1.8, 0.55], 0, matrix)
      batch.box(trim, [front, 0.8, -length / 2 + 0.8], [0.1, 1.6, 0.1], 0, matrix)
    }
  }
  if (wide) for (let s = 2; s < ROAD_END; s += 8) {
    const frame = roadFrame(s)
    batch.box(white, [frame.x, 0.016, frame.z], [0.12, 0.025, 3], frame.yaw)
  }
  const lamps: THREE.Vector3[] = []
  const glowTexture = canvasTexture(128, 128, (ctx) => {
    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
    gradient.addColorStop(0, '#c8e6ed88'); gradient.addColorStop(1, '#c8e6ed00')
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 128, 128)
  })
  const glowMaterial = new THREE.MeshBasicMaterial({ map: glowTexture, transparent: true, opacity: wide ? 0.3 : 0.12, depthWrite: false, toneMapped: false })
  for (let s = 14; s < ROAD_END; s += wide ? 22 : 68) {
    const nearbyCar = parkedVehicles(scenario).find((car) => Math.abs(-car.z - s) < 6)
    const frame = roadFrame(nearbyCar ? -nearbyCar.z + 7 : s, half + 0.55)
    const matrix = new THREE.Matrix4().compose(new THREE.Vector3(frame.x, 0, frame.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, frame.yaw, 0)), new THREE.Vector3(1, 1, 1))
    batch.pole(metal, [0, 2.85, 0], [0.065, 5.7, 0.065], matrix)
    batch.box(metal, [-0.6, 5.7, 0], [1.3, 0.12, 0.12], 0, matrix)
    batch.box(metal, [-1.15, 5.63, 0], [0.55, 0.16, 0.35], 0, matrix)
    batch.box(bulb, [-1.15, 5.52, 0], [0.44, 0.025, 0.28], 0, matrix)
    const position = new THREE.Vector3(-1.15, 5.4, 0).applyMatrix4(matrix)
    lamps.push(position)
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(wide ? 16 : 9, wide ? 19 : 11), glowMaterial)
    pool.rotation.x = -Math.PI / 2; pool.position.set(position.x, 0.022, position.z)
    group.add(pool)
  }
  // Parked cars occupy the kerb in the difficult scene and a bay in the improved one.
  for (const car of parkedVehicles(scenario)) {
    const matrix = new THREE.Matrix4().compose(new THREE.Vector3(car.x, 0, car.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, car.yaw, 0)), new THREE.Vector3(1, 1, 1))
    batch.box(trim, [0, 0.65, 0], [1.8, 0.85, 4.6], 0, matrix)
    batch.box(timber, [0, 1.25, 0.15], [1.7, 0.6, 2.65], 0, matrix)
    batch.box(glass, [0, 1.3, -1.2], [1.55, 0.48, 0.035], 0, matrix)
    for (const x of [-0.85, 0.85]) for (const z of [-1.45, 1.45]) batch.box(metal, [x, 0.3, z], [0.22, 0.55, 0.6], 0, matrix)
    for (const x of [-0.63, 0.63]) batch.box(white, [x, 0.65, 2.31], [0.25, 0.17, 0.02], 0, matrix)
  }
  // Finnish street-name plate (proper names remain Finnish / Swedish).
  const signTexture = canvasTexture(512, 160, (ctx) => {
    ctx.fillStyle = '#d6e5e9'; ctx.fillRect(0, 0, 512, 160)
    ctx.fillStyle = '#003747'; ctx.textAlign = 'center'; ctx.font = 'bold 48px sans-serif'; ctx.fillText('JOKIKATU', 256, 65)
    ctx.font = '32px sans-serif'; ctx.fillText('ÅGATAN', 256, 120)
  })
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 0.78), new THREE.MeshStandardMaterial({ map: signTexture, roughness: 0.8, side: THREE.DoubleSide }))
  const signFrame = roadFrame(22, -half - 0.6)
  sign.position.set(signFrame.x, 2.8, signFrame.z); sign.rotation.y = signFrame.yaw
  group.add(sign); batch.pole(metal, [signFrame.x, 1.6, signFrame.z], [0.04, 3.2, 0.04])
  const goal = roadFrame(FINISH + 5)
  batch.box(trim, [goal.x, 5.8, goal.z], [SCENARIOS[scenario].width + 1.6, 0.65, 0.16], goal.yaw)
  for (const side of [-1, 1]) batch.box(metal, [goal.x + side * (half + 0.7), 2.9, goal.z], [0.12, 5.8, 0.12])
  for (let x = -half; x < half; x += 0.6) for (let row = 0; row < 2; row++) {
    const frame = roadFrame(FINISH + 5, x + 0.3)
    batch.box((Math.round((x + half) / 0.6) + row) % 2 ? metal : trim, [frame.x, 5.63 + row * 0.32, frame.z + 0.095], [0.6, 0.3, 0.025])
  }
  batch.flush(group)
  return { group, lamps }
}

function box(parent: THREE.Object3D, size: number[], position: number[], material: THREE.Material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material)
  mesh.position.set(...position as [number, number, number]); parent.add(mesh)
  return mesh
}

export function createSimulation(canvas: HTMLCanvasElement, hooks: SimulationHooks): SimulationEngine {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.25
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap
  renderer.shadowMap.autoUpdate = false
  const scene = new THREE.Scene()
  const skyColor = new THREE.Color(0x112e38)
  scene.background = skyColor; scene.fog = new THREE.FogExp2(skyColor, 0.006)
  const ambient = new THREE.HemisphereLight(0xc9e2eb, 0x193b45, 0.3)
  scene.add(ambient)
  const moonlight = new THREE.DirectionalLight(0xc0dce8, 0.35)
  moonlight.position.set(-70, 90, -100); scene.add(moonlight)
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), new THREE.MeshStandardMaterial({ color: 0x193b42, roughness: 1 }))
  ground.rotation.x = -Math.PI / 2; ground.position.set(0, -0.08, -120); scene.add(ground)
  const moon = new THREE.Mesh(new THREE.SphereGeometry(3, 16, 12), new THREE.MeshBasicMaterial({ color: 0x9bbfc9, fog: false }))
  moon.position.set(-80, 85, -220); scene.add(moon)
  const starRandom = random(10), stars: number[] = []
  for (let i = 0; i < 130; i++) stars.push((starRandom() - 0.5) * 700, 90 + starRandom() * 200, -100 - starRandom() * 400)
  const starGeometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(stars, 3))
  scene.add(new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: 0xb3d0da, size: 0.55, transparent: true, opacity: 0.6, fog: false })))
  const vehicle = new THREE.Group(), cabin = new THREE.Group()
  scene.add(vehicle); vehicle.add(cabin)
  const camera = new THREE.PerspectiveCamera(67, 1, 0.05, 450)
  camera.position.set(-0.62, TRUCK.eyeHeight, -2.3); camera.rotation.order = 'YXZ'; vehicle.add(camera)
  const cabinMaterial = new THREE.MeshStandardMaterial({ color: 0x122c37, roughness: 0.8, emissive: 0x0c242f, emissiveIntensity: 0.4 })
  const dashTrim = new THREE.MeshStandardMaterial({ color: 0x42606c, roughness: 0.65 })
  const rubber = new THREE.MeshStandardMaterial({ color: 0x09202b, roughness: 0.75 })
  box(cabin, [2.75, 0.35, 0.7], [0, 1.99, -3.18], cabinMaterial)
  box(cabin, [2.7, 0.055, 0.72], [0, 2.18, -3.18], dashTrim)
  for (const side of [-1, 1]) {
    const pillar = box(cabin, [0.12, 1.75, 0.12], [side * 1.29, 2.9, -3.85], cabinMaterial)
    pillar.rotation.z = side * 0.075
    box(cabin, [0.13, 0.52, 1.7], [side * 1.32, 2.05, -2.3], cabinMaterial)
  }
  box(cabin, [2.75, 0.15, 0.15], [0, 3.78, -3.85], cabinMaterial)
  box(cabin, [2.5, 0.16, 0.52], [0, 1.66, -3.85], dashTrim)
  // A short rigid delivery lorry, including the cargo body visible in the mirrors.
  const cargoMaterial = new THREE.MeshStandardMaterial({ color: 0x9bb4be, roughness: 0.8 })
  box(vehicle, [2.5, 3.3, 5.1], [0, 1.9, 1.4], cargoMaterial)
  const wheel = new THREE.Group(); wheel.position.set(-0.62, 2.1, -2.85); wheel.rotation.x = -0.55; cabin.add(wheel)
  wheel.add(new THREE.Mesh(new THREE.TorusGeometry(0.29, 0.033, 10, 40), rubber))
  box(wheel, [0.17, 0.12, 0.06], [0, 0, 0], dashTrim)
  for (let i = 0; i < 3; i++) {
    const spoke = box(wheel, [0.04, 0.23, 0.035], [0, 0, 0], dashTrim)
    const angle = i * Math.PI * 2 / 3; spoke.rotation.z = angle; spoke.position.set(-Math.sin(angle) * 0.12, Math.cos(angle) * 0.12, 0)
  }
  const gaugeTexture = canvasTexture(256, 128, () => {})
  const gauge = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.2), new THREE.MeshBasicMaterial({ map: gaugeTexture }))
  gauge.position.set(-0.62, 2.23, -3.32); cabin.add(gauge)
  for (const side of [-1, 1]) {
    const light = new THREE.SpotLight(0xe4f5f8, 1300, 85, 0.32, 0.7, 2)
    light.position.set(side * 0.85, 0.92, -4.05); light.target.position.set(side * 0.4, 0, -36)
    if (side === -1) { light.castShadow = true; light.shadow.mapSize.set(1024, 1024); light.shadow.bias = -0.0003 }
    vehicle.add(light, light.target)
  }
  const mirrorTargets: THREE.WebGLRenderTarget[] = []
  const mirrorCameras: THREE.PerspectiveCamera[] = []
  for (const side of [-1, 1]) {
    const target = new THREE.WebGLRenderTarget(128, 256)
    target.texture.colorSpace = THREE.SRGBColorSpace; mirrorTargets.push(target)
    const mirrorCamera = new THREE.PerspectiveCamera(48, 0.5, 0.1, 160)
    mirrorCamera.position.set(side * 1.58, 2.55, -3.15); mirrorCamera.rotation.y = Math.PI + side * 0.13
    vehicle.add(mirrorCamera); mirrorCameras.push(mirrorCamera)
    box(cabin, [0.32, 0.6, 0.08], [side * 1.55, 2.7, -4.25], rubber)
    box(cabin, [0.35, 0.06, 0.08], [side * 1.35, 2.65, -4.28], cabinMaterial)
    const mirror = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.52), new THREE.MeshBasicMaterial({ map: target.texture, fog: false, toneMapped: false }))
    mirror.position.set(side * 1.55, 2.7, -4.2); cabin.add(mirror)
  }
  const streetLights = Array.from({ length: 4 }, () => {
    const light = new THREE.PointLight(0xc7e5ed, 0, 23, 2); scene.add(light); return light
  })
  let scenario: Scenario = 'narrow'
  let street = buildStreet(scenario); scene.add(street.group)
  let state = initialState(scenario), controls = emptyControls()
  let running = false, disposed = false, frameId = 0, previous = 0, accumulator = 0, telemetryAt = 0, frameCount = 0
  let lookYaw = 0, lookPitch = -0.035, dragging = false, wasLocked = false, ignoreMouseUntil = 0
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  function updateVehicle() {
    vehicle.position.set(state.x, 0, state.z); vehicle.rotation.y = state.yaw
    camera.rotation.y = lookYaw
    camera.rotation.x = lookPitch
    camera.position.y = TRUCK.eyeHeight + (reducedMotion ? 0 : Math.sin(state.elapsed * 17) * Math.abs(state.speed) * (scenario === 'narrow' ? 0.0015 : 0.0004))
    wheel.rotation.z = -state.steering * 2.5
    const closest = [...street.lamps].sort((a, b) => Math.abs(a.z - state.z) - Math.abs(b.z - state.z)).slice(0, 4)
    streetLights.forEach((light, index) => {
      if (closest[index]) { light.position.copy(closest[index]); light.intensity = scenario === 'wide' ? 1150 : 290 }
      else light.intensity = 0
    })
  }
  function paintGauge() {
    const ctx = (gaugeTexture.image as HTMLCanvasElement).getContext('2d')!
    ctx.fillStyle = '#0a222d'; ctx.fillRect(0, 0, 256, 128)
    ctx.strokeStyle = '#668c9c'; ctx.lineWidth = 3
    ctx.beginPath(); ctx.arc(65, 85, 44, Math.PI, 2 * Math.PI); ctx.stroke()
    for (let i = 0; i <= 6; i++) {
      const angle = Math.PI + i / 6 * Math.PI
      ctx.beginPath(); ctx.moveTo(65 + Math.cos(angle) * 35, 85 + Math.sin(angle) * 35); ctx.lineTo(65 + Math.cos(angle) * 43, 85 + Math.sin(angle) * 43); ctx.stroke()
    }
    const needle = Math.PI + Math.abs(state.speed) * 3.6 / 40 * Math.PI
    ctx.strokeStyle = '#d5edf1'; ctx.beginPath(); ctx.moveTo(65, 85); ctx.lineTo(65 + Math.cos(needle) * 33, 85 + Math.sin(needle) * 33); ctx.stroke()
    ctx.fillStyle = '#d5edf1'; ctx.font = '42px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(String(Math.round(Math.abs(state.speed) * 3.6)), 170, 71)
    ctx.font = '18px sans-serif'; ctx.fillText('km/h', 170, 98)
    gaugeTexture.needsUpdate = true
  }
  function render(mirrors = true) {
    updateVehicle()
    // The light/scene state is identical in all three views. Build shadows once.
    renderer.shadowMap.needsUpdate = true
    if (mirrors) {
      cabin.visible = false
      for (let i = 0; i < mirrorTargets.length; i++) { renderer.setRenderTarget(mirrorTargets[i]); renderer.render(scene, mirrorCameras[i]) }
      cabin.visible = true; renderer.setRenderTarget(null)
    }
    renderer.render(scene, camera)
  }
  function resize() {
    if (disposed) return
    const width = Math.max(1, canvas.clientWidth), height = Math.max(1, canvas.clientHeight)
    renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix()
    if (!running) render()
  }
  const observer = new ResizeObserver(resize); observer.observe(canvas)
  function stop(notify: boolean) {
    const wasRunning = running
    running = false; controls = emptyControls(); dragging = false; accumulator = 0
    cancelAnimationFrame(frameId)
    if (document.pointerLockElement === canvas) document.exitPointerLock()
    if (notify && wasRunning) hooks.paused()
  }
  function frame(now: number) {
    if (!running || disposed) return
    accumulator += Math.min((now - previous) / 1000, 0.08); previous = now
    while (accumulator >= 1 / 120) { state = stepDriving(state, controls, 1 / 120, scenario); accumulator -= 1 / 120 }
    if (now - telemetryAt > 100) { paintGauge(); hooks.tick({ ...state }); telemetryAt = now }
    render(frameCount++ % 3 === 0)
    if (state.finished) { stop(false); hooks.tick({ ...state }); hooks.finished({ ...state }); return }
    frameId = requestAnimationFrame(frame)
  }
  const keyMap: Record<string, keyof Controls> = { KeyW: 'forward', KeyS: 'backward', KeyA: 'left', KeyD: 'right', Space: 'brake', ArrowUp: 'forward', ArrowDown: 'backward', ArrowLeft: 'left', ArrowRight: 'right' }
  function onKey(event: KeyboardEvent) {
    if (!running || event.ctrlKey || event.metaKey || event.altKey) return
    if (event.type === 'keydown' && (event.code === 'Escape' || event.code === 'Tab')) { event.preventDefault(); stop(true); return }
    if (keyMap[event.code]) { event.preventDefault(); controls[keyMap[event.code]] = event.type === 'keydown' }
    if (event.code === 'KeyR' && event.type === 'keydown' && !event.repeat) {
      state = initialState(scenario); lookYaw = 0; lookPitch = -0.035; controls = emptyControls(); hooks.tick({ ...state }); paintGauge()
    }
  }
  function onMouse(event: MouseEvent) {
    if (!running || performance.now() < ignoreMouseUntil || (document.pointerLockElement !== canvas && !dragging)) return
    // Discard cursor-warp events on capture; they are not an intentional head turn.
    if (Math.abs(event.movementX) > 150 || Math.abs(event.movementY) > 150) return
    lookYaw = THREE.MathUtils.clamp(lookYaw - event.movementX * 0.0021, -1.25, 1.25)
    lookPitch = THREE.MathUtils.clamp(lookPitch - event.movementY * 0.0021, -0.55, 0.45)
  }
  function onDown(event: MouseEvent) { if (running && event.button === 0) dragging = true }
  function onUp() { dragging = false }
  function onLock() {
    const locked = document.pointerLockElement === canvas
    hooks.lookMode(locked ? 'locked' : 'drag')
    if (locked) ignoreMouseUntil = performance.now() + 150
    if (wasLocked && !locked && running) stop(true)
    wasLocked = locked
  }
  function onBlur() { stop(true) }
  function onVisibility() { if (document.hidden) stop(true) }
  function onLost(event: Event) { event.preventDefault(); stop(false); hooks.error() }
  function onLockError() { hooks.lookMode('drag') }
  window.addEventListener('keydown', onKey); window.addEventListener('keyup', onKey)
  document.addEventListener('mousemove', onMouse); canvas.addEventListener('mousedown', onDown); window.addEventListener('mouseup', onUp)
  document.addEventListener('pointerlockchange', onLock); document.addEventListener('pointerlockerror', onLockError)
  window.addEventListener('blur', onBlur); document.addEventListener('visibilitychange', onVisibility)
  canvas.addEventListener('webglcontextlost', onLost)
  paintGauge(); resize(); hooks.tick({ ...state })
  return {
    start() {
      if (disposed || state.finished || running) return
      running = true; controls = emptyControls(); previous = performance.now(); accumulator = 0; ignoreMouseUntil = performance.now() + 150
      canvas.focus({ preventScroll: true })
      if (document.pointerLockElement !== canvas) {
        try {
          const request = canvas.requestPointerLock?.()
          if (request && typeof request.catch === 'function') void request.catch(() => { if (!disposed) hooks.lookMode('drag') })
          if (!canvas.requestPointerLock) hooks.lookMode('drag')
        } catch { hooks.lookMode('drag') }
      }
      frameId = requestAnimationFrame(frame)
    },
    pause() { stop(true) },
    reset(nextScenario) {
      stop(false)
      if (nextScenario !== scenario) {
        scene.remove(street.group); disposeObject(street.group)
        scenario = nextScenario; street = buildStreet(scenario); scene.add(street.group)
      }
      ambient.intensity = scenario === 'wide' ? 0.65 : 0.3
      moonlight.intensity = scenario === 'wide' ? 0.55 : 0.35
      state = initialState(scenario); lookYaw = 0; lookPitch = -0.035
      paintGauge(); hooks.tick({ ...state }); render()
    },
    dispose() {
      if (disposed) return
      stop(false); disposed = true; observer.disconnect()
      window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKey)
      document.removeEventListener('mousemove', onMouse); canvas.removeEventListener('mousedown', onDown); window.removeEventListener('mouseup', onUp)
      document.removeEventListener('pointerlockchange', onLock); document.removeEventListener('pointerlockerror', onLockError)
      window.removeEventListener('blur', onBlur); document.removeEventListener('visibilitychange', onVisibility)
      canvas.removeEventListener('webglcontextlost', onLost)
      disposeObject(scene); mirrorTargets.forEach((target) => target.dispose()); renderer.dispose(); renderer.forceContextLoss()
    },
  }
}
