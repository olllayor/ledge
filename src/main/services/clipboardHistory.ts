import { clipboard } from 'electron'
import { promises as fs } from 'node:fs'
import type { ShelfItemRecord } from '@shared/schema'
import { getFileBackedPath } from '@shared/fileUtils'
import { detectPayloadFromText, ImportedImageTooLargeError, payloadToItems, type PayloadContext } from './payloads'
import { broadcastToast } from './toastBroadcaster'
import type { StateStore } from './stateStore'
import type { NativeAgentClient } from '../native/nativeAgent'
import type { ClipboardChangeSnapshot } from './clipboardMonitor'
import {
  classifyPasteboard,
  classifyText,
  hexFromText as hexFromTextForBuild,
  imagePayloadFromPng,
  makeCodeItem,
  makeColorItem,
  pathsFromFileUrlBuffer,
} from './clipboard/payloads'
import { createElectronPasteboardReader, type PasteboardReader } from './clipboard/pasteboardReader'
import { makeImageThumbnail } from './clipboard/writer'

const CONCEALED_TYPE = 'org.nspasteboard.ConcealedType'
const MAX_IMPORTED_IMAGE_BYTES = 25 * 1024 * 1024

export interface ClipboardHistoryServiceDeps {
  stateStore: StateStore
  nativeAgent: NativeAgentClient
  onStateChange(): void
  /** Optional override so tests can inject a fake pasteboard. */
  pasteboardReader?: PasteboardReader
}

/**
 * Decides what (if anything) to record when the clipboard changes, and
 * is also the single owner of "read the pasteboard" logic. The renderer
 * only ever sees the resulting shelf items via the state store; it
 * never reads from the OS pasteboard directly.
 *
 * Reads from the pasteboard go through an injected `PasteboardReader`
 * so the priority chain can be unit-tested without Electron.
 */
export class ClipboardHistoryService {
  private readonly reader: PasteboardReader

  constructor(private readonly deps: ClipboardHistoryServiceDeps) {
    this.reader = deps.pasteboardReader ?? createElectronPasteboardReader(clipboard)
  }

  /**
   * Capture a clipboard snapshot from the `ClipboardMonitor`. The
   * monitor already debounces; this is the storage-side decision tree.
   */
  async capture(snapshot: ClipboardChangeSnapshot): Promise<void> {
    const settings = this.deps.stateStore.getClipboardSettings()
    if (!settings.enabled) return
    if (this.shouldSkip(snapshot, settings)) return

    const items = await this.readPasteboardToShelfItems(snapshot.formats)
    if (items.length === 0) return

    for (const item of items) {
      if (item.kind === 'imageAsset' && getFileBackedPath(item)) {
        const imagePath = getFileBackedPath(item) as string
        try {
          const stat = await fs.stat(imagePath)
          if (stat.size > MAX_IMPORTED_IMAGE_BYTES) {
            broadcastToast(
              `Skipped oversized clipboard image (${Math.round(stat.size / 1024 / 1024)}MB).`,
              'info',
            )
            continue
          }
        } catch {
          continue
        }
      }

      const thumbnailDataUri = makeImageThumbnail(item)

      this.deps.stateStore.appendClipboardEntry({
        capturedAt: new Date().toISOString(),
        sourceBundleId: snapshot.sourceBundleId,
        sourceAppName: snapshot.sourceAppName,
        item,
        thumbnailDataUri
      })
    }
    this.deps.onStateChange()
  }

  private shouldSkip(snapshot: ClipboardChangeSnapshot, settings: ReturnType<StateStore['getClipboardSettings']>): boolean {
    if (settings.ignoreConcealedItems && snapshot.formats.includes(CONCEALED_TYPE)) {
      return true
    }
    if (snapshot.sourceBundleId && settings.ignoreBundleIds.includes(snapshot.sourceBundleId)) {
      return true
    }
    return false
  }

  /**
   * Convert a pasteboard format list to a list of shelf items.
   *
   * Priority order: image > file path > URL > code > color > text.
   * First match wins; we don't merge multiple kinds from one pasteboard.
   */
  private async readPasteboardToShelfItems(formats: string[]): Promise<ShelfItemRecord[]> {
    const context = this.payloadContext()
    const shape = classifyPasteboard(formats)

    if (shape.kind === 'image') {
      const image = this.reader.readImage()
      if (image && !image.isEmpty()) {
        try {
          return await payloadToItems(imagePayloadFromPng(image.toPNG()), context)
        } catch (err) {
          if (err instanceof ImportedImageTooLargeError) {
            broadcastToast(err.message, 'info')
            return []
          }
          throw err
        }
      }
      // Fall through to text path if the pasteboard had an image UTI but
      // reading the image itself failed (e.g. permission denied).
    }

    if (shape.kind === 'file-url') {
      const text = this.reader.readBuffer('public.file-url')
      if (text) {
        const paths = pathsFromFileUrlBuffer(text)
        if (paths.length > 0) {
          const items = await payloadToItems({ kind: 'fileDrop', paths }, context)
          if (items.length > 0) return items
        }
      }
    }

    const text = this.reader.readText().trim()
    if (!text) return []
    return this.buildTextItem(text)
  }

  private async buildTextItem(text: string): Promise<ShelfItemRecord[]> {
    const context = this.payloadContext()
    const kind = classifyText(text)
    if (kind === 'color') {
      // Re-derive the hex (already validated by `classifyText`) so the
      // item always stores a canonical lowercase form.
      const hex = hexFromTextForBuild(text)
      if (!hex) return []
      return [makeColorItem(hex)]
    }
    if (kind === 'code') {
      return [makeCodeItem(text)]
    }
    // Anything else (`url` or `text`) goes through the shared ingest
    // pipeline so URL/title extraction stays in one place.
    return await payloadToItems(detectPayloadFromText(text), context)
  }

  private payloadContext(): PayloadContext {
    return {
      assetsDir: this.deps.stateStore.assetsDir,
      createBookmark: (path: string) => this.deps.nativeAgent.createBookmark(path),
      resolveBookmark: (bookmarkBase64: string, originalPath: string) =>
        this.deps.nativeAgent.resolveBookmark(bookmarkBase64, originalPath)
    }
  }
}

// Re-export the heuristics so existing tests can import from
// `clipboardHistory` (the only path that ever imported them).
export { hexFromText, looksLikeCode } from './clipboard/payloads'
