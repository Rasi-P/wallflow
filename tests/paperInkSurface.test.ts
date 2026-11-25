import { test } from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { MeshStandardMaterial, RedFormat, ShaderLib } from 'three'
import type { DataTexture, WebGLRenderer } from 'three'
import { createPaperInkSurface } from '../src/three/prototypes/paperInkSurface.ts'
import { createBakedNoteSurface } from '../src/three/noteSurface.ts'
import { DEFAULT_NOTE_BODY, DEFAULT_NOTE_TITLE, NOTE_TEXTURE_SIZE as size } from '../src/three/textures.ts'

function mockCanvas(t: TestContext) {
  const pixels = new Uint8ClampedArray(size * size * 4)
  pixels[3] = 127
  pixels[(size - 1) * size * 4 + 3] = 255
  const count = { canvases: 0, readbacks: 0, coverage: 255 }
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement() {
      count.canvases++
      const canvas = { width: 0, height: 0, getContext: () => ({
        canvas, fillRect() {}, drawImage() {}, fillText() {}, clearRect() {},
        createLinearGradient: () => ({ addColorStop() {} }),
        measureText: (text: string) => ({ width: text.length * 32 }),
        getImageData() {
          count.readbacks++
          pixels[(size - 1) * size * 4 + 3] = count.coverage
          return { data: pixels }
        },
      }) }
      return canvas
    },
  } })
  t.after(() => { Reflect.deleteProperty(globalThis, 'document') })
  return count
}

function compileHook(material: MeshStandardMaterial) {
  const shader = { ...ShaderLib.standard, uniforms: { ...ShaderLib.standard.uniforms } }
  material.onBeforeCompile(shader, {} as WebGLRenderer)
  return shader
}

test('paper and ink materials share the finish and upload row-aligned R8 masks', (t) => {
  const count = mockCanvas(t)
  const bind = createPaperInkSurface()
  const first = new MeshStandardMaterial()
  const second = new MeshStandardMaterial()
  const firstBinding = bind(first)
  const secondBinding = bind(second)
  firstBinding.update({ title: 'One', body: 'First note', color: 'yellow' })
  secondBinding.update({ title: 'Two', body: 'Second note', color: 'green' })

  const firstShader = compileHook(first)
  const secondShader = compileHook(second)
  const firstMask = firstShader.uniforms.wallflowInkMask.value as DataTexture
  assert.equal(first.map, second.map)
  assert.equal(first.map?.premultiplyAlpha, true)
  assert.equal(first.customProgramCacheKey(), second.customProgramCacheKey())
  assert.match(firstShader.fragmentShader, /diffuseColor\.rgb \*= sRGBTransferEOTF/)
  assert.ok(!firstShader.fragmentShader.includes('#include <map_fragment>'))
  assert.notEqual(firstMask, secondShader.uniforms.wallflowInkMask.value)
  assert.notDeepEqual(firstShader.uniforms.wallflowPaperTint.value.toArray(), secondShader.uniforms.wallflowPaperTint.value.toArray())
  assert.equal(firstMask.format, RedFormat)
  assert.equal(firstMask.generateMipmaps, true)
  assert.equal(firstMask.flipY, false)
  assert.equal(firstMask.image.data?.length, size * size)
  assert.equal(firstMask.image.data?.[0], 255)
  assert.equal(firstMask.image.data?.[(size - 1) * size], 127)
  assert.equal(count.canvases, 2)
  assert.equal(count.readbacks, 2)

  const version = firstMask.version
  firstBinding.update({ title: 'One', body: 'First note', color: 'blue' })
  assert.equal(firstMask.version, version)
  assert.equal(count.readbacks, 2)
  firstBinding.update({ title: 'Edited', body: 'First note', color: 'blue' })
  assert.equal(compileHook(first).uniforms.wallflowInkMask.value, firstMask)
  assert.equal(firstMask.version, version + 1)
  assert.equal(count.canvases, 2)

  firstBinding.dispose()
  secondBinding.dispose()
})

test('prototype disposal frees ink and restores the baked material hooks', (t) => {
  mockCanvas(t)
  const bind = createPaperInkSurface()
  const first = new MeshStandardMaterial()
  const second = new MeshStandardMaterial()
  const baseKey = first.customProgramCacheKey()
  const firstBinding = bind(first)
  const secondBinding = bind(second)
  const artwork = { title: 'Fallback test', body: '', color: 'pink' as const }
  firstBinding.update(artwork)
  const mask = compileHook(first).uniforms.wallflowInkMask.value as DataTexture
  let masksDisposed = 0
  let finishesDisposed = 0
  mask.addEventListener('dispose', () => { masksDisposed++ })
  first.map!.addEventListener('dispose', () => { finishesDisposed++ })

  firstBinding.dispose()
  assert.equal(masksDisposed, 1)
  assert.equal(finishesDisposed, 0)
  assert.equal(first.customProgramCacheKey(), baseKey)
  assert.equal(first.map, null)
  const baked = createBakedNoteSurface()(first)
  baked.update(artwork)
  assert.ok(!compileHook(first).fragmentShader.includes('wallflowInkMask'))
  assert.notEqual(first.map, second.map)

  secondBinding.dispose()
  assert.equal(finishesDisposed, 1)
  baked.dispose()
})

const colors = ['yellow', 'green', 'blue', 'pink', 'violet'] as const

