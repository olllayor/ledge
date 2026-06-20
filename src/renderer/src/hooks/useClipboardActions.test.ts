// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useClipboardActions } from './useClipboardActions'
import type { ClipboardEntry } from '@shared/schema'

function makeEntry(): ClipboardEntry {
  return {
    id: 'entry-1',
    capturedAt: '2026-06-20T00:00:00Z',
    sourceBundleId: '',
    sourceAppName: '',
    item: {
      id: 'item-1',
      kind: 'text',
      createdAt: '2026-06-20T00:00:00Z',
      order: 0,
      title: 'snippet',
      subtitle: '',
      preview: { summary: 'snippet', detail: '' },
      text: 'hello'
    },
    categoryIds: []
  }
}

describe('useClipboardActions', () => {
  it('returns stable callbacks that forward to window.ledge', async () => {
    const clipboardCopy = vi.fn(async () => true)
    ;(window as unknown as { ledge: Record<string, unknown> }).ledge = {
      clipboardCopy,
      clipboardEntryRemove: vi.fn(async () => undefined),
      clipboardEntryAssign: vi.fn(async () => undefined),
      clipboardEntryUnassign: vi.fn(async () => undefined),
      clipboardCategoryCreate: vi.fn(async () => undefined),
      clipboardCategoryRename: vi.fn(async () => undefined),
      clipboardCategoryRemove: vi.fn(async () => undefined),
      clipboardEntryClearAll: vi.fn(async () => undefined),
      clipboardPruneNow: vi.fn(async () => undefined),
      clipboardStartItemDrag: vi.fn(() => true)
    }

    const { result, rerender } = renderHook(() => useClipboardActions())
    const first = result.current
    rerender()
    expect(result.current).toBe(first) // stable across renders

    const ok = await result.current.copyEntry(makeEntry())
    expect(ok).toBe(true)
    expect(clipboardCopy).toHaveBeenCalledWith({ entryId: 'entry-1' })
  })

  it('returns false from copyEntry when the bridge is absent', async () => {
    delete (window as unknown as { ledge?: unknown }).ledge
    const { result } = renderHook(() => useClipboardActions())
    const ok = await result.current.copyEntry(makeEntry())
    expect(ok).toBe(false)
  })

  it('returns false from startItemDrag when the bridge is absent', () => {
    delete (window as unknown as { ledge?: unknown }).ledge
    const { result } = renderHook(() => useClipboardActions())
    expect(result.current.startItemDrag(makeEntry())).toBe(false)
  })
})
