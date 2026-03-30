import { useState } from 'react'
import type { AppState, IngestPayload, ShelfItemRecord } from '@shared/schema'

interface ShelfViewProps {
  state: AppState
}

export function ShelfView({ state }: ShelfViewProps) {
  const liveShelf = state.liveShelf
  const [isImporting, setIsImporting] = useState(false)
  const primaryItem = liveShelf?.items[0] ?? null
  const itemCount = liveShelf?.items.length ?? 0
  const useCollageHero =
    liveShelf !== null &&
    itemCount > 1 &&
    itemCount <= 3 &&
    liveShelf.items.every(isHeroPreviewable)
  const banner =
    !state.permissionStatus.nativeHelperAvailable
      ? {
          title: 'Native helper is unavailable',
          copy: state.permissionStatus.lastError || 'Rebuild the bundled helper to re-enable shake detection.'
        }
      : state.preferences.shakeEnabled && !state.permissionStatus.accessibilityTrusted
        ? {
            title: 'Accessibility access is off',
            copy: 'Enable it if you want shake-to-open.'
          }
        : state.permissionStatus.lastError
          ? {
              title: 'Native helper reported an error',
              copy: state.permissionStatus.lastError
            }
          : null

  async function pushPayloads(payloads: IngestPayload[]) {
    if (payloads.length === 0) {
      return
    }

    setIsImporting(true)
    try {
      if (!liveShelf) {
        await window.dropover.createShelf({ reason: 'manual' })
      }

      for (const payload of payloads) {
        await window.dropover.addPayload(payload)
      }
    } finally {
      setIsImporting(false)
    }
  }

  async function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault()
    await pushPayloads(await payloadsFromTransfer(event.dataTransfer))
  }

  async function handlePaste(event: React.ClipboardEvent<HTMLDivElement>) {
    const payloads = await payloadsFromTransfer(event.clipboardData)
    if (payloads.length === 0) {
      return
    }

    event.preventDefault()
    await pushPayloads(payloads)
  }

  async function moveItem(itemId: string, direction: -1 | 1) {
    if (!liveShelf) {
      return
    }

    const items = [...liveShelf.items]
    const index = items.findIndex((item) => item.id === itemId)
    const targetIndex = index + direction
    if (index === -1 || targetIndex < 0 || targetIndex >= items.length) {
      return
    }

    const next = [...items]
    const [entry] = next.splice(index, 1)
    next.splice(targetIndex, 0, entry)
    await window.dropover.reorderItems(next.map((item) => item.id))
  }

  return (
    <main className="shelf-shell" onPaste={handlePaste} tabIndex={0}>
      <section className="shelf-panel" onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
        <header className="shelf-topbar">
          <button className="chrome-button chrome-button-close" onClick={() => void window.dropover.closeShelf()} aria-label="Close shelf">
            ×
          </button>
          <div className="shelf-title-group">
            <div className="shelf-handle" aria-hidden="true" />
          </div>
          <div className="chrome-spacer" aria-hidden="true" />
        </header>

        <section className={`drop-surface compact ${itemCount === 0 ? 'is-empty' : ''}`}>
          {itemCount === 0 ? (
            <div className="empty-state compact">
              <p className="surface-title compact">Drop anything here</p>
              <p className="surface-subtitle compact">A temporary shelf appears near the cursor while you drag.</p>
            </div>
          ) : primaryItem ? (
            <HeroItem
              items={liveShelf?.items ?? [primaryItem]}
              item={primaryItem}
              totalItems={itemCount}
              isImporting={isImporting}
              useCollageHero={useCollageHero}
            />
          ) : (
            <div className="empty-state compact">
              <p className="surface-title compact">Shelf ready</p>
            </div>
          )}
        </section>

        {banner ? (
          <section className="permission-banner compact">
            <div>
              <p className="banner-title">{banner.title}</p>
              <p className="banner-copy">{banner.copy}</p>
            </div>
            <button className="ghost-button small" onClick={() => void window.dropover.openPermissionSettings()}>
              Open Settings
            </button>
          </section>
        ) : null}

        {liveShelf && itemCount > 1 && !useCollageHero ? (
          <section className="shelf-drawer">
            <div className="item-list compact">
              {liveShelf?.items.map((item, index) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  isFirst={index === 0}
                  isLast={index === liveShelf.items.length - 1}
                  onMove={moveItem}
                />
              ))}
            </div>
          </section>
        ) : null}
      </section>
    </main>
  )
}

