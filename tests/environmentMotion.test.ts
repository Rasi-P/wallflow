import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BufferGeometry, Float32BufferAttribute, MeshBasicMaterial, MeshDepthMaterial, MeshStandardMaterial, ShaderLib } from 'three'
import type { WebGLRenderer } from 'three'
import {
  createEnvironmentMotionClock, createEnvironmentTicker, ENVIRONMENT_MOTION_INTERVAL_MS, ENVIRONMENT_SHADOW_INTERVAL_MS,
} from '../src/three/environments/environmentMotion.ts'
import { officeSunPosition } from '../src/three/environments/officeMotion.ts'
import { OFFICE_KEY_POSITION, OFFICE_ROOM } from '../src/three/environments/officeWhiteboardLayout.ts'
import { addPlantWind, animateFoliage, animateWindowView } from '../src/three/environments/environmentWind.ts'

test('room motion advances with elapsed time and caps environmental shadow requests', () => {
  const advance = createEnvironmentMotionClock()
  let previousShadow = 0
  let shadowCount = 0
  for (let step = 1; step <= 100; step++) {
    const { seconds, refreshShadows } = advance(ENVIRONMENT_MOTION_INTERVAL_MS)
    assert.equal(seconds, step * ENVIRONMENT_MOTION_INTERVAL_MS / 1000)
    if (!refreshShadows) continue
    assert.ok(seconds * 1000 - previousShadow >= ENVIRONMENT_SHADOW_INTERVAL_MS)
    previousShadow = seconds * 1000
    shadowCount++
  }
  assert.equal(shadowCount, 7)
  assert.deepEqual(advance(10_000), { seconds: 8.24, refreshShadows: false })
})

test('the motion ticker holds one pending timer and resumes without advancing hidden time', () => {
  const elapsed: number[] = []
  let now = 0
  let next: (() => void) | undefined
  const run = createEnvironmentTicker((delta) => elapsed.push(delta), {
    now: () => now,
    schedule(callback, interval) {
      assert.equal(next, undefined)
      assert.equal(interval, ENVIRONMENT_MOTION_INTERVAL_MS)
      next = callback
      return 1
    },
    cancel() { next = undefined },
  })
  function tick(delay: number) {
    now += delay
    const callback = next
    next = undefined
    callback?.()
  }
  tick(1000)
  run(true)
  run(true)
  tick(82)
  run(false)
  assert.equal(next, undefined)
  tick(30_000)
  run(true)
  tick(89)
  run(false)
  assert.deepEqual(elapsed, [82, 89])
})

test('daylight starts in the approved pose and its slow drift still reaches the window opening', () => {
  assert.deepEqual(officeSunPosition(0), [...OFFICE_KEY_POSITION])
  const { left, window } = OFFICE_ROOM
  for (let second = 1; second < 1000; second++) {
    const [x, y, z] = officeSunPosition(second)
    const crossing = left / x
    assert.ok(y * crossing > window.sill && y * crossing < window.head)
    assert.ok(z * crossing > window.rear && z * crossing < window.front)
    assert.ok(Math.hypot(y - OFFICE_KEY_POSITION[1], z - OFFICE_KEY_POSITION[2]) < 1)
  }
})

test('wind anchors the plant root and shares its phase with the shadow shader', () => {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute([1, 2, 3, 1, 2.05, 3, 1.9, 4, 3.4, 1.3, 3, 3], 3))
  const original = geometry.attributes.position.array.slice()
  addPlantWind(geometry, [1, 2, 3], 0.05, 2, 0.6)
  const wind = geometry.attributes.plantWind
  assert.deepEqual(geometry.attributes.position.array, original)
  assert.equal(wind.getX(0), 0)
  assert.equal(wind.getX(1), 0)
  assert.ok(wind.getX(2) > wind.getX(3))
  assert.notEqual(wind.getY(2), wind.getY(3))

  const time = { value: 0 }
  const foliage = new MeshStandardMaterial()
  const shadow = new MeshDepthMaterial()
  const exterior = new MeshBasicMaterial()
  animateFoliage(foliage, time)
  animateFoliage(shadow, time)
  animateWindowView(exterior, time)
  for (const [material, source] of [[foliage, ShaderLib.standard], [shadow, ShaderLib.depth], [exterior, ShaderLib.basic]] as const) {
    const shader: Parameters<MeshBasicMaterial['onBeforeCompile']>[0] = { ...source, uniforms: {} }
    material.onBeforeCompile(shader, {} as WebGLRenderer)
    assert.equal(shader.uniforms.environmentMotionSeconds, time)
    if (material === exterior) {
      assert.match(shader.fragmentShader, /view\.g - view\.b/)
      assert.match(shader.fragmentShader, /wisps \* sky/)
    } else {
      assert.match(shader.vertexShader, /transformed \+= bend/)
    }
    material.dispose()
  }
  geometry.dispose()
})

test('each room keeps its own device pause preference, including when storage is unavailable', async () => {
  const preference = 'wallflow-office-motion'
  const values = new Map([[preference, 'paused'], ['wallflow-wall-v1', 'original document']])
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  let writable = true
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem(key: string, value: string) {
      if (!writable) throw new Error('Storage unavailable')
      values.set(key, value)
    },
  } })
  try {
    const { useEnvironmentMotionStore } = await import('../src/stores/environmentMotionStore.ts')
    const state = useEnvironmentMotionStore.getState
    assert.equal(state().office, false)
    assert.equal(state().study, true)
    state().setEnabled('study', false)
    assert.equal(values.get('wallflow-study-motion'), 'paused')
    assert.equal(values.get(preference), 'paused')
    state().setEnabled('office', true)
    assert.equal(state().study, false)
    writable = false
    state().setEnabled('study', true)
    assert.equal(state().study, true)
    assert.deepEqual([...values], [[preference, 'enabled'], ['wallflow-wall-v1', 'original document'], ['wallflow-study-motion', 'paused']])
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  }
})
