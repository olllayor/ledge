import { useEffect, useState } from 'react';
import type { AppState } from '@shared/schema';
import { useSync } from '../../../providers/SyncProvider';
import { useTeams, type PendingInvitation, type TeamMemberRecord } from '../../../providers/TeamsProvider';
import { SettingsGroup, SettingsRow, Picker, type ShowToast } from '../primitives';

export function TeamSettings({ state, showToast }: { state: AppState; showToast: ShowToast }) {
  const sync = useSync();
  const isConfigured = sync.configured;

  if (!isConfigured) {
    return (
      <SettingsGroup>
        <div style={{ padding: '24px 16px', textAlign: 'center' }}>
          <p className="settings-row-title" style={{ marginBottom: 8 }}>Cloud Sync is not configured</p>
          <p className="settings-row-copy">Set <code>VITE_LEDGE_API_URL</code> to enable team features.</p>
        </div>
      </SettingsGroup>
    );
  }

  return <TeamSettingsConfiguredWrapper state={state} showToast={showToast} />;
}

function TeamSettingsConfiguredWrapper({ state, showToast }: { state: AppState; showToast: ShowToast }) {
  const sync = useSync();
  const teams = useTeams();
  return <TeamSettingsConfigured state={state} showToast={showToast} sync={sync} teams={teams} />;
}

interface TeamDetailState {
  team: { id: string; name: string; createdBy: string; createdAt: number; updatedAt: number };
  members: TeamMemberRecord[];
}

