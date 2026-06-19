import { clipboard, nativeImage } from 'electron'
import { existsSync, promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { shelfItemSchema, type ShelfItemRecord } from '@shared/schema'
import { getFileBackedPath } from '@shared/fileUtils'
import { detectPayloadFromText, ImportedImageTooLargeError, payloadToItems, type PayloadContext } from './payloads'
import { broadcastToast } from './toastBroadcaster'
import type { StateStore } from './stateStore'
import type { NativeAgentClient } from '../native/nativeAgent'
import type { ClipboardChangeSnapshot } from './clipboardMonitor'

const CONCEALED_TYPE = 'org.nspasteboard.ConcealedType'
const MAX_IMPORTED_IMAGE_BYTES = 25 * 1024 * 1024

export interface ClipboardHistoryServiceDeps {
  stateStore: StateStore
  nativeAgent: NativeAgentClient
  onStateChange(): void
}

/**
 * Decides what (if anything) to record when the clipboard changes, and
 * is also the single owner of "read the pasteboard" logic. The renderer
 * only ever sees the resulting shelf items via the state store; it
 * never reads from the OS pasteboard directly.
 */
export class ClipboardHistoryService {
  constructor(private readonly deps: ClipboardHistoryServiceDeps) {}

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

      const thumbnailDataUri =
        item.kind === 'imageAsset' ? this.makeThumbnail(item) : undefined

      this.deps.stateStore.appendClipboardEntry({
        capturedAt: new Date().toISOString(),
        sourceBundleId: snapshot.sourceBundleId,
        sourceAppName: snapshot.sourceAppName,
        item,
        thumbnailDataUri,
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

  private makeThumbnail(item: ShelfItemRecord): string | undefined {
    if (item.kind !== 'imageAsset') return undefined
    const imagePath = getFileBackedPath(item)
    if (!imagePath || !existsSync(imagePath)) return undefined
    const image = nativeImage.createFromPath(imagePath)
    if (image.isEmpty()) return undefined
    const resized = image.resize({ width: 64, quality: 'good' })
    if (resized.isEmpty()) return undefined
    return resized.toDataURL()
  }

  /**
   * Convert a pasteboard format list to a list of shelf items.
   *
   * Priority order: image > file path > URL > code > color > text.
   * First match wins; we don't merge multiple kinds from one pasteboard.
   */
  private async readPasteboardToShelfItems(formats: string[]): Promise<ShelfItemRecord[]> {
    const context = this.payloadContext()

    if (
      formats.some(
        (format) => format.startsWith('image/') || format === 'public.tiff' || format === 'com.adobe.pdf',
      )
    ) {
      const image = clipboard.readImage()
      if (!image.isEmpty()) {
        try {
          return await payloadToItems(
            {
              kind: 'image',
              mimeType: 'image/png',
              base64: image.toPNG().toString('base64'),
              filenameHint: 'clipboard-image',
            },
            context,
          )
        } catch (err) {
          if (err instanceof ImportedImageTooLargeError) {
            broadcastToast(err.message, 'info')
            return []
          }
          throw err
        }
      }
    }

    if (
      formats.includes('public.file-url') ||
      formats.includes('NSFilenamesPboardType') ||
      formats.includes('text/uri-list')
    ) {
      try {
        const buffer = clipboard.readBuffer('public.file-url')
        const text = buffer.toString('utf8')
        if (text) {
          const items = await payloadToItems(
            { kind: 'fileDrop', paths: text.split('\n').filter(Boolean) },
            context,
          )
          if (items.length > 0) return items
        }
      } catch {
        // Fall through to URL/text handling.
      }
    }

    const text = clipboard.readText().trim()
    if (!text) return []

    const hex = hexFromText(text)
    if (hex) {
      return [this.makeColorItem(hex)]
    }

    if (looksLikeCode(text)) {
      return [this.makeCodeItem(text)]
    }

    const payload = detectPayloadFromText(text)
    return await payloadToItems(payload, context)
  }

  private makeColorItem(hex: string): ShelfItemRecord {
    return shelfItemSchema.parse({
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      order: 0,
      title: hex,
      subtitle: 'Color',
      preview: { summary: hex, detail: '' },
      kind: 'color',
      hex,
    })
  }

  private makeCodeItem(text: string): ShelfItemRecord {
    return shelfItemSchema.parse({
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      order: 0,
      title: text.split('\n')[0]?.slice(0, 60) ?? 'Code snippet',
      subtitle: 'Code',
      preview: { summary: text.slice(0, 120), detail: text.length.toString() },
      kind: 'code',
      text,
    })
  }

  private payloadContext(): PayloadContext {
    return {
      assetsDir: this.deps.stateStore.assetsDir,
      createBookmark: (path: string) => this.deps.nativeAgent.createBookmark(path),
      resolveBookmark: (bookmarkBase64: string, originalPath: string) =>
        this.deps.nativeAgent.resolveBookmark(bookmarkBase64, originalPath),
    }
  }
}

function hexFromText(text: string): string | null {
  const trimmed = text.trim()
  // 6 or 8 hex digits, with or without leading '#'.
  const match = /^#?([0-9a-fA-F]{6}([0-9a-fA-F]{2})?)$/.exec(trimmed)
  if (!match) return null
  return `#${match[1].toLowerCase()}`
}

function looksLikeCode(text: string): boolean {
  // Light heuristic — proper language detection is out of scope.
  if (text.length < 16) return false
  if (/\n\s{2,}/.test(text)) return true
  if (/\bfunction\b|\bconst\b|\blet\b|\bimport\b|\bdef\b|\bclass\b/.test(text)) return true
  if (/[{}\[\];].*\n/.test(text)) return true
  return false
}
