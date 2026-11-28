import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import type { Plugin } from 'vite'
import { nativeAssociations } from './associations.ts'

export function wallflowPwa(associationEnv: Record<string, string | undefined>): Plugin {
  return {
    name: 'wallflow-pwa',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      for (const [name, value] of Object.entries(nativeAssociations(associationEnv))) {
        this.emitFile({ type: 'asset', fileName: `.well-known/${name}`, source: JSON.stringify(value) })
      }
      const source = readFileSync(new URL('./sw.js', import.meta.url), 'utf8')
      const publicFiles = ['/offline.html', '/manifest.webmanifest', '/favicon.svg', '/fonts/dm-sans-latin.woff2',
        '/icons/wallflow-192.png', '/icons/wallflow-512.png', '/icons/wallflow-maskable-512.png', '/icons/apple-touch-icon.png']
      const publicAssets = readdirSync('public/environments').filter((name) => name.endsWith('.jpg'))
        .sort().map((name) => `/environments/${name}`)
      const shell = ['/index.html', ...publicFiles]
      const hash = createHash('sha256').update(source).update(readFileSync('index.html'))
      for (const path of [...publicFiles, ...publicAssets]) hash.update(readFileSync(`public${path}`))
      for (const [name, file] of Object.entries(bundle).sort(([left], [right]) => left.localeCompare(right))) {
        if (!name.startsWith('assets/') || name.endsWith('.map')) continue
        shell.push(`/${name}`)
        hash.update(name).update(file.type === 'chunk' ? file.code : file.source)
      }
      const build = { version: hash.digest('hex').slice(0, 24), shell, publicAssets }
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: `self.wallflowBuild = ${JSON.stringify(build)};\n${source}` })
    },
  }
}
