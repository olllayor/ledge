import { randomUUID } from 'node:crypto'
import { shelfItemSchema, type ShelfItemRecord } from '@shared/schema'

/**
 * Pure, dependency-free heuristics for classifying the macOS pasteboard
 * contents and turning each format family into a shelf item. Lives next
 * to the rest of the clipboard code so the orchestrator (`clipboardHistory`)
 * reads top-to-bottom: "decide what kind -> read -> build item -> persist".
 *
 * Every public function in this file is pure (no Electron, no fs, no
 * network) so it can be tested without Electron's `clipboard` module.
 */

// ---- Format detection ---------------------------------------------------

/** Pasteboard UTI names that should be treated as images. */
const IMAGE_FORMATS: ReadonlySet<string> = new Set([
  'public.tiff',
  'public.png',
  'public.jpeg',
  'public.gif',
  'public.heic',
  'public.heif',
  'public.bmp',
  'com.adobe.pdf'
])

/** A normalized, priority-ordered description of the pasteboard. */
export type PasteboardShape =
  | { kind: 'image' }
  | { kind: 'file-url' }
  | { kind: 'text' }

export function classifyPasteboard(formats: string[]): PasteboardShape {
  if (formats.some((f) => f.startsWith('image/') || IMAGE_FORMATS.has(f))) {
    return { kind: 'image' }
  }
  if (
    formats.includes('public.file-url') ||
    formats.includes('NSFilenamesPboardType') ||
    formats.includes('text/uri-list')
  ) {
    return { kind: 'file-url' }
  }
  return { kind: 'text' }
}

// ---- Text -> shelf item -------------------------------------------------

/**
 * 6 or 8 hex digits, with or without leading '#'. Returns the normalized
 * lowercase form (always with `#`) on a match, null otherwise.
 */
export function hexFromText(text: string): string | null {
  const trimmed = text.trim()
  const match = /^#?([0-9a-fA-F]{6}([0-9a-fA-F]{2})?)$/.exec(trimmed)
  if (!match) return null
  return `#${match[1].toLowerCase()}`
}

/**
 * Light heuristic — proper language detection is out of scope. Catches
 * the common cases: brace + newline patterns, two-space indent, and
 * the standard `function` / `const` / `def` / `class` keywords.
 */
export function looksLikeCode(text: string): boolean {
  if (text.length < 16) return false
  if (/\n\s{2,}/.test(text)) return true
  if (/\bfunction\b|\bconst\b|\blet\b|\bimport\b|\bdef\b|\bclass\b/.test(text)) return true
  if (/[{}\[\];].*\n/.test(text)) return true
  return false
}

/**
 * Decide the best "kind" for a text-only pasteboard. Order is:
 * color > code > url > text. Returns null if the text is empty.
 */
export function classifyText(text: string): 'color' | 'code' | 'url' | 'text' | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  if (hexFromText(trimmed)) return 'color'
  if (looksLikeCode(trimmed)) return 'code'
  try {
    const url = new URL(trimmed)
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return 'url'
    }
  } catch {
    // not a URL
  }
  return 'text'
}

export function makeColorItem(hex: string): ShelfItemRecord {
  return shelfItemSchema.parse({
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    order: 0,
    title: hex,
    subtitle: 'Color',
    preview: { summary: hex, detail: '' },
    kind: 'color',
    hex
  })
}

export function makeCodeItem(text: string): ShelfItemRecord {
  return shelfItemSchema.parse({
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    order: 0,
    title: text.split('\n')[0]?.slice(0, 60) || 'Code snippet',
    subtitle: 'Code',
    preview: { summary: text.slice(0, 120), detail: text.length.toString() },
    kind: 'code',
    text
  })
}

// ---- File paths -> shelf item -------------------------------------------

/**
 * Parse a `public.file-url` / `NSFilenamesPboardType` payload (which is a
 * newline-separated list of `file://` URLs or raw POSIX paths) into a
 * list of raw paths suitable for the `fileDrop` ingest path.
 */
export function pathsFromFileUrlBuffer(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      // Strip the `file://` scheme if present, then URL-decode the
      // remainder. Without the decode, a path with spaces (e.g.
      // `file:///Users/me/My%20Files/foo.txt`) round-trips as
      // `/Users/me/My%20Files/foo.txt`, which fails every downstream
      // fs.stat / createBookmark call.
      const stripped = line.replace(/^file:\/\//, '')
      try {
        return decodeURIComponent(stripped)
      } catch {
        return stripped
      }
    })
}

// ---- Image -> payload ---------------------------------------------------

export interface ImageIngestPayload {
  kind: 'image'
  mimeType: 'image/png'
  base64: string
  filenameHint: string
}

export function imagePayloadFromPng(pngBuffer: Buffer, hint = 'clipboard-image'): ImageIngestPayload {
  return {
    kind: 'image',
    mimeType: 'image/png',
    base64: pngBuffer.toString('base64'),
    filenameHint: hint
  }
}
