import { CanvasTexture, Color, DataTexture, LinearFilter, LinearMipmapLinearFilter, LinearSRGBColorSpace, RedFormat } from 'three'
import { NOTE_COLORS } from '../../utils/constants.ts'
import { DEFAULT_NOTE_BODY, DEFAULT_NOTE_TITLE, getPaperFinish, NOTE_TEXTURE_SIZE, paintNoteInk } from '../textures.ts'
import type { NoteInk } from '../textures.ts'
import type { BindNoteSurface } from '../noteSurface.ts'

const size = NOTE_TEXTURE_SIZE
const programKey = 'wallflow-paper-ink-v1'

interface InkMaskEntry {
  key: string
  texture: DataTexture
  users: number
}

function createInkMask() {
  const texture = new DataTexture(new Uint8Array(size * size), size, size, RedFormat)
  texture.generateMipmaps = true
  texture.minFilter = LinearMipmapLinearFilter
  texture.magFilter = LinearFilter
  texture.anisotropy = 8
  return texture
}

// Canvas rows start at the top. DataTexture does not flip rows on upload.
function copyCoverage(rgba: Uint8ClampedArray, target: Uint8Array) {
  for (let y = 0; y < size; y++) {
    let alpha = ((size - y - 1) * size * 4) + 3
    const end = (y + 1) * size
    for (let i = y * size; i < end; i++, alpha += 4) target[i] = rgba[alpha]
  }
}

function paintMask(context: CanvasRenderingContext2D, mask: DataTexture, artwork: NoteInk) {
  context.clearRect(0, 0, size, size)
  paintNoteInk(context, artwork, '#ffffff')
  const { data } = context.getImageData(0, 0, size, size)
  copyCoverage(data, mask.image.data as Uint8Array)
  mask.needsUpdate = true
}

export function createPaperInkSurface(): BindNoteSurface {
  const masks = new Map<string, InkMaskEntry>()
  let finish: CanvasTexture | undefined
  let scratch: CanvasRenderingContext2D | undefined
  let users = 0

  function releaseMask(entry: InkMaskEntry) {
    if (--entry.users > 0) return
    masks.delete(entry.key)
    entry.texture.dispose()
    entry.texture.image.data = null
  }

  return (material) => {
    if (!scratch) {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = size
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) throw new Error('The note ink canvas could not be created.')
      scratch = context
    }
    if (!finish) {
      finish = new CanvasTexture(getPaperFinish())
      // Keep the finish in encoded sRGB so source-over matches the baked Canvas2D texture.
      // Premultiplied RGB lets filtering and mipmaps preserve the transparent grain edges.
      finish.premultiplyAlpha = true
      finish.anisotropy = 8
    }
    users++

    const uniforms = {
      wallflowInkMask: { value: null as DataTexture | null },
      wallflowPaperTint: { value: new Color() },
      wallflowInkTint: { value: new Color() },
    }
    const originalCompile = material.onBeforeCompile
    const originalKey = material.customProgramCacheKey
    let mask: InkMaskEntry | undefined
    let disposed = false
    material.map = finish
    material.customProgramCacheKey = () => programKey
    material.onBeforeCompile = (shader, renderer) => {
      originalCompile.call(material, shader, renderer)
      Object.assign(shader.uniforms, uniforms)
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <map_pars_fragment>', `#include <map_pars_fragment>
          uniform sampler2D wallflowInkMask;
          uniform vec3 wallflowPaperTint;
          uniform vec3 wallflowInkTint;`)
        .replace('#include <map_fragment>', `
          vec4 finish = texture2D(map, vMapUv);
          vec3 paper = finish.rgb + wallflowPaperTint * (1.0 - finish.a);
          float ink = texture2D(wallflowInkMask, vMapUv).r;
          vec3 noteSrgb = mix(paper, wallflowInkTint, ink);
          diffuseColor.rgb *= sRGBTransferEOTF(vec4(noteSrgb, 1.0)).rgb;`)
    }
    material.needsUpdate = true

    return {
      update(artwork) {
        if (disposed || !scratch) return
        const { paper, ink } = NOTE_COLORS[artwork.color]
        // Treat palette values as raw sRGB numbers. The fragment shader decodes the composite.
        uniforms.wallflowPaperTint.value.setStyle(paper, LinearSRGBColorSpace)
        uniforms.wallflowInkTint.value.setStyle(ink, LinearSRGBColorSpace)
        const key = JSON.stringify([artwork.title || DEFAULT_NOTE_TITLE, artwork.task ? artwork.body : artwork.body || DEFAULT_NOTE_BODY, artwork.doodle, artwork.task])
        if (mask?.key === key) return

        const existing = masks.get(key)
        if (!existing && mask?.users === 1) {
          // Only an exclusive owner can repaint an existing mask.
          paintMask(scratch, mask.texture, artwork)
          masks.delete(mask.key)
          mask.key = key
          masks.set(key, mask)
          return
        }

        const previous = mask
        if (existing) {
          existing.users++
          mask = existing
        } else {
          const texture = createInkMask()
          paintMask(scratch, texture, artwork)
          mask = { key, texture, users: 1 }
          masks.set(key, mask)
        }
        uniforms.wallflowInkMask.value = mask.texture
        if (previous) releaseMask(previous)
      },
      dispose() {
        if (disposed) return
        disposed = true
        material.map = null
        material.customProgramCacheKey = originalKey
        material.onBeforeCompile = originalCompile
        material.needsUpdate = true
        uniforms.wallflowInkMask.value = null
        if (mask) releaseMask(mask)
        mask = undefined
        if (--users === 0) {
          finish?.dispose()
          finish = undefined
          if (scratch) scratch.canvas.width = scratch.canvas.height = 0
          scratch = undefined
        }
      },
    }
  }
}
