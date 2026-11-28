import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import type { Session } from '@supabase/supabase-js'
import { supabaseAuthStorageKey } from '../../src/auth/supabaseClient.ts'

export async function verifyWorkspaceBrowser(
  project: string, desktopSession: Session, phoneSession: Session, otherSession: Session, initialNoteCount: number, legacyRaw: string,
) {
  const preview = process.env.WALLFLOW_PREVIEW_URL
  assert.match(preview ?? '', /^http:\/\/127\.0\.0\.1:(55329|55479)$/, 'Use the isolated local preview port.')
  const modulePath = process.env.WALLFLOW_PLAYWRIGHT_MODULE ?? 'playwright'
  const { chromium } = await import(modulePath)
  const browser = await chromium.launch({ headless: true, executablePath: process.env.WALLFLOW_CHROMIUM_BINARY, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
  const storageKey = supabaseAuthStorageKey(project)
  const storageState = (session: Session) => ({
    cookies: [],
    origins: [{ origin: preview, localStorage: [{ name: storageKey, value: JSON.stringify(session) }] }],
  })
  try {
    const desktop = await browser.newContext({ viewport: { width: 1366, height: 820 }, storageState: storageState(desktopSession) })
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: storageState(phoneSession) })
    const laptop = await desktop.newPage()
    const mobile = await phone.newPage()
    const options = { timeout: 20_000 }
    const legacyRequests: string[] = []
    for (const page of [laptop, mobile]) {
      page.on('request', (request: { url(): string }) => {
        const path = new URL(request.url()).pathname
        if (path.startsWith('/api/v1/')) legacyRequests.push(path)
      })
    }
    await laptop.goto(preview + '/app/')
    await mobile.goto(preview + '/app/')
    await laptop.locator('.save-status--supabase').filter({ hasText: 'Synced to account' }).waitFor(options)
    await laptop.locator('canvas').waitFor(options)
    await mobile.locator('.save-status--supabase').filter({ hasText: 'Synced to account' }).waitFor(options)
    await mobile.locator('.wall-scene canvas').waitFor(options)
    const canvas = await mobile.locator('.wall-scene canvas').elementHandle()
    for (const [width, height] of [[320, 700], [390, 844], [844, 390]]) {
      await mobile.setViewportSize({ width, height })
      const box = await mobile.getByRole('button', { name: 'Quick Capture', exact: true }).boundingBox()
      assert.ok(box && box.x >= 0 && box.x + box.width <= width && box.height >= 44, 'Capture fits the mobile viewport.')
      assert.ok(await canvas?.evaluate((element: HTMLElement) => element.isConnected), 'Rotation retains the same WebGL canvas.')
    }
    await mobile.setViewportSize({ width: 390, height: 844 })
    const workerControlled = () => Boolean(navigator.serviceWorker.controller)
    await mobile.waitForFunction(workerControlled, undefined, options)
    await laptop.waitForFunction(workerControlled, undefined, options)

    const commitRoute = project + '/rest/v1/rpc/commit_wallflow_workspace'
    const enterNote = async (page: typeof laptop, title: string) => {
      const onPhone = page === mobile
      await page.getByRole('button', { name: 'Add a note', exact: true }).click(options)
      const editor = page.getByRole('textbox', { name: 'Note title', exact: true })
      await editor.fill(title, options)
      if (onPhone) await page.getByRole('button', { name: 'Done', exact: true }).click(options)
      else await editor.press('Enter', options)
    }

    await laptop.route(commitRoute, (route: { abort(): Promise<void> }) => route.abort())
    await enterNote(laptop, 'Draft through a network interruption')
    await laptop.locator('.save-status--supabase').filter({ hasText: 'Offline' }).waitFor(options)
    await laptop.reload()
    await laptop.locator('.wall-note-count').filter({ hasText: `${initialNoteCount + 1} notes` }).waitFor(options)
    await laptop.locator('.save-status--supabase').filter({ hasText: 'Offline' }).waitFor(options)
    await laptop.unroute(commitRoute)
    await laptop.evaluate(() => window.dispatchEvent(new Event('online')))
    await laptop.locator('.save-status--supabase').filter({ hasText: 'Synced to account' }).waitFor(options)
    await mobile.locator('.wall-note-count').filter({ hasText: `${initialNoteCount + 1} notes` }).waitFor(options)

    await laptop.getByRole('button', { name: 'Manage boards' }).click(options)
    const downloaded = laptop.waitForEvent('download', options)
    await laptop.getByRole('button', { name: 'Export account workspace' }).click(options)
    const backup = await downloaded
    const backupPath = await backup.path()
    assert.ok(backupPath)
    const content = await readFile(backupPath)
    const saved = JSON.parse(content.toString())
    assert.equal(saved.accountId, desktopSession.user.id)
    assert.equal(saved.project, project)
    assert.ok(saved.workspace.boards[saved.workspace.activeBoardId].document.notes.some(
      (note: { title: string }) => note.title === 'Draft through a network interruption',
    ))
    await laptop.keyboard.press('Escape')
    await enterNote(mobile, 'Mobile viewport change before restore')
    await laptop.locator('.wall-note-count').filter({ hasText: `${initialNoteCount + 2} notes` }).waitFor(options)

    await laptop.getByRole('button', { name: 'Manage boards' }).click(options)
    const upload = { name: backup.suggestedFilename(), mimeType: 'application/json', buffer: content }
    laptop.once('dialog', (dialog: { accept(): Promise<void> }) => dialog.accept())
    await laptop.getByLabel('Restore workspace backup').setInputFiles(upload, options)
    await laptop.locator('.save-status--supabase').filter({ hasText: 'Synced to account' }).waitFor(options)
    await mobile.locator('.wall-note-count').filter({ hasText: `${initialNoteCount + 1} notes` }).waitFor(options)

    await mobile.goto(preview + '/capture/native/ios')
    let capture = mobile.getByRole('dialog', { name: 'Quick Capture' })
    await capture.waitFor(options)
    await phone.setOffline(true)
    await capture.getByRole('textbox', { name: 'Note', exact: true }).fill('Offline from Quick Capture')
    await capture.getByRole('button', { name: 'Add checklist' }).click()
    await capture.getByRole('textbox', { name: /Checklist/ }).fill('One step\nAnother step')
    await capture.getByRole('button', { name: 'Capture note' }).click()
    await capture.getByText('Pending sync', { exact: true }).waitFor(options)
    await mobile.goto(preview + '/capture')
    capture = mobile.getByRole('dialog', { name: 'Quick Capture' })
    await capture.getByText('Offline from Quick Capture', { exact: true }).waitFor(options)
    await phone.setOffline(false)
    await capture.getByText('Note synced to your workspace.').waitFor(options)
    await laptop.locator('.wall-note-count').filter({ hasText: `${initialNoteCount + 2} notes` }).waitFor(options)
    const cached = await mobile.evaluate(async () => {
      const names = await caches.keys()
      const entries = await Promise.all(names.map(async (name) => (await (await caches.open(name)).keys()).map((req) => req.url)))
      return entries.flat()
    })
    assert.ok(cached.some((url: string) => new URL(url).pathname === '/index.html'))
    assert.ok(cached.every((value: string) => {
      const url = new URL(value)
      return url.origin === preview && !url.search && !url.pathname.startsWith('/auth/') && !url.pathname.startsWith('/rest/')
    }))
    await capture.getByRole('button', { name: 'Close dialog' }).click()
    const searchForCapture = async (query: string) => {
      await mobile.getByRole('button', { name: 'Find notes and sections' }).click()
      await mobile.getByRole('searchbox', { name: 'Search your notes' }).fill(query)
      return mobile.getByRole('button', { name: /Untitled note.*(Offline from Quick Capture|Another step)/ })
    }
    await (await searchForCapture('Offline from Quick Capture')).click()
    await mobile.getByRole('button', { name: 'Edit note', exact: true }).click()
    await mobile.getByRole('button', { name: 'Task details' }).click()
    await mobile.getByRole('checkbox', { name: 'Complete checklist item 1' }).check()
    await mobile.getByRole('button', { name: 'Set reminder' }).click()
    await mobile.getByLabel('Reminder date and time').fill('2031-01-20T09:00')
    await mobile.getByRole('button', { name: 'Save reminder' }).click()
    await mobile.getByRole('button', { name: 'Done', exact: true }).click()
    await (await searchForCapture('Another step')).waitFor(options)
    await mobile.getByRole('button', { name: 'Close dialog' }).click()
    await mobile.getByRole('button', { name: 'Wall settings' }).click()
    await mobile.getByLabel('Mobile theme').selectOption('dark')
    assert.equal(await mobile.evaluate(() => document.documentElement.dataset.mobileTheme), 'dark')
    await mobile.getByRole('button', { name: 'Done', exact: true }).click()

    await desktop.setOffline(true)
    await enterNote(laptop, 'Private draft for original account')
    await laptop.locator('.save-status--supabase').filter({ hasText: 'Offline' }).waitFor(options)
    await laptop.getByRole('button', { name: 'Wall settings' }).click(options)
    await laptop.getByRole('button', { name: 'Sign out', exact: true }).click(options)
    await laptop.getByRole('button', { name: 'Confirm sign-out' }).click(options)
    await laptop.getByRole('button', { name: 'Continue with Google' }).waitFor(options)
    await desktop.setOffline(false)
    await laptop.reload()
    await laptop.getByRole('button', { name: 'Continue with Google' }).waitFor(options)

    // Use a real local Auth session to simulate the account chosen after OAuth.
    await laptop.evaluate(({ key, session }: { key: string; session: Session }) => {
      localStorage.setItem(key, JSON.stringify(session))
      localStorage.removeItem(`${key}:signed-out`)
    }, { key: storageKey, session: otherSession })
    await laptop.reload()
    await laptop.locator('.save-status--supabase').filter({ hasText: 'Synced to account' }).waitFor(options)
    await laptop.locator('.wall-note-count').filter({ hasText: /^1 note$/ }).waitFor(options)
    await laptop.getByRole('button', { name: 'Manage boards' }).click(options)
    let foreignConfirmation = false
    laptop.once('dialog', (dialog: { dismiss(): Promise<void> }) => {
      foreignConfirmation = true
      return dialog.dismiss()
    })
    await laptop.getByLabel('Restore workspace backup').setInputFiles(upload, options)
    await laptop.getByRole('alert').filter({ hasText: 'Select a workspace backup from this account and Supabase project.' }).waitFor(options)
    assert.equal(foreignConfirmation, false)
    await laptop.locator('.wall-note-count').filter({ hasText: /^1 note$/ }).waitFor(options)

    const blocked = await browser.newContext({ storageState: storageState(otherSession) })
    await blocked.addInitScript(() => Object.defineProperty(window, 'indexedDB', { configurable: true, value: undefined }))
    const noStorage = await blocked.newPage()
    await noStorage.goto(preview + '/app/')
    await noStorage.getByRole('button', { name: 'Add a note' }).click(options)
    await noStorage.getByRole('textbox', { name: 'Note title' }).fill('Browser storage is blocked', options)
    await noStorage.getByRole('textbox', { name: 'Note title' }).press('Enter', options)
    await noStorage.locator('.save-status--supabase').filter({ hasText: 'Draft needs attention' }).waitFor(options)
    await noStorage.getByRole('button', { name: 'Manage boards' }).click(options)
    await noStorage.getByRole('button', { name: 'Download unsaved changes' }).waitFor(options)
    const oldOrigin = preview.replace('127.0.0.1', 'localhost')
    const device = await browser.newContext({ storageState: { cookies: [], origins: [{
      origin: oldOrigin, localStorage: [{ name: 'wallflow-wall-v1', value: legacyRaw }],
    }] } })
    const oldPage = await device.newPage()
    await oldPage.goto(oldOrigin + '/sign-in')
    await oldPage.getByRole('button', { name: 'Use this browser only' }).click(options)
    await oldPage.getByRole('button', { name: 'Manage boards' }).click(options)
    const exported = oldPage.waitForEvent('download', options)
    await oldPage.getByRole('button', { name: 'Export browser boards' }).click(options)
    const exportPath = await (await exported).path()
    assert.ok(exportPath)
    const portable = await readFile(exportPath)
    assert.equal(await oldPage.evaluate(() => localStorage.getItem('wallflow-wall-v1')), legacyRaw)

    const importFile = { name: 'wallflow-browser-export.json', mimeType: 'application/json', buffer: portable }
    for (let attempt = 0; attempt < 2; attempt++) {
      await laptop.getByLabel('Import browser export').setInputFiles(importFile, options)
      await laptop.getByRole('button', { name: 'Confirm import' }).click(options)
      await laptop.getByRole('dialog').waitFor({ ...options, state: 'hidden' })
      await laptop.locator('.board-index').filter({ hasText: '2 of 2' }).waitFor(options)
      await laptop.getByRole('button', { name: 'Manage boards' }).click(options)
    }
    assert.deepEqual(legacyRequests, [])
    const importedSourceId = JSON.parse(portable.toString()).boards[0].sourceId
    return importedSourceId

  } finally {
    await browser.close()
  }
}
