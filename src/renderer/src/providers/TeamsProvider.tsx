import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api, isAuthError, isNetworkError, type PendingInviteDto, type TeamDto } from '../lib/apiClient';
import { useSync } from './SyncProvider';
import { useLedgeState } from '../hooks/useLedgeState';

export type TeamMemberRecord = {
  userId: string;
  teamId: string;
  role: 'admin' | 'member';
  joinedAt: number;
  email?: string;
};

export type TeamWithRole = TeamDto;

export type PendingInvitation = PendingInviteDto;

interface TeamsContextValue {
  myTeams: TeamWithRole[];
  teamsLoading: boolean;
  activeTeamId: string | null;
  setActiveTeamId(teamId: string | null): void;
  createTeam(name: string): Promise<string>;
  updateTeam(teamId: string, name: string): Promise<string>;
  updateMemberRole(teamId: string, userId: string, role: 'admin' | 'member'): Promise<void>;
  removeMember(teamId: string, userId: string): Promise<void>;
  deleteTeam(teamId: string): Promise<void>;
  inviteMember(teamId: string, email: string, role: 'admin' | 'member'): Promise<string>;
  acceptInvitation(inviteId: string): Promise<void>;
  rejectInvitation(inviteId: string): Promise<void>;
  revokeInvitation(teamId: string, inviteId: string): Promise<void>;
  myPendingInvitations: PendingInvitation[];
  refreshTeams(): Promise<void>;
  getTeamDetail(teamId: string): Promise<{
    team: { id: string; name: string; createdBy: string; createdAt: number; updatedAt: number };
    members: TeamMemberRecord[];
  }>;
  listPendingForTeam(teamId: string): Promise<PendingInvitation[]>;
}

const noop = async () => '';
const noopVoid = async () => {};

const TeamsContext = createContext<TeamsContextValue>({
  myTeams: [],
  teamsLoading: true,
  activeTeamId: null,
  setActiveTeamId: () => {},
  createTeam: noop,
  updateTeam: noop,
  updateMemberRole: noopVoid,
  removeMember: noopVoid,
  deleteTeam: noopVoid,
  inviteMember: noop,
  acceptInvitation: noopVoid,
  rejectInvitation: noopVoid,
  revokeInvitation: noopVoid,
  myPendingInvitations: [],
  refreshTeams: noopVoid,
  getTeamDetail: async () => ({ team: { id: '', name: '', createdBy: '', createdAt: 0, updatedAt: 0 }, members: [] }),
  listPendingForTeam: async () => [],
});

export function useTeams() {
  return useContext(TeamsContext);
}

const TEAMS_POLL_MS = 30_000;

