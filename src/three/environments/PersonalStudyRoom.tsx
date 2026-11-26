import { memo, useCallback, useEffect, useLayoutEffect, useMemo } from 'react'
import type { RefObject } from 'react'
import { useThree } from '@react-three/fiber'
import { SRGBColorSpace, TextureLoader, Vector3 } from 'three'
import type { DirectionalLight, Group, SpotLight, Texture } from 'three'
import { useWallStore } from '../../stores/wallStore'
import { wallFinish } from '../../utils/appearance'
import { createBoardCutaway, studyDaylightPositions, studyRoomFrame } from './studyRoomLayout'
import { buildStudyRoom } from './studyRoomModel'
import { useEnvironmentMotion } from './useEnvironmentMotion'

const outsideUrl = `${import.meta.env.BASE_URL}environments/personal-study-outside.jpg`

export const PersonalStudyRoom = memo(function PersonalStudyRoom({ board, plasterTexture, sun, windowLight, reducedMotion }: {
  board: RefObject<Group | null>; plasterTexture: Texture; sun: RefObject<DirectionalLight | null>;
  windowLight: RefObject<SpotLight | null>; reducedMotion: boolean
}) {
  const scene = useThree((state) => state.scene)
  const gl = useThree((state) => state.gl)
  const invalidate = useThree((state) => state.invalidate)
  const overview = useThree(({ size }) => studyRoomFrame(size.width, size.height) !== null)
  const cutaway = useMemo(createBoardCutaway, [])
  const model = useMemo(() => buildStudyRoom(cutaway.planes, plasterTexture), [cutaway, plasterTexture])
  const plasterColor = useWallStore((state) => wallFinish(state.appearance).color)
  const updateMotion = useCallback((seconds: number, refreshShadows: boolean) => {
    model.updateMotion(seconds)
    if (refreshShadows) {
      const positions = studyDaylightPositions(seconds)
      sun.current?.position.set(...positions.sun)
      windowLight.current?.target.position.set(...positions.windowTarget)
    }
  }, [model, sun, windowLight])
  useEnvironmentMotion('study', reducedMotion, updateMotion)

  useLayoutEffect(() => {
    model.roomReturns.visible = overview
    model.compactWall.visible = !overview
    invalidate()
  }, [model, overview, invalidate])

  useEffect(() => {
    let current = true
    const texture = new TextureLoader().load(outsideUrl, (loaded) => {
      if (!current) return
      model.outside.map = loaded
      invalidate()
    })
    texture.colorSpace = SRGBColorSpace
    texture.anisotropy = Math.min(gl.capabilities.getMaxAnisotropy(), 4)
    return () => {
      current = false
      model.outside.map = model.glassGradient
      texture.dispose()
    }
  }, [model, gl, invalidate])

  useLayoutEffect(() => {
    model.plaster.color.set(plasterColor)
    model.bouncedPlaster.color.set(plasterColor)
    invalidate()
  }, [model, plasterColor, invalidate])

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
  useEffect(() => () => model.dispose(), [model])

  return <primitive object={model.room} />
})
