import { existsSync } from 'node:fs'
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
export function writeShelfItemToClipboard(item: ShelfItemRecord, writer: ClipboardWriter = createElectronClipboardWriter()): void {
  switch (item.kind) {
    case 'text':
      writer.writeText(item.text)
      return
    case 'url':
      writer.writeText(item.url)
      return
    case 'code':
      writer.writeText(item.text)
      return
    case 'color':
      writer.writeText(item.hex)
      return
    case 'imageAsset':
      writeImageAssetToClipboard(item, writer)
      return
    case 'file':
    case 'folder':
      writeFileBackedToClipboard(item, writer)
      return
  }
}

function writeImageAssetToClipboard(item: ShelfItemRecord, writer: ClipboardWriter): void {
  if (!('file' in item)) return
  const imagePath = getFileBackedPath(item)
  if (!imagePath) return
  try {
    const image = nativeImage.createFromPath(imagePath)
    if (!image.isEmpty()) {
      writer.writeImage(image)
    }
  } catch {
    // Best-effort.
  }
}

function writeFileBackedToClipboard(item: ShelfItemRecord, writer: ClipboardWriter): void {
  if (!isFileBackedItem(item)) return
  const path = getFileBackedPath(item)
  if (!path) return
  writer.clear()
  writer.writeText(path)
  writer.writeBuffer('public.file-url', Buffer.from(`file://${path}`, 'utf8'))
}

// ---- Thumbnails ---------------------------------------------------------

/**
 * Generate a 64x64 PNG data URI for an image-asset shelf item, suitable
 * for the clipboard history card grid. Returns `undefined` when the
 * image file is missing or the resize fails.
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
