import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ClipboardHistoryService } from './clipboardHistory'
// StateStore owns its own persister; we don't need to import
// the persister helpers here.
import { StateStore } from './stateStore'
import type { NativeAgentClient } from '../native/nativeAgent'
import type { PasteboardReader } from './clipboard/pasteboardReader'
import type { ClipboardChangeSnapshot } from './clipboardMonitor'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((path) =>
      rm(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 }),
    ),
  )
})

class FakePasteboardReader implements PasteboardReader {
  formats: string[] = []
  image: { isEmpty(): boolean; toPNG(): Buffer } | null = null
  buffer: string = ''
  text: string = ''

  availableFormats() {
    return this.formats
  }
  readImage() {
    return this.image
  }
  readBuffer() {
    return this.buffer
  }
  readText() {
    return this.text
  }
}

function makeNativeAgent(): NativeAgentClient {
  // We only need a few stubs; capture() never calls createBookmark unless
  // the pasteboard carries a file URL, in which case the FakeNativeAgent
  // returns a base64 bookmark for the supplied path.
  return {
    createBookmark: vi.fn(async (path: string) => `bm:${path}`),
    resolveBookmark: vi.fn(async (bm: string) => ({
      resolvedPath: bm.replace(/^bm:/, ''),
      isStale: false,
      isMissing: false
    }))
  } as unknown as NativeAgentClient
}

async function buildService(opts: {
  pasteboard: FakePasteboardReader
  enabled?: boolean
}) {
  const dir = await mkdtemp(join(tmpdir(), 'clipboard-history-'))
  tempDirs.push(dir)
  // Use a real StateStore so capture() exercises the real persister.
  const stateStore = new StateStore(dir, {})
  // Default to enabled; tests can opt out with `enabled: false` to
  // verify the "history off" path skips capture entirely.
  stateStore.updateClipboardSettings({ enabled: opts.enabled ?? true })
  const nativeAgent = makeNativeAgent()
  const onStateChange = vi.fn()
  const service = new ClipboardHistoryService({
    stateStore,
    nativeAgent,
    onStateChange,
    pasteboardReader: opts.pasteboard
  })
  return { service, stateStore, onStateChange, nativeAgent }
}

function snapshot(formats: string[]): ClipboardChangeSnapshot {
  return {
    changeCount: 1,
    sourceBundleId: 'com.apple.Safari',
    sourceAppName: 'Safari',
    formats
  }
}

describe('ClipboardHistoryService.capture', () => {
  it('does nothing when clipboard history is disabled', async () => {
    const pasteboard = new FakePasteboardReader()
    pasteboard.formats = ['public.utf8-plain-text']
    pasteboard.text = 'hello'
    const { service, stateStore } = await buildService({ pasteboard, enabled: false })
    await service.capture(snapshot(pasteboard.formats))
    expect(stateStore.getClipboardEntries()).toHaveLength(0)
  })

  it('skips concealed pasteboards when the setting is on', async () => {
    const pasteboard = new FakePasteboardReader()
    pasteboard.formats = ['org.nspasteboard.ConcealedType', 'public.utf8-plain-text']
    pasteboard.text = 'secret'
    const { service, stateStore } = await buildService({ pasteboard, enabled: true })
    await service.capture(snapshot(pasteboard.formats))
    expect(stateStore.getClipboardEntries()).toHaveLength(0)
  })

  it('skips items from apps in the ignoreBundleIds list', async () => {
    const pasteboard = new FakePasteboardReader()
    pasteboard.formats = ['public.utf8-plain-text']
    pasteboard.text = 'skipped'
    const { service, stateStore } = await buildService({ pasteboard, enabled: true })
    stateStore.updateClipboardSettings({ ignoreBundleIds: ['com.apple.Safari'] })
    await service.capture(snapshot(pasteboard.formats))
    expect(stateStore.getClipboardEntries()).toHaveLength(0)
  })

  it('captures plain text as a text item', async () => {
    const pasteboard = new FakePasteboardReader()
    pasteboard.formats = ['public.utf8-plain-text']
    pasteboard.text = 'Hello, world'
    const { service, stateStore, onStateChange } = await buildService({ pasteboard })
    await service.capture(snapshot(pasteboard.formats))
    const entries = stateStore.getClipboardEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0]?.item.kind).toBe('text')
    expect(onStateChange).toHaveBeenCalledTimes(1)
  })

  it('classifies a hex string as a color item', async () => {
    const pasteboard = new FakePasteboardReader()
    pasteboard.formats = ['public.utf8-plain-text']
    pasteboard.text = '#FF8800'
    const { service, stateStore } = await buildService({ pasteboard })
    await service.capture(snapshot(pasteboard.formats))
    const entries = stateStore.getClipboardEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0]?.item.kind).toBe('color')
  })

  it('classifies indented text as a code item', async () => {
    const pasteboard = new FakePasteboardReader()
    pasteboard.formats = ['public.utf8-plain-text']
    pasteboard.text = 'function foo() {\n  return 1\n}'
    const { service, stateStore } = await buildService({ pasteboard })
    await service.capture(snapshot(pasteboard.formats))
    const entries = stateStore.getClipboardEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0]?.item.kind).toBe('code')
  })

  it('classifies a URL as a url item', async () => {
    const pasteboard = new FakePasteboardReader()
    pasteboard.formats = ['public.utf8-plain-text']
    pasteboard.text = 'https://example.com'
    const { service, stateStore } = await buildService({ pasteboard })
    await service.capture(snapshot(pasteboard.formats))
    const entries = stateStore.getClipboardEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0]?.item.kind).toBe('url')
  })

  it('captures a PNG image from the pasteboard', async () => {
    const pasteboard = new FakePasteboardReader()
    pasteboard.formats = ['public.png']
    pasteboard.image = { isEmpty: () => false, toPNG: () => Buffer.from([0x89, 0x50, 0x4e, 0x47]) }
    const { service, stateStore } = await buildService({ pasteboard })
    await service.capture(snapshot(pasteboard.formats))
    const entries = stateStore.getClipboardEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0]?.item.kind).toBe('imageAsset')
  })

  it('falls back from image to text when readImage returns null', async () => {
    const pasteboard = new FakePasteboardReader()
    pasteboard.formats = ['public.png', 'public.utf8-plain-text']
    pasteboard.image = null
    pasteboard.text = 'hello world'
    const { service, stateStore } = await buildService({ pasteboard })
    await service.capture(snapshot(pasteboard.formats))
    const entries = stateStore.getClipboardEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0]?.item.kind).toBe('text')
  })

  it('returns no entries for an empty pasteboard', async () => {
    const pasteboard = new FakePasteboardReader()
    pasteboard.formats = ['public.utf8-plain-text']
    pasteboard.text = ''
    const { service, stateStore } = await buildService({ pasteboard })
    await service.capture(snapshot(pasteboard.formats))
    expect(stateStore.getClipboardEntries()).toHaveLength(0)
  })
})
