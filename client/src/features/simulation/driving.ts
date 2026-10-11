// Presentation-only geometry and bicycle-model physics, not routing or a digital twin.
export type Scenario = 'narrow' | 'wide'
export const TRUCK = { width: 2.55, length: 8, wheelbase: 5, eyeHeight: 2.65 } as const
export const START = 8
export const FINISH = 248
export const ROAD_END = 275
export const SCENARIOS = {
  narrow: { width: 4.8, maxSpeed: 30 / 3.6 },
  wide: { width: 9, maxSpeed: 30 / 3.6 },
} as const

const bends = [[-20, 0], [32, 0], [72, -8], [112, 7], [145, 7], [190, -8], [232, 0], [300, 0]] as const
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

export function roadX(s: number): number {
  for (let i = 1; i < bends.length; i++) {
    if (s <= bends[i][0]) {
      const [fromS, fromX] = bends[i - 1]
      const [toS, toX] = bends[i]
      const t = clamp((s - fromS) / (toS - fromS), 0, 1)
      return fromX + (toX - fromX) * (1 - Math.cos(t * Math.PI)) / 2
    }
  }
  return bends[bends.length - 1][1]
}

export function roadFrame(s: number, offset = 0) {
  const derivative = (roadX(s + 0.05) - roadX(s - 0.05)) / 0.1
  const yaw = -Math.atan(derivative)
  return { x: roadX(s) + Math.cos(yaw) * offset, z: -s - Math.sin(yaw) * offset, yaw }
}

// Nearest point on the sampled centreline, including the straight run-in/run-out.
const segments = Array.from({ length: ROAD_END + 40 }, (_, index) => {
  const s = index - 20
  const x = roadX(s)
  const dx = roadX(s + 1) - x
  return { s, x, dx, length: Math.hypot(dx, 1) }
})
export function projectToRoad(x: number, z: number) {
  let bestDistance = Infinity
  let result = { s: -z, lateral: 0 }
  const index = Math.round(-z) + 20
  for (let i = Math.max(0, index - 16); i < Math.min(segments.length, index + 17); i++) {
    const line = segments[i]
    const t = clamp(((x - line.x) * line.dx - (z + line.s)) / (line.length * line.length), 0, 1)
    const px = line.x + line.dx * t
    const pz = -line.s - t
    const distance = (x - px) ** 2 + (z - pz) ** 2
    if (distance < bestDistance) {
      bestDistance = distance
      result = { s: line.s + t, lateral: ((x - px) + line.dx * (z - pz)) / line.length }
    }
  }
  return result
}

export interface Rectangle { x: number; z: number; yaw: number; width: number; length: number }
export function parkedVehicles(scenario: Scenario): Rectangle[] {
  return [82, 172, 217].map((s, index) => {
    const side = index === 1 ? -1 : 1
    const offset = SCENARIOS[scenario].width / 2 + (scenario === 'narrow' ? -0.3 : 0.8)
    return { ...roadFrame(s, side * offset), width: 1.8, length: 4.6 }
  })
}

// Separating-axis test. Positive means separated, zero/negative means contact.
export function rectangleGap(a: Rectangle, b: Rectangle): number {
  const axes = (box: Rectangle) => [
    { x: Math.cos(box.yaw), z: -Math.sin(box.yaw), size: box.width / 2 },
    { x: -Math.sin(box.yaw), z: -Math.cos(box.yaw), size: box.length / 2 },
  ]
  const aAxes = axes(a)
  const bAxes = axes(b)
  const radius = (boxAxes: ReturnType<typeof axes>, axis: { x: number; z: number }) =>
    boxAxes.reduce((sum, item) => sum + Math.abs(item.x * axis.x + item.z * axis.z) * item.size, 0)
  return Math.max(...[...aAxes, ...bAxes].map((axis) =>
    Math.abs((b.x - a.x) * axis.x + (b.z - a.z) * axis.z) - radius(aAxes, axis) - radius(bAxes, axis)))
}

