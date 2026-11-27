import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import type { Session } from '@supabase/supabase-js'
import { supabaseAuthStorageKey } from '../../src/auth/supabaseClient.ts'

export async function verifyWorkspaceBrowser(
  project: string, desktopSession: Session, phoneSession: Session, otherSession: Session, initialNoteCount: number,
) {
  const preview = process.env.WALLFLOW_PREVIEW_URL
  assert.equal(preview, 'http://127.0.0.1:55329', 'Use the isolated local preview port.')
  const modulePath = process.env.WALLFLOW_PLAYWRIGHT_MODULE ?? 'playwright'
  const { chromium } = await import(modulePath)
  const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
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
    for (const page of [laptop, mobile]) {
      await page.goto(preview + '/app/')
      await page.locator('.save-status--supabase').filter({ hasText: 'Synced to account' }).waitFor(options)
      await page.getByRole('button', { name: 'Add a note' }).waitFor(options)
      const viewportWidth = await page.evaluate(() => window.innerWidth)
      const syncBox = await page.locator('.save-status--supabase').boundingBox()
      assert.ok(syncBox && syncBox.x >= 0 && syncBox.x + syncBox.width <= viewportWidth, 'Sync status fits the viewport.')
    }

    const commitRoute = project + '/rest/v1/rpc/commit_wallflow_workspace'
    const enterNote = async (page: typeof laptop, title: string) => {
      await page.getByRole('button', { name: 'Add a note' }).click(options)
      const editor = page.getByRole('textbox', { name: 'Note title' })
      await editor.fill(title, options)
      await editor.press('Enter', options)
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
    laptop.once('dialog', (dialog: { accept(): Promise<void> }) => dialog.accept())
    await laptop.getByLabel('Restore workspace backup').setInputFiles(upload, options)
    await laptop.getByRole('alert').filter({ hasText: 'Select a workspace backup from this account and development project.' }).waitFor(options)
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
  } finally {
    await browser.close()
  }
}
