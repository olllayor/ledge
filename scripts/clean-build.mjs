import { rmSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '..')
const targets = [
  'out',
  'build/icon.icns',
  'build/icon.iconset',
  'build/icon.png',
  'native/bin'
]

for (const target of targets) {
  rmSync(resolve(repoRoot, target), { recursive: true, force: true })
}
