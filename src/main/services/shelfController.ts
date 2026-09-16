import { clipboard, screen } from 'electron'
import { isFileBackedItem } from '@shared/fileUtils'
import { type IngestPayload, type ShelfItemRecord, type ShelfRecord } from '@shared/schema'
import { ImportedImageTooLargeError, detectPayloadFromText, payloadToItems, refreshFileRef } from './payloads'
import { ShelfCapacityError } from '@shared/shelfLimits'
import { broadcastToast } from './toastBroadcaster'
import type { StateStore } from './stateStore'
import type { NativeAgentClient, ShakeDetectedEvent } from '../native/nativeAgent'
import type { ShelfWindow } from '../windows/shelfWindow'
import { sanitizeRemoteFileRefs } from '../remoteShelf'

export interface ShelfControllerDeps {
  stateStore: StateStore
  nativeAgent: NativeAgentClient
  shelfWindow: ShelfWindow
  onStateChange(): void
  onInactivityTick(): void
}

export interface AddPayloadsOptions {
  origin?: ShelfRecord['origin']
  point?: { x: number; y: number }
  inactive?: boolean
}

/**
 * Drives the shelf lifecycle: create, ingest, restore, shake. The
 * `index.ts` orchestrator wires this up to the rest of the app
 * (windows, tray, IPC) — this controller is intentionally window-aware
 * (it positions and shows the shelf) but does not own any windows.
 */
export class ShelfController {
  private pinned = false

  constructor(private readonly deps: ShelfControllerDeps) {}

  /** Runtime-only pin (never persisted): opts the shelf out of auto-retract. */
  get isPinned(): boolean {
    return this.pinned
  }

  togglePinned(): boolean {
    this.pinned = !this.pinned
    // Re-evaluate arming so un-pinning restarts the retract countdown
    // and pinning clears it immediately.
    this.deps.onInactivityTick()
    return this.pinned
  }

  async createShelf(
    reason: ShelfRecord['origin'],
    point: { x: number; y: number },
    inactive: boolean,
  ): Promise<void> {
    const liveShelf = this.deps.stateStore.getLiveShelf()
    if (!liveShelf) {
      this.deps.stateStore.createShelf(reason)
      this.deps.shelfWindow.resetPosition()
    }

    const isShake = reason === 'shake'
    await this.deps.shelfWindow.showNear(
      point,
      inactive,
      isShake ? { width: 240, height: 296 } : undefined,
    )
    this.deps.onStateChange()
    this.deps.onInactivityTick()
  }

  async createShelfFromClipboard(): Promise<void> {
    const image = clipboard.readImage()
    if (!image.isEmpty()) {
      await this.addExternalPayloads(
        [
          {
            kind: 'image',
            mimeType: 'image/png',
            base64: image.toPNG().toString('base64'),
            filenameHint: 'clipboard-image',
          },
        ],
        'tray',
      )
      return
    }

    const text = clipboard.readText().trim()
    if (text) {
      await this.addExternalPayloads([detectPayloadFromText(text)], 'tray')
      return
    }

    await this.createShelf('tray', currentCursorPoint(), false)
  }

  async handleShakeDetected(event: ShakeDetectedEvent): Promise<void> {
    const preferences = this.deps.stateStore.getPreferences()
    if (!preferences.shakeEnabled) return

    if (event.sourceBundleId && preferences.excludedBundleIds.includes(event.sourceBundleId)) {
      return
    }

    // Electron already reports the cursor in the coordinate space used by
    // BrowserWindow. Using it here avoids AppKit-to-Electron translation
    // errors on multi-display setups.
    await this.createShelf('shake', currentCursorPoint(), true)
  }

  async addExternalPayloads(
    payloads: IngestPayload[],
    reason: ShelfRecord['origin'],
  ): Promise<void> {
    await this.addPayloadsToLiveShelf(payloads, {
      origin: reason,
      point: currentCursorPoint(),
      inactive: reason === 'tray',
    })
  }

  async addPayloadsToLiveShelf(
    payloads: IngestPayload[],
    options: AddPayloadsOptions = {},
  ): Promise<boolean> {
    const allItems: ShelfItemRecord[] = []
    let oversizedError: ImportedImageTooLargeError | null = null

    for (const payload of payloads) {
      try {
        const items = await payloadToItems(payload, {
          assetsDir: this.deps.stateStore.assetsDir,
          createBookmark: (path) => this.deps.nativeAgent.createBookmark(path),
          resolveBookmark: (bookmarkBase64, originalPath) =>
            this.deps.nativeAgent.resolveBookmark(bookmarkBase64, originalPath),
        })
        allItems.push(...items)
      } catch (error) {
        // Imported-image size cap is a user-facing failure, not an internal
        // bug. Remember the first one and continue so other payloads in the
        // same drop (e.g. text from a multi-item drag) still get ingested.
        if (error instanceof ImportedImageTooLargeError) {
          if (!oversizedError) oversizedError = error
          continue
        }
        throw error
      }
    }

    if (allItems.length === 0) {
      if (oversizedError) {
        broadcastToast(oversizedError.message, 'error')
      }
      return false
    }

    this.deps.stateStore.ensureLiveShelf(options.origin ?? 'manual')
    try {
      this.deps.stateStore.appendItems(allItems)
    } catch (error) {
      // Shelf-full is a user-facing limit, not an internal bug: surface
      // it and keep the shelf (and its window flow) intact.
      if (error instanceof ShelfCapacityError) {
        broadcastToast(error.message, 'error')
        return false
      }
      throw error
    }
    if (this.deps.shelfWindow.isVisible()) {
      await this.deps.shelfWindow.show(options.inactive ?? false)
    } else {
      await this.deps.shelfWindow.showNear(
        options.point ?? currentCursorPoint(),
        options.inactive ?? false,
      )
    }
    this.deps.onStateChange()
    this.deps.onInactivityTick()
    return true
  }

