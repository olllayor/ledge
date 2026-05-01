import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
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
  // Use local electron installation if available, otherwise fall back to download
  ELECTRON_CUSTOM_DIR:
    process.env.ELECTRON_CUSTOM_DIR ??
    (process.platform === 'darwin' && process.arch === 'arm64' &&
     existsSync('node_modules/electron/dist/Electron.app')
      ? 'node_modules/electron'
      : `v${electronVersion}`),
  ELECTRON_CUSTOM_FILENAME:
    process.env.ELECTRON_CUSTOM_FILENAME ??
    `electron-v${electronVersion}-darwin-${requestedArch}.zip`
}

execFileSync('pnpm', ['exec', 'electron-builder', ...cliArgs, ...publishArgs], {
  cwd: repoRoot,
  stdio: 'inherit',
  env
})
