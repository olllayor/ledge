import { isAbsolute, resolve as resolvePath, sep } from 'node:path'
import { getFileBackedPath } from '@shared/fileUtils'
import type { ShelfItemRecord } from '@shared/schema'

/**
 * Whitelist-check an asset path supplied to the `ledge-asset://`
 * protocol. The protocol hands the renderer whatever file it requests,
 * so we have to refuse paths outside our own assets directory and
 * outside the live shelf's file-backed items.
 *
 * Returns the absolute, normalized path on success; null when the path
 * is rejected. The caller is responsible for translating the null into
 * a 403 response.
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
    return normalizedPath
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
