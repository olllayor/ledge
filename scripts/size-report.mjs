import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const repoRoot = resolve(import.meta.dirname, '..')
const appPath = resolve(repoRoot, 'dist/mac-arm64/Ledge.app')
const asarPath = resolve(appPath, 'Contents/Resources/app.asar')

function size(path) {
  if (!existsSync(path)) return 'missing'
  return execFileSync('du', ['-sh', path], { cwd: repoRoot, encoding: 'utf8' }).trim().split(/\s+/)[0]
}

console.log('\nLedge package size report')
console.log(`app: ${size(appPath)}`)
console.log(`electron framework: ${size(resolve(appPath, 'Contents/Frameworks/Electron Framework.framework'))}`)
console.log(`app.asar: ${size(asarPath)}`)
console.log(`native helper: ${size(resolve(appPath, 'Contents/Resources/native/DropShelfNativeAgent'))}`)
console.log(`renderer: ${size(resolve(repoRoot, 'out/renderer'))}`)
console.log(`renderer JS/CSS:`)

try {
  const output = execFileSync('find', ['out/renderer', '-type', 'f', '(', '-name', '*.js', '-o', '-name', '*.css', ')', '-print'], {
    cwd: repoRoot,
    encoding: 'utf8'
  })
    .trim()
    .split('\n')
    .filter(Boolean)

  for (const file of output) {
    console.log(`  ${size(resolve(repoRoot, file))}\t${file}`)
  }
} catch {
  console.log('  missing')
}

if (existsSync(asarPath)) {
  const asar = require('@electron/asar')
  const header = asar.getRawHeader(asarPath).header
  const entries = []

  function walk(node, path = '') {
    if (node.files) {
      for (const [name, child] of Object.entries(node.files)) {
        walk(child, `${path}/${name}`)
      }
      return
    }

    entries.push({ path, size: node.size ?? 0 })
  }

  walk(header)
  console.log('top app.asar entries:')
  for (const entry of entries.sort((a, b) => b.size - a.size).slice(0, 12)) {
    console.log(`  ${(entry.size / 1024).toFixed(1)} KB\t${entry.path}`)
  }
}
