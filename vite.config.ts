import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { checkSupabasePublishableKey, supabaseProjectOrigin, supabasePublicVariables } from './src/auth/supabaseEnvironment.ts'

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const environment = loadEnv(mode, process.cwd(), [...supabasePublicVariables])
  for (const name of Object.keys(environment)) {
    if (!supabasePublicVariables.some((allowed) => allowed === name)) {
      throw new Error('A browser environment variable uses a reserved WALLFLOW prefix.')
    }
  }
  const projectUrl = environment.VITE_SUPABASE_URL?.trim()
  const publishableKey = environment.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
  const previewFlag = environment.VITE_WALLFLOW_SUPABASE_PREVIEW
  if (projectUrl) supabaseProjectOrigin(projectUrl)
  if (publishableKey) checkSupabasePublishableKey(publishableKey)
  if (previewFlag && previewFlag !== 'true' && previewFlag !== 'false') {
    throw new Error('VITE_WALLFLOW_SUPABASE_PREVIEW must be true or false.')
  }
  if (command === 'build' && mode === 'supabase-preview') {
    if (previewFlag !== 'true') {
      throw new Error('A Supabase preview build requires VITE_WALLFLOW_SUPABASE_PREVIEW=true.')
    }
    if (!projectUrl || !publishableKey) {
      throw new Error('A Supabase preview build requires VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.')
    }
  }

  return {
    plugins: [react(), tailwindcss()],
    envPrefix: [...supabasePublicVariables],
    server: {
      port: 5173,
      strictPort: true,
      watch: process.env.WALLFLOW_VITE_POLLING === 'true' ? { usePolling: true, interval: 250 } : undefined,
      proxy: {
        '/api/': {
          target: process.env.WALLFLOW_VITE_PROXY_TARGET ?? 'http://127.0.0.1:8000',
          changeOrigin: false,
        },
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            three: ['three'],
          },
        },
      },
    },
  }
})
