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

const hasPublishArg = cliArgs.some((arg) => arg === '--publish' || arg.startsWith('--publish='))
const publishArgs = hasPublishArg ? [] : ['--publish', 'never']

const env = {
  ...process.env,
  ELECTRON_MIRROR:
    process.env.ELECTRON_MIRROR ??
    'https://github.com/electron/electron/releases/download/',
  // app-builder splices this directly into the download URL path (in place
  // of the release tag), not a "reuse this local directory" toggle — it
  // must always be the version. A previous version of this script pointed
  // it at `node_modules/electron` whenever a local Electron.app dist was
  // present, meaning to skip the download; that produced a malformed URL
  // (.../releases/download/node_modules/electron/electron-v...zip) on any
  // cache miss, which is every fresh CI runner.
  ELECTRON_CUSTOM_DIR: process.env.ELECTRON_CUSTOM_DIR ?? `v${electronVersion}`,
  ELECTRON_CUSTOM_FILENAME:
    process.env.ELECTRON_CUSTOM_FILENAME ??
    `electron-v${electronVersion}-darwin-${requestedArch}.zip`
}

execFileSync('pnpm', ['exec', 'electron-builder', ...cliArgs, ...publishArgs], {
  cwd: repoRoot,
  stdio: 'inherit',
  env
})