interface ItemCardProps {
  item: ShelfItemRecord
  isFirst: boolean
  isLast: boolean
  onMove(itemId: string, direction: -1 | 1): Promise<void>
}

function ItemCard({ item, isFirst, isLast, onMove }: ItemCardProps) {
  const fileBacked = item.kind === 'file' || item.kind === 'folder' || item.kind === 'imageAsset'
  const badge = fileBacked ? (item.kind === 'folder' ? 'Folder' : item.kind === 'imageAsset' ? 'Image' : 'File') : item.kind === 'url' ? 'Link' : 'Text'
  const missing = fileBacked && item.file.isMissing
  const stale = fileBacked && item.file.isStale && !missing
  const fileStatus = missing ? 'Missing from disk' : stale ? 'Resolved from bookmark' : ''
  const previewCopy = missing ? item.file.originalPath : item.preview.summary
  const actionTitle = missing ? 'This item is no longer available on disk.' : undefined

  return (
    <article
      className={`item-card compact item-${item.kind}${missing ? ' is-missing' : ''}`}
      draggable={fileBacked && !missing}
      onDragStart={(event) => {
        if (!fileBacked || missing) {
          return
        }

        event.preventDefault()
        window.dropover.startItemDrag(item.id)
      }}
    >
      <div className="item-card-main compact">
        <div className="item-copy">
          <div className="item-badge">{badge}</div>
          <div>
            <p className="item-title compact">{item.title}</p>
            <p className="item-subtitle compact">{fileStatus || item.subtitle || item.preview.summary}</p>
          </div>
        </div>
        <div className="item-controls">
          <button className="mini-button compact" onClick={() => void onMove(item.id, -1)} disabled={isFirst} aria-label="Move item up">
            ↑
          </button>
          <button className="mini-button compact" onClick={() => void onMove(item.id, 1)} disabled={isLast} aria-label="Move item down">
            ↓
          </button>
          <button className="mini-button compact destructive" onClick={() => void window.dropover.removeItem(item.id)} aria-label="Remove item">
            ×
          </button>
        </div>
      </div>

      <p className="item-preview compact">{previewCopy}</p>

      <div className="item-actions compact">
        {fileBacked ? (
          <>
            <button className="ghost-button small" onClick={() => void window.dropover.previewItem(item.id)} disabled={missing} title={actionTitle}>
              Quick Look
            </button>
            <button className="ghost-button small" onClick={() => void window.dropover.revealItem(item.id)} disabled={missing} title={actionTitle}>
              Reveal
            </button>
            <button className="ghost-button small" onClick={() => void window.dropover.openItem(item.id)} disabled={missing} title={actionTitle}>
              Open
            </button>
          </>
        ) : null}
        {item.kind === 'text' || item.kind === 'url' ? (
          <>
            <button className="ghost-button small" onClick={() => void window.dropover.copyItem(item.id)}>
              Copy
            </button>
            <button className="ghost-button small" onClick={() => void window.dropover.saveItem(item.id)}>
              Save
            </button>
            {item.kind === 'url' ? (
              <button className="ghost-button small" onClick={() => void window.dropover.openItem(item.id)}>
                Open
              </button>
            ) : null}
          </>
        ) : null}
      </div>
    </article>
  )
}

interface HeroItemProps {
  items: ShelfItemRecord[]
  item: ShelfItemRecord
  totalItems: number
  isImporting: boolean
  useCollageHero: boolean
}

