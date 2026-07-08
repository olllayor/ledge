import { clipboard, dialog, Menu, shell } from 'electron'
import { promises as fs } from 'node:fs'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isFileBackedItem, getFileBackedPath } from '@shared/fileUtils'
import { isOpenPathSuccess, urlToWebloc } from './systemUtils'
import type { StateStore } from './stateStore'
import type { NativeAgentClient } from '../native/nativeAgent'
import type { ShelfWindow } from '../windows/shelfWindow'
import type { PreferencesWindow } from '../windows/preferencesWindow'
import type { ShelfItemRecord } from '@shared/schema'

export interface ShelfActionsDeps {
  stateStore: StateStore
  nativeAgent: NativeAgentClient
  shelfWindow: ShelfWindow
  preferencesWindow: PreferencesWindow
  onStateChange(): void
}

export class ShelfActions {
  constructor(private readonly deps: ShelfActionsDeps) {}

  private get liveItems(): ShelfItemRecord[] {
    return this.deps.stateStore.getLiveShelf()?.items ?? []
  }

  async previewItem(itemId: string): Promise<boolean> {
    const item = this.liveItems.find((entry) => entry.id === itemId)
    if (!item || !isFileBackedItem(item)) {
      return false
    }

    const path = getFileBackedPath(item)
    if (!path) {
      return false
    }

    return this.deps.shelfWindow.previewFile(path, basename(path))
  }

  async revealItem(itemId: string): Promise<boolean> {
    const item = this.liveItems.find((entry) => entry.id === itemId)
    const path = item && isFileBackedItem(item) ? getFileBackedPath(item) : null
    if (!path) {
      return false
    }

    shell.showItemInFolder(path)
    return true
  }

  async openItem(itemId: string): Promise<boolean> {
    const item = this.liveItems.find((entry) => entry.id === itemId)
    if (!item) {
      return false
    }

    if (item.kind === 'url') {
      // Refuse non-http(s) schemes. A URL item is a web link; opening
      // `file://`, `javascript:`, or a custom URI scheme here would
      // either open the wrong app or, in the worst case, allow a remote
      // shelf to pivot into a local resource.
      let parsed: URL
      try {
        parsed = new URL(item.url)
      } catch {
        return false
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return false
      }
      await shell.openExternal(parsed.toString())
      return true
    }

    const path = isFileBackedItem(item)
      ? getFileBackedPath(item)
      : item.kind === 'text'
        ? (item.savedFilePath ?? null)
        : null

    if (!path) {
      return false
    }

    return isOpenPathSuccess(await shell.openPath(path))
  }

  async copyItem(itemId: string): Promise<boolean> {
    const item = this.liveItems.find((entry) => entry.id === itemId)
    if (!item) {
      return false
    }

    if (item.kind === 'text') {
      clipboard.writeText(item.text)
      return true
    }

    if (item.kind === 'url') {
      clipboard.writeText(item.url)
      return true
    }

    if (isFileBackedItem(item)) {
      const filePath = getFileBackedPath(item)
      if (filePath) {
        writeFilePathsToClipboard([filePath])
        return true
      }
    }

    return false
  }

  async saveItem(itemId: string): Promise<boolean> {
    const item = this.liveItems.find((entry) => entry.id === itemId)
    if (!item || (item.kind !== 'text' && item.kind !== 'url')) {
      return false
    }

    const extension = item.kind === 'url' ? 'webloc' : 'txt'
    const window = this.deps.shelfWindow.getBrowserWindow()
    const options = {
      defaultPath: join(this.deps.stateStore.exportsDir, `${sanitizeName(item.title)}.${extension}`),
    }
    const result = window
      ? await dialog.showSaveDialog(window, options)
      : await dialog.showSaveDialog(options)

    if (result.canceled || !result.filePath) {
      return false
    }

    if (item.kind === 'text') {
      await fs.writeFile(result.filePath, item.text, 'utf8')
    } else {
      const data = urlToWebloc(item.url)
      await fs.writeFile(result.filePath, data, 'utf8')
    }

    return true
  }

  async relinkItem(itemId: string): Promise<boolean> {
    const item = this.liveItems.find((entry) => entry.id === itemId)
    if (!item || !isFileBackedItem(item)) {
      return false
    }

    const browserWindow =
      this.deps.shelfWindow.getBrowserWindow() ?? this.deps.preferencesWindow.getBrowserWindow()
    const properties: Electron.OpenDialogOptions['properties'] =
      item.kind === 'folder' ? ['openDirectory'] : ['openFile']
    const result = browserWindow
      ? await dialog.showOpenDialog(browserWindow, { properties })
      : await dialog.showOpenDialog({ properties })

    if (result.canceled || result.filePaths.length === 0) {
      return false
    }

    const selectedPath = result.filePaths[0]
    const bookmarkBase64 = await this.deps.nativeAgent.createBookmark(selectedPath)
    this.deps.stateStore.relinkFileBackedItem(itemId, {
      originalPath: selectedPath,
      resolvedPath: selectedPath,
      bookmarkBase64,
    })
    this.deps.onStateChange()
    return true
  }

  async shareItems(itemIds?: string[]): Promise<boolean> {
    const liveShelf = this.deps.stateStore.getLiveShelf()
    if (!liveShelf) {
      return false
    }

    const selection = (itemIds?.length
      ? liveShelf.items.filter((item) => itemIds.includes(item.id))
      : liveShelf.items
    )
      .filter(isFileBackedItem)
      .map((item) => getFileBackedPath(item))
      .filter((path): path is string => Boolean(path))

    if (selection.length === 0) {
      return false
    }

    const menu = Menu.buildFromTemplate([
      {
        role: 'shareMenu',
        sharingItem: {
          filePaths: selection,
        },
      },
    ])

    menu.popup({
      window: this.deps.shelfWindow.getBrowserWindow() ?? undefined,
    })
    return true
  }

  draggablePathsForItemIds(itemIds: string[]): string[] {
    if (itemIds.length === 0) {
      return []
    }

    const ids = new Set(itemIds)
    const paths: string[] = []

    for (const entry of this.liveItems) {
      if (!ids.has(entry.id) || !isFileBackedItem(entry)) {
        continue
      }

      const path = getFileBackedPath(entry)
      if (path) {
        paths.push(path)
      }
    }

    return paths
  }
}

/**
 * Write a set of file paths to the system clipboard in both the
 * newline-separated plain-text form and the `text/uri-list` form so
 * that downstream apps (Finder, text editors, browsers) all see
 * the same file list.
 */
export function writeFilePathsToClipboard(paths: string[]): void {
  const uniquePaths = [...new Set(paths)]
  if (uniquePaths.length === 0) {
    return
  }

  const uriList = uniquePaths.map((path) => pathToFileURL(path).toString()).join('\r\n')
  clipboard.clear()
  clipboard.writeText(uniquePaths.join('\n'))
  clipboard.writeBuffer('text/uri-list', Buffer.from(uriList, 'utf8'))
}

export function sanitizeName(value: string): string {
  return value.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '') || 'drop-item'
}
