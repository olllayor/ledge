# Background Running on macOS — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Ledge a well-behaved always-on macOS menu-bar citizen: single-instance enforcement with resurface, silent launch-at-login with honest OS-status display, background health (no throttling of panels, wake re-assertion).

**Architecture:** A new `singleInstance.ts` service owns the marker-file protocol; `PreferencesSyncService` gains login-item read-back via an injectable seam; three new fields ride the existing `permissionStatusSchema` into Settings; small additive changes to windows (`backgroundThrottling`) and `index.ts` (`window-all-closed`, `powerMonitor`).

**Tech Stack:** Electron 41 main process, vitest (node env, real temp dirs), zod schemas, React settings UI.

**Spec:** `docs/superpowers/specs/2026-08-11-macos-background-running-design.md`

## Global Constraints

- TypeScript strict — no `any`, no unused locals/params; `pnpm lint` must stay green.
- Zod validates all IPC/state payloads; new fields use `.default(...)` so old state parses.
- IPC channels stay exactly as defined in `src/shared/ipc.ts` — this plan adds **zero** new channels (status rides `permissionStatusSchema`).
- Node built-ins import with the `node:` prefix.
- Verify per task: `pnpm vitest run <file>` green; final: `pnpm lint && pnpm test && pnpm build`.
- Conventional Commits for every task commit.
- macOS-only behavior; guard Electron-API calls that don't exist on other platforms where the codebase already does so (`app.dock`, login items are cross-platform safe but read-back is packaged-only per existing convention in `preferencesSync.ts:52`).

---

### Task 1: Single-instance lock + marker-file resurface

**Files:**
- Create: `src/main/services/singleInstance.ts`
- Test: `src/main/services/singleInstance.test.ts`
- Modify: `src/main/index.ts` (top-of-module + inside `whenReady`)

**Interfaces:**
- Produces:
  - `SECOND_INSTANCE_MARKER_FILENAME` — `'.second-instance-signal'`
  - `writeSecondInstanceMarker(userDataDir: string): void`
  - `watchSecondInstanceMarker(userDataDir: string, onSignal: () => void): () => void` — returns an unsubscribe fn
  - `startSingleInstanceWatch(opts: { userDataDir: string; onSignal: () => void }): (() => void) | null` — composition used by `index.ts`; logs and returns `null` when `fs.watch` throws
- Consumes: none from other tasks.

- [ ] **Step 1: Write the failing test**

```ts
// src/main/services/singleInstance.test.ts
import { mkdtemp, rm, access, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SECOND_INSTANCE_MARKER_FILENAME,
  cleanupStaleMarker,
  startSingleInstanceWatch,
  writeSecondInstanceMarker,
} from './singleInstance'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((path) =>
      rm(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 }),
    ),
  )
})

describe('singleInstance', () => {
  it('writes the marker via tmp+rename without leaving the tmp sibling', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ledge-single-instance-'))
    tempDirs.push(dir)

    writeSecondInstanceMarker(dir)

    await access(join(dir, SECOND_INSTANCE_MARKER_FILENAME))
    await expect(
      access(join(dir, `${SECOND_INSTANCE_MARKER_FILENAME}.tmp`)),
    ).rejects.toThrow()
  })

  it('removes a stale marker without throwing when absent', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ledge-single-instance-'))
    tempDirs.push(dir)

    expect(cleanupStaleMarker(dir)).toBe(false)
    await writeFile(join(dir, SECOND_INSTANCE_MARKER_FILENAME), 'stale')
    expect(cleanupStaleMarker(dir)).toBe(true)
    await expect(
      access(join(dir, SECOND_INSTANCE_MARKER_FILENAME)),
    ).rejects.toThrow()
  })

  it('invokes onSignal when the marker appears and stops after unsubscribe', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ledge-single-instance-'))
    tempDirs.push(dir)
    const onSignal = vi.fn()

    const unsubscribe = startSingleInstanceWatch({ userDataDir: dir, onSignal })
    expect(unsubscribe).toBeTypeOf('function')

    writeSecondInstanceMarker(dir)

    await vi.waitFor(() => {
      expect(onSignal).toHaveBeenCalledTimes(1)
    })

    await delay(50)
    await expect(
      access(join(dir, SECOND_INSTANCE_MARKER_FILENAME)),
    ).rejects.toThrow()

    unsubscribe!()
  })

  it('returns null rather than throwing when the directory cannot be watched', () => {
    const unsubscribe = startSingleInstanceWatch({
      userDataDir: join(tmpdir(), 'ledge-does-not-exist-anywhere'),
      onSignal: () => {},
    })
    expect(unsubscribe).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/main/services/singleInstance.test.ts`
