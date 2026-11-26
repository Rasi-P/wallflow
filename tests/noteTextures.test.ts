import { test } from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { createNoteTexture, NOTE_TEXTURE_SIZE } from '../src/three/textures.ts'
import { NoteTexturePool } from '../src/three/noteTextures.ts'
import { MAX_NOTES, SAMPLE_NOTES } from '../src/utils/constants.ts'

function mockCanvas(t: TestContext) {
  const counts = { canvases: 0, fills: 0, composites: 0 }
  // Count the real generator's canvas operations without requiring a browser or GPU.
  const documentMock = {
    createElement() {
      counts.canvases++
      return {
        width: 0, height: 0,
        getContext: () => ({
          fillRect: () => { counts.fills++ },
          drawImage: () => { counts.composites++ },
          createLinearGradient: () => ({ addColorStop() {} }),
          measureText: (text: string) => ({ width: text.length * 32 }),
          fillText() {},
        }),
      }
    },
  }
  Object.defineProperty(globalThis, 'document', { value: documentMock, configurable: true })
  t.after(() => { Reflect.deleteProperty(globalThis, 'document') })
  return counts
}

test('60 unique note textures reuse one full-resolution paper finish', (t) => {
  const counts = mockCanvas(t)
  const textures = Array.from({ length: MAX_NOTES }, (_, index) => createNoteTexture({
    ...SAMPLE_NOTES[index % SAMPLE_NOTES.length], title: `Note ${index}`, doodle: undefined,
  }))
  assert.equal(new Set(textures.map((texture) => texture.image)).size, MAX_NOTES)
  assert.ok(textures.every(({ image }) => image.width === NOTE_TEXTURE_SIZE && image.height === NOTE_TEXTURE_SIZE))
  assert.equal(counts.canvases, MAX_NOTES + 1)
  assert.equal(counts.composites, MAX_NOTES)
  assert.equal(counts.fills, 55_001 + MAX_NOTES)
  textures.forEach((texture) => texture.dispose())
})

test('editing an unshared note marks the same canvas texture for upload', (t) => {
  const counts = mockCanvas(t)
  const pool = new NoteTexturePool()
  const artwork = { ...SAMPLE_NOTES[0], doodle: undefined }
  const before = pool.update(null, artwork)
  const canvas = before.texture.image
  const version = before.texture.version
  const after = pool.update(before, { ...artwork, title: 'Edited title', color: 'green' })
  assert.equal(after.texture, before.texture)
  assert.equal(after.texture.image, canvas)
  assert.ok(after.texture.version > version)
  assert.equal(counts.canvases, 1)
  pool.release(after)
})

test('editing and deleting shared notes preserves artwork until its last user leaves', (t) => {
  mockCanvas(t)
  const pool = new NoteTexturePool()
  const artwork = { ...SAMPLE_NOTES[1], doodle: undefined }
  const first = pool.update(null, artwork)
  const second = pool.update(null, artwork)
  assert.equal(first.texture, second.texture)
  let disposals = 0
  first.texture.addEventListener('dispose', () => { disposals++ })
  const sharedVersion = first.texture.version

  const edited = pool.update(second, { ...artwork, body: 'A different thought' })
  assert.notEqual(edited.texture, first.texture)
  assert.equal(first.texture.version, sharedVersion)
  assert.equal(disposals, 0)
  assert.equal(first.texture.image.width, 1024)

  const restored = pool.update(edited, artwork)
  assert.equal(restored.texture, first.texture)
  assert.equal(edited.texture.image.width, 0)
  pool.release(first)
  assert.equal(disposals, 0)
  pool.release(restored)
  assert.equal(disposals, 1)
  assert.equal(first.texture.image.width, 0)
  assert.equal(first.texture.image.height, 0)
})

test('baked artwork shares legacy lettering and separates different title styles', (t) => {
  mockCanvas(t)
  const pool = new NoteTexturePool()
  const artwork = { ...SAMPLE_NOTES[0], doodle: undefined }
  const legacy = pool.update(null, artwork)
  const handwritten = pool.update(null, { ...artwork, typography: 'handwritten' })
  const sans = pool.update(null, { ...artwork, typography: 'sans' })
  assert.equal(handwritten, legacy)
  assert.notEqual(sans.texture, legacy.texture)
  for (const entry of [legacy, handwritten, sans]) pool.release(entry)
})
