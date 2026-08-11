import { randomUUID } from 'node:crypto'
import { syncStateSchema, type SyncState, type SyncStatePatch } from '@shared/schema'
import type { PersisterBinding, PersistedState } from './types'

/**
 * Owns the cloud-sync `SyncState` slice. Side effects of a plan change
 * (recents cap, color availability) live with the
 * `ShelfStore.applyPlanLimits` path and are kicked off by the IPC
 * registrar's `setSyncState` handler.
 */
export class SyncStore {
  constructor(
    private readonly persister: PersisterBinding,
    private readonly getState: () => PersistedState,
  ) {}

  get(): SyncState {
    return this.getState().sync
  }

  set(patch: SyncStatePatch): SyncState {
    const state = this.getState()
    state.sync = syncStateSchema.parse({
      ...state.sync,
      ...patch
    })
    this.persister.save(state)
    return state.sync
  }

  /**
   * First-launch initialization: assign a deviceId the first time the
   * state file is read. Lives here (not in the persister) because
   * it's domain-shaped (sync, not file format).
   */
  ensureDeviceId(): void {
    const state = this.getState()
    if (!state.sync.deviceId) {
      state.sync = syncStateSchema.parse({
        ...state.sync,
        deviceId: randomUUID()
      })
      this.persister.save(state)
    }
  }
}
