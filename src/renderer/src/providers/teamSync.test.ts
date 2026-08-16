import { describe, expect, it } from 'vitest'
import type { ShelfItemRecord } from '@shared/schema'
import { compareRanks } from '@shared/lexorank'
import {
  buildTeamPushPlan,
  MutationQueue,
  remoteToLocalItems,
  syncedFromRemote,
  type RemoteTeamItemDoc,
} from './teamSync'

function localItem(id: string, overrides: Partial<ShelfItemRecord> = {}): ShelfItemRecord {
  return {
    id,
    kind: 'text',
    createdAt: '2026-08-16T00:00:00.000Z',
    order: 0,
    title: id,
    subtitle: '',
    preview: { summary: id, detail: '' },
    text: `content-${id}`,
    ...overrides,
  } as ShelfItemRecord
}

function remoteDoc(
  itemId: string,
  order: string,
  overrides: Partial<RemoteTeamItemDoc> = {},
): RemoteTeamItemDoc {
  return {
    _id: `doc-${itemId}`,
    _creationTime: 1_700_000_000_000,
    itemId,
    kind: 'text',
    title: itemId,
    subtitle: '',
    preview: { summary: itemId, detail: '' },
    order,
    text: `content-${itemId}`,
    version: 1,
    serverUpdatedAt: 1_700_000_000_000,
    ...overrides,
  }
}

describe('remoteToLocalItems', () => {
  it('sorts by rank and renumbers local order', () => {
    const items = remoteToLocalItems([
      remoteDoc('c', 'a2'),
      remoteDoc('a', 'a0'),
      remoteDoc('b', 'a1'),
    ])
    expect(items.map((i) => i.id)).toEqual(['a', 'b', 'c'])
    expect(items.map((i) => i.order)).toEqual([0, 1, 2])
  })

  it('strips file paths and flags file-backed items missing', () => {
    const items = remoteToLocalItems([
      remoteDoc('f', 'a0', {
        kind: 'file',
        text: undefined,
        file: { originalPath: '/Users/alice/secret.txt', resolvedPath: '/Users/alice/secret.txt', isStale: false, isMissing: false },
        mimeType: 'text/plain',
      }),
    ])
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('file')
    if (items[0].kind === 'file') {
      expect(items[0].file.originalPath).toBe('')
      expect(items[0].file.resolvedPath).toBe('')
      expect(items[0].file.bookmarkBase64).toBe('')
      expect(items[0].file.isMissing).toBe(true)
    }
  })

  it('passes through creator attribution', () => {
    const items = remoteToLocalItems([
      remoteDoc('a', 'a0', { createdByUser: { email: 'alex@team.dev' } }),
    ])
    expect(items[0].createdByUser).toEqual({ email: 'alex@team.dev' })
  })

  it('drops docs whose payload cannot produce a valid local item', () => {
    const items = remoteToLocalItems([
      remoteDoc('bad', 'a0', { kind: 'url', text: undefined, url: 'not-a-url' }),
      remoteDoc('good', 'a1', { kind: 'url', text: undefined, url: 'https://ledge.app' }),
    ])
    expect(items.map((i) => i.id)).toEqual(['good'])
  })
})

