import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveConfig } from 'vite'

const buildMode = 'wallflow-config-test'
const previewMode = 'supabase-preview'

function preserveEnvironment(variables: readonly string[]) {
  const original = variables.map((key) => [key, process.env[key]] as const)
  return () => {
    for (const [key, value] of original) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

test('Vite exposes only documented public values and rejects privileged keys during config loading', async () => {
  const variables = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'VITE_SYNTHETIC_PRIVATE_VALUE',
    'VITE_SUPABASE_PUBLISHABLE_KEY_EXTRA']
  const restoreEnvironment = preserveEnvironment(variables)
  try {
    process.env.VITE_SUPABASE_URL = 'https://fixture.example.invalid'
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test_fixture'
    process.env.VITE_SYNTHETIC_PRIVATE_VALUE = 'must-stay-out-of-client-env'
    delete process.env.VITE_SUPABASE_PUBLISHABLE_KEY_EXTRA
    const config = await resolveConfig({ mode: buildMode, logLevel: 'silent' }, 'build')
    assert.equal(config.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_URL)
    assert.equal(config.env.VITE_SUPABASE_PUBLISHABLE_KEY, process.env.VITE_SUPABASE_PUBLISHABLE_KEY)
    assert.equal(config.env.VITE_SYNTHETIC_PRIVATE_VALUE, undefined)

    const syntheticSecret = ['sb', 'secret', 'fixture'].join('_')
    for (const invalidKey of [syntheticSecret, `sb_publishable_${syntheticSecret}`, 'legacy.jwt.fixture']) {
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY = invalidKey
      await assert.rejects(resolveConfig({ mode: buildMode, logLevel: 'silent' }, 'build'), (error: unknown) =>
        error instanceof Error && /must contain a Supabase publishable key/.test(error.message) && !error.message.includes(invalidKey))
    }

    process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test_fixture'
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY_EXTRA = 'unexpected'
    await assert.rejects(resolveConfig({ mode: buildMode, logLevel: 'silent' }, 'build'), /reserved WALLFLOW prefix/)
  } finally {
    restoreEnvironment()
  }
})

test('preview builds require an explicit opt-in, project URL and publishable key', async () => {
  const restoreEnvironment = preserveEnvironment([
    'VITE_WALLFLOW_SUPABASE_PREVIEW', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY',
  ])
  const previewConfig = { mode: previewMode, logLevel: 'silent' } as const
  try {
    process.env.VITE_WALLFLOW_SUPABASE_PREVIEW = 'false'
    process.env.VITE_SUPABASE_URL = ''
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY = ''
    await assert.rejects(resolveConfig(previewConfig, 'build'), /requires VITE_WALLFLOW_SUPABASE_PREVIEW=true/)
    const normal = await resolveConfig({ mode: buildMode, logLevel: 'silent' }, 'serve')
    assert.ok(normal.server.proxy?.['/api/'])
    assert.equal((await resolveConfig(previewConfig, 'serve')).env.VITE_WALLFLOW_SUPABASE_PREVIEW, 'false')

    process.env.VITE_WALLFLOW_SUPABASE_PREVIEW = 'true'
    await assert.rejects(resolveConfig(previewConfig, 'build'), /requires VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY/)
    process.env.VITE_SUPABASE_URL = 'http://127.0.0.1:55321'
    await assert.rejects(resolveConfig(previewConfig, 'build'), /requires VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY/)
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test_fixture'
    const localPreview = await resolveConfig(previewConfig, 'build')
    assert.equal(localPreview.env.VITE_SUPABASE_URL, 'http://127.0.0.1:55321')
    assert.equal(localPreview.env.VITE_WALLFLOW_SUPABASE_PREVIEW, 'true')

    const syntheticSecret = ['sb', 'secret', 'fixture'].join('_')
    process.env.VITE_SUPABASE_URL = `https://${syntheticSecret}.example.invalid`
    await assert.rejects(resolveConfig(previewConfig, 'build'), (error: unknown) =>
      error instanceof Error && /must contain only a project origin/.test(error.message) && !error.message.includes(syntheticSecret))
  } finally {
    restoreEnvironment()
  }
})
