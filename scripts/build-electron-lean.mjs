import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '..')
const packageJsonPath = resolve(repoRoot, 'package.json')
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))

const rawElectronVersion =
  packageJson.devDependencies?.electron ?? packageJson.dependencies?.electron

if (!rawElectronVersion) {
  throw new Error('Unable to determine Electron version from package.json')
}

const electronVersion = rawElectronVersion.replace(/^[^0-9]*/, '')
const cliArgs = process.argv.slice(2)

const requestedArch = cliArgs.includes('--x64')
  ? 'x64'
  : cliArgs.includes('--arm64')
    ? 'arm64'
    : process.arch

const env = {
  ...process.env,
  ELECTRON_MIRROR:
    process.env.ELECTRON_MIRROR ??
    'https://github.com/electron/electron/releases/download/',
  ELECTRON_CUSTOM_DIR: process.env.ELECTRON_CUSTOM_DIR ?? `v${electronVersion}`,
  ELECTRON_CUSTOM_FILENAME:
    process.env.ELECTRON_CUSTOM_FILENAME ??
    `electron-${electronVersion}-darwin-${requestedArch}.zip`
}

execFileSync('pnpm', ['exec', 'electron-builder', ...cliArgs], {
  cwd: repoRoot,
  stdio: 'inherit',
  env
})