Expected: FAIL — `Cannot find module './singleInstance'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/main/services/singleInstance.ts
import { watch, type FSWatcher } from 'node:fs'
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  writeSync,
} from 'node:fs'
import { join } from 'node:path'

export const SECOND_INSTANCE_MARKER_FILENAME = '.second-instance-signal'

function markerPath(userDataDir: string): string {
  return join(userDataDir, SECOND_INSTANCE_MARKER_FILENAME)
}

/**
 * Called by the losing instance before it quits. The marker is written
 * via tmp+rename (same atomicity convention as StatePersister) so the
 * primary's watcher never observes a half-written file. Best-effort: if
 * the write fails the OS-level single-instance lock still prevents a
 * duplicate process, only the resurface signal is lost.
 */
export function writeSecondInstanceMarker(userDataDir: string): void {
  try {
    mkdirSync(userDataDir, { recursive: true })
    const tmp = `${markerPath(userDataDir)}.tmp-${process.pid}`
    const fd = openSync(tmp, 'w')
    try {
      writeSync(fd, new Date().toISOString())
    } finally {
      closeSync(fd)
    }
    renameSync(tmp, markerPath(userDataDir))
  } catch (error) {
    console.warn('[ledge] second-instance marker write failed:', error)
  }
}

/**
 * Runs at primary startup before the watcher attaches so a marker left
 * behind by a crashed secondary is never misread as a fresh launch.
 * Returns whether a marker was removed.
 */
export function cleanupStaleMarker(userDataDir: string): boolean {
  try {
    if (!existsSync(markerPath(userDataDir))) {
      return false
    }
    rmSync(markerPath(userDataDir), { force: true })
    return true
  } catch (error) {
    console.warn('[ledge] second-instance stale marker cleanup failed:', error)
    return false
  }
}

export function startSingleInstanceWatch(opts: {
  userDataDir: string
  onSignal: () => void
}): (() => void) | null {
  const { userDataDir, onSignal } = opts
  cleanupStaleMarker(userDataDir)

  let watcher: FSWatcher
  try {
    watcher = watch(userDataDir, { persistent: false }, (_event, filename) => {
      if (filename !== SECOND_INSTANCE_MARKER_FILENAME) {
        return
      }
      // Debounce: rename can emit twice after login bursts.
      rmSync(markerPath(userDataDir), { force: true })
      onSignal()
    })
  } catch (error) {
    console.warn('[ledge] second-instance watch unavailable:', error)
    return null
  }
  watcher.on('error', (error) => {
    console.warn('[ledge] second-instance watch error:', error)
  })
  return () => watcher.close()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/main/services/singleInstance.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Wire into index.ts**

At the top of `src/main/index.ts`, immediately after the imports (before `process.on('unhandledRejection')`):

```ts
// Menu-bar utility: exactly one instance ever runs. The loser writes a
// resurface signal for the primary and quits before touching state,
// windows, or global shortcuts. `app.quit()` here is safe — no
// shortcuts are registered yet, so nothing is unregistered.
if (!app.requestSingleInstanceLock()) {
  writeSecondInstanceMarker(app.getPath('userData'))
  app.quit()
}
```

Add the import:

```ts
import {
  writeSecondInstanceMarker,
  startSingleInstanceWatch,
} from './services/singleInstance'
```

Inside `app.whenReady().then(async () => {`, right after `ipcRegistrar.registerAll()` (line ~350):

```ts
  startSingleInstanceWatch({
    userDataDir: app.getPath('userData'),
    onSignal: () => {
      // A second launch means the user reached for Ledge while it was
      // already running. Mid-work (a live shelf exists) we stay out of
      // the way; otherwise surface Settings, mirroring `activate`.
      if (stateStore.getLiveShelf()) {
        console.log('[ledge] second instance launch ignored (live shelf)')
        return
      }
      void preferencesWindow.show()
    },
  })
```

Also add the explicit never-quit handler near the `activate` handler (~line 387):

```ts
app.on('window-all-closed', () => {
  // Menu-bar utility: closing every window must never quit the app.
  // Tray Quit (and Cmd+Q) are the only exits.
})
```

- [ ] **Step 6: Lint + full unit tests**

Run: `pnpm lint && pnpm vitest run src/main`
Expected: no type errors; all main-process tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/main/services/singleInstance.ts src/main/services/singleInstance.test.ts src/main/index.ts
git commit -m "feat: single-instance lock with marker-file resurface"
```

---

### Task 2: Login-item read-back, schema fields, `openAsHidden`

**Files:**
- Modify: `src/shared/schema.ts:107-114` (`permissionStatusSchema`)
- Modify: `src/main/services/preferencesSync.ts:19-78`
- Test: `src/main/services/preferencesSync.test.ts` (new colocated file)

**Interfaces:**
- Produces:
  - `permissionStatusSchema` gains: `loginItemOpenAtLogin`, `loginItemWasOpenedAtLogin`, `loginItemWasOpenedAsHidden` — all `z.boolean().default(false)`.
  - `PreferencesSyncService` constructor gains optional 8th param: `loginItemSettings?: LoginItemSettingsPort` (after `notchDropoutWindow?`).
  - `type LoginItemSettingsPort = { get(): { openAtLogin: boolean; wasOpenedAtLogin: boolean; wasOpenedAsHidden: boolean } }`
- Consumes: nothing from Task 1.

- [ ] **Step 1: Write the failing tests**

```ts
// src/main/services/preferencesSync.test.ts
import { describe, expect, it } from 'vitest'
import { permissionStatusSchema } from '@shared/schema'

describe('permissionStatusSchema login-item fields', () => {
  it('defaults the login-item fields to false for legacy payloads', () => {
    const parsed = permissionStatusSchema.parse({
      nativeHelperAvailable: true,
      accessibilityTrusted: false,
      shakeReady: false,
      lastError: '',
      shortcutRegistered: true,
      shortcutError: '',
    })
    expect(parsed.loginItemOpenAtLogin).toBe(false)
    expect(parsed.loginItemWasOpenedAtLogin).toBe(false)
    expect(parsed.loginItemWasOpenedAsHidden).toBe(false)
  })

  it('round-trips an approved hidden login item', () => {
    const parsed = permissionStatusSchema.parse({
      nativeHelperAvailable: false,
      accessibilityTrusted: false,
      shakeReady: false,
      lastError: '',
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
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/main/services/preferencesSync.test.ts`
Expected: FAIL — `loginItemOpenAtLogin` is `undefined` (fields stripped by zod .parse without the schema knowing them... actually zod strips unknown keys; the assertion `toBe(false)` fails because value is `undefined`).

- [ ] **Step 3: Add schema fields**

In `src/shared/schema.ts`, extend `permissionStatusSchema`:

```ts
export const permissionStatusSchema = z.object({
  nativeHelperAvailable: z.boolean().default(false),
  accessibilityTrusted: z.boolean().default(false),
  shakeReady: z.boolean().default(false),
  lastError: z.string().default(''),
  shortcutRegistered: z.boolean().default(false),
  shortcutError: z.string().default(''),
  // OS-owned login-item truth, mirrored for the Settings UI. Always
  // false in dev builds (read-back is packaged-only, matching sync()).
  loginItemOpenAtLogin: z.boolean().default(false),
  loginItemWasOpenedAtLogin: z.boolean().default(false),
  loginItemWasOpenedAsHidden: z.boolean().default(false),
});
```

- [ ] **Step 4: Run schema tests to verify pass**

Run: `pnpm vitest run src/main/services/preferencesSync.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Read-back in PreferencesSyncService**

In `src/main/services/preferencesSync.ts`, after the imports add:

```ts
export interface LoginItemSettingsSnapshot {
  openAtLogin: boolean
  wasOpenedAtLogin: boolean
  wasOpenedAsHidden: boolean
}

/** Injectable seam so tests can simulate approved/hidden matrices. */
export type LoginItemSettingsPort = () => LoginItemSettingsSnapshot

const DEV_DEFAULTS: LoginItemSettingsSnapshot = {
  openAtLogin: false,
  wasOpenedAtLogin: false,
  wasOpenedAsHidden: false,
}
```

Add the field and constructor param:

```ts
  private loginItemStatus: LoginItemSettingsSnapshot = { ...DEV_DEFAULTS }

  constructor(
    /* …existing params unchanged… */
    private readonly notchDropoutWindow?: NotchDropoutWindow,
    private readonly getLoginItemSettings: LoginItemSettingsPort = () =>
      app.isPackaged ? app.getLoginItemSettings() : { ...DEV_DEFAULTS },
  ) {}
```

In `sync()`, replace the `setLoginItemSettings` block with:

```ts
    if (app.isPackaged) {
      try {
        app.setLoginItemSettings({
          openAtLogin: preferences.launchAtLogin,
          // Menu-bar utility: starting at login must never surface a
          // window or steal focus — tray icon only.
          openAsHidden: true,
        })
      } catch {
        // Some macOS environments can still reject login-item writes.
      }
    }
    this.refreshLoginItemStatus()
```

Add two methods to the class:

```ts
  /** Current OS-side login-item truth (zeros in dev builds). */
  currentLoginItemStatus(): LoginItemSettingsSnapshot {
    return { ...this.loginItemStatus }
  }

  private refreshLoginItemStatus(): void {
    try {
      this.loginItemStatus = this.getLoginItemSettings()
    } catch (error) {
      console.warn('[ledge] login-item status read-back failed:', error)
      this.loginItemStatus = { ...DEV_DEFAULTS }
    }
  }
```

And in `currentPermissionStatus()`:

```ts
  currentPermissionStatus(): PermissionStatus {
    return permissionStatusSchema.parse({
      ...this.nativeAgent.getStatus(),
      ...this.status,
      ...this.loginItemStatusKeysForSchema(),
    })
  }

  private loginItemStatusKeysForSchema() {
    return {
      loginItemOpenAtLogin: this.loginItemStatus.openAtLogin,
      loginItemWasOpenedAtLogin: this.loginItemStatus.wasOpenedAtLogin,
      loginItemWasOpenedAsHidden: this.loginItemStatus.wasOpenedAsHidden,
    }
  }
```

(`index.ts` call-site needs no change — the 8th ctor param is optional.)

- [ ] **Step 6: Unit-test the service read-back**

Append to `src/main/services/preferencesSync.test.ts`:

```ts
import { LoginItemSettingsPort, PreferencesSyncService } from './preferencesSync'
```
```ts
// Hoisted mock: preferencesSync imports electron at module scope.
vi.mock('electron', () => ({
  app: { isPackaged: true, setLoginItemSettings: vi.fn(), getLoginItemSettings: vi.fn() },
  globalShortcut: { unregisterAll: vi.fn(), register: vi.fn(() => true) },
}))

function buildService(port: LoginItemSettingsPort) {
  const noop: never = (() => {}) as never
  return new PreferencesSyncService(
    noop, noop, noop, noop, noop, // stateStore, nativeAgent, quickPaste, peek, clipboardMonitor
    async () => {},               // onCreateShelfFromShortcut
    undefined,                    // notchDropoutWindow
    port,
  )
}

describe('PreferencesSyncService login-item status', () => {
  it('mirrors the port snapshot into the permission status', () => {
    const service = buildService(() => ({
      openAtLogin: true,
      wasOpenedAtLogin: true,
      wasOpenedAsHidden: true,
    }))
    ;(service as never as { stateStore: { getPreferences(): unknown } })
    // stateStore is only read by sync(); currentPermissionStatus needs nativeAgent:
    Object.defineProperty(service as object, 'nativeAgent', {
      value: { getStatus: () => ({ nativeHelperAvailable: false, accessibilityTrusted: false, shakeReady: false, lastError: '' }) },
    })
    ;(service as unknown as { refreshLoginItemStatus(): void }).refreshLoginItemStatus()
    const status = service.currentPermissionStatus()
    expect(status.loginItemOpenAtLogin).toBe(true)
    expect(status.loginItemWasOpenedAsHidden).toBe(true)
  })

  it('falls back to zeros when the port throws', () => {
    const service = buildService(() => { throw new Error('denied') })
    Object.defineProperty(service as object, 'nativeAgent', {
      value: { getStatus: () => ({ nativeHelperAvailable: false, accessibilityTrusted: false, shakeReady: false, lastError: '' }) },
    })
    ;(service as unknown as { refreshLoginItemStatus(): void }).refreshLoginItemStatus()
    const status = service.currentPermissionStatus()
    expect(status.loginItemOpenAtLogin).toBe(false)
  })
})
```

> NOTE for implementer: `buildService` passes typed noops into slots that are never touched by `currentPermissionStatus`. If the cast gymnastics feel noisy, an equally valid alternative is extracting `currentPermissionStatus` to accept `{ native, shortcut, loginItem }` as a plain function — but keep the class API unchanged for `index.ts`.

- [ ] **Step 7: Run tests, lint, commit**

Run: `pnpm vitest run src/main/services/preferencesSync.test.ts && pnpm lint`
Expected: PASS + clean.

```bash
git add src/shared/schema.ts src/main/services/preferencesSync.ts src/main/services/preferencesSync.test.ts
git commit -m "feat: login-item status read-back and hidden-at-login launch"
```

---

### Task 3: Settings UI status row

**Files:**
- Modify: `src/renderer/src/components/Preferences/sections/GeneralSettings.tsx:43-54`

**Interfaces:**
- Consumes: the three `loginItem*` fields from Task 2 via `state.permissionStatus`.

- [ ] **Step 1: Add the status row**

In `GeneralSettings.tsx`, inside the `Startup` `SettingsGroup`, directly after the Launch-at-login `SettingsRow`:

```tsx
        {preferences.launchAtLogin ? (
          <SettingsRow
            title="Login item status"
            copy={
              state.permissionStatus.loginItemOpenAtLogin
                ? state.permissionStatus.loginItemWasOpenedAsHidden
                  ? ‘Ledge starts hidden in the background at login — tray icon only, no windows.’
                  : ‘Ledge will start at your next login.’
                : ‘macOS hasn’t confirmed the login item yet. Check System Settings › General › Login Items.’
            }
            trailing={
              <StatusPill
                label={
                  state.permissionStatus.loginItemOpenAtLogin ? ‘Starts hidden’ : ‘Check Login Items’
                }
                variant={state.permissionStatus.loginItemOpenAtLogin ? ‘good’ : ‘warn’}
              />
            }
          />
        ) : null}
```

> `StatusPill` already supports `'warn'` (primitives.tsx:104) — use it as written.

- [ ] **Step 2: Lint + renderer typecheck**

Run: `pnpm lint`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/Preferences/sections/GeneralSettings.tsx
git commit -m "feat: show login-item status in Settings startup section"
```

---

### Task 4: Background health (throttling, wake re-assert, window-all-closed)

**Files:**
- Modify: `src/main/windows/shelfWindow.ts:34-38`, `quickPasteWindow.ts:35-39`, `peekWindow.ts:36-40`, `clipboardWindow.ts` (webPreferences block), `notchDropoutWindow.ts` (webPreferences block)
- Modify: `src/main/tray.ts` (add `reassert()`)
- Modify: `src/main/index.ts` (powerMonitor import + resume handler)

**Interfaces:**
- Produces: `TrayController.reassert(): void` — destroys and recreates the status item; safe to call anytime, idempotent. (`createTrayImage()` is synchronous — tray.ts:24.)

- [ ] **Step 1: backgroundThrottling on panel windows**

In each of the five window files' `webPreferences`, add one line (keep `preferencesWindow.ts` untouched):

```ts
      webPreferences: {
        preload: resolvePreloadPath(),
        contextIsolation: true,
        sandbox: true,
        // Panels idle hidden for hours; Chromium would otherwise throttle
        // timers/rAF and the first shake/shortcut after a break feels dead.
        backgroundThrottling: false,
      },
```

- [ ] **Step 2: TrayController.reassert**

In `src/main/tray.ts`, refactor the constructor setup into a private `attach()` used by both the constructor and:

```ts
  /**
   * macOS can drop status items across sleep/display reconfiguration.
   * Cheap and idempotent: destroy + rebuild from the same icon path.
   */
  reassert(): void {
    this.tray.destroy()
    this.tray = new Tray(createTrayImage())
    this.attach()
  }
```

(Follow the existing constructor code for exact wiring — `setIgnoreDoubleClickEvents`, click/right-click/drop handlers.)

- [ ] **Step 3: powerMonitor resume hook**

In `src/main/index.ts`, extend the electron import: `import { app, Menu, net, powerMonitor, protocol as protocolModule, screen, shell } from 'electron'`.

Inside `whenReady`, after `syncClipboardFallbackPoller()` (~line 380):

```ts
  powerMonitor.on('resume', () => {
    // After wake, macOS may have recycled the status item and the Swift
    // helper can be mid-respawn; re-assert both cheaply.
    tray.reassert()
    broadcastState()
  })
```

(The native agent already auto-respawns on unexpected exit — see `nativeAgent.stop()` comment in `before-quit` — so resume only needs to make state fresh.)

- [ ] **Step 4: Verify + commit**

Run: `pnpm lint && pnpm test`
Expected: clean + all suites pass.

```bash
git add src/main/windows/ src/main/tray.ts src/main/index.ts
git commit -m "fix: keep panels hot under background throttling; re-assert tray on wake"
```

---

## Self-review notes

- Spec §1 (lock + resurface) → Task 1 · §2 (read-back + UI) → Tasks 2–3 · §3 (window-all-closed) → Task 1 Step 5 · §4 (throttling) → Task 4 · §5 (resume) → Task 4. Full coverage.
- Type consistency: `LoginItemSettingsPort`, `startSingleInstanceWatch`, `reassert` named identically plan-wide.
- Zero new IPC channels; Convex untouched (permission status is runtime state).
