import { existsSync } from 'node:fs'
import { join } from 'node:path'

export function resolvePreloadPath(): string {
  // `electron-vite` emits the preload as a CommonJS bundle in both dev
  // and production. Order matters: `.cjs` is the canonical build output,
  // and we keep the legacy `.js` / `.mjs` lookups so older builds keep
  // resolving correctly after a partial rebuild.
  const candidates = ['index.cjs', 'index.js', 'index.mjs']
  for (const name of candidates) {
    const candidate = join(__dirname, '../preload', name)
    if (existsSync(candidate)) {
      return candidate
    }
  }
  return join(__dirname, '../preload/index.cjs')
}
