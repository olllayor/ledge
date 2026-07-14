import { useEffect, useState } from 'react';
import { useQuery } from 'convex/react';
import { api } from '../../../../../../convex/_generated/api';
import type { Doc } from '../../../../../../convex/_generated/dataModel';
import type { AppState } from '@shared/schema';
import { useSync } from '../../../providers/SyncProvider';
import { useTeams } from '../../../providers/TeamsProvider';
import { SettingsGroup, SettingsRow, Picker, type ShowToast } from '../primitives';

export function TeamSettings({ state, showToast }: { state: AppState; showToast: ShowToast }) {
  const sync = useSync();
  const teams = useTeams();
  const isConfigured = sync.configured;
  const isLoggedIn = !!state.sync.signedInEmail;

  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [newTeamName, setNewTeamName] = useState('');
  const [editTeamName, setEditTeamName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'member' | 'admin'>('member');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);

  const sessionToken = sync.sessionToken;

  const teamDetail = useQuery(
    api.teams.getTeam,
    selectedTeamId && sessionToken ? { sessionToken, teamId: selectedTeamId as any } : 'skip',
  );

  const pendingInvites = useQuery(
    api.invitations.listPendingForTeam,
    selectedTeamId && sessionToken ? { sessionToken, teamId: selectedTeamId as any } : 'skip',
  );

  useEffect(() => {
    if (selectedTeamId && !teams.myTeams.find((t) => t._id === selectedTeamId)) {
      setSelectedTeamId(null);
    }
  }, [teams.myTeams, selectedTeamId]);

  useEffect(() => {
    if (showDeleteConfirm && !teams.myTeams.find((t) => t._id === showDeleteConfirm)) {
      setShowDeleteConfirm(null);
    }
  }, [teams.myTeams, showDeleteConfirm]);

  async function handleCreate() {
    if (!newTeamName.trim()) return;
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
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to send invitation', 'error');
    }
  }

  async function handleRemoveMember(teamId: string, userId: string) {
    try {
      await teams.removeMember(teamId, userId);
      showToast('Member removed');
    } catch (err) {
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

  if (!isConfigured) {
    return (
      <SettingsGroup>
        <div style={{ padding: '24px 16px', textAlign: 'center' }}>
          <p className="settings-row-title" style={{ marginBottom: 8 }}>Cloud Sync is not configured</p>
          <p className="settings-row-copy">Set <code>VITE_CONVEX_URL</code> to enable team features.</p>
        </div>
      </SettingsGroup>
    );
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

  const selectedTeam = teams.myTeams.find((t) => t._id === selectedTeamId);
  const isAdmin = selectedTeam?.myRole === 'admin';

  return (
    <>
      <SettingsGroup title="Teams">
        {teams.myTeams.length > 0 ? (
          <div className="team-pref-list">
            {teams.myTeams.map((t) => (
              <button
                key={t._id}
                className={`team-pref-item${t._id === selectedTeamId ? ' is-active' : ''}`}
                type="button"
                onClick={() => setSelectedTeamId(t._id)}
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
            trailing={<span />}
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
          {editingId === selectedTeam._id ? (
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
                    onClick={() => { setEditTeamName(selectedTeam.name); setEditingId(selectedTeam._id); }}
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
            trailing={<span />}
            fullWidth
          >
            <div className="settings-field" style={{ padding: '8px 0 4px' }}>
              {teamDetail.members.map((m: Doc<'teamMembers'>) => (
                <div key={m._id} className="team-member-row">
                  <span className="team-member-email">{m.userId}</span>
                  <span className={`team-member-role-badge is-${m.role}`}>{m.role}</span>
                  {isAdmin && m.userId !== teamDetail.team.createdBy && (
                    <button
                      className="settings-link-btn"
                      type="button"
                      onClick={() => { if (window.confirm('Remove this member?')) void handleRemoveMember(selectedTeam._id, m.userId); }}
                      style={{ color: 'var(--danger)', fontSize: '0.7rem' }}
                    >
                      Remove
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
              trailing={<span />}
              fullWidth
            >
              <div className="settings-field" style={{ padding: '8px 0 4px' }}>
                <div className="team-pref-invite">
                  <input
                    className="pref-input"
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void handleInvite(selectedTeam._id); }}
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
                    onClick={() => void handleInvite(selectedTeam._id)}
                  >
                    Invite
                  </button>
                </div>
              </div>
            </SettingsRow>
          )}

          {/* Pending invitations */}
          {isAdmin && pendingInvites && pendingInvites.length > 0 && (
            <SettingsRow
              title={`Pending invitations (${pendingInvites.length})`}
              trailing={<span />}
              fullWidth
            >
              <div className="settings-field" style={{ padding: '8px 0 4px' }}>
                <div className="team-pref-pending-list">
                  {pendingInvites.map((inv: Doc<'teamInvitations'>) => (
                    <div key={inv._id} className="team-pref-pending-row">
                      <span className="team-pending-email">{inv.email}</span>
                      <span className={`team-member-role-badge is-${inv.role}`}>{inv.role}</span>
                      <button
                        className="settings-link-btn"
                        type="button"
                        onClick={async () => {
                          try {
                            await teams.revokeInvitation(inv._id);
                            showToast('Invitation revoked');
                          } catch (err) {
                            showToast(err instanceof Error ? err.message : 'Failed to revoke', 'error');
                          }
                        }}
                        style={{ fontSize: '0.7rem' }}
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
          {isAdmin && selectedTeam._id && (
            <SettingsGroup>
              <div className="settings-danger-zone">
                <SettingsRow
                  title="Delete team"
                  copy="Permanently delete this team and all its data."
                  trailing={
                    showDeleteConfirm === selectedTeam._id ? (
                      <button
                        className="settings-cta is-danger"
                        type="button"
                        onClick={() => void handleDeleteTeam(selectedTeam._id)}
                      >
                        Confirm delete
                      </button>
                    ) : (
                      <button
                        className="settings-cta is-danger"
                        type="button"
                        onClick={() => setShowDeleteConfirm(selectedTeam._id)}
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
