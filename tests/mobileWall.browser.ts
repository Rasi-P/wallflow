import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, readFile } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import { createBoardStore, snapshotBoard } from '../src/stores/boardStore.ts'
import { WORKSPACE_STORAGE_KEY } from '../src/stores/workspaceStorage.ts'
import { mobileStudyFrame, studyNoteFitsOpening } from '../src/three/mobileStudyFrame.ts'
import { photoCameraTarget } from '../src/three/photoWallFrame.ts'
import { NOTE_WIDTH, NOTE_HEIGHT, SAMPLE_NOTES } from '../src/utils/constants.ts'
import { replaceUntouchedSamplesWithProfessorStudy } from '../src/utils/onboarding.ts'
import type { StickyNoteData, WallDocument } from '../src/types/wall.ts'
import type { SavedWorkspace } from '../src/types/workspace.ts'

const [output = '/tmp/wallflow-screenshots', baseline] = process.argv.slice(2)
const { chromium } = await import(process.env.WALLFLOW_PLAYWRIGHT_MODULE ?? 'playwright')
const contentTypes: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
}
const server = async (build: string) => {
  const root = resolve(build)
  const handle = createServer(async (req, res) => {
    const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
    if (!/^\/(?:[a-zA-Z0-9_.\/-]+)?$/.test(path) || path.includes('..')) { res.writeHead(404).end(); return }
    const file = ['/', '/app/', '/sign-in', '/capture'].includes(path) ? '/index.html' : path
    try {
      const content = await readFile(root + file)
      res.writeHead(200, { 'Content-Type': contentTypes[extname(file)] ?? 'application/octet-stream' }).end(content)
    } catch { res.writeHead(404).end() }
  })
  await new Promise<void>((accept) => handle.listen(0, '127.0.0.1', accept))
  const address = handle.address()
  assert.ok(address && typeof address !== 'string')
  return { url: `http://127.0.0.1:${address.port}`, close: () => handle.close() }
}

const current = await server('dist')
const prior = baseline ? await server(baseline) : undefined
const browser = await chromium.launch({
  headless: true, executablePath: process.env.WALLFLOW_CHROMIUM_BINARY,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
await mkdir(output, { recursive: true })
const phone = { width: 390, height: 844 }
const landscape = { width: 844, height: 390 }
const laptop = { width: 1440, height: 900 }
const notes = replaceUntouchedSamplesWithProfessorStudy(structuredClone(SAMPLE_NOTES))
const dense = Array.from({ length: 60 }, (_, index): StickyNoteData => ({
  id: `dense-${index}`, title: `Research note ${index + 1}`, body: 'Review the next step.',
  color: SAMPLE_NOTES[index % SAMPLE_NOTES.length].color, position: [-12.35 + (index % 10) * 2.75, 7.5 - Math.floor(index / 10) * 3],
  rotation: (index % 5 - 2) / 45,
}))

async function openWall(url: string, viewport: { width: number; height: number }, touch = false, entries = notes) {
  const base = snapshotBoard('research', createBoardStore().getState())
  base.name = 'Research wall'
  base.document.notes = structuredClone(entries)
  base.preferences.onboardingComplete = true
  const second = { ...structuredClone(base), id: 'reading', name: 'Reading room' }
  const storage: SavedWorkspace = {
    version: 2, activeBoardId: 'research', boardOrder: ['research', 'reading'], boards: { research: base, reading: second },
  }
  const context = await browser.newContext({
    viewport, hasTouch: touch, isMobile: touch, deviceScaleFactor: touch ? 3 : 1, reducedMotion: 'reduce', colorScheme: 'light',
    storageState: { cookies: [], origins: [{ origin: url, localStorage: [{ name: WORKSPACE_STORAGE_KEY, value: JSON.stringify(storage) }] }] },
  })
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', (error: Error) => errors.push(error.message))
  await context.addInitScript(() => {
    const stats = { uploads: new Set<HTMLCanvasElement>(), draws: 0 }
    Object.assign(window, { wallReviewStats: stats })
    const gl = WebGL2RenderingContext.prototype
    const upload = gl.texSubImage2D
    gl.texSubImage2D = function (...args: unknown[]) {
      const canvas = args.find((value): value is HTMLCanvasElement => value instanceof HTMLCanvasElement && value.width >= 512)
      if (canvas) stats.uploads.add(canvas)
      return Reflect.apply(upload, this, args)
    } as typeof upload
    const draw = gl.drawElements
    gl.drawElements = function (...args: Parameters<typeof draw>) { stats.draws++; return draw.apply(this, args) }
  })
  await page.goto(url + '/app/')
  await page.getByRole('button', { name: 'Use this browser only' }).click()
  await page.locator('.wall-scene canvas').waitFor()
  await page.waitForFunction(() => (window as unknown as { wallReviewStats: { draws: number } }).wallReviewStats.draws > 0)
  await page.evaluate(async () => {
    await document.fonts.ready
    await document.querySelector<HTMLImageElement>('.photo-workspace-plate img')?.decode()
    await new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())))
  })
  return { page, context, errors }
}

