# Electron + macOS Native Skill

## Overview
Ledge is a macOS-only Electron app with a Swift native helper. This skill covers Electron patterns and macOS-specific conventions.

## Electron Architecture
- **Main process** (`src/main/`): Node.js, manages windows, tray, system integration
- **Preload** (`src/preload/`): Bridge between main and renderer via `contextBridge`
- **Renderer** (`src/renderer/`): React UI, no direct Node.js access

## Window Management
- `ShelfWindow`: Floating, always-on-top, frameless, transparent background
- `PreferencesWindow`: Standard window with traffic lights
- Use `BrowserWindow` options: `transparent: true`, `alwaysOnTop: true`, `skipTaskbar: true`
- Position windows near cursor using `screen.getCursorScreenPoint()`

## System Integration
- **Tray**: `TrayController` manages menu bar icon and context menu
- **Global shortcuts**: `globalShortcut.register()` with validation
- **Clipboard**: `clipboard.readText()`, `clipboard.readImage()`
- **Drag & drop**: `webContents.startDrag()` with custom icon
- **Shell**: `shell.openExternal()`, `shell.showItemInFolder()`

## Native Agent (Swift)
- Binary: `native/DropShelfNativeAgent`
- Communication: stdout JSON protocol
- Capabilities:
  - Shake detection (configurable sensitivity)
  - Bookmark create/resolve (macOS security-scoped)
  - Permission checks (accessibility, notifications)
- Start: `nativeAgent.start()` → reads JSON lines from stdout
- Commands sent via stdin JSON

## macOS Specifics
- **Menu bar app**: `app.dock.hide()` on startup, no dock icon
- **Login items**: `app.setLoginItemSettings()` for launch-at-login
- **Accessibility**: Required for global shortcuts and shake detection
- **Hardened runtime**: Required for notarization
- **ASAR unpacking**: Native binary must be unpacked from ASAR

## Security Patterns
- **No `nodeIntegration`** in renderer
- **Context isolation** enabled
- **Preload bridge** exposes only `LedgeAPI` interface
- **Asset protocol** validates paths against allowed list
- **Bookmark-based file refs** for security-scoped access

## IPC Patterns
```typescript
// Main process handler
ipcMain.handle(IPC_CHANNELS.addPayload, async (_event, payload: unknown) => {
  const parsed = ingestPayloadSchema.parse(payload);
  // ... process
  return broadcastState();
});

// Renderer call
const state = await window.ledgeAPI.addPayload(payload);
```

## Build & Distribution
- `electron-vite` for dev/build
- `electron-builder` for DMG/ZIP
- Code signing required for macOS distribution
- Notarization via `electron-builder notarize` or manual `notarytool`

## Common Pitfalls
- **Always check `app.isPackaged`** before accessing `process.resourcesPath`
- **Window focus**: macOS windows don't auto-focus like Windows
- **Coordinate systems**: Screen coordinates vs window coordinates differ
- **Native image**: Resize for drag icons (72x72 recommended)
- **File dialogs**: Must parent to window for proper modal behavior
- **Menu popup**: Use `menu.popup({ window: browserWindow })`
