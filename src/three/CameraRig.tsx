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
import { compactStudyFrame, STUDY_ROOM_MAX_DISTANCE, studyRoomFrame } from './environments/studyRoomLayout'
import { OFFICE_ROOM_MAX_DISTANCE, officeWhiteboardFrame } from './environments/officeWhiteboardLayout'

function measureCompactInsets(canvas: HTMLCanvasElement) {
  const app = canvas.closest('.wallflow-app')
  const bounds = canvas.getBoundingClientRect()
  const header = app?.querySelector('.app-header')?.getBoundingClientRect()
  const toolbar = app?.querySelector('.floating-toolbar')?.getBoundingClientRect()
  const styles = app ? getComputedStyle(app) : null
  const safe = (edge: 'left' | 'right') => Number.parseFloat(styles?.getPropertyValue(`--wall-safe-${edge}`) ?? '') || 0
  return {
    left: safe('left') + 14,
    right: safe('right') + 14,
    top: header?.height ? Math.max(10, header.bottom - bounds.top + 10) : 116,
    bottom: toolbar?.height ? Math.max(10, bounds.bottom - toolbar.top + 10) : 204,
  }
}

function wallOrientation([tilt, turn]: Point2) {
  return new Euler(MathUtils.degToRad(tilt), MathUtils.degToRad(turn), 0)
}

function homeTarget(mobile: boolean, starterX: number | undefined, starterY: number | undefined, roomX?: number, roomY?: number) {
  if (roomX !== undefined && roomY !== undefined) return new Vector3(roomX, roomY, 0)
  const { notes, wallRotation } = useWallStore.getState()
  if (starterX !== undefined && starterY !== undefined) return new Vector3(starterX, starterY, 0).applyEuler(wallOrientation(wallRotation))
  const firstNote = notes.find((note) => !note.archived)
  if (mobile && firstNote) return new Vector3(...firstNote.position, 0).applyEuler(wallOrientation(wallRotation))
  return new Vector3(0, 0.18, 0)
}

