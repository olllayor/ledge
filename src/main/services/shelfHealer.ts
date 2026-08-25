import { promises as fs } from 'node:fs'
import { healShelfItem, type HealFileRefDeps } from '@shared/fileUtils'
import type { ShelfItemRecord, ShelfRecord } from '@shared/schema'
import type { StateStore } from './stateStore'

export interface ShelfHealerDeps {
  stateStore: StateStore
  exists(path: string): Promise<boolean>
  resolveBookmark(
    bookmarkBase64: string,
    originalPath: string,
  ): Promise<{ resolvedPath: string; isStale: boolean; isMissing: boolean }>
}

/**
 * Startup healing pass (docs/vorssaint-shelf-plan.md Phase 1). Every
 * file-backed item on the personal live shelf gets one chance to come
 * back through its bookmark before the first broadcast; items under a
 * not-yet-mounted volume are deferred instead of flagged missing.
 *
 * Recents are NOT scanned here on purpose: they already refresh lazily
 * during `restoreShelf`, and scanning all of them would slow cold
 * launch with native bookmark calls. Team shelves are server-backed
 * and heal on interaction.
 *
 * Persists only when something actually healed so normal launches
 * never rewrite the store file.
 */
export class ShelfHealer {
  constructor(private readonly deps: ShelfHealerDeps) {}

  /** Returns true when any item was healed (and thus re-persisted). */
  async healPersonalLiveShelf(): Promise<boolean> {
    const shelf = this.deps.stateStore.getPersonalLiveShelf()
    if (!shelf) {
      return false
    }

    const deps = this.healDeps()
    let changed = false

    const items: ShelfItemRecord[] = []
    for (const item of shelf.items) {
      try {
        const result = await healShelfItem(item, deps)
        if (result.healed) changed = true
        items.push(result.item)
      } catch {
        // A single broken item must never abort the whole pass;
        // keep the unhealed item and move on.
        items.push(item)
      }
    }

    if (!changed) {
      return false
    }

    const healedShelf: ShelfRecord = { ...shelf, items }
    this.deps.stateStore.replacePersonalLiveShelf(healedShelf)
    return true
  }

  private healDeps(): HealFileRefDeps {
    return {
      exists: this.deps.exists,
      resolveBookmark: this.deps.resolveBookmark,
    }
  }
}

/** Production deps: real filesystem probes + native bookmark resolver. */
export function createNodeHealerDeps(
  resolveBookmark: ShelfHealerDeps['resolveBookmark'],
): Omit<ShelfHealerDeps, 'stateStore'> {
  return {
    exists: async (path) => {
      try {
        await fs.access(path)
        return true
      } catch {
        return false
      }
    },
    resolveBookmark,
  }
}