describe('buildTeamPushPlan', () => {
  it('pushes every item with increasing ranks for a fresh shelf', () => {
    const local = [localItem('a'), localItem('b'), localItem('c')]
    const plan = buildTeamPushPlan(local, [], new Map())

    expect(plan.deletes).toEqual([])
    expect(plan.upserts.map((u) => u.itemId)).toEqual(['a', 'b', 'c'])
    expect(plan.upserts.map((u) => u.version)).toEqual([1, 1, 1])
    const ranks = plan.upserts.map((u) => u.order)
    expect(ranksIsIncreasing(ranks)).toBe(true)
  })

  it('produces no work when local mirrors the server', () => {
    const docs = [remoteDoc('a', 'a0'), remoteDoc('b', 'a1')]
    const local = remoteToLocalItems(docs)
    const synced = syncedFromRemote(docs)

    const plan = buildTeamPushPlan(local, docs, synced)
    expect(plan.upserts).toEqual([])
    expect(plan.deletes).toEqual([])
  })

  it('appends a new item after the last anchor', () => {
    const docs = [remoteDoc('a', 'a0'), remoteDoc('b', 'a1')]
    const local = [...remoteToLocalItems(docs), localItem('new')]
    const synced = syncedFromRemote(docs)

    const plan = buildTeamPushPlan(local, docs, synced)
    expect(plan.upserts.map((u) => u.itemId)).toEqual(['new'])
    expect(compareRanks('a1', plan.upserts[0].order)).toBeLessThan(0)
  })

  it('inserts a middle item between its neighbors', () => {
    const docs = [remoteDoc('a', 'a0'), remoteDoc('b', 'a1')]
    const local = [
      ...remoteToLocalItems([docs[0]]),
      localItem('mid'),
      ...remoteToLocalItems([docs[1]]).map((i) => ({ ...i, order: 2 })),
    ]
    const synced = syncedFromRemote(docs)

    const plan = buildTeamPushPlan(local, docs, synced)
    expect(plan.upserts.map((u) => u.itemId)).toEqual(['mid'])
    expect(compareRanks('a0', plan.upserts[0].order)).toBeLessThan(0)
    expect(compareRanks(plan.upserts[0].order, 'a1')).toBeLessThan(0)
  })

  it('reports locally removed items as deletes', () => {
    const docs = [remoteDoc('a', 'a0'), remoteDoc('b', 'a1')]
    const synced = syncedFromRemote(docs)
    const local = remoteToLocalItems([docs[0]])

    const plan = buildTeamPushPlan(local, docs, synced)
    expect(plan.upserts).toEqual([])
    expect(plan.deletes).toEqual(['b'])
  })

  it('re-ranks a moved item and keeps untouched items as anchors', () => {
    const docs = [remoteDoc('a', 'a0'), remoteDoc('b', 'a1'), remoteDoc('c', 'a2')]
    const synced = syncedFromRemote(docs)
    // Move 'c' to the front.
    const local = [
      ...remoteToLocalItems([docs[2]]),
      ...remoteToLocalItems([docs[0], docs[1]]).map((i) => ({ ...i, order: i.order + 1 })),
    ]

    const plan = buildTeamPushPlan(local, docs, synced)
    expect(plan.upserts.map((u) => u.itemId)).toEqual(['c'])
    expect(compareRanks(plan.upserts[0].order, 'a0')).toBeLessThan(0)
  })

  it('bumps the version for an edited item', () => {
    const docs = [remoteDoc('a', 'a0', { version: 3 })]
    const synced = syncedFromRemote(docs)
    const local = [{ ...remoteToLocalItems(docs)[0], text: 'edited' }]

    const plan = buildTeamPushPlan(local, docs, synced)
    expect(plan.upserts).toHaveLength(1)
    expect(plan.upserts[0].version).toBe(4)
    expect(plan.upserts[0].text).toBe('edited')
  })

  it('keeps final ranks strictly increasing across a shuffled reorder', () => {
    const docs = ['a', 'b', 'c', 'd', 'e'].map((id, i) =>
      remoteDoc(id, `a${i}`),
    )
    const synced = syncedFromRemote(docs)
    // Reverse the whole list: every item's anchor breaks at some point.
    const reversed = [...remoteToLocalItems(docs)].reverse().map((item, index) => ({
      ...item,
      order: index,
    }))

    const plan = buildTeamPushPlan(reversed, docs, synced)
    // Whatever subset gets re-ranked, the intended local order must be
    // reproducible: apply the plan's ranks onto a rank map and sort.
    const rankById = new Map(docs.map((doc) => [doc.itemId, doc.order]))
    for (const upsert of plan.upserts) {
      rankById.set(upsert.itemId, upsert.order)
    }
    const sortedIds = [...rankById.entries()]
      .sort(([, x], [, y]) => compareRanks(x, y))
      .map(([id]) => id)
    expect(sortedIds).toEqual(['e', 'd', 'c', 'b', 'a'])
  })
})

describe('MutationQueue', () => {
  it('runs enqueued mutations serially even when they fail', async () => {
    const order: string[] = []
    const queue = new MutationQueue()

    const first = queue.enqueue(async () => {
      order.push('first')
      throw new Error('boom')
    })
    const second = queue.enqueue(async () => {
      order.push('second')
      return 'ok'
    })

    await expect(first).rejects.toThrow('boom')
    await expect(second).resolves.toBe('ok')
    expect(order).toEqual(['first', 'second'])
  })
})

function ranksIsIncreasing(ranks: string[]): boolean {
  for (let i = 1; i < ranks.length; i++) {
    if (compareRanks(ranks[i - 1], ranks[i]) >= 0) {
      return false
    }
  }
  return true
}
