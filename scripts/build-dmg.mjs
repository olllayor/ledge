import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { arch as processArch } from 'node:process'

const repoRoot = resolve(import.meta.dirname, '..')
const packageJson = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'))
const productName = packageJson.build?.productName ?? packageJson.name
const version = packageJson.version
const arch = processArch === 'arm64' ? 'arm64' : 'x64'
const supportedDmgFormats = new Set(['UDZO', 'UDBZ', 'ULFO'])
const dmgFormat = (process.env.LEDGE_DMG_FORMAT ?? 'ULFO').toUpperCase()

const distDir = resolve(repoRoot, 'dist')
const appPath = join(distDir, `mac-${arch}`, `${productName}.app`)
const stagingDir = join(distDir, 'dmg-staging')
const dmgPath = join(distDir, `${productName}-${version}-${arch}.dmg`)

if (!supportedDmgFormats.has(dmgFormat)) {
  throw new Error(
    `Unsupported LEDGE_DMG_FORMAT "${dmgFormat}". Expected one of: ${[...supportedDmgFormats].join(', ')}`
  )
}

if (!existsSync(appPath)) {
  throw new Error(`Unable to find packaged app at ${appPath}`)
}

rmSync(stagingDir, { recursive: true, force: true })
rmSync(dmgPath, { force: true })
mkdirSync(stagingDir, { recursive: true })

cpSync(appPath, join(stagingDir, `${productName}.app`), { recursive: true })
symlinkSync('/Applications', join(stagingDir, 'Applications'))

// `hdiutil create` intermittently fails with "Resource busy" (error 49168) on
// macOS CI runners — a race between hdiutil's attach/convert step and Spotlight
// (mds) or other background processes touching the staging dir. Retry with
// backoff so a transient failure doesn't kill the whole release. `-nospotlight`
// also keeps Spotlight from indexing the freshly created volume.
const hdiutilArgs = [
  'create',
  '-volname',
  `${productName} ${version}`,
  '-srcfolder',
  stagingDir,
  '-ov',
  '-nospotlight',
  '-format',
  // ULFO is the default because it keeps modern macOS installs fast while still shrinking
  // the GitHub asset. UDBZ is smaller but slower to decompress; UDZO is the fallback.
  dmgFormat,
  dmgPath
]

const MAX_ATTEMPTS = 5
for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  try {
    execFileSync('hdiutil', hdiutilArgs, {
      cwd: repoRoot,
      stdio: 'inherit'
    })
    break
  } catch (error) {
    if (attempt === MAX_ATTEMPTS) throw error
    const backoff = attempt * 5
    console.warn(
      `hdiutil create failed (attempt ${attempt}/${MAX_ATTEMPTS}); retrying in ${backoff}s…`
    )
    await new Promise((resolve) => setTimeout(resolve, backoff * 1000))
  }
}

rmSync(stagingDir, { recursive: true, force: true })
