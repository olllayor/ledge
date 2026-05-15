import { Menu, Tray, nativeImage } from 'electron'
import type { AppState, ShelfRecord } from '@shared/schema'

interface TrayCallbacks {
  onNewShelf(): void
  onNewShelfFromClipboard(): void
  onOpenPreferences(): void
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

  destroy(): void {
    this.tray.destroy()
  }

  private buildMenu(): Menu {
    const recentShelves = this.snapshot?.recentShelves ?? []

    return Menu.buildFromTemplate([
      {
        label: 'New Shelf',
        click: () => this.callbacks.onNewShelf()
      },
      {
        label: 'New Shelf From Clipboard',
        click: () => this.callbacks.onNewShelfFromClipboard()
      },
      {
        label: 'Recent Shelves',
        submenu: recentShelves.length > 0 ? recentShelves.map((shelf) => createRestoreMenuItem(shelf, this.callbacks.onRestoreShelf)) : [{ label: 'No recent shelves', enabled: false }]
      },
      {
        type: 'separator'
      },
      {
        label: `Version ${process.env.npm_package_version ?? '0.1.0'}`,
        enabled: false
      },
      {
        label: 'New in This Version…',
        click: () => this.callbacks.onOpenWhatsNew()
      },
      {
        label: 'Quick Start Guide…',
        click: () => this.callbacks.onOpenQuickStart()
      },
      {
        label: 'About Ledge…',
        click: () => this.callbacks.onOpenAbout()
      },
      {
        label: 'Settings…',
        accelerator: 'CommandOrControl+,',
        click: () => this.callbacks.onOpenPreferences()
      },
      {
        type: 'separator'
      },
      {
        label: 'Quit',
        accelerator: 'CommandOrControl+Q',
        click: () => this.callbacks.onQuit()
      }
    ])
  }
}

function createRestoreMenuItem(shelf: ShelfRecord, onRestore: (id: string) => void) {
  return {
    label: `${shelf.name} (${shelf.items.length})`,
    click: () => onRestore(shelf.id)
  }
}

function createTrayImage() {
  const svg = `
    <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
      <rect x="1.5" y="11" width="15" height="5" rx="2" fill="black"/>
      <rect x="11.5" y="5" width="4.5" height="7.5" rx="1.5" fill="black"/>
      <rect x="2" y="2.5" width="9.5" height="9" rx="1.5" fill="black"/>
      <rect x="3.5" y="4.5" width="5" height="0.6" rx="0.3" fill="white"/>
      <rect x="3.5" y="6.5" width="3" height="0.6" rx="0.3" fill="white"/>
      <rect x="3.5" y="8.5" width="4" height="0.6" rx="0.3" fill="white"/>
    </svg>
  `

  const image = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`)
  image.setTemplateImage(true)
  return image
}
