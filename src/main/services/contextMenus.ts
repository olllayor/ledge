import { Menu } from 'electron'
import type { ShelfItemRecord } from '@shared/schema'
import { isFileBackedItem } from '@shared/fileUtils'
import type { ShelfActions } from './shelfActions'
import type { ShelfController } from './shelfController'
import type { ShelfWindow } from '../windows/shelfWindow'
import type { ShelfItemOps } from './shelfItemOps'

export interface ContextMenuDeps {
  shelfWindow: ShelfWindow
  shelfActions: ShelfActions
  shelfController: ShelfController
  shelfOps: ShelfItemOps
  onInactivityTick(): void
  broadcastState(): unknown
}

/**
 * Builds and pops the right-click menus for a single item and for the
 * whole shelf. Lives outside `IpcRegistrar` so the registrar stays a
 * thin glue layer and the menu templates are independently editable.
 */
export class ShelfContextMenus {
  constructor(private readonly deps: ContextMenuDeps) {}

  popupForItem(item: ShelfItemRecord): void {
    const missing = isFileBackedItem(item) && item.file.isMissing
    const template: Electron.MenuItemConstructorOptions[] = []

    if (isFileBackedItem(item)) {
      template.push(
        { label: 'Quick Look', enabled: !missing, click: () => this.deps.shelfActions.previewItem(item.id) },
        { label: 'Reveal in Finder', enabled: !missing, click: () => this.deps.shelfActions.revealItem(item.id) },
        { label: 'Open', enabled: !missing, click: () => this.deps.shelfActions.openItem(item.id) },
        { label: 'Relink…', click: () => void this.deps.shelfActions.relinkItem(item.id) },
        { type: 'separator' },
        { label: 'Share', enabled: true, click: () => void this.deps.shelfActions.shareItems([item.id]) },
      )
    } else if (item.kind === 'text' || item.kind === 'url') {
      template.push(
        { label: 'Copy', click: () => void this.deps.shelfActions.copyItem(item.id) },
        { label: 'Save', click: () => void this.deps.shelfActions.saveItem(item.id) },
      )
      if (item.kind === 'url') {
        template.push({ label: 'Open', click: () => void this.deps.shelfActions.openItem(item.id) })
      }
    }

    template.push(
      { type: 'separator' },
      { label: 'Remove Item', click: () => this.deps.shelfOps.remove(item.id) },
    )

    Menu.buildFromTemplate(template).popup({
      window: this.deps.shelfWindow.getBrowserWindow() ?? undefined,
    })
  }

  popupForShelf(items: ShelfItemRecord[]): void {
    const template: Electron.MenuItemConstructorOptions[] = []

    if (items.length > 0) {
      const primaryItem = items[0]
      const missing = isFileBackedItem(primaryItem) && primaryItem.file.isMissing

      template.push(
        { label: 'Quick Look', enabled: !missing, click: () => this.deps.shelfActions.previewItem(primaryItem.id) },
        { label: 'Reveal in Finder', enabled: !missing, click: () => this.deps.shelfActions.revealItem(primaryItem.id) },
        { label: 'Open', enabled: !missing, click: () => this.deps.shelfActions.openItem(primaryItem.id) },
        { label: 'Copy', click: () => void this.deps.shelfActions.copyItem(primaryItem.id) },
        { label: 'Save', click: () => void this.deps.shelfActions.saveItem(primaryItem.id) },
        { type: 'separator' },
      )
    }

    template.push(
      { label: 'Share All', enabled: items.length > 0, click: () => void this.deps.shelfActions.shareItems() },
      { type: 'separator' },
      { label: 'Clear Shelf', enabled: items.length > 0, click: () => this.deps.shelfOps.clear() },
      {
        label: 'Close Shelf',
        click: () => {
          this.deps.shelfController.closeShelf()
          this.deps.onInactivityTick()
          this.deps.broadcastState()
        },
      },
    )

    Menu.buildFromTemplate(template).popup({
      window: this.deps.shelfWindow.getBrowserWindow() ?? undefined,
    })
  }
}
