import { describe, expect, it, vi } from 'vitest'
import { permissionStatusSchema } from '@shared/schema'
import {
  PreferencesSyncService,
  type LoginItemSettingsPort,
} from './preferencesSync'

// Hoisted mock: preferencesSync imports electron at module scope.
vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    setLoginItemSettings: vi.fn(),
    getLoginItemSettings: vi.fn(),
  },
  globalShortcut: { unregisterAll: vi.fn(), register: vi.fn(() => true) },
}))

const NATIVE_STATUS_ZEROS = {
  nativeHelperAvailable: false,
  accessibilityTrusted: false,
  shakeReady: false,
  lastError: '',
}

function buildService(port: LoginItemSettingsPort): PreferencesSyncService {
  const noop = () => {}
  const service = new PreferencesSyncService(
    undefined as never, // stateStore — untouched by currentPermissionStatus
    { getStatus: () => ({ ...NATIVE_STATUS_ZEROS }) } as never,
    undefined as never, // quickPasteWindow
    undefined as never, // peekWindow
    undefined as never, // clipboardMonitor
    async () => {},
    undefined, // notchDropoutWindow
    port,
  )
  void noop
  return service
}

describe('permissionStatusSchema login-item fields', () => {
  it('defaults the login-item fields to false for legacy payloads', () => {
    const parsed = permissionStatusSchema.parse({
      ...NATIVE_STATUS_ZEROS,
      shortcutRegistered: true,
      shortcutError: '',
    })
    expect(parsed.loginItemOpenAtLogin).toBe(false)
    expect(parsed.loginItemWasOpenedAtLogin).toBe(false)
    expect(parsed.loginItemWasOpenedAsHidden).toBe(false)
  })

  it('round-trips an approved hidden login item', () => {
    const parsed = permissionStatusSchema.parse({
      ...NATIVE_STATUS_ZEROS,
      shortcutRegistered: false,
      shortcutError: '',
      loginItemOpenAtLogin: true,
      loginItemWasOpenedAtLogin: true,
      loginItemWasOpenedAsHidden: true,
    })
    expect(parsed.loginItemOpenAtLogin).toBe(true)
    expect(parsed.loginItemWasOpenedAsHidden).toBe(true)
  })
})

describe('PreferencesSyncService login-item status', () => {
  it('mirrors the port snapshot into the permission status after refresh', () => {
    const service = buildService(() => ({
      openAtLogin: true,
      wasOpenedAtLogin: true,
      wasOpenedAsHidden: true,
    }))
    ;(
      service as unknown as { refreshLoginItemStatus(): void }
    ).refreshLoginItemStatus()
    const status = service.currentPermissionStatus()
    expect(status.loginItemOpenAtLogin).toBe(true)
    expect(status.loginItemWasOpenedAtLogin).toBe(true)
    expect(status.loginItemWasOpenedAsHidden).toBe(true)
  })

  it('falls back to zeros when the port throws', () => {
    const service = buildService(() => {
      throw new Error('denied')
    })
    ;(
      service as unknown as { refreshLoginItemStatus(): void }
    ).refreshLoginItemStatus()
    const status = service.currentPermissionStatus()
    expect(status.loginItemOpenAtLogin).toBe(false)
    expect(status.loginItemWasOpenedAtLogin).toBe(false)
    expect(status.loginItemWasOpenedAsHidden).toBe(false)
  })
})