function HeroItem({ items, item, totalItems, isImporting, useCollageHero }: HeroItemProps) {
  const fileBacked = item.kind === 'file' || item.kind === 'folder' || item.kind === 'imageAsset'
  const missing = fileBacked && item.file.isMissing
  const statusLabel = isImporting
    ? 'Importing'
    : missing
      ? 'Missing on disk'
      : useCollageHero
        ? `${totalItems} Images`
        : totalItems > 1
          ? `${totalItems} items`
          : 'Ready'
  const previewSrc = getHeroPreviewSource(item)
  const collageItems = useCollageHero ? items.slice(0, 3).map((entry, index) => ({ item: entry, index })) : []

  return (
    <div className={`hero-item${useCollageHero ? ' is-collage' : ''}`}>
      <div className={`hero-stage${useCollageHero ? ' is-collage' : ''}`}>
        {useCollageHero ? (
          <div className="hero-collage" aria-hidden="true">
            {collageItems.map(({ item: collageItem, index }) => {
              const src = getHeroPreviewSource(collageItem)
              const stackClassName = heroStackClassName(index, collageItems.length)
              return (
                <div key={collageItem.id} className={`hero-stack-card ${stackClassName}`}>
                  {src ? <img src={src} alt="" className="hero-stack-image" /> : <HeroGlyph kind={collageItem.kind} />}
                </div>
              )
            })}
          </div>
        ) : (
          <>
            {totalItems > 1 ? <span className="hero-count">{totalItems}</span> : null}
            <div className={`hero-artwork ${missing ? 'is-missing' : ''}`}>
              {previewSrc ? <img src={previewSrc} alt="" className="hero-image" /> : <HeroGlyph kind={item.kind} />}
            </div>
          </>
        )}
      </div>
      {!useCollageHero ? (
        <div className="hero-chip-row">
          <div className="hero-chip" title={item.title}>
            <span>{item.title}</span>
            <span className="hero-chip-arrow">›</span>
          </div>
        </div>
      ) : null}
      <div className="hero-status-row">
        <span className={`meta-chip${useCollageHero ? ' meta-chip-prominent' : ''}`}>{statusLabel}</span>
      </div>
    </div>
  )
}