type WallPage = Awaited<ReturnType<typeof openWall>>['page']
function snapshot(page: WallPage) {
  return page.evaluate((key: string) => {
    const saved = JSON.parse(localStorage.getItem(key)!)
    return saved.boards[saved.activeBoardId].document
  }, WORKSPACE_STORAGE_KEY) as Promise<WallDocument>
}

async function getProjection(page: WallPage, document: WallDocument) {
  const [bounds, header, toolbar] = await Promise.all([
    page.locator('canvas').boundingBox(), page.locator('.app-header').boundingBox(), page.locator('.floating-toolbar').boundingBox(),
  ])
  assert.ok(bounds && header && toolbar)
  const frame = mobileStudyFrame(bounds.width, bounds.height, document, { left: 0, right: 0,
    top: header.y + header.height - bounds.y, bottom: bounds.y + bounds.height - toolbar.y })
  const [cameraX, cameraY] = photoCameraTarget(frame.content, frame.centre, frame.scale)
  return ([x, y]: [number, number]) => ({
    x: Math.round(bounds.x + bounds.width / 2 + (x - cameraX) * frame.scale),
    y: Math.round(bounds.y + bounds.height / 2 - (y - cameraY) * frame.scale),
  })
}

function screen(path: string) { return join(output, path) }
async function screenshot(page: WallPage, name: string) {
  return page.screenshot({ path: screen(name), animations: 'disabled', scale: 'css' }) as Promise<Buffer>
}

