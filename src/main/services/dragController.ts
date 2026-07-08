import { app, nativeImage, type NativeImage, type WebContents } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Validate that every path is reachable on disk before handing it to
 * `webContents.startDrag`. `startDrag` is synchronous from the
 * renderer's perspective, so we have to do this synchronously here too:
 * an async `fs.access` race would let a stale path slip into the drag
 * payload, which silently produces a broken drag.
 */
export function pathsExist(paths: string[]): boolean {
  if (paths.length === 0) return false
  for (const p of paths) {
    try {
      if (!existsSync(p)) return false
    } catch {
      return false
    }
  }
  return true
}

export interface DragOptions {
  /**
   * Override the icon resolver. Used by tests to avoid touching
   * `app.getAppPath()` (which is undefined under vitest). Production
   * callers leave this unset and get the bundled `.icns`/`icon.png`
   * fallback chain.
   */
  resolveIcon?: (paths: string[]) => NativeImage | null
}

/**
 * Kick off a native file drag with the supplied paths. Returns silently
 * when no path can be resolved or any path is missing; the caller is
 * expected to do its own user-facing error reporting if needed.
 */
export function startNativeDrag(
  webContents: WebContents,
  paths: string[],
  options: DragOptions = {},
): void {
  const [firstPath] = paths
  if (!firstPath) {
    return
  }
  if (!pathsExist(paths)) {
    return
  }

  const icon = options.resolveIcon ? options.resolveIcon(paths) : null
  const resolvedIcon = icon ?? defaultDragIconImage(paths)

  const dragPayload =
    paths.length > 1
      ? {
          file: firstPath,
          files: paths,
          icon: resolvedIcon,
        }
      : {
          file: firstPath,
          icon: resolvedIcon,
        }

  webContents.startDrag(dragPayload)
}

function defaultDragIconImage(paths: string[]): NativeImage {
  const iconCandidates = [
    ...paths,
    join(app.getAppPath(), 'build', 'app.icns'),
    join(process.resourcesPath, 'app.icns'),
    join(app.getAppPath(), 'build', 'icon.png'),
    join(process.resourcesPath, 'icon.png'),
  ]

  for (const candidate of iconCandidates) {
    const image = nativeImage.createFromPath(candidate)
    if (image.isEmpty()) {
      continue
    }
    return image.resize({ width: 72, height: 72, quality: 'best' })
  }

  const embeddedFallback = nativeImage.createFromBuffer(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR42mNk+P+/HgAEtQJ8j3u7EwAAAABJRU5ErkJggg==',
      'base64',
    ),
  )

  if (!embeddedFallback.isEmpty()) {
    return embeddedFallback.resize({ width: 72, height: 72, quality: 'best' })
  }

  return nativeImage.createEmpty()
}
