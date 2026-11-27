import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const assets = 'dist'
const entries = await readdir(assets, { recursive: true, withFileTypes: true })
const files = entries.filter((entry) => entry.isFile())
const blockedFile = files.find(({ name }) => /^\.env(?:$|\.)|^(?:credentials|service-account.*|client_secret.*)\.json$|\.(?:pem|key|sqlite3?|pgdump|dump)$/i.test(name))
assert.ok(!blockedFile, 'Build output contains a private configuration or database artifact.')
const scripts = files.filter(({ name }) => /\.(?:js|html|css|map|json|svg|txt)$/.test(name))
assert.ok(scripts.some((entry) => entry.name === 'index.html'), 'Build WALLFLOW before checking its assets.')

const checks = [
  ['legacy API or session', /\/api\/v1\/|x-csrftoken|csrfmiddlewaretoken|x-wallflow-account|wallflow-(?:auth-session|session|csrf)|\bdjango\b/i],
  ['private configuration', /sb_secret_[a-z0-9_-]{12,}|GOCSPX-[a-z0-9_-]{18,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|postgres(?:ql)?:\/\/[^\s:/]+:[^\s@]+@|eyJ[a-z0-9_-]{12,}\.eyJ[a-z0-9_-]{12,}\.[a-z0-9_-]{16,}/i],
]
let initialization = false
let workspaceRead = false
for (const entry of scripts) {
  const file = join(entry.parentPath, entry.name)
  const text = await readFile(file, 'utf8')
  for (const [label, pattern] of checks) {
    assert.ok(!pattern.test(text), `${file} contains ${label} material.`)
  }
  initialization ||= text.includes('initialize_wallflow_workspace')
  workspaceRead ||= /['"]read_wallflow_workspace['"]/.test(text)
}
assert.ok(initialization && workspaceRead, 'The Supabase workspace operations are missing.')
console.log(`Checked ${scripts.length} frontend assets for legacy API calls and secret patterns.`)
