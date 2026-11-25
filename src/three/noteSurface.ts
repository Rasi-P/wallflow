import type { MeshStandardMaterial } from 'three'
import { NoteTexturePool } from './noteTextures.ts'
import type { NoteTextureLease } from './noteTextures.ts'
import type { NoteArtwork } from './textures.ts'

export type BindNoteSurface = (material: MeshStandardMaterial) => {
  update(artwork: NoteArtwork): void
  dispose(): void
}

export function createBakedNoteSurface(): BindNoteSurface {
  const pool = new NoteTexturePool()
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
