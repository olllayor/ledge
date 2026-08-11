import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The cloud-sync session token is a bearer credential accepted by every
 * public Convex function for up to a year. Storing it in the renderer's
 * `localStorage` (unencrypted LevelDB on disk) let any process running as
 * the same OS user lift it and impersonate the user remotely.
 *
 * This store keeps the token (and the associated email) in the main
 * process, encrypted at rest via Electron's `safeStorage` — which is
 * backed by the macOS Keychain. The renderer only ever sees the token
 * through a narrow IPC surface, and the on-disk blob is useless without
 * the OS keychain entry.
 *
 * If OS-level encryption is unavailable (should never happen on the
 * supported macOS targets), the store degrades to in-memory only: the
 * user re-authenticates each launch, but we never write the token to disk
 * in plaintext.
 */
export interface SyncSession {
  sessionToken: string
  email: string
}

const EMPTY_SESSION: SyncSession = { sessionToken: '', email: '' }

export class SecureSessionStore {
  private cache: SyncSession | null = null

  constructor(private readonly filePath: string = defaultSessionPath()) {}

  get(): SyncSession {
    if (this.cache) {
      return this.cache
    }
    this.cache = this.readFromDisk()
    return this.cache
  }

  set(session: SyncSession): void {
    this.cache = { sessionToken: session.sessionToken, email: session.email }
    if (!session.sessionToken) {
      this.clear()
      return
    }
    if (!safeStorage.isEncryptionAvailable()) {
      // No OS keychain — keep it in memory only, never plaintext on disk.
      return
    }
    try {
      const encrypted = safeStorage.encryptString(JSON.stringify(this.cache))
      writeFileSync(this.filePath, encrypted)
    } catch {
      // A failed write leaves the in-memory cache authoritative for this
      // session; the user simply re-signs-in next launch.
    }
  }

  clear(): void {
    this.cache = { ...EMPTY_SESSION }
    try {
      if (existsSync(this.filePath)) {
        rmSync(this.filePath)
      }
    } catch {
      // Best-effort: nothing actionable if the unlink fails.
    }
  }

  private readFromDisk(): SyncSession {
    if (!existsSync(this.filePath) || !safeStorage.isEncryptionAvailable()) {
      return { ...EMPTY_SESSION }
    }
    try {
      const decrypted = safeStorage.decryptString(readFileSync(this.filePath))
      const parsed = JSON.parse(decrypted) as Partial<SyncSession>
      return {
        sessionToken: typeof parsed.sessionToken === 'string' ? parsed.sessionToken : '',
        email: typeof parsed.email === 'string' ? parsed.email : '',
      }
    } catch {
      // Corrupt or undecryptable blob (e.g. keychain reset) — treat as
      // signed out rather than crashing.
      return { ...EMPTY_SESSION }
    }
  }
}

function defaultSessionPath(): string {
  return join(app.getPath('userData'), 'sync-session.enc')
}