try {
  const desktop = await openWall(current.url, laptop)
  const desktopCapture = await screenshot(desktop.page, 'desktop.png')
  assert.deepEqual(desktop.errors, [])
  if (prior) {
    const original = await openWall(prior.url, laptop)
    const before = await screenshot(original.page, 'desktop-before.png')
    assert.ok(before.equals(desktopCapture), 'Desktop screenshots should match pixel for pixel.')
    await original.context.close()
    console.log('Desktop screenshot matches the pre-change build pixel for pixel.')
  }
  await desktop.context.close()

  const { page, context, errors } = await openWall(current.url, phone, true)
  await screenshot(page, 'mobile-portrait.png')
  assert.equal(await page.locator('.mobile-note-grid').count(), 0)
  const canvas = await page.locator('canvas').elementHandle()
  assert.ok(await canvas.evaluate((element: HTMLCanvasElement) => element.width / element.clientWidth <= 1.5))
  const before = await snapshot(page)
  const project = await getProjection(page, before)
  const note = before.notes[0]
  const center = project(note.position)
  const client = await context.newCDPSession(page)
  type TouchPoint = { id: number; x: number; y: number }
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', ...touchPoints: TouchPoint[]) =>
    client.send('Input.dispatchTouchEvent', { type, touchPoints })
  const first = { ...center, id: 1 }
  await touch('touchStart', first)
  await touch('touchEnd')
  await page.getByRole('button', { name: 'Edit note', exact: true }).waitFor()

  await touch('touchStart', first)
  await touch('touchMove', { ...first, x: first.x + 14, y: first.y + 22 })
  await touch('touchMove', { ...first, x: first.x + 23, y: first.y + 46 })
  await touch('touchEnd')
  let after = await snapshot(page)
  assert.ok(after.notes[0].position[0] > note.position[0] && after.notes[0].position[1] < note.position[1])
  assert.deepEqual(after.notes.slice(1), before.notes.slice(1))
  console.log('One-finger selection and spatial drag persisted only the selected note.')

  const moved = after.notes[0]
  const [width, height] = moved.size ?? [NOTE_WIDTH, NOTE_HEIGHT]
  const angle = moved.rotation
  const corner = project([moved.position[0] + Math.cos(angle) * width / 2 + Math.sin(angle) * height / 2,
    moved.position[1] + Math.sin(angle) * width / 2 - Math.cos(angle) * height / 2])
  await touch('touchStart', { ...corner, id: 1 })
  await touch('touchMove', { x: corner.x + 22, y: corner.y + 22, id: 1 })
  await touch('touchEnd')
  after = await snapshot(page)
  assert.ok(after.notes[0].size![0] > width)
  assert.deepEqual(after.notes.slice(1), before.notes.slice(1))
  console.log('One-finger resize used the actual corner handle.')

  const zoom = page.getByLabel('Wall zoom')
  const movedCenter = project(after.notes[0].position)
  const a = { ...movedCenter, id: 1 }
  const b = { x: movedCenter.x + 115, y: movedCenter.y + 56, id: 2 }
  await touch('touchStart', a)
  await touch('touchStart', a, b)
  await touch('touchMove', { ...a, x: a.x - 26, y: a.y - 23 }, { ...b, x: b.x + 51, y: b.y + 31 })
  await touch('touchEnd')
  assert.ok(Number.parseInt(await zoom.innerText(), 10) > 100)
  assert.deepEqual(await snapshot(page), after, 'Two fingers must leave the board document alone.')
  const previousView = await page.locator('canvas').screenshot()
  const currentZoom = await zoom.innerText()
  await touch('touchStart', a)
  await touch('touchStart', a, b)
  await touch('touchMove', { ...a, x: a.x + 22, y: a.y + 31 }, { ...b, x: b.x + 22, y: b.y + 31 })
  await touch('touchEnd')
  assert.equal(await zoom.innerText(), currentZoom)
  assert.equal((await page.locator('canvas').screenshot()).equals(previousView), false)
  assert.deepEqual(await snapshot(page), after)
  assert.equal(await page.getByRole('dialog').count(), 0)
  console.log('Two-finger pinch and pan moved the camera without moving, resizing or editing paper.')

  await page.getByRole('button', { name: 'Edit note', exact: true }).tap()
  const editor = page.getByRole('dialog', { name: 'Edit sticky note' })
  await editor.getByRole('textbox', { name: 'Note description' }).fill('A touch draft')
  await editor.getByRole('textbox', { name: 'Note description' }).press('Enter')
  await editor.getByRole('textbox', { name: 'Note description' }).press('a')
  assert.equal(await editor.getByRole('textbox', { name: 'Note description' }).inputValue(), 'A touch draft\na')
  await page.setViewportSize(landscape)
  await page.waitForFunction(() => {
    const box = document.querySelector('.compact-note-modal')?.getBoundingClientRect()
    return box && box.top >= 0 && box.bottom <= window.innerHeight
  })
  await screenshot(page, 'mobile-note-editor.png')
  const done = editor.getByRole('button', { name: 'Done', exact: true })
  await done.scrollIntoViewIfNeeded()
  const doneBounds = await done.boundingBox()
  assert.ok(doneBounds && doneBounds.y < 100, 'Done stays in the landscape editor header.')
  await done.tap()
  assert.equal((await snapshot(page)).notes[0].body, 'A touch draft\na')
  assert.ok(await canvas.evaluate((element: HTMLElement) => element.isConnected))
  await page.getByRole('combobox', { name: 'Switch board' }).selectOption('reading')
  assert.deepEqual(await snapshot(page), before)
  await screenshot(page, 'mobile-landscape.png')
  await page.getByRole('button', { name: 'Fit whole board' }).tap()
  await page.waitForFunction(() => document.querySelector('[aria-label="Wall zoom"]')?.textContent !== '100%')
  await screenshot(page, 'mobile-landscape-overview.png')
  await page.getByRole('button', { name: 'Quick Capture' }).tap()
  await page.getByRole('dialog', { name: 'Quick Capture' }).waitFor()
  assert.deepEqual(errors, [])
  await context.close()

  const denseContext = await openWall(current.url, phone, true, dense)
  const densePage = denseContext.page
  const progress = () => densePage.evaluate(() => {
    const stats = (window as unknown as { wallReviewStats: { uploads: Set<HTMLCanvasElement>; draws: number } }).wallReviewStats
    return { sizes: [...stats.uploads].filter(({ width }) => width).map(({ width }) => width), draws: stats.draws }
  })
  const launchDocument = await snapshot(densePage)
  const denseFrame = mobileStudyFrame(phone.width, phone.height, launchDocument, { left: 0, right: 0, top: 155, bottom: 87 })
  assert.ok(denseFrame.opening && launchDocument.notes.some((entry) => !studyNoteFitsOpening(entry, denseFrame.opening!)))
  const initialTextures = (await progress()).sizes
  assert.ok(initialTextures.length > 0 && initialTextures.length < 60)
  await densePage.getByRole('button', { name: 'Fit whole board' }).tap()
  await densePage.waitForFunction(() => (window as unknown as { wallReviewStats: { uploads: Set<HTMLCanvasElement> } })
    .wallReviewStats.uploads.size >= 60)
  const overview = await progress()
  assert.equal(overview.sizes.length, 60)
  assert.ok(overview.sizes.every((width) => width === 512))
  await screenshot(densePage, 'mobile-60-notes.png')
  const draws = (await progress()).draws
  await densePage.waitForTimeout(250)
  assert.equal((await progress()).draws, draws, 'An idle wall should not render continuously.')
  assert.deepEqual(await snapshot(densePage), launchDocument)
  assert.deepEqual(denseContext.errors, [])
  console.log(`Dense board rendered all 60 notes with 512px textures, ${initialTextures.length} at launch and no idle draw calls.`)
  await denseContext.context.close()
} finally {
  await browser.close()
  current.close()
  prior?.close()
}
