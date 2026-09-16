import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildStateFileLayout,
  PERSISTED_STATE_VERSION,
  StatePersister,
  defaultClipboardSettingsRecord,
  defaultPreferences,
  defaultSyncStateRecord,
} from './persister'
import type { PersistedState } from './types'

function makeDefaults(): PersistedState {
  return {
    liveShelf: null,
    teamLiveShelves: {},
    recentShelves: [],
    preferences: defaultPreferences(),
    sync: defaultSyncStateRecord(),
    team: { activeTeamId: null },
    clipboardHistory: [],
    clipboardCategories: [],
    clipboardSettings: defaultClipboardSettingsRecord(),
  }
}

function makeValidRecentShelf() {
  return {
    id: 'shelf-1',
    name: 'Kept',
    color: 'ember',
    origin: 'manual',
    items: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

describe('StatePersister migration salvage', () => {
  it('keeps healthy slices when one slice fails validation', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledge-persister-'))
    try {
      const layout = buildStateFileLayout(dir)
      // A v4 file whose clipboard slices hold shapes from some other era.
      const fileState = {
        version: PERSISTED_STATE_VERSION,
        liveShelf: null,
        recentShelves: [makeValidRecentShelf()],
        teamLiveShelves: {},
        preferences: {},
        sync: {},
        team: { activeTeamId: null },
        clipboardHistory: { bogus: true },
        clipboardCategories: 'nope',
        clipboardSettings: 42,
      }
      writeFileSync(layout.statePath, JSON.stringify(fileState), 'utf8')

      const defaults = makeDefaults()
      const result = new StatePersister({ statePath: layout.statePath }).load(defaults)

      // Healthy slices survive…
      expect(result.state.recentShelves).toHaveLength(1)
      expect(result.state.recentShelves[0]?.name).toBe('Kept')
      expect(result.state.preferences.hasCompletedOnboarding).toBe(false)
      expect(result.state.sync).toEqual(defaultSyncStateRecord())
      // …the drifted ones fall back instead of quarantining the file.
      expect(result.state.clipboardHistory).toEqual([])
      expect(result.state.clipboardCategories).toEqual([])
      expect(result.state.clipboardSettings).toEqual(defaultClipboardSettingsRecord())
      expect(result.didMigrate).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('migrates a v1 envelope without a sync slice', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledge-persister-'))
    try {
      const layout = buildStateFileLayout(dir)
      const fileState = {
        version: 1,
        liveShelf: null,
        recentShelves: [makeValidRecentShelf()],
        preferences: {},
        clipboardHistory: [],
        clipboardCategories: [],
        clipboardSettings: defaultClipboardSettingsRecord(),
      }
      writeFileSync(layout.statePath, JSON.stringify(fileState), 'utf8')

      const defaults = makeDefaults()
      const result = new StatePersister({ statePath: layout.statePath }).load(defaults)

      expect(result.state.recentShelves).toHaveLength(1)
      expect(result.state.sync).toEqual(defaultSyncStateRecord())
      expect(result.state.team.activeTeamId).toBeNull()
      expect(result.didMigrate).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
