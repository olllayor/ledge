/**
 * Minimal interface for reading the macOS pasteboard. Lets the
 * `ClipboardHistoryService` be unit-tested without spinning up
 * Electron's `clipboard` module, and keeps the orchestrator file
 * (`clipboardHistory.ts`) free of `clipboard.*` calls.
 */
export interface PasteboardReader {
  /** Read the available UTI / pasteboard types without reading payloads. */
  availableFormats(): string[]
  /** Read the pasteboard image (or null if the pasteboard isn't an image). */
  readImage(): { isEmpty(): boolean; toPNG(): Buffer } | null
  /** Read a pasteboard buffer for a specific type. Empty string if absent. */
  readBuffer(format: string): string
  /** Read the pasteboard text. Empty string if absent. */
  readText(): string
}

/**
 * The real `PasteboardReader`, backed by Electron's `clipboard` module.
 * Wraps the synchronous calls in `try/catch` where Electron can throw
 * (e.g. permission errors on the pasteboard daemon).
 */
export function createElectronPasteboardReader(
  electronClipboard: typeof import('electron').clipboard,
): PasteboardReader {
  return {
    availableFormats() {
      try {
        return electronClipboard.availableFormats()
      } catch {
        return []
      }
    },
    readImage() {
      try {
        return electronClipboard.readImage()
      } catch {
        return null
      }
    },
    readBuffer(format) {
      try {
        const buffer = electronClipboard.readBuffer(format)
        return buffer.toString('utf8')
      } catch {
        return ''
      }
    },
    readText() {
      try {
        return electronClipboard.readText()
      } catch {
        return ''
      }
    }
  }
}
