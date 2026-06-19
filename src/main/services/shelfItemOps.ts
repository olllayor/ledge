import type { AppState } from '@shared/schema'
import type { StateStore } from './stateStore'

/**
 * Orchestrates the orchestrator-side effects of a shelf item
 * mutation: state-store write → broadcast → inactivity tick. Owns
 * the "every shelf IPC handler" boilerplate that the IPC registrar
 * used to repeat by hand, so adding a new shelf-mutating IPC
 * channel is a one-liner.
 *
 * Read-only operations (preview, reveal, copy) stay on
 * `ShelfActions`; this class is the read+write surface for the
 * live shelf and its items.
 */
export class ShelfItemOps {
  constructor(
    private readonly stateStore: StateStore,
    private readonly deps: {
      onInactivityTick(): void
      broadcastState(): AppState
    },
  ) {}

  /** Append items, then return the broadcast-ready state. */
  append(items: Parameters<StateStore['appendItems']>[0]): AppState {
    this.stateStore.appendItems(items)
    return this.flush()
  }

  /** Rename the live shelf, then return the broadcast-ready state. */
  rename(name: string): AppState {
    this.stateStore.renameLiveShelf(name)
    return this.flush()
  }

  /** Remove an item, then return the broadcast-ready state. */
  remove(itemId: string): AppState {
    this.stateStore.removeItem(itemId)
    return this.flush()
  }

  /** Empty the live shelf, then return the broadcast-ready state. */
  clear(): AppState {
    this.stateStore.clearLiveShelf()
    return this.flush()
  }

  /** Reorder the live shelf, then return the broadcast-ready state. */
  reorder(itemIds: string[]): AppState {
    this.stateStore.reorderItems(itemIds)
    return this.flush()
  }

  private flush(): AppState {
    this.deps.onInactivityTick()
    return this.deps.broadcastState()
  }
}