for (const [noteCount, artworkCount] of [[10, 10], [60, 60], [60, 5]]) {
  test(`${noteCount} notes with ${artworkCount} distinct artworks use ${artworkCount} masks`, (t) => {
    const count = mockCanvas(t)
    const bind = createPaperInkSurface()
    const materials = Array.from({ length: noteCount }, (_, index) => {
      const material = new MeshStandardMaterial()
      const binding = bind(material)
      binding.update({ title: `Note ${index % artworkCount}`, body: 'Two lines\nof writing', color: colors[Math.floor(index / artworkCount) % colors.length] })
      return { material, binding }
    })
    const finishes = new Set(materials.map(({ material }) => material.map))
    const masks = new Set<DataTexture>(materials.map(({ material }) => compileHook(material).uniforms.wallflowInkMask.value))
    const bytes = [...masks].reduce((sum, mask) => sum + (mask.image.data?.byteLength ?? 0), 0)
    assert.equal(finishes.size, 1)
    assert.equal(masks.size, artworkCount)
    assert.equal(bytes, artworkCount * size * size)
    assert.equal(count.readbacks, artworkCount)
    t.diagnostic(`${masks.size + finishes.size} note textures, ${bytes / 2 ** 20} MiB of ink buffers, ${count.readbacks} canvas readbacks`)
    materials.forEach(({ material, binding }) => { binding.dispose(); material.dispose() })
    assert.ok([...masks].every((mask) => mask.image.data === null))
  })
}

test('editing shared ink leaves the other note intact and changing its color reuses the mask', (t) => {
  const count = mockCanvas(t)
  const bind = createPaperInkSurface()
  const first = new MeshStandardMaterial()
  const second = new MeshStandardMaterial()
  const firstBinding = bind(first)
  const secondBinding = bind(second)
  const artwork = { title: '', body: '', color: 'yellow' as const }
  firstBinding.update(artwork)
  secondBinding.update({ title: DEFAULT_NOTE_TITLE, body: DEFAULT_NOTE_BODY, color: 'green' })
  const firstShader = compileHook(first)
  const secondShader = compileHook(second)
  const shared = firstShader.uniforms.wallflowInkMask.value as DataTexture
  const sharedVersion = shared.version
  assert.equal(secondShader.uniforms.wallflowInkMask.value, shared)
  assert.equal(count.readbacks, 1)

  count.coverage = 47
  firstBinding.update({ ...artwork, title: 'Edited title' })
  const edited = firstShader.uniforms.wallflowInkMask.value as DataTexture
  assert.notEqual(edited, shared)
  assert.equal(edited.image.data?.[0], 47)
  assert.equal(secondShader.uniforms.wallflowInkMask.value, shared)
  assert.equal(shared.image.data?.[0], 255)
  assert.equal(shared.version, sharedVersion)

  const beforeTint = secondShader.uniforms.wallflowInkTint.value.toArray()
  secondBinding.update({ title: DEFAULT_NOTE_TITLE, body: DEFAULT_NOTE_BODY, color: 'pink' })
  assert.notDeepEqual(secondShader.uniforms.wallflowInkTint.value.toArray(), beforeTint)
  assert.equal(secondShader.uniforms.wallflowInkMask.value, shared)
  assert.equal(count.readbacks, 2)

  firstBinding.update(artwork)
  assert.equal(firstShader.uniforms.wallflowInkMask.value, shared)
  assert.equal(edited.image.data, null)
  assert.equal(count.readbacks, 2)
  firstBinding.dispose()
  firstBinding.dispose()
  assert.equal(shared.image.data?.[0], 255)
  secondBinding.dispose()
  assert.equal(shared.image.data, null)
})

test('wall history reacquires live masks and recreates freed masks after deletion', async (t) => {
  const count = mockCanvas(t)
  const storage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null, setItem() {} } })
  t.after(() => {
    if (storage) Object.defineProperty(globalThis, 'localStorage', storage)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  })
  const { useWallStore } = await import('../src/stores/wallStore.ts')
  const original = { title: 'Shared', body: '', color: 'yellow' as const, rotation: 0, position: [0, 0] as [number, number] }
  useWallStore.setState({ notes: [{ ...original, id: 'first' }, { ...original, id: 'second' }], past: [], future: [] })
  const bind = createPaperInkSurface()
  const handles = new Map<string, { binding: ReturnType<typeof bind>; material: MeshStandardMaterial; shader: ReturnType<typeof compileHook> }>()

  function syncNotes() {
    const { notes } = useWallStore.getState()
    const live = new Set(notes.map((note) => note.id))
    for (const [id, handle] of handles) {
      if (live.has(id)) continue
      handle.binding.dispose()
      handle.material.dispose()
      handles.delete(id)
    }
    for (const note of notes) {
      let handle = handles.get(note.id)
      if (!handle) {
        const material = new MeshStandardMaterial()
        const binding = bind(material)
        handle = { binding, material, shader: compileHook(material) }
        handles.set(note.id, handle)
      }
      handle.binding.update(note)
    }
  }
  const mask = (id: string) => handles.get(id)?.shader.uniforms.wallflowInkMask.value as DataTexture
  const { updateNote, undo, redo, deleteNote } = useWallStore.getState()

  syncNotes()
  const shared = mask('second')
  assert.equal(mask('first'), shared)
  updateNote('first', { body: 'Edited independently' }); syncNotes()
  const edited = mask('first')
  assert.notEqual(edited, shared)
  undo(); syncNotes()
  assert.equal(mask('first'), shared)
  assert.equal(edited.image.data, null)
  redo(); syncNotes()
  assert.notEqual(mask('first'), edited)
  assert.equal(mask('second'), shared)
  deleteNote('second'); syncNotes()
  assert.equal(shared.image.data, null)
  undo(); syncNotes()
  const restored = mask('second')
  assert.notEqual(restored, shared)
  assert.equal(restored.image.data?.byteLength, size * size)
  redo(); syncNotes()
  assert.equal(restored.image.data, null)
  assert.equal(count.readbacks, 4)
  deleteNote('first'); syncNotes()
  assert.equal(handles.size, 0)
})