function TeamSettingsConfigured({
  state,
  showToast,
  sync,
  teams,
}: {
  state: AppState;
  showToast: ShowToast;
  sync: ReturnType<typeof useSync>;
  teams: ReturnType<typeof useTeams>;
}) {
  const isLoggedIn = !!state.sync.signedInEmail;

  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [teamDetail, setTeamDetail] = useState<TeamDetailState | null>(null);
  const [pendingInvites, setPendingInvites] = useState<PendingInvitation[]>([]);
  const [newTeamName, setNewTeamName] = useState('');
  const [editTeamName, setEditTeamName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'member' | 'admin'>('member');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [confirmingRemovalId, setConfirmingRemovalId] = useState<string | null>(null);

  useEffect(() => {
    if (selectedTeamId && !teams.myTeams.find((t) => t.id === selectedTeamId)) {
      setSelectedTeamId(null);
    }
  }, [teams.myTeams, selectedTeamId]);

  useEffect(() => {
    if (showDeleteConfirm && !teams.myTeams.find((t) => t.id === showDeleteConfirm)) {
      setShowDeleteConfirm(null);
    }
  }, [teams.myTeams, showDeleteConfirm]);

  // Pull team detail + pending invites when a team is selected.
  useEffect(() => {
    if (!selectedTeamId || !sync.sessionToken) {
      setTeamDetail(null);
      setPendingInvites([]);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const detail = await teams.getTeamDetail(selectedTeamId);
        if (cancelled) return;
        setTeamDetail(detail);
        const invites = await teams.listPendingForTeam(selectedTeamId);
        if (cancelled) return;
        setPendingInvites(invites);
      } catch (error) {
        if (!cancelled) {
          console.error('[team-settings] failed to load team detail', error);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [selectedTeamId, sync.sessionToken, teams]);

  useEffect(() => {
    if (
      confirmingRemovalId &&
      teamDetail &&
      !teamDetail.members.some((m) => m.userId === confirmingRemovalId)
    ) {
      setConfirmingRemovalId(null);
    }
  }, [teamDetail, confirmingRemovalId]);

  async function handleCreate() {
    // Same gate as the Create button's `disabled` — the Enter key path
    // bypasses the attribute, so without this a still-loading (or
    // erroring) teams query would fire a doomed mutation.
    if (!newTeamName.trim() || teams.teamsLoading) return;
    try {
      const teamId = await teams.createTeam(newTeamName.trim());
      setNewTeamName('');
      setSelectedTeamId(teamId);
      showToast('Team created');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to create team', 'error');
    }
  }

  async function handleUpdateName() {
    if (!editingId || !editTeamName.trim()) return;
    try {
      await teams.updateTeam(editingId, editTeamName.trim());
      setEditingId(null);
      showToast('Team renamed');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to rename team', 'error');
    }
  }

  async function handleInvite(teamId: string) {
    if (!inviteEmail.trim()) return;
    try {
      await teams.inviteMember(teamId, inviteEmail.trim(), inviteRole);
      setInviteEmail('');
      showToast('Invitation sent');
      const invites = await teams.listPendingForTeam(teamId);
      setPendingInvites(invites);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to send invitation', 'error');
    }
  }

  async function handleRemoveMember(teamId: string, userId: string) {
    try {
      await teams.removeMember(teamId, userId);
      setConfirmingRemovalId(null);
      showToast('Member removed');
      const detail = await teams.getTeamDetail(teamId);
      setTeamDetail(detail);
    } catch (err) {
      setConfirmingRemovalId(null);
      showToast(err instanceof Error ? err.message : 'Failed to remove member', 'error');
    }
  }

  async function handleDeleteTeam(teamId: string) {
    try {
      await teams.deleteTeam(teamId);
      setSelectedTeamId(null);
      setShowDeleteConfirm(null);
      showToast('Team deleted');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to delete team', 'error');
    }
  }

  if (!isLoggedIn) {
    return (
      <SettingsGroup>
        <div style={{ padding: '24px 16px', textAlign: 'center' }}>
          <p className="settings-row-title" style={{ marginBottom: 8 }}>Sign in to use teams</p>
          <p className="settings-row-copy">Cloud Sync must be connected before you can create teams.</p>
        </div>
      </SettingsGroup>
    );
  }

  const selectedTeam = teams.myTeams.find((t) => t.id === selectedTeamId);
  const isAdmin = selectedTeam?.myRole === 'admin';

  return (
    <>
      <SettingsGroup title="Teams">
        {teams.myTeams.length > 0 ? (
          <div className="team-pref-list">
            {teams.myTeams.map((t) => (
              <button
                key={t.id}
                className={`team-pref-item${t.id === selectedTeamId ? ' is-active' : ''}`}
                type="button"
                onClick={() => setSelectedTeamId(t.id)}
              >
                <span>{t.name}</span>
                <span className="team-pref-item-meta">{t.myRole}</span>
              </button>
            ))}
          </div>
        ) : (
          <SettingsRow
            title="No teams yet"
            copy="Create a team to start sharing shelves."
          />
        )}

        <div className="team-pref-create" style={{ marginTop: 10 }}>
          <input
            className="pref-input team-pref-create-input"
            type="text"
            value={newTeamName}
            onChange={(e) => setNewTeamName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleCreate(); }}
            placeholder="New team name"
          />
          <button
            className="settings-cta"
            type="button"
            disabled={!newTeamName.trim() || teams.teamsLoading}
            onClick={() => void handleCreate()}
          >
            Create
          </button>
        </div>
      </SettingsGroup>

      {selectedTeam && teamDetail && (
        <SettingsGroup title={selectedTeam.name}>
          {/* Team name */}
          {editingId === selectedTeam.id ? (
            <div className="team-pref-name-edit">
              <input
                className="pref-input"
                type="text"
                value={editTeamName}
                onChange={(e) => setEditTeamName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleUpdateName(); if (e.key === 'Escape') setEditingId(null); }}
                autoFocus
              />
              <button className="settings-cta-small" type="button" onClick={() => void handleUpdateName()}>
                Save
              </button>
              <button className="settings-link-btn" type="button" onClick={() => setEditingId(null)}>
                Cancel
              </button>
            </div>
          ) : (
            <SettingsRow
              title="Team name"
              copy={selectedTeam.name}
              trailing={
                isAdmin ? (
                  <button
                    className="settings-cta-small"
                    type="button"
                    onClick={() => { setEditTeamName(selectedTeam.name); setEditingId(selectedTeam.id); }}
                  >
                    Rename
                  </button>
                ) : undefined
              }
            />
          )}

          {/* Members */}
          <SettingsRow
            title={`Members (${teamDetail.members.length})`}
            fullWidth
          >
            <div className="settings-field" style={{ padding: '8px 0 4px' }}>
              {teamDetail.members.map((m) => (
                <div key={m.userId} className="team-member-row">
                  <span className="team-member-email">{m.email ?? m.userId}</span>
                  {isAdmin && m.userId !== teamDetail.team.createdBy ? (
                    <select
                      className="team-member-role-select"
                      value={m.role}
                      onChange={async (e) => {
                        try {
                          await teams.updateMemberRole(selectedTeam.id, m.userId, e.target.value as 'admin' | 'member');
                          showToast(`Role updated to ${e.target.value}`);
                          const detail = await teams.getTeamDetail(selectedTeam.id);
                          setTeamDetail(detail);
                        } catch (err) {
                          showToast(err instanceof Error ? err.message : 'Failed to update role', 'error');
                        }
                      }}
                    >
                      <option value="member">member</option>
                      <option value="admin">admin</option>
                    </select>
                  ) : (
                    <span className={`team-member-role-badge is-${m.role}`}>{m.role}</span>
                  )}
                  {isAdmin && m.userId !== teamDetail.team.createdBy && (
                    <button
                      className="settings-link-btn is-danger"
                      type="button"
                      aria-label={
                        confirmingRemovalId === m.userId
                          ? `Confirm removing ${m.email ?? m.userId}`
                          : `Remove ${m.email ?? m.userId}`
                      }
                      onClick={() => {
                        if (confirmingRemovalId === m.userId) {
                          void handleRemoveMember(selectedTeam.id, m.userId);
                        } else {
                          setConfirmingRemovalId(m.userId);
                        }
                      }}
                      onBlur={() => setConfirmingRemovalId((id) => (id === m.userId ? null : id))}
                    >
                      {confirmingRemovalId === m.userId ? 'Confirm' : 'Remove'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </SettingsRow>

          {/* Invite */}
          {isAdmin && (
            <SettingsRow
              title="Invite member"
              copy="Send an email invitation to join this team."
              fullWidth
            >
              <div className="settings-field" style={{ padding: '8px 0 4px' }}>
                <div className="team-pref-invite">
                  <input
                    className="pref-input"
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void handleInvite(selectedTeam.id); }}
                    placeholder="colleague@example.com"
                  />
                  <Picker value={inviteRole} onChange={(v) => setInviteRole(v as 'member' | 'admin')}>
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </Picker>
                  <button
                    className="settings-cta"
                    type="button"
                    disabled={!inviteEmail.trim()}
                    onClick={() => void handleInvite(selectedTeam.id)}
                  >
                    Invite
                  </button>
                </div>
              </div>
            </SettingsRow>
          )}

          {/* Pending invitations */}
          {isAdmin && pendingInvites.length > 0 && (
            <SettingsRow
              title={`Pending invitations (${pendingInvites.length})`}
              fullWidth
            >
              <div className="settings-field" style={{ padding: '8px 0 4px' }}>
                <div className="team-pref-pending-list">
                  {pendingInvites.map((inv) => (
                    <div key={inv.id} className="team-pref-pending-row">
                      <span className="team-pending-email">{inv.email}</span>
                      <span className={`team-member-role-badge is-${inv.role}`}>{inv.role}</span>
                      <button
                        className="settings-link-btn"
                        type="button"
                        onClick={async () => {
                          try {
                            await teams.revokeInvitation(selectedTeam.id, inv.id);
                            showToast('Invitation revoked');
                            setPendingInvites(await teams.listPendingForTeam(selectedTeam.id));
                          } catch (err) {
                            showToast(err instanceof Error ? err.message : 'Failed to revoke', 'error');
                          }
                        }}
                      >
                        Revoke
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </SettingsRow>
          )}

          {/* Danger zone */}
          {isAdmin && selectedTeam.id && (
            <SettingsGroup>
              <div className="settings-danger-zone">
                <SettingsRow
                  title="Delete team"
                  copy="Permanently delete this team and all its data."
                  trailing={
                    showDeleteConfirm === selectedTeam.id ? (
                      <button
                        className="settings-cta is-danger"
                        type="button"
                        onClick={() => void handleDeleteTeam(selectedTeam.id)}
                        onBlur={() => setShowDeleteConfirm(null)}
                      >
                        Confirm delete
                      </button>
                    ) : (
                      <button
                        className="settings-cta is-danger"
                        type="button"
                        onClick={() => setShowDeleteConfirm(selectedTeam.id)}
                        onBlur={() => setShowDeleteConfirm(null)}
                      >
                        Delete
                      </button>
                    )
                  }
                />
              </div>
            </SettingsGroup>
          )}
        </SettingsGroup>
      )}
    </>
  );
}