export function TeamsProvider({ children }: { children: ReactNode }) {
  const { sessionToken } = useSync();
  const [myTeams, setMyTeams] = useState<TeamWithRole[]>([]);
  const [teamsLoaded, setTeamsLoaded] = useState(false);
  const [myPendingInvitations, setMyPendingInvitations] = useState<PendingInvitation[]>([]);
  const refreshInFlightRef = useRef(false);

  // Single source of truth is the persisted main-process team state —
  // a local useState copy would reset to `null` on every app launch
  // while the main process (and its shelf scoping) restores the last
  // active team, desyncing the UI from what the shelf panel shows.
  const { state: persistedActiveTeamId } = useLedgeState(
    (s) => s.team?.activeTeamId ?? null,
  );
  const activeTeamId = persistedActiveTeamId ?? null;

  const refreshTeams = useCallback(async () => {
    if (!sessionToken || refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    try {
      const [teams, invites] = await Promise.all([
        api.client.listTeams(sessionToken),
        api.client.listPendingInvites(sessionToken),
      ]);
      setMyTeams(teams);
      setMyPendingInvitations(invites);
      setTeamsLoaded(true);
    } catch (error) {
      if (isAuthError(error)) {
        setMyTeams([]);
        setMyPendingInvitations([]);
        setTeamsLoaded(true);
        return;
      }
      if (isNetworkError(error)) {
        // Keep last-known teams while offline.
        return;
      }
      console.error('[teams] refresh failed', error);
    } finally {
      refreshInFlightRef.current = false;
    }
  }, [sessionToken]);

  useEffect(() => {
    if (!sessionToken) {
      setMyTeams([]);
      setMyPendingInvitations([]);
      setTeamsLoaded(false);
      return;
    }
    void refreshTeams();
    const timer = window.setInterval(() => {
      void refreshTeams();
    }, TEAMS_POLL_MS);
    const onFocus = () => {
      void refreshTeams();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [sessionToken, refreshTeams]);

  useEffect(() => {
    if (!sessionToken && activeTeamId !== null) {
      void window.ledge.setTeamState({ activeTeamId: null });
    }
  }, [sessionToken, activeTeamId]);

  // The persisted team can disappear (deleted, kicked, left from
  // another device). Fall back to personal instead of scoping shelves
  // to a team we're no longer in.
  useEffect(() => {
    if (!activeTeamId || !teamsLoaded) {
      return;
    }
    if (!myTeams.some((team) => team.id === activeTeamId)) {
      void window.ledge.setTeamState({ activeTeamId: null });
    }
  }, [activeTeamId, myTeams, teamsLoaded]);

  const setActiveTeamId = useCallback(
    async (teamId: string | null) => {
      await window.ledge.setTeamState({ activeTeamId: teamId });
    },
    [],
  );

  const createTeam = useCallback(
    async (name: string) => {
      const result = await api.client.createTeam(sessionToken, name);
      await refreshTeams();
      return result.id;
    },
    [sessionToken, refreshTeams],
  );

  const updateTeam = useCallback(
    async (teamId: string, name: string) => {
      await api.client.updateTeam(sessionToken, teamId, name);
      await refreshTeams();
      return teamId;
    },
    [sessionToken, refreshTeams],
  );

  const updateMemberRole = useCallback(
    async (teamId: string, userId: string, role: 'admin' | 'member') => {
      await api.client.updateMemberRole(sessionToken, teamId, userId, role);
    },
    [sessionToken],
  );

  const removeMember = useCallback(
    async (teamId: string, userId: string) => {
      await api.client.removeMember(sessionToken, teamId, userId);
    },
    [sessionToken],
  );

  const deleteTeam = useCallback(
    async (teamId: string) => {
      await api.client.deleteTeam(sessionToken, teamId);
      await refreshTeams();
    },
    [sessionToken, refreshTeams],
  );

  const inviteMember = useCallback(
    async (teamId: string, email: string, role: 'admin' | 'member') => {
      const result = await api.client.inviteMember(sessionToken, teamId, email, role);
      return result.id;
    },
    [sessionToken],
  );

  const acceptInvitation = useCallback(
    async (inviteId: string) => {
      await api.client.acceptInvite(sessionToken, inviteId);
      await refreshTeams();
    },
    [sessionToken, refreshTeams],
  );

  const rejectInvitation = useCallback(
    async (inviteId: string) => {
      await api.client.rejectInvite(sessionToken, inviteId);
      await refreshTeams();
    },
    [sessionToken, refreshTeams],
  );

  const revokeInvitation = useCallback(
    async (teamId: string, inviteId: string) => {
      await api.client.revokeInvite(sessionToken, teamId, inviteId);
    },
    [sessionToken],
  );

  const getTeamDetail = useCallback(
    async (teamId: string) => api.client.getTeam(sessionToken, teamId),
    [sessionToken],
  );

  const listPendingForTeam = useCallback(
    async (teamId: string) => api.client.listPendingInvitesForTeam(sessionToken, teamId),
    [sessionToken],
  );

  const value = useMemo(
    () => ({
      myTeams,
      teamsLoading: !teamsLoaded && !!sessionToken,
      activeTeamId,
      setActiveTeamId,
      createTeam,
      updateTeam,
      updateMemberRole,
      removeMember,
      deleteTeam,
      inviteMember,
      acceptInvitation,
      rejectInvitation,
      revokeInvitation,
      myPendingInvitations,
      refreshTeams,
      getTeamDetail,
      listPendingForTeam,
    }),
    [
      myTeams,
      teamsLoaded,
      sessionToken,
      activeTeamId,
      setActiveTeamId,
      createTeam,
      updateTeam,
      updateMemberRole,
      removeMember,
      deleteTeam,
      inviteMember,
      acceptInvitation,
      rejectInvitation,
      revokeInvitation,
      myPendingInvitations,
      refreshTeams,
      getTeamDetail,
      listPendingForTeam,
    ],
  );

  return <TeamsContext.Provider value={value}>{children}</TeamsContext.Provider>;
}
