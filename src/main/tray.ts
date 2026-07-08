import { app, Menu, Tray, nativeImage } from 'electron'
import { join } from 'node:path'
import type { AppState, ShelfRecord } from '@shared/schema'

interface TrayCallbacks {
  onNewShelf(): void
  onNewShelfFromClipboard(): void
  onOpenPreferences(): void
  onOpenClipboardHistory(): void
  onOpenWhatsNew(): void
  onOpenQuickStart(): void
  onOpenAbout(): void
  onRestoreShelf(id: string): void
  onDropFiles(paths: string[]): void
  onDropText(text: string): void
  onQuit(): void
}

export class TrayController {
  private readonly tray: Tray
  private snapshot: AppState | null = null

  constructor(private readonly callbacks: TrayCallbacks) {
    this.tray = new Tray(createTrayImage())
    this.tray.setIgnoreDoubleClickEvents(true)
    this.tray.setToolTip('Ledge')
    this.tray.on('click', () => {
      this.tray.popUpContextMenu(this.buildMenu())
    })
    this.tray.on('right-click', () => {
      this.tray.popUpContextMenu(this.buildMenu())
    })
    this.tray.on('drop-files', (_event, files) => {
      this.callbacks.onDropFiles(files)
    })
    this.tray.on('drop-text', (_event, text) => {
      this.callbacks.onDropText(text)
    })
  }

  update(snapshot: AppState): void {
    this.snapshot = snapshot
  }

  buildTemplate(): Electron.MenuItemConstructorOptions[] {
    return buildTrayMenuTemplate(this.snapshot?.recentShelves ?? [], this.callbacks)
  }

  destroy(): void {
    this.tray.destroy()
  }

  private buildMenu(): Menu {
    return Menu.buildFromTemplate(this.buildTemplate())
  }
}

/**
 * Builds the tray menu template. Exported as a pure function so it can
 * be unit-tested without instantiating an Electron `Tray`.
 */
export function buildTrayMenuTemplate(
  recentShelves: ShelfRecord[],
  callbacks: TrayCallbacks,
): Electron.MenuItemConstructorOptions[] {
  return [
    {
      label: 'New Shelf',
      click: () => callbacks.onNewShelf()
    },
    {
      label: 'New Shelf From Clipboard',
      click: () => callbacks.onNewShelfFromClipboard()
    },
    {
      label: 'Recent Shelves',
      submenu: recentShelves.length > 0 ? recentShelves.map((shelf) => createRestoreMenuItem(shelf, callbacks.onRestoreShelf)) : [{ label: 'No recent shelves', enabled: false }]
    },
    {
      label: 'Clipboard History…',
      click: () => callbacks.onOpenClipboardHistory()
    },
    {
      type: 'separator'
    },
    {
      label: `Version ${app.getVersion()}`,
      enabled: false
    },
    {
      label: 'New in This Version…',
      click: () => callbacks.onOpenWhatsNew()
    },
    {
      label: 'Quick Start Guide…',
      click: () => callbacks.onOpenQuickStart()
    },
    {
      label: 'About Ledge…',
      click: () => callbacks.onOpenAbout()
    },
    {
      label: 'Settings…',
      accelerator: 'CommandOrControl+,',
      click: () => callbacks.onOpenPreferences()
    },
    {
      type: 'separator'
    },
    {
      label: 'Quit',
      accelerator: 'CommandOrControl+Q',
      click: () => callbacks.onQuit()
    }
  ]
}

function createRestoreMenuItem(shelf: ShelfRecord, onRestore: (id: string) => void) {
  return {
    label: `${shelf.name} (${shelf.items.length})`,
    click: () => onRestore(shelf.id)
  }
}

function createTrayImage() {
  const resourcesDir = join(__dirname, '..', '..', 'build')

  // 1. Prefer the dedicated menubar icon (monochrome, pixel-fitted for 16 px)
  const trayPath = join(resourcesDir, 'tray-icon.png')
  const trayImage = nativeImage.createFromPath(trayPath)
  if (!trayImage.isEmpty()) {
    trayImage.setTemplateImage(true)
    return trayImage
  }

  // 2. Fallback to the generic app icon (only during transition)
  const fallbackPath = join(resourcesDir, 'icon.png')
  const fallback = nativeImage.createFromPath(fallbackPath)
  if (!fallback.isEmpty()) {
    const resized = fallback.resize({ width: 16, height: 16 })
    resized.setTemplateImage(true)
    return resized
  }

  // 3. Ultimate fallback – Electron will supply a generic icon
  return nativeImage.createEmpty()
}
