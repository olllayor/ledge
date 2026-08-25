import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { clipboard, nativeImage } from 'electron'
import type { ShelfItemRecord } from '@shared/schema'
import { getFileBackedPath, isFileBackedItem } from '@shared/fileUtils'

/**
 * Minimal interface for writing to the macOS pasteboard. Lets the
 * `quickPaste` flow be unit-tested without Electron's `clipboard` module.
 */
export interface ClipboardWriter {
  writeText(text: string): void
  writeBuffer(format: string, buffer: Buffer): void
  writeImage(image: unknown): void
  clear(): void
}

export function createElectronClipboardWriter(): ClipboardWriter {
  return {
    writeText: (text) => clipboard.writeText(text),
    writeBuffer: (format, buffer) => clipboard.writeBuffer(format, buffer),
    writeImage: (image) => clipboard.writeImage(image as Electron.NativeImage),
    clear: () => clipboard.clear()
  }
}

/**
 * Write a single shelf item to the system clipboard. This is the single
 * "switch on item.kind" path used by both the capture-time path
 * (when the user copies something from another app) and the renderer
 * (when the user clicks "copy" on a clipboard history card).
 */
export function writeShelfItemToClipboard(item: ShelfItemRecord, writer: ClipboardWriter = createElectronClipboardWriter()): boolean {
  switch (item.kind) {
    case 'text':
      writer.writeText(item.text)
      return true
    case 'url':
      writer.writeText(item.url)
      return true
    case 'code':
      writer.writeText(item.text)
      return true
    case 'color':
      writer.writeText(item.hex)
      return true
    case 'imageAsset':
      return writeImageAssetToClipboard(item, writer)
    case 'file':
    case 'folder':
      return writeFileBackedToClipboard(item, writer)
  }
  // Exhaustiveness fallback: should be unreachable for a valid ShelfItemRecord.
  return false
}

function writeImageAssetToClipboard(item: ShelfItemRecord, writer: ClipboardWriter): boolean {
  if (!isFileBackedItem(item)) return false
  const imagePath = getFileBackedPath(item)
  if (!imagePath) return false
  try {
    const image = nativeImage.createFromPath(imagePath)
    if (image.isEmpty()) return false
    writer.writeImage(image)
    return true
  } catch {
    // Best-effort: a read/decode failure means nothing was written.
    return false
  }
}

function writeFileBackedToClipboard(item: ShelfItemRecord, writer: ClipboardWriter): boolean {
  if (!isFileBackedItem(item)) return false
  const path = getFileBackedPath(item)
  if (!path) return false
  writer.clear()
  writer.writeText(path)
  // pathToFileURL percent-encodes spaces, #, %, and non-ASCII; a raw
  // `file://${path}` is an invalid URL for any such path and Finder
  // silently refuses the paste.
  writer.writeBuffer('public.file-url', Buffer.from(pathToFileURL(path).href, 'utf8'))
  return true
}

// ---- Thumbnails ---------------------------------------------------------

/**
 * Generate a 64x64 PNG data URI for an image-asset shelf item, suitable
 * for the clipboard history card grid. Returns `undefined` when the
 * image file is missing or the resize fails.
 * Sync version — runs on main thread, keep fast (64px resize).
 */
export function makeImageThumbnail(item: ShelfItemRecord): string | undefined {
  if (item.kind !== 'imageAsset') return undefined
  const imagePath = getFileBackedPath(item)
  if (!imagePath || !existsSync(imagePath)) return undefined
  let image
  try {
    image = nativeImage.createFromPath(imagePath)
  } catch {
    return undefined
  }
  if (image.isEmpty()) return undefined
  const resized = image.resize({ width: 64, quality: 'good' })
  if (resized.isEmpty()) return undefined
  return resized.toDataURL()
}

/**
 * Async thumbnail to avoid blocking the capture hot path.
 * Yields to event loop before the synchronous resize so clipboard
 * double-capture logic isn't delayed.
 */
export async function makeImageThumbnailAsync(item: ShelfItemRecord): Promise<string | undefined> {
  if (item.kind !== 'imageAsset') return undefined
  // Yield one tick so the capture loop can finish state writes.
  await new Promise<void>((resolve) => setImmediate(resolve))
  return makeImageThumbnail(item)
}
