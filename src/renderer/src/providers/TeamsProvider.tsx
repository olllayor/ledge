import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../../../convex/_generated/api';
import { useSync } from './SyncProvider';

export interface TeamMemberRecord {
  _id: string;
  teamId: string;
  userId: string;
  role: 'admin' | 'member';
  joinedAt: number;
}

export interface TeamWithRole {
  _id: string;
  _creationTime: number;
  name: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  myRole: 'admin' | 'member';
}

interface TeamsContextValue {
  myTeams: TeamWithRole[];
  teamsLoading: boolean;
  activeTeamId: string | null;
  setActiveTeamId(teamId: string | null): void;
  createTeam(name: string): Promise<string>;
  updateTeam(teamId: string, name: string): Promise<string>;
  updateMemberRole(teamId: string, userId: string, role: 'admin' | 'member'): Promise<string>;
  removeMember(teamId: string, userId: string): Promise<void>;
  deleteTeam(teamId: string): Promise<void>;
  inviteMember(teamId: string, email: string, role: 'admin' | 'member'): Promise<string>;
  acceptInvitation(token: string): Promise<void>;
  rejectInvitation(token: string): Promise<void>;
  revokeInvitation(invitationId: string): Promise<void>;
  myPendingInvitations: Array<{
    _id: string;
    teamId: string;
    email: string;
    invitedBy: string;
    role: 'admin' | 'member';
    token: string;
    status: string;
    expiresAt: number;
    createdAt: number;
  }>;
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
  updateMemberRole: noop,
  removeMember: noopVoid,
  deleteTeam: noopVoid,
  inviteMember: noop,
  acceptInvitation: noopVoid,
  rejectInvitation: noopVoid,
  revokeInvitation: noopVoid,
  myPendingInvitations: [],
});

export function useTeams() {
  return useContext(TeamsContext);
}

export function TeamsProvider({ children }: { children: ReactNode }) {
  const { sessionToken } = useSync();

  const myTeamsData = useQuery(api.teams.listMyTeams, sessionToken ? { sessionToken } : 'skip') as
    | TeamWithRole[]
    | undefined;

  const userPendingInvites = useQuery(
    api.invitations.listPendingForEmail,
    sessionToken ? { sessionToken } : 'skip',
  ) as TeamsContextValue['myPendingInvitations'] | undefined;

  const createTeamMut = useMutation(api.teams.createTeam);
  const updateTeamMut = useMutation(api.teams.updateTeam);
  const updateMemberRoleMut = useMutation(api.teams.updateMemberRole);
  const removeMemberMut = useMutation(api.teams.removeMember);
  const deleteTeamMut = useMutation(api.teams.deleteTeam);
  const inviteMemberMut = useMutation(api.invitations.inviteMember);
  const acceptInvitationMut = useMutation(api.invitations.acceptInvitation);
  const rejectInvitationMut = useMutation(api.invitations.rejectInvitation);
  const revokeInvitationMut = useMutation(api.invitations.revokeInvitation);

  const [activeTeamId, setActiveTeamIdState] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionToken) {
      setActiveTeamIdState(null);
    }
  }, [sessionToken]);

  const setActiveTeamId = useCallback(
    async (teamId: string | null) => {
      setActiveTeamIdState(teamId);
      await window.ledge.setTeamState({ activeTeamId: teamId });
    },
    [],
  );

  const createTeam = useCallback(
    async (name: string) => createTeamMut({ sessionToken: sessionToken!, name }),
    [createTeamMut, sessionToken],
  );

  const updateTeam = useCallback(
    async (teamId: string, name: string) =>
      updateTeamMut({ sessionToken: sessionToken!, teamId: teamId as any, name }),
    [updateTeamMut, sessionToken],
  );

  const updateMemberRole = useCallback(
    async (teamId: string, userId: string, role: 'admin' | 'member') =>
      updateMemberRoleMut({ sessionToken: sessionToken!, teamId: teamId as any, userId: userId as any, role }),
    [updateMemberRoleMut, sessionToken],
  );

  const removeMember = useCallback(
    async (teamId: string, userId: string) => {
      await removeMemberMut({ sessionToken: sessionToken!, teamId: teamId as any, userId: userId as any });
    },
    [removeMemberMut, sessionToken],
  );

  const deleteTeam = useCallback(
    async (teamId: string) => {
      await deleteTeamMut({ sessionToken: sessionToken!, teamId: teamId as any });
    },
    [deleteTeamMut, sessionToken],
  );

  const inviteMember = useCallback(
    async (teamId: string, email: string, role: 'admin' | 'member') =>
      inviteMemberMut({ sessionToken: sessionToken!, teamId: teamId as any, email, role }),
    [inviteMemberMut, sessionToken],
  );

  const acceptInvitation = useCallback(
    async (token: string) => {
      await acceptInvitationMut({ sessionToken: sessionToken!, token });
    },
    [acceptInvitationMut, sessionToken],
  );

  const rejectInvitation = useCallback(
    async (token: string) => {
      await rejectInvitationMut({ sessionToken: sessionToken!, token });
    },
    [rejectInvitationMut, sessionToken],
  );

  const revokeInvitation = useCallback(
    async (invitationId: string) => {
      await revokeInvitationMut({ sessionToken: sessionToken!, invitationId: invitationId as any });
    },
    [revokeInvitationMut, sessionToken],
  );

  const value = useMemo(
    () => ({
      myTeams: (myTeamsData ?? []) as TeamWithRole[],
      teamsLoading: myTeamsData === undefined && !!sessionToken,
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
      myPendingInvitations: (userPendingInvites ?? []) as TeamsContextValue['myPendingInvitations'],
    }),
    [
      myTeamsData,
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
      userPendingInvites,
    ],
  );

  return <TeamsContext.Provider value={value}>{children}</TeamsContext.Provider>;
}
