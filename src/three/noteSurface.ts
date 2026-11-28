import type { MeshStandardMaterial } from 'three'
import { NoteTexturePool } from './noteTextures.ts'
import type { NoteTextureLease } from './noteTextures.ts'
import type { NoteArtwork } from './textures.ts'
import { containsEmoji } from '../utils/noteEmoji.ts'

export type BindNoteSurface = (material: MeshStandardMaterial) => {
  update(artwork: NoteArtwork): void
  dispose(): void
}

export function keepColorEmoji(monochrome: BindNoteSurface | null | undefined, baked: BindNoteSurface): BindNoteSurface {
  if (!monochrome) return baked
  return (material) => {
    let factory: BindNoteSurface | undefined
    let binding: ReturnType<BindNoteSurface> | undefined
    return {
      update(artwork) {
        const colorEmoji = containsEmoji(artwork.title) || containsEmoji(artwork.body) ||
          artwork.task?.rows.some(({ text }) => containsEmoji(text))
        const next = colorEmoji ? baked : monochrome
        if (factory !== next) {
          binding?.dispose()
          binding = next(material)
          factory = next
        }
        binding?.update(artwork)
      },
      dispose() { binding?.dispose() },
    }
  }
}

export function createBakedNoteSurface(textureSize?: number): BindNoteSurface {
  const pool = new NoteTexturePool(textureSize)
  return (material) => {
    let lease: NoteTextureLease | null = null
    return {
      update(artwork) {
        lease = pool.update(lease, artwork)
        if (!material.map) material.needsUpdate = true
        material.map = lease.texture
      },
      dispose() {
        if (lease) pool.release(lease)
        material.map = null
      },
    }
  }
}
