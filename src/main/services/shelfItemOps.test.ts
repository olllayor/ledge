import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ShelfItemOps } from './shelfItemOps'
import { StateStore } from './stateStore'
import type { AppState, ShelfItemRecord } from '@shared/schema'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((path) =>
      rm(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 }),
    ),
  )
})

async function buildHarness(): Promise<{
  ops: ShelfItemOps
  stateStore: StateStore
  broadcast: ReturnType<typeof vi.fn>
  tick: ReturnType<typeof vi.fn>
}> {
  const dir = await mkdtemp(join(tmpdir(), 'shelf-item-ops-'))
  tempDirs.push(dir)
  const stateStore = new StateStore(dir)
  const broadcast = vi.fn((): AppState => stateStore.snapshot({
    nativeHelperAvailable: false,
    accessibilityTrusted: false,
    shakeReady: false,
    lastError: '',
    shortcutRegistered: false,
    shortcutError: ''
  }))
  const tick = vi.fn()
  const ops = new ShelfItemOps(stateStore, {
    onInactivityTick: tick,
    broadcastState: broadcast
  })
  return { ops, stateStore, broadcast, tick }
}

function makeItem(id: string, order: number): ShelfItemRecord {
  return {
    id,
    kind: 'text',
    createdAt: new Date().toISOString(),
    order,
    title: id,
    subtitle: '',
    preview: { summary: id, detail: '' },
    text: id
  }
}

describe('ShelfItemOps', () => {
  it('appends items, ticks, and broadcasts', async () => {
    const { ops, stateStore, broadcast, tick } = await buildHarness()

    const result = ops.append([makeItem('a', 0), makeItem('b', 1)])

    expect(stateStore.getLiveShelf()?.items.map((i) => i.id)).toEqual(['a', 'b'])
    expect(tick).toHaveBeenCalledOnce()
    expect(broadcast).toHaveBeenCalledOnce()
    expect(result.liveShelf?.items.map((i) => i.id)).toEqual(['a', 'b'])
  })

  it('renames the live shelf and returns the broadcast state', async () => {
    const { ops, stateStore, tick } = await buildHarness()
    stateStore.createShelf('manual')

    ops.rename('  new name  ')

    expect(stateStore.getLiveShelf()?.name).toBe('new name')
    expect(tick).toHaveBeenCalledOnce()
  })

  it('reorders, clears, and removes items through the same flush pattern', async () => {
    const { ops, stateStore, tick, broadcast } = await buildHarness()
    stateStore.createShelf('manual')
    stateStore.appendItems([makeItem('a', 0), makeItem('b', 1), makeItem('c', 2)])

    tick.mockClear()
    broadcast.mockClear()
    ops.reorder(['c', 'a'])
    expect(stateStore.getLiveShelf()?.items.map((i) => i.id)).toEqual(['c', 'a', 'b'])
    expect(tick).toHaveBeenCalledOnce()
    expect(broadcast).toHaveBeenCalledOnce()

    tick.mockClear()
    broadcast.mockClear()
    ops.remove('a')
    expect(stateStore.getLiveShelf()?.items.map((i) => i.id)).toEqual(['c', 'b'])
    expect(tick).toHaveBeenCalledOnce()
    expect(broadcast).toHaveBeenCalledOnce()

    tick.mockClear()
    broadcast.mockClear()
    ops.clear()
    expect(stateStore.getLiveShelf()?.items).toEqual([])
    expect(tick).toHaveBeenCalledOnce()
    expect(broadcast).toHaveBeenCalledOnce()
  })
})