  async restoreShelf(id: string): Promise<boolean> {
    const shelf = this.deps.stateStore.restoreShelf(id)
    if (!shelf) {
      return false
    }

    // `restoreShelf` above already moved the shelf out of Recents, set it
    // live, and persisted to disk. A rejected bookmark resolution here
    // (native helper timeout/crash/bad response) must NOT abort the flow —
    // otherwise the shelf is committed off Recents but the window never
    // opens and the shelf vanishes. Degrade per-item to the un-refreshed
    // ref instead of throwing.
    const refreshedItems = await Promise.all(
      shelf.items.map(async (item) => {
        if (!isFileBackedItem(item)) {
          return item
        }

        try {
          return {
            ...item,
            file: await refreshFileRef(item.file, {
              resolveBookmark: (bookmarkBase64, originalPath) =>
                this.deps.nativeAgent.resolveBookmark(bookmarkBase64, originalPath),
            }),
          }
        } catch {
          return item
        }
      }),
    )

    // Re-read the live shelf before replacing: payloads added while the
    // bookmark refresh was in flight (drop onto the already-visible
    // window, tray drop) live in stateStore's live shelf, and writing
    // back the stale pre-await snapshot would silently drop them.
    const currentLive = this.deps.stateStore.getPersonalLiveShelf()
    const addedDuringRefresh = currentLive?.id === shelf.id ? currentLive.items : []
    const snapshotById = new Map(shelf.items.map((item) => [item.id, item]))
    const refreshedById = new Map(refreshedItems.map((item) => [item.id, item]))

    // Refreshed bookmark data wins for untouched items; locally-changed
    // items and brand-new additions keep their live versions.
    const mergedItems = refreshedItems.map((refreshed) => {
      const liveItem = addedDuringRefresh.find((candidate) => candidate.id === refreshed.id)
      const snapshotItem = snapshotById.get(refreshed.id)
      return liveItem && JSON.stringify(liveItem) !== JSON.stringify(snapshotItem)
        ? liveItem
        : refreshed
    })
    for (const liveItem of addedDuringRefresh) {
      if (!refreshedById.has(liveItem.id)) {
        mergedItems.push(liveItem)
      }
    }

    this.deps.stateStore.replaceLiveShelf({
      ...shelf,
      items: mergedItems,
    })

    this.deps.shelfWindow.resetPosition()
    await this.deps.shelfWindow.showNear(currentCursorPoint(), false)
    this.deps.onInactivityTick()
    return true
  }

  /**
   * Apply a remote shelf snapshot to local state. The caller is
   * responsible for the per-shelf `lastSyncedRemoteUpdatedAt` watermark
   * that protects against replayed snapshots — this method just
   * sanitizes and writes.
   */
  applyRemoteShelfSnapshot(remoteShelf: ShelfRecord): void {
    // Personal-slot routing only: whole-shelf cloud sync has no team
    // concept, so a team shelf being open must not redirect (or
    // clobber) remote personal shelves.
    //   1. Personal live shelf id matches remote (or there is no personal
    //      live shelf) -> the personal live shelf is the destination.
    //   2. A recent shelf id matches remote -> that recent entry is the
    //      destination.
    //   3. Neither (and a personal live shelf is open) -> insert the
    //      unknown remote into recents. Never no-op: a shelf created on
    //      another device must appear in Recents, not vanish.
    const sanitized = sanitizeRemoteFileRefs(remoteShelf)
    const liveShelf = this.deps.stateStore.getPersonalLiveShelf()
    const recentShelf =
      liveShelf?.id === remoteShelf.id
        ? null
        : this.deps.stateStore.getRecentShelves().find((s) => s.id === remoteShelf.id) ?? null
    const local = liveShelf?.id === remoteShelf.id ? liveShelf : recentShelf

    if (local === liveShelf || (!local && !liveShelf)) {
      // No personal live shelf, or its id matches the remote. In both
      // cases the personal live shelf is the destination — including the
      // first-contact case where the device has never seen this shelf.
      this.deps.stateStore.replacePersonalLiveShelf(sanitized)
    } else {
      // Existing recent (replace) or brand-new remote (insert into recents).
      this.deps.stateStore.upsertRecentShelf(sanitized)
    }
  }

  closeShelf(): void {
    this.deps.stateStore.closeShelf()
    this.deps.shelfWindow.resetPosition()
    this.deps.shelfWindow.hide()
    this.deps.onInactivityTick()
  }

  /**
   * Drop every local copy of a shelf that the cloud reports as deleted
   * (tombstoned on another device). If it is the shelf currently open,
   * closing it is part of honoring the deletion — the user deleted it
   * themselves on another device.
   */
  removeSyncedShelfLocally(shelfId: string): void {
    if (this.deps.stateStore.getPersonalLiveShelf()?.id === shelfId) {
      this.deps.stateStore.replaceLiveShelf(null)
      this.deps.shelfWindow.resetPosition()
      this.deps.shelfWindow.hide()
      this.deps.onInactivityTick()
    }
    this.deps.stateStore.removeRecentShelf(shelfId)
  }
}

export function currentCursorPoint() {
  return screen.getCursorScreenPoint()
}
