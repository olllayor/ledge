# Ledge — Agent Guide

macOS-only Electron shelf utility (menu bar, React, Swift native helper, optional Convex sync).

## Critical: Convex Code

Before writing any Convex code, read `convex/_generated/ai/guidelines.md`. It overrides training data defaults. All Convex functions require argument validators. Use `internal*` variants for private functions.

## Commands

```bash
pnpm dev            # dev (builds brand + native first, then electron-vite)
pnpm build          # production build
pnpm lint           # tsc --noEmit for both tsconfig.json and tsconfig.node.json
pnpm test           # vitest run + native Swift self-test
pnpm dist           # clean → build → lean bundle → size report
```

Verification order: `pnpm lint` → `pnpm test` → `pnpm build`.

## Architecture

| Layer | Path | Notes |
|-------|------|-------|
| Main process | `src/main/` | Electron main, tray, windows, native bridge |
| Preload | `src/preload/` | contextBridge, no nodeIntegration |
| Renderer | `src/renderer/` | React UI, CSS (no Tailwind) |
| Shared | `src/shared/` | Zod schemas, IPC contracts |
| Native | `native/DropShelfNativeAgent/` | Swift binary, stdout JSON protocol |
| Backend | `convex/` | Optional cloud sync, auth, billing |
| Scripts | `scripts/` | Branding, native build, DMG, size report |

## Path Aliases

- `@shared/*` → `src/shared/*`
- `@renderer/*` → `src/renderer/src/*`

These are configured in both `tsconfig.json` and `electron.vite.config.ts`. Do not use relative paths for shared code.

## Key Conventions

- **TypeScript strict** — no `any`, no unused locals/params
- **Zod** for all IPC payloads and shared schemas
- **IPC channels** defined as constants in `src/shared/ipc.ts`
- **Prefer `node:` prefix** for Node.js built-in imports
- **`app.dock.hide()`** — menu-bar-only app, never call `app.dock.show()`
- **Bookmark file refs** — always check `isFileBackedItem()` before `.file` access
- **Always check `isMissing`** before file operations on shelf items

## Native Agent

Swift binary communicates via stdout JSON lines. Commands sent via stdin. Handles shake detection, bookmark create/resolve, permission checks. Build with `pnpm native:build` (runs automatically in `pnpm dev`).

## Convex Backend (Optional)

Cloud sync is optional — local shelf works without it. Key env vars:
- `VITE_CONVEX_URL` — for dev with sync
- `RESEND_API_KEY`, `LEDGE_AUTH_EMAIL_FROM` — email OTP
- `LEMON_SQUEEZY_API_KEY`, `LEMON_SQUEEZY_WEBHOOK_SECRET` — billing

Run `pnpm convex:dev` for local Convex dev. Tests in `convex/*.test.ts` use `convex-test` with `@edge-runtime/vm`.

## Testing

- Unit tests: `*.test.ts` colocated with source
- Run single test: `pnpm vitest run src/path/to/file.test.ts`
- Convex tests: `convex/*.test.ts` (require `import.meta.glob` module map)
- Native test: `pnpm native:test` (Swift self-test)

## Build Gotchas

- `electron-vite` bundles main/preload/renderer separately into `out/`
- `pnpm dev` runs `brand:build` and `native:build` first — if Electron download fails, run: `node node_modules/.pnpm/electron@41.2.0/node_modules/electron/install.js`
- `pnpm dist` produces `dist/mac-arm64/Ledge.app` (Apple Silicon only)
- Native binary must be unpacked from ASAR (configured in `package.json` build config)

## CI

GitHub Actions runs on `macos-14`: `pnpm lint` → `pnpm test` → `pnpm build`. Uses pnpm 10.11.1, Node 22.
