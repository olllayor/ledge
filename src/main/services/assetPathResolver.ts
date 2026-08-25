import { isAbsolute, resolve as resolvePath, sep } from 'node:path'
import { realpathSync } from 'node:fs'
import { getFileBackedPath } from '@shared/fileUtils'
import type { ShelfItemRecord } from '@shared/schema'

/**
 * Whitelist-check an asset path supplied to the `ledge-asset://`
 * protocol. The protocol hands the renderer whatever file it requests,
 * so we have to refuse paths outside our own assets directory and
 * outside the live shelf's file-backed items.
 *
 * The assetsDir branch verifies containment against REAL paths: a
 * symlink planted inside assetsDir pointing anywhere on disk must not
 * pass the lexical resolve+prefix check. Returns the absolute,
 * normalized path on success; null when the path is rejected. The
 * caller is responsible for translating the null into a 403 response.
 */
export function resolveAllowedAssetPath(
  rawPath: string,
  context: { assetsDir: string; liveItems: ShelfItemRecord[] },
): string | null {
  if (!isAbsolute(rawPath)) {
    return null
  }

  const normalizedPath = resolvePath(rawPath)
  if (isPathInside(context.assetsDir, normalizedPath)) {
    try {
      // Symlink escape guard: compare resolved targets, not lexemes.
      const realCandidate = realpathSync(normalizedPath)
      const realAssetsDir = realpathSync(context.assetsDir)
      if (isPathInside(realAssetsDir, realCandidate)) {
        return normalizedPath
      }
      return null
    } catch {
      // Unreadable or dangling path — nothing to serve either way.
      return null
    }
  }

  for (const item of context.liveItems) {
    if (item.kind !== 'imageAsset' && !(item.kind === 'file' && item.mimeType.startsWith('image/'))) {
      continue
    }

    const itemPath = getFileBackedPath(item)
    if (itemPath && resolvePath(itemPath) === normalizedPath) {
      return normalizedPath
    }
  }

  return null
}

export function isPathInside(parent: string, candidate: string): boolean {
  const normalizedParent = resolvePath(parent)
  const normalizedCandidate = resolvePath(candidate)
  return normalizedCandidate === normalizedParent || normalizedCandidate.startsWith(`${normalizedParent}${sep}`)
}
