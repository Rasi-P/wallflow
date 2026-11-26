import { memo, useEffect, useLayoutEffect, useMemo } from 'react'
import type { RefObject } from 'react'
import { useThree } from '@react-three/fiber'
import { SRGBColorSpace, TextureLoader, Vector3 } from 'three'
import type { Group, Texture } from 'three'
import { useWallStore } from '../../stores/wallStore'
import { wallFinish } from '../../utils/appearance'
import { createBoardCutaway, studyRoomFrame } from './studyRoomLayout'
import { buildStudyRoom } from './studyRoomModel'

const outsideUrl = `${import.meta.env.BASE_URL}environments/personal-study-outside.jpg`

export const PersonalStudyRoom = memo(function PersonalStudyRoom({ board, plasterTexture }: {
  board: RefObject<Group | null>; plasterTexture: Texture
}) {
  const scene = useThree((state) => state.scene)
  const gl = useThree((state) => state.gl)
  const invalidate = useThree((state) => state.invalidate)
  const overview = useThree(({ size }) => studyRoomFrame(size.width, size.height) !== null)
  const cutaway = useMemo(createBoardCutaway, [])
  const model = useMemo(() => buildStudyRoom(cutaway.planes, plasterTexture), [cutaway, plasterTexture])
  const plasterColor = useWallStore((state) => wallFinish(state.appearance).color)

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
