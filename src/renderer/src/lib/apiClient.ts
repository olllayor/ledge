import type { ShelfRecord, PreferencesRecord } from '@shared/schema';
import type { CloudShelfItem } from '@shared/sync';

/**
 * Typed fetch client for the Cloudflare Worker backend.
 *
 * The Worker origin comes from `VITE_LEDGE_API_URL`. Session tokens
 * live in the main-process Keychain and are passed into each call —
 * this module never stores them.
 */

export function getApiBaseUrl(): string {
  const raw = import.meta.env.VITE_LEDGE_API_URL;
  return typeof raw === 'string' ? raw.replace(/\/+$/, '') : '';
}

export function isCloudConfigured(): boolean {
  return getApiBaseUrl().length > 0;
}

/** HTTP error with the Worker's JSON `{ error: string }` body already unwrapped. */
export class LedgeApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'LedgeApiError';
    this.status = status;
  }
}

/** fetch() itself failed (offline, DNS, CORS, abort) — not an HTTP status. */
export class LedgeNetworkError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'LedgeNetworkError';
  }
}

export function isAuthError(error: unknown): boolean {
  return error instanceof LedgeApiError && (error.status === 401 || error.status === 403);
}

export function isNetworkError(error: unknown): boolean {
  return error instanceof LedgeNetworkError;
}

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface RequestOptions {
  method?: HttpMethod;
  token?: string;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
}

async function parseErrorMessage(response: Response): Promise<string> {
  const fallback = `Request failed (${response.status})`;
  try {
    const text = await response.text();
    if (!text) return fallback;
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && 'error' in parsed) {
        const message = (parsed as { error: unknown }).error;
        if (typeof message === 'string' && message.length > 0) {
          return message;
        }
      }
      if (typeof parsed === 'string' && parsed.length > 0) {
        return parsed;
      }
    } catch {
      if (text.length > 0 && text.length < 300) return text;
    }
  } catch {
    // body already consumed or unreadable
  }
  return fallback;
}