export function clearanceAt(pose: { x: number; z: number; yaw: number }, scenario: Scenario): number {
  const rightX = Math.cos(pose.yaw)
  const rightZ = -Math.sin(pose.yaw)
  const forwardX = -Math.sin(pose.yaw)
  const forwardZ = -Math.cos(pose.yaw)
  let clearance = Infinity
  // Test the whole rigid body, not just the camera or front axle.
  for (const forward of [-TRUCK.length / 2, -2, 0, 2, TRUCK.length / 2]) {
    for (const side of [-TRUCK.width / 2, TRUCK.width / 2]) {
      const point = projectToRoad(pose.x + rightX * side + forwardX * forward, pose.z + rightZ * side + forwardZ * forward)
      clearance = Math.min(clearance, SCENARIOS[scenario].width / 2 - Math.abs(point.lateral))
    }
  }
  for (const vehicle of parkedVehicles(scenario)) {
    clearance = Math.min(clearance, rectangleGap({ ...pose, ...TRUCK }, vehicle))
  }
  return clearance
}

export interface Controls { forward: boolean; backward: boolean; left: boolean; right: boolean; brake: boolean }
export const emptyControls = (): Controls => ({ forward: false, backward: false, left: false, right: false, brake: false })
export interface DriveState {
  x: number; z: number; yaw: number; speed: number; steering: number
  elapsed: number; contacts: number; touching: boolean; contactFlash: number
  clearance: number; minClearance: number; progress: number; finished: boolean
}
export function initialState(scenario: Scenario): DriveState {
  const pose = roadFrame(START, scenario === 'wide' ? 1.6 : 0)
  const clearance = clearanceAt(pose, scenario)
  return { ...pose, speed: 0, steering: 0, elapsed: 0, contacts: 0, touching: false, contactFlash: 0, clearance, minClearance: clearance, progress: 0, finished: false }
}
const approach = (value: number, target: number, amount: number) => value + clamp(target - value, -amount, amount)

export function stepDriving(state: DriveState, input: Controls, dt: number, scenario: Scenario): DriveState {
  if (state.finished) return state
  // The scene supplies fixed 1/120 s steps; bound direct callers as well.
  dt = clamp(dt, 0, 1 / 30)
  if (dt === 0) return state
  const steering = approach(state.steering, (Number(input.left) - Number(input.right)) * 0.53, dt * 1.5)
  let speed = state.speed
  if (input.brake || (input.forward && input.backward)) speed = approach(speed, 0, 8 * dt)
  else if (input.forward) speed = speed < -0.05 ? approach(speed, 0, 5 * dt) : Math.min(speed + 2.3 * dt, SCENARIOS[scenario].maxSpeed)
  else if (input.backward) speed = speed > 0.05 ? approach(speed, 0, 5 * dt) : Math.max(speed - 1.8 * dt, -2.4)
  else speed = approach(speed, 0, 0.8 * dt)

  const yaw = state.yaw + speed / TRUCK.wheelbase * Math.tan(steering) * dt
  const pose = { yaw, x: state.x - Math.sin(yaw) * speed * dt, z: state.z - Math.cos(yaw) * speed * dt }
  const rawClearance = clearanceAt(pose, scenario)
  const contact = rawClearance < 0 || -pose.z < START - 3
  const nextPose = contact ? { x: state.x, z: state.z, yaw: state.yaw } : pose
  const clearance = contact ? 0 : rawClearance
  const progress = clamp((projectToRoad(nextPose.x, nextPose.z).s - START) / (FINISH - START), 0, 1)
  return {
    ...nextPose, speed: contact ? 0 : speed, steering, elapsed: state.elapsed + dt,
    contacts: state.contacts + Number(contact && !state.touching), touching: contact,
    contactFlash: contact ? 1.6 : Math.max(0, state.contactFlash - dt),
    clearance, minClearance: Math.min(state.minClearance, clearance), progress, finished: progress >= 1,
  }
}
