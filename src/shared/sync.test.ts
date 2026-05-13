import { describe, expect, it } from 'vitest'
import { serializeShelfForCloud, syncDeviceLimitForPlan, syncShelfLimitForPlan } from './sync'
import type { ShelfRecord } from './schema'

describe('sync helpers', () => {
  it('keeps plan limits scoped to cloud sync', () => {
    expect(syncShelfLimitForPlan('free')).toBe(10)
    expect(syncDeviceLimitForPlan('free')).toBe(1)
    expect(syncShelfLimitForPlan('pro')).toBe(500)
    expect(syncDeviceLimitForPlan('pro')).toBe(3)
  })

  it('serializes shelves for cloud without native bookmark secrets', () => {
    const shelf: ShelfRecord = {
      id: 'shelf-1',
      name: 'Shelf',
      color: 'wave',
      createdAt: '2026-05-09T00:00:00.000Z',
      updatedAt: '2026-05-09T00:00:00.000Z',
      origin: 'manual',
      items: [
        {
          id: 'item-1',
          kind: 'file',
          createdAt: '2026-05-09T00:00:00.000Z',
          order: 0,
          title: 'project.pdf',
          subtitle: '',
          preview: { summary: 'PDF', detail: '' },
          mimeType: 'application/pdf',
          file: {
            originalPath: '/Users/me/Documents/project.pdf',
            resolvedPath: '/Users/me/Documents/project.pdf',
            bookmarkBase64: 'secret-bookmark',
            isMissing: false,
            isStale: false
          }
        }
      ]
    }

    const cloudShelf = serializeShelfForCloud(shelf)
    expect(JSON.stringify(cloudShelf)).not.toContain('secret-bookmark')
    expect(cloudShelf.items[0]).toMatchObject({
      file: {
        originalPath: '/Users/me/Documents/project.pdf',
        resolvedPath: '/Users/me/Documents/project.pdf',
        isMissing: false
      }
    })
  })
})