export function CameraRig({ wall, reducedMotion = false, room }: { wall: RefObject<Group | null>; reducedMotion?: boolean; room: 'study' | 'office' | null }) {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null)
  const camera = useThree((state) => state.camera)
  const canvas = useThree((state) => state.gl.domElement)
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
  const roomFrame = room === 'office' ? officeWhiteboardFrame(width, height) : room === 'study' ? studyRoomFrame(width, height) : null
  const starterX = starterFrame?.x, starterY = starterFrame?.y
  const roomX = roomFrame?.x, roomY = roomFrame?.y
  const roomOverview = roomFrame !== null
  const compact = room !== null && !roomOverview
  const layout = room ? `${room}-${roomOverview ? 'overview' : 'compact'}` : 'wall'
  const roomLimit = room === 'office' ? OFFICE_ROOM_MAX_DISTANCE : STUDY_ROOM_MAX_DISTANCE
  const [compactLimit, setCompactLimit] = useState(MAX_CAMERA_DISTANCE)
  const maxDistance = roomOverview ? roomLimit : compact ? compactLimit : MAX_CAMERA_DISTANCE
  const boardDistance = starterFrame?.distance ?? (mobile ? 14.6 : MathUtils.clamp(10.4 / (2 * Math.tan(MathUtils.degToRad(WALL_CAMERA_FOV / 2)) * aspect), 14.6, MAX_CAMERA_DISTANCE))
  const baseDistance = roomFrame?.distance ?? boardDistance
  const distanceRef = useRef(baseDistance)
  const initializedCamera = useRef<Camera | null>(null)
  const previousHome = useRef<{ layout: typeof layout; target: Vector3; position: Vector3 } | null>(null)
  const transition = useRef<{ position: Vector3; target: Vector3; kind: 'reset' | 'zoom' | 'focus' | 'section'; anchor?: Point2; distance?: number } | null>(null)
  const handledCommand = useRef<typeof command>(null)
  const lastBounds = useRef({ tilt: NaN, turn: NaN, aspect: NaN })

  const getHome = useCallback(() => {
    if (compact) {
      const { notes, wallRotation } = useWallStore.getState()
      const fit = compactStudyFrame(width, height, notes, wallRotation, measureCompactInsets(canvas))
      return { target: new Vector3(fit.x, fit.y, 0), distance: fit.distance, limit: fit.maxDistance }
    }
    return {
      target: homeTarget(mobile, starterX, starterY, roomX, roomY),
      distance: baseDistance,
      limit: roomOverview ? roomLimit : MAX_CAMERA_DISTANCE,
    }
  }, [compact, width, height, canvas, mobile, starterX, starterY, roomX, roomY, baseDistance, roomOverview, roomLimit])

  const updateZoomRange = useCallback((distance: number, limit: number) => {
    distanceRef.current = distance
    const control = controls.current
    if (control) control.maxDistance = limit
    if (compact) setCompactLimit(limit)
    useWallStore.getState().setZoomBounds([Math.round(distance / limit * 100), Math.round(distance / MIN_CAMERA_DISTANCE * 100)])
    if ('far' in camera && 'updateProjectionMatrix' in camera && typeof camera.updateProjectionMatrix === 'function') {
      camera.far = compact ? Math.max(110, limit + 52) : room === 'office' ? 124 : 110
      camera.updateProjectionMatrix()
    }
  }, [camera, compact, room])

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
    if (width <= 0 || height <= 0) return
    const { target, distance, limit } = getHome()
    const position = target.clone().add(new Vector3(0, 0, distance))
    const control = controls.current
    const previous = previousHome.current
    const wasAtHome = control && previous &&
      camera.position.distanceToSquared(previous.position) < 0.001 && control.target.distanceToSquared(previous.target) < 0.001
    updateZoomRange(distance, limit)
    const { editingId, draggingId } = useWallStore.getState()
    if (initializedCamera.current !== camera || previous?.layout !== layout || (room && wasAtHome && !editingId && !draggingId)) {
      initializedCamera.current = camera
      transition.current = null
      camera.position.copy(position)
      camera.lookAt(target)
      control?.target.copy(target)
      control?.update()
    }
    previousHome.current = { layout, target, position }
    useWallStore.getState().setZoomPercent(Math.round(distance / (control?.getDistance() || distance) * 100))
    invalidate()
  }, [camera, getHome, height, invalidate, layout, room, updateZoomRange, width])

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
    if (!command || !controls.current || width <= 0 || height <= 0 || handledCommand.current === command) return
    handledCommand.current = command
    const state = useWallStore.getState()
    if (state.draggingId) return
    const target = controls.current.target.clone()
    const position = camera.position.clone()
    let anchor: Point2 | undefined
    let distance: number | undefined
    if (command.kind === 'reset' || command.kind === 'overview') {
      const home = getHome()
      updateZoomRange(home.distance, home.limit)
      target.copy(home.target)
      position.copy(target).add(new Vector3(0, 0, home.distance))
      previousHome.current = { layout, target: target.clone(), position: position.clone() }
    } else if (command.kind === 'zoom') {
      const pending = transition.current?.kind === 'zoom' ? transition.current : null
      const offset = pending ? pending.position.clone().sub(pending.target) : camera.position.clone().sub(target)
      const length = MathUtils.clamp(offset.length() * (command.value ?? 1), MIN_CAMERA_DISTANCE, controls.current.maxDistance)
      position.copy(target).add(offset.setLength(length))
    } else {
      const focus = resolveCameraFocus(state, command.kind, command.targetId)
      if (!focus || !wall.current) return
      anchor = focus.center
      distance = wallFocusDistance(focus.width, focus.height, aspect)
      positionWallFocus(wall.current, anchor, distance, target, position)
    }
    if (wall.current) constrainWallView(wall.current, target, position, aspect)
    transition.current = { position, target, kind: command.kind === 'overview' ? 'reset' : command.kind, anchor, distance }
    invalidate()
  }, [command, camera, invalidate, aspect, wall, getHome, height, layout, updateZoomRange, width])

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
    minDistance={MIN_CAMERA_DISTANCE} maxDistance={maxDistance}
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
