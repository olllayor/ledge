import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let encryptionAvailable = true

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => tmpdir()) },
  safeStorage: {
    isEncryptionAvailable: () => encryptionAvailable,
    // Reversible fake "encryption": base64 payload behind an `enc:` tag so
    // the on-disk blob never contains the plaintext token, matching the
    // real API's opaque-ciphertext contract.
    encryptString: (value: string) => Buffer.from(`enc:${Buffer.from(value).toString('base64')}`),
    decryptString: (buf: Buffer) =>
      Buffer.from(buf.toString().replace(/^enc:/, ''), 'base64').toString(),
  },
}))

import { SecureSessionStore } from './secureSessionStore'

let dir: string
let filePath: string

beforeEach(() => {
  encryptionAvailable = true
  dir = mkdtempSync(join(tmpdir(), 'ledge-session-'))
  filePath = join(dir, 'sync-session.enc')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('SecureSessionStore', () => {
  it('returns an empty session when nothing is stored', () => {
    const store = new SecureSessionStore(filePath)
    expect(store.get()).toEqual({ sessionToken: '', email: '' })
  })

  it('persists and reloads a session across instances', () => {
    new SecureSessionStore(filePath).set({ sessionToken: 'tok-123', email: 'a@b.com' })
    const reloaded = new SecureSessionStore(filePath)
    expect(reloaded.get()).toEqual({ sessionToken: 'tok-123', email: 'a@b.com' })
  })

  it('never writes the raw token to disk (encrypted at rest)', () => {
    new SecureSessionStore(filePath).set({ sessionToken: 'super-secret', email: 'a@b.com' })
    const onDisk = readFileSync(filePath).toString()
    expect(onDisk).not.toContain('super-secret')
    expect(onDisk).toContain('enc:')
  })

  it('clear() removes the on-disk blob and empties the session', () => {
    const store = new SecureSessionStore(filePath)
    store.set({ sessionToken: 'tok', email: 'a@b.com' })
    expect(existsSync(filePath)).toBe(true)
    store.clear()
    expect(existsSync(filePath)).toBe(false)
    expect(store.get()).toEqual({ sessionToken: '', email: '' })
  })

  it('setting an empty token clears the stored session', () => {
    const store = new SecureSessionStore(filePath)
    store.set({ sessionToken: 'tok', email: 'a@b.com' })
    store.set({ sessionToken: '', email: '' })
    expect(existsSync(filePath)).toBe(false)
  })

  it('does not write plaintext to disk when OS encryption is unavailable', () => {
    encryptionAvailable = false
    const store = new SecureSessionStore(filePath)
    store.set({ sessionToken: 'tok', email: 'a@b.com' })
    // In-memory cache still serves the token this session...
    expect(store.get().sessionToken).toBe('tok')
    // ...but nothing is persisted in plaintext.
    expect(existsSync(filePath)).toBe(false)
  })
})
