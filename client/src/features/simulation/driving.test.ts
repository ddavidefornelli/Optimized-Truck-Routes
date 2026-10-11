import { describe, expect, it } from 'vitest'
import { clearanceAt, emptyControls, FINISH, initialState, parkedVehicles, projectToRoad, rectangleGap, roadFrame, roadX, SCENARIOS, START, stepDriving, TRUCK } from './driving'
import type { Controls, DriveState, Scenario } from './driving'

function drive(state: DriveState, input: Partial<Controls>, seconds: number, mode: Scenario = 'narrow') {
  for (let i = 0; i < Math.round(seconds * 120); i++) state = stepDriving(state, { ...emptyControls(), ...input }, 1 / 120, mode)
  return state
}

describe('illustrative street and vehicle geometry', () => {
  it('keeps the same bends and speed limit in both scenarios', () => {
    expect(SCENARIOS.narrow.maxSpeed).toBe(SCENARIOS.wide.maxSpeed)
    expect(SCENARIOS.wide.width).toBeGreaterThan(SCENARIOS.narrow.width)
    expect(roadX(START)).toBe(0)
    expect(roadX(72)).toBe(-8)
    expect(roadX(112)).toBe(7)
    for (let s = 0; s < 275; s += 3) {
      const frame = roadFrame(s)
      expect(projectToRoad(frame.x, frame.z).s).toBeCloseTo(s, 1)
      expect(projectToRoad(frame.x, frame.z).lateral).toBeCloseTo(0, 3)
      expect(Math.abs(roadX(s + 0.01) - roadX(s))).toBeLessThan(0.01)
    }
  })

  it('starts with a stationary, collision-free lorry and more room on the wide road', () => {
    const narrow = initialState('narrow'), wide = initialState('wide')
    expect(narrow.speed).toBe(0)
    expect(narrow.contacts).toBe(0)
    expect(narrow.progress).toBe(0)
    expect(narrow.clearance).toBeCloseTo((SCENARIOS.narrow.width - TRUCK.width) / 2)
    expect(wide.clearance).toBeGreaterThan(narrow.clearance)
    expect(wide.clearance).toBeGreaterThan(0)
  })

  it('checks the full body, including corner swing, not just the eye position', () => {
    const pose = { ...roadFrame(15), yaw: Math.PI / 4 }
    expect(Math.abs(projectToRoad(pose.x, pose.z).lateral)).toBeLessThan(0.01)
    expect(clearanceAt(pose, 'narrow')).toBeLessThan(0)
    expect(clearanceAt(pose, 'wide')).toBeGreaterThan(0)
  })

  it('detects rotated parked-car collisions using both rectangle axes', () => {
    const a = { x: 0, z: 0, yaw: Math.PI / 4, width: 2, length: 4 }
    expect(rectangleGap(a, a)).toBeLessThan(0)
    expect(rectangleGap(a, { ...a, x: 12 })).toBeGreaterThan(0)
    const car = parkedVehicles('narrow')[0]
    expect(clearanceAt(car, 'narrow')).toBeLessThan(0)
    expect(parkedVehicles('wide')).toHaveLength(3)
  })
})

describe('WASD driving', () => {
  it('accelerates forward, coasts, brakes and reverses', () => {
    const moving = drive(initialState('narrow'), { forward: true }, 2)
    expect(moving.speed).toBeCloseTo(4.6)
    expect(moving.z).toBeLessThan(-START)
    expect(moving.progress).toBeGreaterThan(0)
    expect(drive(moving, {}, 0.5).speed).toBeLessThan(moving.speed)
    const stopped = drive(moving, { brake: true }, 1)
    expect(stopped.speed).toBe(0)
    const reversed = drive(stopped, { backward: true }, 1)
    expect(reversed.speed).toBeLessThan(0)
    expect(reversed.z).toBeGreaterThan(stopped.z)
    const speedLimited = drive(initialState('wide'), { forward: true }, 4, 'wide')
    expect(speedLimited.speed).toBeLessThanOrEqual(SCENARIOS.wide.maxSpeed)
  })

  it('turns a lorry rather than strafing or rotating in place', () => {
    const parked = drive(initialState('wide'), { left: true }, 0.5, 'wide')
    expect(parked.yaw).toBe(0)
    expect(parked.steering).toBeCloseTo(0.53)
    const left = drive(parked, { forward: true, left: true }, 1, 'wide')
    expect(left.yaw).toBeGreaterThan(0)
    expect(left.x).toBeLessThan(parked.x)
    const right = drive(initialState('wide'), { forward: true, right: true }, 1, 'wide')
    expect(right.yaw).toBeLessThan(0)
    expect(right.x).toBeGreaterThan(initialState('wide').x)
  })

  it('stops on kerb contact, counts a contact once, and allows recovery in reverse', () => {
    let state = drive(initialState('narrow'), { forward: true, left: true }, 4)
    expect(state.contacts).toBeGreaterThan(0)
    expect(state.speed).toBe(0)
    expect(state.clearance).toBe(0)
    const contacts = state.contacts
    const position = { x: state.x, z: state.z }
    state = drive(state, { forward: true, left: true }, 1)
    expect(state.contacts).toBe(contacts)
    expect(state.x).toBe(position.x)
    expect(state.z).toBe(position.z)
    state = drive(state, { backward: true, left: true }, 1)
    expect(state.speed).toBeLessThan(0)
    expect(state.z).toBeGreaterThan(position.z)
  })

  it('opposing controls brake, and reset creates a clean new run', () => {
    const moving = drive(initialState('narrow'), { forward: true }, 1)
    const stopped = drive(moving, { forward: true, backward: true, left: true, right: true }, 1)
    expect(stopped.speed).toBe(0)
    expect(stopped.steering).toBe(0)
    expect(initialState('narrow')).toMatchObject({ elapsed: 0, contacts: 0, contactFlash: 0, finished: false })
  })

  it('finishes at the gate and freezes the completed result', () => {
    const state = { ...initialState('wide'), ...roadFrame(FINISH - 0.01, 1.6), speed: 2 }
    const complete = stepDriving(state, { ...emptyControls(), forward: true }, 1 / 120, 'wide')
    expect(complete.finished).toBe(true)
    expect(complete.progress).toBe(1)
    expect(drive(complete, { forward: true }, 5, 'wide')).toEqual(complete)
  })

  it('bounds suspended-tab deltas and never moves when the step is zero', () => {
    const state = initialState('narrow')
    const after = stepDriving(state, { ...emptyControls(), forward: true }, 300, 'narrow')
    expect(after.elapsed).toBeCloseTo(1 / 30)
    expect(after.progress).toBeLessThan(0.01)
    expect(stepDriving(state, emptyControls(), 0, 'narrow')).toEqual(state)
  })
})
