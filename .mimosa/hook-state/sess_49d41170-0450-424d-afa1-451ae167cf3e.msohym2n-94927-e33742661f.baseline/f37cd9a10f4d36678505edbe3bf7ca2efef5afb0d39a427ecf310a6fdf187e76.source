import { preferencesRecordSchema, type PreferencePatch, type PreferencesRecord } from '@shared/schema'
import type { PersisterBinding, PersistedState } from './types'

/**
 * Read/write the user-facing `PreferencesRecord`. Pure CRUD over the
 * shared `PersistedState.preferences` slot; callers (e.g. the IPC
 * registrar) own the side effects of changing preferences (re-apply
 * the global shortcut, configure the gesture recognizer, etc.).
 */
export class PreferencesStore {
  constructor(
    private readonly persister: PersisterBinding,
    private readonly getState: () => PersistedState,
  ) {}

  get(): PreferencesRecord {
    return this.getState().preferences
  }

  set(patch: PreferencePatch): PreferencesRecord {
    const state = this.getState()
    state.preferences = preferencesRecordSchema.parse({
      ...state.preferences,
      ...patch
    })
    this.persister.save(state)
    return state.preferences
  }
}
