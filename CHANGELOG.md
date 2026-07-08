# Changelog

All notable changes to Ledge will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.5.0] - 2026-07-08

_Maintenance release; no user-facing changes._

## [0.4.0] - 2026-07-08

### Fixed
- **gitignore**: stop ignoring .github/ and docs/ (`8ac764c`)
- **release**: don't set CSC_LINK/CSC_KEY_PASSWORD when secrets are empty (`4d34f3c`)

## [0.3.0] - 2026-07-08

### Fixed
- **release**: stop electron-builder downloading a 404'd zip URL (`2801667`)
- **ci**: allow pnpm to run electron/esbuild postinstall scripts (`a9b23e8`)

## [0.2.0] - 2026-07-08

### Added
- **clipboard**: add dedicated clipboardCopy IPC channel (`d37ada9`)
- undo/redo feature added (`354dc9d`)

### Fixed
- persist clipboardPruneNow, onboarding keydown, shortcut normalization, perf polish (`3d9592b`)
- bug fixes (`7d74809`)

### Changed
- **renderer**: split ClipboardCard + ClipboardCategories into subcomponents (`3401a7c`)
- **renderer**: extract clipboard filters + actions hook (`acdd84e`)
- **ipc**: extract ClipboardIpcController (`7bc18b7`)
- **clipboard**: extract pure payloads + pasteboard reader + writer (`6b8b602`)
- **ipc**: extract ShelfContextMenus + add mutateAndBroadcast helper (`b29b020`)
- **renderer**: centralize state projections in hooks/selectors.ts (`c489d9d`)
- **renderer**: split PreferencesView into router + 7 section components (`c7254c9`)
- **renderer**: extract drop-handler helpers from ShelfView into shelfDrop.ts (`a2e6238`)
- **ipc**: centralize shelf-item mutations in a ShelfItemOps service (`99617aa`)
- **ipc**: extract per-channel Zod schemas into shared/ipcSchemas.ts (`0a6e1f5`)
- **state**: split monolithic StateStore into per-domain sub-stores (`3a74476`)
- **preferencesSync**: import PreferencesRecord at top level (`7a2073a`)
- **main**: extract shelf/clipboard/preferences services + IPC registrar (`e80aa68`)

