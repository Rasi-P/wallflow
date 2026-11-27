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
  if (projectUrl) supabaseProjectOrigin(projectUrl)
  if (publishableKey) checkSupabasePublishableKey(publishableKey)
  if (command === 'build' && (!projectUrl || !publishableKey)) {
    throw new Error('Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to build WALLFLOW.')
  }

  return {
    plugins: [react(), tailwindcss()],
    envPrefix: [...supabasePublicVariables],
    server: {
      port: 5173,
      strictPort: true,
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
