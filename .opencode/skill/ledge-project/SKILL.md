# Ledge Project Skill

## Project Overview
Ledge is a macOS-only Electron shelf utility inspired by Dropover. It ships a menu-bar-first Electron shell, a React renderer, and a Swift helper for shake gestures and bookmark-based file references.

## Tech Stack
- **Runtime**: Electron 41 (Chromium)
- **Frontend**: React 19, TypeScript, CSS (no Tailwind)
- **Backend**: Convex (optional cloud sync)
- **Native**: Swift helper (`native/DropShelfNativeAgent`) for shake detection, bookmarks
- **Build**: electron-vite, electron-builder
- **Package Manager**: pnpm 10

## Repository Layout
```
src/main/          → Electron main process, tray, windows, persistence, native bridge
src/preload/       → Secure preload bridge (contextBridge)
src/renderer/      → React UI for shelf and preferences windows
src/shared/        → Shared schemas (Zod) and IPC contracts
native/            → Swift helper for shake detection and bookmark resolution
convex/            → Convex backend (sync, auth, billing)
scripts/           → Build helpers (branding, native agent, DMG)
```

## Build & Dev Commands
```bash
pnpm dev            # Start dev (builds brand + native, runs electron-vite)
pnpm build          # Production build
pnpm lint           # TypeScript check (tsc --noEmit)
pnpm test           # vitest + native test
pnpm dist           # Full distribution build (clean + build + DMG)
```

## Key Conventions

### Code Style
- TypeScript strict mode, no `any`
- Zod schemas for all IPC payloads (`src/shared/schema.ts`)
- IPC channels defined as constants in `src/shared/ipc.ts`
- Prefer `node:` prefix for Node.js imports
- Use `Electron.IpcMainEvent` patterns for IPC handlers

### State Management
- Main process: `StateStore` class wraps JSON persistence in `~/Library/Application Support/Ledge`
- Renderer: `useLedgeState` hook subscribes via IPC bridge
- No Redux/Zustand — state flows main → renderer via `stateUpdated` events

### File References
- Files use bookmark-based references (macOS security-scoped bookmarks)
- `fileRef` pattern: `{ originalPath, resolvedPath, isStale, isMissing }`
- Always check `isMissing` before file operations

### Window Management
- `ShelfWindow` — floating shelf near cursor, always-on-top
- `PreferencesWindow` — standard preferences panel
- Windows communicate via preload bridge, never direct `remote`

### Native Agent
- Swift binary at `native/DropShelfNativeAgent`
- Communicates via stdout JSON protocol
- Handles: shake detection, bookmark create/resolve, permission checks

## Tribal Knowledge
- **Don't use `app.dock.show()`** — app is menu-bar-only, dock is hidden
- **Always check `isFileBackedItem()`** before accessing `.file` property
- **Image assets stored as base64** in shelf items, uploaded to Convex storage for sync
- **Shake sensitivity** has three levels: gentle/balanced/firm
- **Global shortcut** must be validated before registration (macOS quirks)
- **Preference patching** normalizes shortcuts and bundle IDs before applying

## Testing
- Unit tests: `*.test.ts` colocated with source
- Run: `pnpm test` (vitest + Swift self-test)
- Convex tests: `convex/*.test.ts` use `convex-test`

## Common Pitfalls
- `electron-vite` uses `@shared/` alias — don't use relative paths for shared code
- `app.whenReady()` is the entry point — all setup happens there
- Asset protocol handler validates paths against allowed list (security)
- Bookmark resolution is async and can fail if file moved/deleted
