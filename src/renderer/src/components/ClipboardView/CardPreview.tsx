import type { ClipboardEntry } from '@shared/schema'

/**
 * Presentational subcomponents for a single clipboard history card.
 * Extracted from `ClipboardCard.tsx` so the card itself stays focused
 * on wiring (drag handlers, copy/remove buttons, category chips)
 * while these helpers stay pure and easy to read.
 */

function fileExtensionOf(item: ClipboardEntry['item']): string {
  if (item.kind !== 'file' && item.kind !== 'imageAsset') return ''
  const path = item.file.resolvedPath || item.file.originalPath
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  const filename = slash >= 0 ? path.slice(slash + 1) : path
  const dot = filename.lastIndexOf('.')
  if (dot < 0) return ''
  return filename.slice(dot + 1).toUpperCase()
}

/**
 * Time string for the card subtitle: "now" / "5m" / "3h" / "2d".
 */
export function formatRelativeTime(iso: string): string {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return ''
  const diff = Date.now() - then
  if (diff < 60_000) return 'now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`
  return `${Math.floor(diff / 86_400_000)}d`
}

export function CardPreview({ entry }: { entry: ClipboardEntry }) {
  const item = entry.item
  if (item.kind === 'imageAsset') {
    if (entry.thumbnailDataUri) {
      return <img src={entry.thumbnailDataUri} alt="" draggable={false} />
    }
    return <span>🖼</span>
  }
  if (item.kind === 'color') {
    return <span style={{ background: item.hex, width: '100%', height: '100%' }} />
  }
  if (item.kind === 'url') return <span>↗</span>
  if (item.kind === 'file') return <span>📄</span>
  if (item.kind === 'folder') return <span>📁</span>
  if (item.kind === 'code') return <span>&lt;/&gt;</span>
  return <span>Aa</span>
}

export function CardLabel({ entry }: { entry: ClipboardEntry }) {
  const item = entry.item
  if (item.kind === 'text') {
    const preview = item.text.replace(/\s+/g, ' ').slice(0, 80)
    return <span className="clipboard-card-label">{preview}</span>
  }
  if (item.kind === 'code') {
    const preview = item.text.split('\n', 1)[0]?.slice(0, 80) ?? ''
    return <span className="clipboard-card-label is-code">{preview}</span>
  }
  if (item.kind === 'url') {
    return <span className="clipboard-card-label">{item.title || item.url}</span>
  }
  if (item.kind === 'color') {
    return (
      <span className="clipboard-card-label is-color">
        <span
          style={{
            background: item.hex,
            width: 10,
            height: 10,
            borderRadius: 5,
            display: 'inline-block'
          }}
        />
        {item.name ? `${item.name} · ${item.hex}` : item.hex}
      </span>
    )
  }
  return <span className="clipboard-card-label">{item.title}</span>
}

export function CardSubtitle({ entry }: { entry: ClipboardEntry }) {
  const parts: string[] = []
  if (entry.sourceAppName) parts.push(entry.sourceAppName)
  parts.push(formatRelativeTime(entry.capturedAt))
  const ext = fileExtensionOf(entry.item)
  if (ext) parts.push(ext)
  return (
    <span className="clipboard-card-subtitle">
      {parts.filter(Boolean).map((p, i) => (
        <span key={i}>{p}</span>
      ))}
    </span>
  )
}