function buildUrl(baseUrl: string, path: string, query?: RequestOptions['query']): string {
  const url = new URL(path, `${baseUrl}/`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

export async function apiRequest<T>(
  baseUrl: string,
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  if (!baseUrl) {
    throw new LedgeNetworkError('Cloud API is not configured (VITE_LEDGE_API_URL is unset).');
  }

  const { method = 'GET', token, body, query } = options;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(buildUrl(baseUrl, path, query), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (cause) {
    throw new LedgeNetworkError('Could not reach the Ledge cloud service.', { cause });
  }

  if (!response.ok) {
    throw new LedgeApiError(await parseErrorMessage(response), response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  if (!text) {
    return undefined as T;
  }
  return JSON.parse(text) as T;
}

// ── Wire types (mirror docs/cf-migration.md REST contract) ──

export interface AuthMeResponse {
  userId: string;
  email: string;
  daysRemaining: number;
}

export interface AuthVerifyResponse {
  sessionToken: string;
  email: string;
  daysRemaining: number;
}

export interface SyncOverviewResponse {
  plan: 'free' | 'pro';
  deviceCount: number;
  deviceLimit: number;
  syncedShelfCount: number;
  shelfLimit: number;
  storageBytesUsed: number;
  storageBytesLimit: number;
}

export interface RemoteShelfDto {
  shelfId: string;
  name: string;
  color: ShelfRecord['color'];
  origin: ShelfRecord['origin'];
  items: CloudShelfItem[];
  localCreatedAt: string;
  localUpdatedAt: string;
  /** Server write time (ms). Used as the `since` cursor. */
  updatedAt: number;
  /** Set when the shelf was tombstoned (possibly on another device). */
  deletedAt?: number;
}

export interface UpsertShelfBody {
  shelfId: string;
  name: string;
  color: ShelfRecord['color'];
  origin: ShelfRecord['origin'];
  items: CloudShelfItem[];
  localCreatedAt: string;
  localUpdatedAt: string;
  imageStorageBytes: number;
}

export interface TeamDto {
  id: string;
  name: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  myRole: 'admin' | 'member';
}

export interface TeamMemberDto {
  userId: string;
  teamId: string;
  role: 'admin' | 'member';
  joinedAt: number;
  email?: string;
}

export interface TeamDetailDto {
  team: {
    id: string;
    name: string;
    createdBy: string;
    createdAt: number;
    updatedAt: number;
  };
  members: TeamMemberDto[];
}

export interface PendingInviteDto {
  id: string;
  teamId: string;
  teamName?: string;
  email: string;
  invitedBy: string;
  role: 'admin' | 'member';
  status: string;
  expiresAt: number;
  createdAt: number;
}

export interface TeamShelfItemsDto {
  items: Array<Record<string, unknown>>;
  truncated?: boolean;
}

export interface TeamItemUpsertBody {
  itemId: string;
  kind: string;
  title: string;
  subtitle: string;
  preview: { summary: string; detail: string };
  order: string;
  version: number;
  serverUpdatedAt: number;
  /** Local ISO timestamp; persisted in the item payload for pull. */
  createdAt?: string;
  file?: { originalPath: string; resolvedPath: string; isStale: boolean; isMissing: boolean };
  mimeType?: string;
  text?: string;
  url?: string;
  hex?: string;
  name?: string;
  language?: string;
  cloudStorageKey?: string;
  cloudStorageBytes?: number;
}

/** Thin wrapper bound to a base URL. Prefer the module-level `api` singleton. */
export class LedgeApiClient {
  constructor(private readonly baseUrl: string) {}

  private call<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return apiRequest<T>(this.baseUrl, path, options);
  }

  // ── Auth ──

  requestOtp(email: string): Promise<{ ok: true }> {
    return this.call('/auth/otp', { method: 'POST', body: { email } });
  }

  verifyOtp(email: string, code: string): Promise<AuthVerifyResponse> {
    return this.call('/auth/verify', { method: 'POST', body: { email, code } });
  }

  me(token: string): Promise<AuthMeResponse> {
    return this.call('/auth/me', { token });
  }

  refreshSession(token: string): Promise<{ ok: true }> {
    return this.call('/auth/refresh', { method: 'POST', token });
  }

  signOut(token: string): Promise<{ ok: true }> {
    return this.call('/auth/signout', { method: 'POST', token });
  }

  // ── Sync / personal ──

  overview(token: string): Promise<SyncOverviewResponse> {
    return this.call('/sync/overview', { token });
  }

  async listShelves(token: string, since?: number): Promise<RemoteShelfDto[]> {
    const result = await this.call<RemoteShelfDto[] | { shelves: RemoteShelfDto[] }>(
      '/sync/shelves',
      {
        token,
        query: since !== undefined && since > 0 ? { since } : undefined,
      },
    );
    return Array.isArray(result) ? result : (result.shelves ?? []);
  }

  registerDevice(
    token: string,
    input: { deviceId: string; name: string; platform: string },
  ): Promise<{ ok: true }> {
    return this.call('/sync/devices', { method: 'POST', token, body: input });
  }

  upsertShelf(token: string, body: UpsertShelfBody): Promise<{ ok: true }> {
    return this.call('/sync/shelves', { method: 'POST', token, body });
  }

  deleteShelf(token: string, shelfId: string): Promise<{ ok: true }> {
    return this.call(`/sync/shelves/${encodeURIComponent(shelfId)}`, {
      method: 'DELETE',
      token,
    });
  }

  putPreferences(token: string, values: PreferencesRecord): Promise<{ ok: true }> {
    return this.call('/sync/preferences', { method: 'PUT', token, body: { values } });
  }

  // ── Billing ──

  refreshEntitlements(
    token: string,
    input: { licenseKey?: string; orderId?: string },
  ): Promise<{ ok: true }> {
    return this.call('/billing/refresh', { method: 'POST', token, body: input });
  }

  // ── Teams ──

  async listTeams(token: string): Promise<TeamDto[]> {
    const result = await this.call<TeamDto[] | { teams: TeamDto[] }>('/teams', { token });
    return Array.isArray(result) ? result : (result.teams ?? []);
  }

  createTeam(token: string, name: string): Promise<{ id: string }> {
    return this.call('/teams', { method: 'POST', token, body: { name } });
  }

  getTeam(token: string, teamId: string): Promise<TeamDetailDto> {
    return this.call(`/teams/${encodeURIComponent(teamId)}`, { token });
  }

  updateTeam(token: string, teamId: string, name: string): Promise<{ ok: true }> {
    return this.call(`/teams/${encodeURIComponent(teamId)}`, {
      method: 'PATCH',
      token,
      body: { name },
    });
  }

  deleteTeam(token: string, teamId: string): Promise<{ ok: true }> {
    return this.call(`/teams/${encodeURIComponent(teamId)}`, { method: 'DELETE', token });
  }

  updateMemberRole(
    token: string,
    teamId: string,
    userId: string,
    role: 'admin' | 'member',
  ): Promise<{ ok: true }> {
    return this.call(
      `/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}`,
      { method: 'POST', token, body: { role } },
    );
  }

  removeMember(token: string, teamId: string, userId: string): Promise<{ ok: true }> {
    return this.call(
      `/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}`,
      { method: 'DELETE', token },
    );
  }

  inviteMember(
    token: string,
    teamId: string,
    email: string,
    role: 'admin' | 'member',
  ): Promise<{ id: string }> {
    return this.call(`/teams/${encodeURIComponent(teamId)}/invites`, {
      method: 'POST',
      token,
      body: { email, role },
    });
  }

  async listPendingInvites(token: string): Promise<PendingInviteDto[]> {
    const result = await this.call<PendingInviteDto[] | { invitations: PendingInviteDto[] }>(
      '/invites/pending',
      { token },
    );
    return Array.isArray(result) ? result : (result.invitations ?? []);
  }

  async listPendingInvitesForTeam(token: string, teamId: string): Promise<PendingInviteDto[]> {
    const result = await this.call<PendingInviteDto[] | { invitations: PendingInviteDto[] }>(
      `/teams/${encodeURIComponent(teamId)}/invites`,
      { token },
    );
    return Array.isArray(result) ? result : (result.invitations ?? []);
  }

  acceptInvite(token: string, inviteId: string): Promise<{ ok: true }> {
    return this.call(`/invites/${encodeURIComponent(inviteId)}/accept`, {
      method: 'POST',
      token,
    });
  }

  rejectInvite(token: string, inviteId: string): Promise<{ ok: true }> {
    return this.call(`/invites/${encodeURIComponent(inviteId)}/reject`, {
      method: 'POST',
      token,
    });
  }

  revokeInvite(token: string, teamId: string, inviteId: string): Promise<{ ok: true }> {
    return this.call(
      `/teams/${encodeURIComponent(teamId)}/invites/${encodeURIComponent(inviteId)}`,
      { method: 'DELETE', token },
    );
  }

  // ── Team shelf items ──

  async listTeamShelfItems(
    token: string,
    teamId: string,
    shelfId: string,
  ): Promise<TeamShelfItemsDto> {
    const result = await this.call<TeamShelfItemsDto | Array<Record<string, unknown>>>(
      `/teams/${encodeURIComponent(teamId)}/shelf/items`,
      { token, query: { shelfId } },
    );
    if (Array.isArray(result)) {
      return { items: result, truncated: false };
    }
    return { items: result.items ?? [], truncated: result.truncated ?? false };
  }

  upsertTeamShelfItem(
    token: string,
    teamId: string,
    body: TeamItemUpsertBody,
  ): Promise<{ ok: true }> {
    return this.call(`/teams/${encodeURIComponent(teamId)}/shelf/items`, {
      method: 'POST',
      token,
      body,
    });
  }

  deleteTeamShelfItem(
    token: string,
    teamId: string,
    itemId: string,
    body: { version: number; serverUpdatedAt: number },
  ): Promise<{ ok: true }> {
    return this.call(
      `/teams/${encodeURIComponent(teamId)}/shelf/items/${encodeURIComponent(itemId)}`,
      { method: 'DELETE', token, body },
    );
  }
}

/** Process-wide client. Rebuilds against the current env base URL on each call. */
export const api = {
  get client(): LedgeApiClient {
    return new LedgeApiClient(getApiBaseUrl());
  },
};
