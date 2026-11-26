import { useCallback, useLayoutEffect, useRef } from 'react'
import type { ComponentRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei/core/OrbitControls.js'
import { MathUtils, MOUSE, TOUCH } from 'three'
import type { OrthographicCamera } from 'three'
import { useWallStore, useWorkspaceStore } from '../stores/wallStore'
import type { Point2 } from '../types/wall'
import { WALL_HEIGHT, WALL_WIDTH } from '../utils/constants'
import { resolveCameraFocus } from './cameraFocus'
import { photoCameraTarget, photoWallFrame } from './photoWallFrame'
import { mobileStudyFrame, studyNoteFitsOpening, studyOpeningAt } from './mobileStudyFrame'
import type { StudyOpening } from './mobileStudyFrame'

const CAMERA_DEPTH = 24
type View = { target: Point2; scale: number }
type Preset = 'default' | 'overview'
type PendingView = View & { preset?: Preset }
type Frame = ReturnType<typeof photoWallFrame> & Partial<Pick<ReturnType<typeof mobileStudyFrame>, 'opening' | 'overview'>>

function presetView(frame: Frame, preset: Preset): View {
  const view = preset === 'overview' ? frame.overview ?? frame : frame
  return { target: photoCameraTarget(view.content, frame.centre, view.scale), scale: view.scale }
}

function cameraMatches(camera: OrthographicCamera, view: View) {
  return Math.abs(camera.zoom - view.scale) < 0.02 &&
    Math.hypot(camera.position.x - view.target[0], camera.position.y - view.target[1]) < 0.03
}

export const photoCameraOptions = { position: [0, 0, CAMERA_DEPTH] as [number, number, number], near: 0.1, far: 60 }

function measureInsets(canvas: HTMLCanvasElement) {
  const app = canvas.closest('.wallflow-app')
  const bounds = canvas.getBoundingClientRect()
  const header = app?.querySelector('.app-header')?.getBoundingClientRect()
  const toolbar = app?.querySelector('.floating-toolbar')?.getBoundingClientRect()
  const styles = app && getComputedStyle(app)
  const safe = (edge: 'left' | 'right') => Number.parseFloat(styles?.getPropertyValue('--wall-safe-' + edge) ?? '') || 0
  return {
    left: safe('left'), right: safe('right'),
    top: header ? header.bottom - bounds.top : 0,
    bottom: toolbar ? bounds.bottom - toolbar.top : 0,
  }
}

export function PhotoCameraRig({ phone, reducedMotion, onStudyOpening }: {
  phone: boolean; reducedMotion: boolean; onStudyOpening: (opening: StudyOpening | null) => void
}) {
  const control = useRef<ComponentRef<typeof OrbitControls>>(null)
  const camera = useThree((state) => state.camera) as OrthographicCamera
  const { width, height } = useThree((state) => state.size)
  const canvas = useThree((state) => state.gl.domElement)
  const invalidate = useThree((state) => state.invalidate)
  const mode = useWallStore((state) => state.mode)
  const command = useWallStore((state) => state.cameraCommand)
  const boardId = useWorkspaceStore((state) => state.activeBoardId)
  const previousBoard = useRef<string | undefined>(undefined)
  const previousPhone = useRef(phone)
  const handled = useRef<typeof command>(null)
  const framing = useRef<Frame | null>(null)
  const pending = useRef<PendingView | null>(null)

  const showZoom = useCallback(() => {
    if (!framing.current) return
    const state = useWallStore.getState()
    const zoom = Math.round(camera.zoom / framing.current.scale * 100)
    if (state.zoomPercent !== zoom) state.setZoomPercent(zoom)
  }, [camera])

  const setView = useCallback(({ target, scale }: View) => {
    const controls = control.current
    if (!controls) return
    camera.zoom = scale
    camera.updateProjectionMatrix()
    camera.position.set(...target, CAMERA_DEPTH)
    controls.target.set(...target, 0)
    controls.update()
    camera.updateMatrixWorld()
    showZoom()
    invalidate()
  }, [camera, invalidate, showZoom])

  const measureFrame = useCallback(() => {
    const document = useWallStore.getState()
    const insets = measureInsets(canvas)
    const frame = phone ? mobileStudyFrame(width, height, document, insets) : photoWallFrame(width, height, document, insets)
    framing.current = frame
    if (control.current) {
      control.current.minZoom = frame.min
      control.current.maxZoom = frame.max
    }
    useWallStore.getState().setZoomBounds([Math.round(frame.min / frame.scale * 100), Math.round(frame.max / frame.scale * 100)])
    return frame
  }, [canvas, height, phone, width])

  const preparePreset = useCallback((frame: Frame, preset: Preset): PendingView => {
    const opening = phone && preset === 'default' ? frame.opening ?? null : null
    onStudyOpening(opening)
    if (opening) {
      const state = useWallStore.getState()
      const selected = state.notes.find(({ id }) => id === state.selectedId)
      if (selected && !state.editingId && !studyNoteFitsOpening(selected, opening)) state.select(null)
    }
    return { ...presetView(frame, preset), preset }
  }, [onStudyOpening, phone])

  useLayoutEffect(() => {
    if (!width || !height || !control.current) return
    const sameView = previousBoard.current === boardId && previousPhone.current === phone
    const previous = framing.current
    const wasAtHome = previous && cameraMatches(camera, presetView(previous, 'default'))
    const wasAtOverview = phone && previous?.overview && cameraMatches(camera, presetView(previous, 'overview'))
    const resizingPreset = phone ? pending.current?.preset : undefined
    const frame = measureFrame()
    previousBoard.current = boardId
    previousPhone.current = phone
    pending.current = null
    if (!sameView || !previous || wasAtHome) setView(preparePreset(frame, 'default'))
    else if (resizingPreset || wasAtOverview) setView(preparePreset(frame, resizingPreset ?? 'overview'))
    else setView({ target: [camera.position.x, camera.position.y], scale: MathUtils.clamp(camera.zoom, frame.min, frame.max) })
  }, [boardId, camera, height, measureFrame, phone, preparePreset, setView, width])

  useLayoutEffect(() => {
    const controls = control.current
    if (!controls) return
    let locked = false
    const update = controls.update.bind(controls)
    controls.update = () => locked ? false : update()
    const sync = (state: ReturnType<typeof useWallStore.getState>) => {
      const wasEnabled = controls.enabled
      locked = state.draggingId !== null
      const dialog = state.editingId || state.searchOpen || state.settingsOpen || state.helpOpen || state.tasksOpen
      controls.enabled = !dialog && (!locked || state.draggingFromTouch)
      controls.enablePan = controls.enableZoom = !locked
      if (locked) pending.current = null
      if (!wasEnabled && controls.enabled) invalidate()
    }
    sync(useWallStore.getState())
    const unsubscribe = useWallStore.subscribe(sync)
    return () => { unsubscribe(); controls.update = update }
  }, [invalidate])

  useLayoutEffect(() => {
    const controls = control.current
    if (!controls || !command || handled.current === command || !framing.current) return
    handled.current = command
    const state = useWallStore.getState()
    if (state.draggingId) return
    const frame = framing.current
    const limit = (scale: number) => MathUtils.clamp(scale, frame.min, frame.max)
    if (command.kind === 'reset' || command.kind === 'overview') {
      pending.current = preparePreset(measureFrame(), command.kind === 'overview' ? 'overview' : 'default')
    } else if (command.kind === 'zoom') {
      if (phone) onStudyOpening(null)
      pending.current = {
        target: pending.current?.target ?? [controls.target.x, controls.target.y],
        scale: limit((pending.current?.scale ?? camera.zoom) / (command.value ?? 1)),
      }
    } else {
      const focus = resolveCameraFocus(state, command.kind, command.targetId)
      if (!focus) return
      const widthFraction = phone ? 0.68 : 0.78
      const scale = limit(Math.min(frame.areaWidth * widthFraction / focus.width, frame.areaHeight * 0.8 / focus.height))
      if (phone) onStudyOpening(command.kind === 'focus'
        ? studyOpeningAt(focus.center, frame.areaWidth, frame.areaHeight, scale) : null)
      pending.current = { target: photoCameraTarget(focus.center, frame.centre, scale), scale }
    }
    invalidate()
  }, [camera, command, invalidate, measureFrame, onStudyOpening, phone, preparePreset])

  useFrame((_, delta) => {
    const view = pending.current
    if (!view || !control.current?.enabled) return
    const { x, y } = control.current.target
    const { zoom } = camera
    const done = reducedMotion || (Math.hypot(x - view.target[0], y - view.target[1]) < 0.005 && Math.abs(zoom - view.scale) < 0.02)
    const alpha = done ? 1 : 1 - Math.exp(-14 * Math.min(delta, 0.05))
    setView({
      target: [MathUtils.lerp(x, view.target[0], alpha), MathUtils.lerp(y, view.target[1], alpha)],
      scale: MathUtils.lerp(zoom, view.scale, alpha),
    })
    if (done) pending.current = null
  }, -0.5)

  return <OrbitControls ref={control} makeDefault enableRotate={false} enableDamping={!reducedMotion}
    screenSpacePanning dampingFactor={0.1} zoomSpeed={0.75}
    mouseButtons={{ LEFT: mode === 'pan' ? MOUSE.PAN : undefined, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN }}
    touches={{ ONE: mode === 'pan' ? TOUCH.PAN : undefined, TWO: TOUCH.DOLLY_PAN }}
    onStart={() => {
      pending.current = null
      if (phone) onStudyOpening(null)
    }}
    onChange={() => {
      const controls = control.current
      if (!controls) return
      const x = MathUtils.clamp(controls.target.x, -WALL_WIDTH / 2, WALL_WIDTH / 2)
      const y = MathUtils.clamp(controls.target.y, -WALL_HEIGHT / 2, WALL_HEIGHT / 2)
      if (x !== controls.target.x || y !== controls.target.y) {
        camera.position.set(x, y, CAMERA_DEPTH)
        controls.target.set(x, y, 0)
        camera.updateMatrixWorld()
      }
      showZoom()
    }} />
}
