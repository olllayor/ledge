import { useState } from 'react';
import { useTeams } from '../providers/TeamsProvider';

export function InvitationBanner() {
  const { myPendingInvitations, acceptInvitation, rejectInvitation } = useTeams();
  const [loading, setLoading] = useState<string | null>(null);

  if (myPendingInvitations.length === 0) return null;

  async function handleAccept(inviteId: string) {
    setLoading(inviteId);
    try {
      await acceptInvitation(inviteId);
    } catch {
      // silently fail — user can retry
    } finally {
      setLoading(null);
    }
  }

  async function handleReject(inviteId: string) {
    setLoading(inviteId);
    try {
      await rejectInvitation(inviteId);
    } catch {
      // silently fail
    } finally {
      setLoading(null);
    }
  }

  const invite = myPendingInvitations[0];
  if (!invite) return null;

  const teamDisplayName = invite.teamName || `${invite.teamId.slice(0, 8)}…`;
  const remaining = myPendingInvitations.length - 1;

  return (
    <div className="invitation-banner">
      <div className="invitation-banner-text">
        <strong>{teamDisplayName}</strong> {remaining > 0 ? `(+${remaining} other${remaining > 1 ? 's' : ''})` : `• Invitation to join team`}
      </div>
      <div className="invitation-banner-actions">
        <button
          className="invitation-banner-action is-accept"
          type="button"
          disabled={loading !== null}
          onClick={() => void handleAccept(invite.id)}
        >
          {loading === invite.id ? 'Joining…' : 'Accept'}
        </button>
        <button
          className="invitation-banner-action is-reject"
          type="button"
          disabled={loading !== null}
          onClick={() => void handleReject(invite.id)}
        >
          Decline
        </button>
      </div>
    </div>
  );
}
