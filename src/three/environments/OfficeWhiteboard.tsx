import { memo, useCallback, useEffect, useLayoutEffect, useMemo } from 'react'
import type { RefObject } from 'react'
import { useThree } from '@react-three/fiber'
import { RepeatWrapping, SRGBColorSpace, TextureLoader, Vector3 } from 'three'
import type { DirectionalLight, Group } from 'three'
import { buildOfficeWhiteboard } from './officeWhiteboardModel'
import { officeWhiteboardFrame } from './officeWhiteboardLayout'
import { createBoardCutaway } from './studyRoomLayout'
import { createOakGrain, createOvercastGlass, createStudyFabric, createStudyPlaster } from './studyRoomMaterials'
import { officeSunPosition } from './officeMotion'
import { useEnvironmentMotion } from './useEnvironmentMotion'

const assets = `${import.meta.env.BASE_URL}environments/office-whiteboard-`

export const OfficeWhiteboard = memo(function OfficeWhiteboard({ board, sun, reducedMotion }: {
  board: RefObject<Group | null>; sun: RefObject<DirectionalLight | null>; reducedMotion: boolean
}) {
  const scene = useThree((state) => state.scene)
  const gl = useThree((state) => state.gl)
  const invalidate = useThree((state) => state.invalidate)
  const overview = useThree(({ size }) => officeWhiteboardFrame(size.width, size.height) !== null)
  const cutaway = useMemo(createBoardCutaway, [])
  const textures = useMemo(() => {
    const fabric = createStudyFabric()
    fabric.wrapS = fabric.wrapT = RepeatWrapping
    return { plaster: createStudyPlaster(), oak: createOakGrain(), sky: createOvercastGlass(), fabric }
  }, [])
  const model = useMemo(() => buildOfficeWhiteboard(cutaway.planes, textures), [cutaway, textures])
  const updateMotion = useCallback((seconds: number, refreshShadows: boolean) => {
    model.motionTime.value = seconds
    if (refreshShadows) sun.current?.position.set(...officeSunPosition(seconds))
  }, [model, sun])
  useEnvironmentMotion('office', reducedMotion, updateMotion)

  useLayoutEffect(() => {
    model.returns.visible = overview
    model.compactWall.visible = !overview
    model.foreground.visible = overview
    gl.shadowMap.needsUpdate = true
    invalidate()
  }, [model, overview, gl, invalidate])

  useEffect(() => {
    const loader = new TextureLoader()
    let active = true
    const load = (name: string, apply: typeof model.setOakTexture) => {
      const texture = loader.load(`${assets}${name}.jpg`, (ready) => {
        if (!active) return
        apply(ready)
        invalidate()
      })
      texture.colorSpace = SRGBColorSpace
      texture.anisotropy = Math.min(gl.capabilities.getMaxAnisotropy(), 4)
      return texture
    }
    const sky = load('skyline', model.setSkyTexture)
    const oak = load('oak', model.setOakTexture)
    return () => {
      active = false
      model.setSkyTexture(textures.sky)
      model.setOakTexture(textures.oak)
      sky.dispose()
      oak.dispose()
    }
  }, [model, textures, gl, invalidate])

  useLayoutEffect(() => {
    const previous = scene.onBeforeRender
    const clippingWasEnabled = gl.localClippingEnabled
    const eye = new Vector3()
    gl.localClippingEnabled = true
    scene.onBeforeRender = (...args) => {
      previous.call(scene, ...args)
      if (board.current) cutaway.update(board.current, eye.setFromMatrixPosition(args[2].matrixWorld))
    }
    gl.shadowMap.needsUpdate = true
    invalidate()
    return () => {
      scene.onBeforeRender = previous
      gl.localClippingEnabled = clippingWasEnabled
      gl.shadowMap.needsUpdate = true
      invalidate()
    }
  }, [board, cutaway, gl, invalidate, scene])
  useEffect(() => () => {
    model.dispose()
    Object.values(textures).forEach((texture) => texture.dispose())
  }, [model, textures])

  return <primitive object={model.room} />
})
