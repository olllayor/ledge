import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '..')
const buildDir = resolve(repoRoot, 'build')
const sourcePath = resolve(buildDir, 'icon-source.png')
const pngPath = resolve(buildDir, 'icon.png')
const iconsetDir = resolve(buildDir, 'icon.iconset')
const icnsPath = resolve(buildDir, 'app.icns')

if (!existsSync(sourcePath)) {
  throw new Error(`Brand source is missing at ${sourcePath}`)
}

mkdirSync(buildDir, { recursive: true })
rmSync(iconsetDir, { recursive: true, force: true })
mkdirSync(iconsetDir, { recursive: true })

execFileSync('sips', ['-s', 'format', 'png', '-z', '1024', '1024', sourcePath, '--out', pngPath], {
  cwd: repoRoot,
  stdio: 'inherit'
})

const sizes = [16, 32, 128, 256, 512]

for (const size of sizes) {
  const file = resolve(iconsetDir, `icon_${size}x${size}.png`)
  execFileSync('sips', ['-z', String(size), String(size), pngPath, '--out', file], {
    cwd: repoRoot,
    stdio: 'inherit'
  })

  const retinaFile = resolve(iconsetDir, `icon_${size}x${size}@2x.png`)
  execFileSync('sips', ['-z', String(size * 2), String(size * 2), pngPath, '--out', retinaFile], {
    cwd: repoRoot,
    stdio: 'inherit'
  })
}

execFileSync('iconutil', ['-c', 'icns', iconsetDir, '-o', icnsPath], {
  cwd: repoRoot,
  stdio: 'inherit'
})

// ── Tray icon (menubar) ────────────────────────────────────────────────
// Generates a crisp, monochrome shelf icon for the system tray.
// Requires ImageMagick (uses 'magick' on v7+, falls back to 'convert').
const traySvgPath = resolve(buildDir, 'tray-icon.svg')
const trayPngPath = resolve(buildDir, 'tray-icon.png')
const trayRetinaPath = resolve(buildDir, 'tray-icon@2x.png')

if (existsSync(traySvgPath)) {
  const magick = (() => {
    try {
      execFileSync('magick', ['--version'], { stdio: 'ignore' })
      return 'magick'
    } catch {
      try {
        execFileSync('convert', ['--version'], { stdio: 'ignore' })
        return 'convert'
      } catch {
        return null
      }
    }
  })()

  if (!magick) {
    if (existsSync(trayPngPath) && existsSync(trayRetinaPath)) {
      console.warn('ImageMagick not found; reusing existing tray icon PNGs')
    } else {
      throw new Error(
        'ImageMagick is required to build the tray icon. Install it with: brew install imagemagick'
      )
    }
  } else {
    execFileSync(magick, [traySvgPath, '-resize', '16x16', trayPngPath], {
      cwd: repoRoot,
      stdio: 'inherit'
    })

    execFileSync(magick, [traySvgPath, '-resize', '32x32', trayRetinaPath], {
      cwd: repoRoot,
      stdio: 'inherit'
    })
  }
} else {
  console.warn(`Tray icon source missing at ${traySvgPath}; skipping tray icon generation`)
}
