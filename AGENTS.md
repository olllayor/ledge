# Ledge — Agent Guide

macOS-only Electron shelf utility (menu bar, React, Swift native helper, optional Cloudflare sync).

## Commands

```bash
pnpm dev                 # dev (builds brand + native first, then electron-vite)
pnpm build               # production build
pnpm lint                # tsc --noEmit for both tsconfig.json and tsconfig.node.json
pnpm test                # vitest run + native Swift self-test
pnpm dist                # clean → build → lean bundle → size report
pnpm changelog:diff      # dry-run: print rendered CHANGELOG.md for <ref>..HEAD
pnpm changelog:update    # write: merge the diff into CHANGELOG.md locally
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
| Backend | `cloudflare/` | Cloudflare Worker (Hono) + D1 + R2 — auth, sync, billing, teams |
| Scripts | `scripts/` | Branding, native build, DMG, size report, changelog |
| Automation | `.github/workflows/` | CI, release, nightly changelog digest |

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
- **Commit messages** — use Conventional Commits (`feat:`, `fix:`, `refactor:`, `chore:`, etc.) so the nightly changelog digest can categorize them automatically

## Native Agent

Swift binary communicates via stdout JSON lines. Commands sent via stdin. Handles shake detection, bookmark create/resolve, permission checks, measured notch geometry (`screen.metrics`) and the swipe-to-reveal gesture watch (`notch.revealWatch`). Build with `pnpm native:build` (runs automatically in `pnpm dev`).

See `docs/notch-geometry.md` for how notch measurements, hover hysteresis, and swipe-to-reveal fit together.

## Cloudflare Backend (Optional)

Cloud sync is optional — local shelf works without it. The Worker lives in `cloudflare/`.

Key env vars:
- `VITE_LEDGE_API_URL` — Worker origin (renderer cloud features)
- `VITE_PRO_CHECKOUT_URL` — Lemon Squeezy checkout page
- Worker secrets: `RESEND_API_KEY` (preferred email), `EMAIL_FROM` (from-address), `LEMON_SQUEEZY_API_KEY`, `LEMON_SQUEEZY_WEBHOOK_SECRET`. Email send order: Resend → Cloudflare `send_email` binding → console log.

```bash
pnpm --filter ledge-cloudflare dev
pnpm --filter ledge-cloudflare db:migrate:local
pnpm --filter ledge-cloudflare test
```

See `docs/cf-migration.md` for API contract and design rules.

## Testing

- Unit tests: `*.test.ts` colocated with source
- Run single test: `pnpm vitest run src/path/to/file.test.ts`
- Worker tests: `pnpm --filter ledge-cloudflare test`
- Native test: `pnpm native:test` (Swift self-test)

## Build Gotchas

- `electron-vite` bundles main/preload/renderer separately into `out/`
- `pnpm dev` runs `brand:build` and `native:build` first — if Electron download fails, run: `node node_modules/.pnpm/electron@41.2.0/node_modules/electron/install.js`
- `pnpm dist` produces `dist/mac-arm64/Ledge.app` (Apple Silicon only)
- Native binary must be unpacked from ASAR (configured in `package.json` build config)

## CI

GitHub Actions runs on `macos-14`: `pnpm lint` → `pnpm test` → `pnpm build`. Uses pnpm 10.11.1, Node 22.

## Changelog Automation

`.github/workflows/changelog-nightly.yml` runs at 03:00 UTC each night and on
`workflow_dispatch`. It diffs `main` against the most recent
`nightly-baseline-YYYY-MM-DD` tag (or `HEAD~1` on first run), runs
`scripts/build-changelog.mjs`, and opens a PR titled
`docs(changelog): nightly digest …` against `main`. Merging the PR rolls
entries under `## [Unreleased]` and the next run uses the new `main` HEAD as
its baseline.

Use `pnpm changelog:diff [<ref>]` to preview what the bot would generate for
`<ref>..HEAD` (default `HEAD~1`), and `pnpm changelog:update [<ref>]` to apply
it locally — useful when batching several days of work before a release.

The script classifies commits via Conventional Commits prefixes:

| Prefix    | Section              |
|-----------|----------------------|
| `feat:`   | Added                |
| `fix:`    | Fixed                |
| `perf:`   | Performance          |
| `refactor:`, `chore:`, `build:` | Changed   |
| `docs:`   | Documentation        |
| `test:`, `style:`, `ci:` | Internal        |
