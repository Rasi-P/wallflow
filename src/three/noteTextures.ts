import type { CanvasTexture } from 'three'
import { createNoteTexture, NOTE_TEXTURE_SIZE, repaintNoteTexture } from './textures.ts'
import type { NoteArtwork } from './textures.ts'

export interface NoteTextureLease {
  texture: CanvasTexture<HTMLCanvasElement>
  key: string
  users: number
}

// One pool per wall. Geometry, position and note ID do not affect the baked artwork.
export class NoteTexturePool {
  private readonly entries = new Map<string, NoteTextureLease>()

  private readonly textureSize: number

  constructor(textureSize = NOTE_TEXTURE_SIZE) { this.textureSize = textureSize }

  update(previous: NoteTextureLease | null, artwork: NoteArtwork): NoteTextureLease {
    const key = JSON.stringify([artwork.title, artwork.body, artwork.color, artwork.doodle, artwork.task,
      artwork.typography ?? 'handwritten', artwork.inlineSketches, artwork.sketchAspect, artwork.phone, artwork.largerInk])
    if (previous?.key === key) return previous

    const existing = this.entries.get(key)
    if (existing) {
      existing.users++
      if (previous) this.release(previous)
      return existing
    }

    if (previous?.users === 1) {
      repaintNoteTexture(previous.texture, artwork)
      this.entries.delete(previous.key)
      previous.key = key
      this.entries.set(key, previous)
      return previous
    }

    const entry = { key, users: 1, texture: createNoteTexture(artwork, this.textureSize) }
    this.entries.set(key, entry)
    if (previous) this.release(previous)
    return entry
  }

  release(entry: NoteTextureLease) {
    if (--entry.users > 0) return
    this.entries.delete(entry.key)
    entry.texture.dispose()
    // Drop the canvas pixel backing store as soon as the last note stops using it.
    entry.texture.image.width = entry.texture.image.height = 0
  }
}
