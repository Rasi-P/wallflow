import { useCallback, useEffect, useRef, useState } from 'react'
import type { ComponentRef, RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei/core/OrbitControls.js'
import { Euler, MathUtils, MOUSE, TOUCH, Vector3 } from 'three'
import type { Camera, Group } from 'three'
import { useWallStore } from '../stores/wallStore'
import type { Point2 } from '../types/wall'
import { constrainWallView, MAX_CAMERA_DISTANCE, MIN_CAMERA_DISTANCE, WALL_CAMERA_FOV } from './wallViewBounds'
import { getStarterFrame } from './starterFrame'
import { SAMPLE_NOTES } from '../utils/constants'
import { positionWallFocus, resolveCameraFocus, wallFocusDistance } from './cameraFocus'

function wallOrientation([tilt, turn]: Point2) {
  return new Euler(MathUtils.degToRad(tilt), MathUtils.degToRad(turn), 0)
}

function homeTarget(mobile: boolean, starterX: number | undefined, starterY: number | undefined) {
  const { notes, wallRotation } = useWallStore.getState()
  if (starterX !== undefined && starterY !== undefined) return new Vector3(starterX, starterY, 0).applyEuler(wallOrientation(wallRotation))
  const firstNote = notes.find((note) => !note.archived)
  if (mobile && firstNote) return new Vector3(...firstNote.position, 0).applyEuler(wallOrientation(wallRotation))
  return new Vector3(0, 0.18, 0)
}

export function CameraRig({ wall, reducedMotion = false }: { wall: RefObject<Group | null>; reducedMotion?: boolean }) {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null)
  const camera = useThree((state) => state.camera)
  const invalidate = useThree((state) => state.invalidate)
  const { width, height } = useThree((state) => state.size)
  const mode = useWallStore((s) => s.mode)
  const command = useWallStore((s) => s.cameraCommand)
  const mobile = width <= 700
  const aspect = width > 0 && height > 0 ? width / height : 1
  const [starterWall] = useState(() => {
    const notes = useWallStore.getState().notes.filter((note) => !note.archived)
    return notes.length === SAMPLE_NOTES.length && SAMPLE_NOTES.every((sample, i) => {
      const note = notes[i]
      return note.id === sample.id && note.position[0] === sample.position[0] && note.position[1] === sample.position[1]
    })
  })
  const starterFrame = starterWall ? getStarterFrame(width, height) : null
  const starterX = starterFrame?.x, starterY = starterFrame?.y
  const baseDistance = starterFrame?.distance ?? (mobile ? 14.6 : MathUtils.clamp(10.4 / (2 * Math.tan(MathUtils.degToRad(WALL_CAMERA_FOV / 2)) * aspect), 14.6, MAX_CAMERA_DISTANCE))
  const distanceRef = useRef(baseDistance)
  const initializedCamera = useRef<Camera | null>(null)
  const transition = useRef<{ position: Vector3; target: Vector3; kind: 'reset' | 'zoom' | 'focus' | 'section'; anchor?: Point2; distance?: number } | null>(null)
  const handledCommand = useRef<typeof command>(null)
  const lastBounds = useRef({ tilt: NaN, turn: NaN, aspect: NaN })

  const constrain = useCallback(() => {
    const control = controls.current
    const surface = wall.current
    if (!control || !surface) return
    if (constrainWallView(surface, control.target, camera.position, aspect)) camera.lookAt(control.target)
    const bounds = lastBounds.current
    bounds.tilt = surface.rotation.x
    bounds.turn = surface.rotation.y
    bounds.aspect = aspect
    camera.updateMatrixWorld()
  }, [aspect, camera, wall])

  useEffect(() => {
    distanceRef.current = baseDistance
    if (initializedCamera.current !== camera) {
      initializedCamera.current = camera
      const target = homeTarget(mobile, starterX, starterY)
      transition.current = null
      camera.position.copy(target).add(new Vector3(0, 0, baseDistance))
      controls.current?.target.copy(target)
      controls.current?.update()
    }
    const distance = controls.current?.getDistance() || baseDistance
    useWallStore.getState().setZoomPercent(Math.round(baseDistance / distance * 100))
    useWallStore.getState().setZoomBounds([Math.round(baseDistance / MAX_CAMERA_DISTANCE * 100), Math.round(baseDistance / MIN_CAMERA_DISTANCE * 100)])
    invalidate()
  }, [baseDistance, camera, invalidate, mobile, starterX, starterY])

  useEffect(() => {
    const control = controls.current
    if (!control) return
    const update = control.update
    let locked = false
    control.update = () => locked ? false : update()
    // Keep the coordinates of an active touch current for pinch handoff while freezing the camera.
    const sync = (state: ReturnType<typeof useWallStore.getState>) => {
      const wasLocked = locked
      const wasEnabled = control.enabled
      locked = state.draggingId !== null
      const hasDialog = state.editingId || state.searchOpen || state.settingsOpen || state.helpOpen
      control.enabled = !hasDialog && (!locked || state.draggingFromTouch)
      control.enablePan = control.enableZoom = control.enableRotate = !locked
      if (locked) transition.current = null
      if ((wasLocked && !locked) || (!wasEnabled && control.enabled)) invalidate()
    }
    sync(useWallStore.getState())
    const unsubscribe = useWallStore.subscribe(sync)
    return () => { unsubscribe(); control.update = update }
  }, [invalidate])

  useEffect(() => {
    if (!command || !controls.current || handledCommand.current === command) return
    handledCommand.current = command
    const state = useWallStore.getState()
    if (state.draggingId) return
    const target = controls.current.target.clone()
    const position = camera.position.clone()
    let anchor: Point2 | undefined
    let distance: number | undefined
    if (command.kind === 'reset') {
      target.copy(homeTarget(mobile, starterX, starterY))
      position.copy(target).add(new Vector3(0, 0, distanceRef.current))
    } else if (command.kind === 'zoom') {
      const pending = transition.current?.kind === 'zoom' ? transition.current : null
      const offset = pending ? pending.position.clone().sub(pending.target) : camera.position.clone().sub(target)
      const length = MathUtils.clamp(offset.length() * (command.value ?? 1), MIN_CAMERA_DISTANCE, MAX_CAMERA_DISTANCE)
      position.copy(target).add(offset.setLength(length))
    } else {
      const focus = resolveCameraFocus(state, command.kind, command.targetId)
      if (!focus || !wall.current) return
      anchor = focus.center
      distance = wallFocusDistance(focus.width, focus.height, aspect)
      positionWallFocus(wall.current, anchor, distance, target, position)
    }
    if (wall.current) constrainWallView(wall.current, target, position, aspect)
    transition.current = { position, target, kind: command.kind, anchor, distance }
    invalidate()
  }, [command, camera, invalidate, mobile, aspect, wall, starterX, starterY])

  useFrame((_, delta) => {
    const control = controls.current
    const tween = transition.current
    if (!control?.enabled || useWallStore.getState().draggingId) return
    const bounds = lastBounds.current
    const surface = wall.current
    const boundsChanged = surface && (surface.rotation.x !== bounds.tilt || surface.rotation.y !== bounds.turn || aspect !== bounds.aspect)
    if (tween) {
      if (surface && boundsChanged) {
        if (tween.anchor && tween.distance) positionWallFocus(surface, tween.anchor, tween.distance, tween.target, tween.position)
        constrainWallView(surface, tween.target, tween.position, aspect)
      }
      const settled = reducedMotion || (camera.position.distanceToSquared(tween.position) < 0.000004 &&
        control.target.distanceToSquared(tween.target) < 0.000004)
      const alpha = settled ? 1 : 1 - Math.exp(-9 * Math.min(delta, 0.05))
      camera.position.lerp(tween.position, alpha)
      control.target.lerp(tween.target, alpha)
      control.update()
      if (settled) transition.current = null
      else invalidate()
    }
    // Native input is checked on change. Recheck when a wall animation or a resize moves the bounds.
    if (boundsChanged) constrain()
  })

  return <OrbitControls ref={controls} makeDefault
    enableDamping={!reducedMotion} dampingFactor={0.085} zoomSpeed={0.7} panSpeed={0.8} rotateSpeed={0.45}
    minDistance={MIN_CAMERA_DISTANCE} maxDistance={MAX_CAMERA_DISTANCE}
    minPolarAngle={Math.PI * 0.28} maxPolarAngle={Math.PI * 0.72}
    minAzimuthAngle={-Math.PI * 0.32} maxAzimuthAngle={Math.PI * 0.32}
    mouseButtons={{ LEFT: mode === 'orbit' ? MOUSE.ROTATE : mode === 'pan' ? MOUSE.PAN : undefined, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN }}
    touches={{ ONE: mode === 'orbit' ? TOUCH.ROTATE : mode === 'pan' ? TOUCH.PAN : undefined, TWO: TOUCH.DOLLY_PAN }}
    onStart={() => { transition.current = null }}
    onChange={() => {
      if (!controls.current) return
      constrain()
      const zoom = Math.round(distanceRef.current / controls.current.getDistance() * 100)
      if (useWallStore.getState().zoomPercent !== zoom) useWallStore.getState().setZoomPercent(zoom)
    }} />
}
