import { teamStateSchema, type TeamState } from '@shared/schema'
import type { PersisterBinding, PersistedState } from './types'

export class TeamStore {
  constructor(
    private readonly persister: PersisterBinding,
    private readonly getState: () => PersistedState,
  ) {}

  get(): TeamState {
    return this.getState().team
  }

  set(patch: Partial<TeamState>): TeamState {
    const state = this.getState()
    state.team = teamStateSchema.parse({
      ...state.team,
      ...patch,
    })
    this.persister.save(state)
    return state.team
  }
}