function HeroGlyph({ kind }: { kind: ShelfItemRecord['kind'] }) {
  if (kind === 'folder') {
    return (
      <svg viewBox="0 0 96 96" aria-hidden="true">
        <path d="M16 28a10 10 0 0 1 10-10h16l8 8h20a10 10 0 0 1 10 10v28a12 12 0 0 1-12 12H24A12 12 0 0 1 12 64V28h4Z" fill="rgba(255,255,255,0.96)" />
        <path d="M20 34h56a8 8 0 0 1 8 8v20a10 10 0 0 1-10 10H24A10 10 0 0 1 14 62V40a6 6 0 0 1 6-6Z" fill="rgba(230,232,235,0.95)" />
      </svg>
    )
  }

  if (kind === 'url') {
    return (
      <svg viewBox="0 0 96 96" aria-hidden="true">
        <path d="M38 58l20-20m-7-10h8a16 16 0 1 1 0 32h-8m-6 0h-8a16 16 0 0 1 0-32h8" fill="none" stroke="rgba(255,255,255,0.96)" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }

  if (kind === 'text') {
    return (
      <svg viewBox="0 0 96 96" aria-hidden="true">
        <path d="M28 16h30l18 18v42a8 8 0 0 1-8 8H28a8 8 0 0 1-8-8V24a8 8 0 0 1 8-8Z" fill="rgba(255,255,255,0.96)" />
        <path d="M58 16v18h18" fill="rgba(225,228,232,0.95)" />
        <path d="M34 50h28M34 60h20" stroke="rgba(136,139,144,0.8)" strokeWidth="6" strokeLinecap="round" />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 96 96" aria-hidden="true">
      <path d="M28 14h30l18 18v40a10 10 0 0 1-10 10H28a10 10 0 0 1-10-10V24a10 10 0 0 1 10-10Z" fill="rgba(255,255,255,0.97)" />
      <path d="M58 14v18a8 8 0 0 0 8 8h18" fill="rgba(224,226,230,0.95)" />
      <path d="M34 56h24" stroke="rgba(206,210,216,0.9)" strokeWidth="6" strokeLinecap="round" />
    </svg>
  )
}

function getHeroPreviewSource(item: ShelfItemRecord): string | null {
  if (item.kind !== 'imageAsset' && !(item.kind === 'file' && item.mimeType.startsWith('image/'))) {
    return null
  }

  const path = item.file.resolvedPath || item.file.originalPath
  if (!path || item.file.isMissing) {
    return null
  }

  return `dropover-asset://preview?path=${encodeURIComponent(path)}`
}

function isHeroPreviewable(item: ShelfItemRecord): boolean {
  if (item.kind === 'imageAsset') {
    return !item.file.isMissing
  }

  if (item.kind === 'file') {
    return item.mimeType.startsWith('image/') && !item.file.isMissing
  }

  return false
}

function heroStackClassName(index: number, count: number): string {
  if (count === 2) {
    return index === 0 ? 'hero-stack-card-front' : 'hero-stack-card-back-left'
  }

  if (index === 0) {
    return 'hero-stack-card-front'
  }

  return index === 1 ? 'hero-stack-card-back-left' : 'hero-stack-card-back-right'
}

async function payloadsFromTransfer(transfer: DataTransfer): Promise<IngestPayload[]> {
  const payloads: IngestPayload[] = []
  const droppedFiles = Array.from(transfer.files)
  const droppedItemFiles = Array.from(transfer.items as DataTransferItemList)
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file))
  const filePaths = [
    ...droppedFiles
      .map((file) => window.dropover.getFilePath(file))
      .filter((path): path is string => Boolean(path)),
    ...droppedItemFiles
      .map((file) => window.dropover.getFilePath(file))
      .filter((path): path is string => Boolean(path)),
    ...filePathsFromUriList(transfer.getData('text/uri-list'))
  ]

  if (filePaths.length > 0) {
    payloads.push({
      kind: 'fileDrop',
      paths: [...new Set(filePaths)]
    })
  }

  const imageItems = Array.from(transfer.items as DataTransferItemList).filter((item) => item.type.startsWith('image/'))
  for (const item of imageItems) {
    try {
      const file = item.getAsFile()
      if (!file) {
        continue
      }

      const maybePath = window.dropover.getFilePath(file)
      if (maybePath) {
        continue
      }

      payloads.push(await imageToPayload(file))
    } catch {
      // Skip malformed image transfer items and continue ingesting the rest of the payload.
    }
  }

  if (payloads.length === 0) {
    const uriList = transfer.getData('text/uri-list').trim()
    if (uriList) {
      payloads.push({
        kind: 'url',
        url: uriList.split('\n')[0],
        label: uriList.split('\n')[0]
      })
    }
  }

  const text = transfer.getData('text/plain').trim()
  if (text && payloads.length === 0) {
    try {
      const parsed = new URL(text)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        payloads.push({
          kind: 'url',
          url: parsed.toString(),
          label: parsed.hostname
        })
      } else {
        payloads.push({
          kind: 'text',
          text
        })
      }
    } catch {
      payloads.push({
        kind: 'text',
        text
      })
    }
  }

  return payloads
}

function filePathsFromUriList(uriList: string): string[] {
  return uriList
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && !entry.startsWith('#'))
    .flatMap((entry) => {
      try {
        const url = new URL(entry)
        if (url.protocol !== 'file:') {
          return []
        }

        return [decodeURIComponent(url.pathname)]
      } catch {
        return []
      }
    })
}

async function imageToPayload(file: File): Promise<IngestPayload> {
  const arrayBuffer = await file.arrayBuffer()
  const bytes = new Uint8Array(arrayBuffer)
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return {
    kind: 'image',
    mimeType: file.type || 'image/png',
    base64: btoa(binary),
    filenameHint: file.name || 'drop-image'
  }
}
