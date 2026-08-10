import type { ShelfItemRecord } from '@shared/schema'

export type HeroMode = 'single' | 'collage' | 'stack'
export type SessionMode = 'idle' | 'acceptingDrop' | 'exporting' | 'menuOpen' | 'itemListOpen'
export type MenuTarget = 'frontItem' | 'shelf'

export function isPreviewableImageItem(item: ShelfItemRecord): boolean {
  if (item.kind === 'imageAsset') {
    return !item.file.isMissing
  }

  if (item.kind === 'file') {
    return item.mimeType.startsWith('image/') && !item.file.isMissing
  }

  return false
}

export function isExportableShelfItem(item: ShelfItemRecord): boolean {
  return (item.kind === 'file' || item.kind === 'folder' || item.kind === 'imageAsset') && !item.file.isMissing
}

export function getHeroMode(items: ShelfItemRecord[]): HeroMode {
  if (items.length <= 1) {
    return 'single'
  }

  return items.length <= 3 && items.every(isPreviewableImageItem) ? 'collage' : 'stack'
}

export function getExportableItems(items: ShelfItemRecord[]): ShelfItemRecord[] {
  return items.filter(isExportableShelfItem)
}

export function getHeroCountLabel(items: ShelfItemRecord[], heroMode: HeroMode): string {
  const [frontItem] = items

  if (heroMode === 'collage') {
    return `${items.length} Images`
  }

  if (heroMode === 'single') {
    return frontItem && isPreviewableImageItem(frontItem) ? '1 Image' : '1 Item'
  }

  return `${items.length} Items`
}
