import { memo } from 'react'
import type { ClipboardEntry } from '@shared/schema'

function fileExtensionOf(item: ClipboardEntry['item']): string {
  if (item.kind !== 'file' && item.kind !== 'imageAsset') return ''
  const path = item.file.resolvedPath || item.file.originalPath
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  const filename = slash >= 0 ? path.slice(slash + 1) : path
  const dot = filename.lastIndexOf('.')
  if (dot < 0) return ''
  return filename.slice(dot + 1).toUpperCase()
}

export function formatRelativeTime(iso: string): string {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return ''
  const diff = Date.now() - then
  if (diff < 60_000) return 'now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`
  return `${Math.floor(diff / 86_400_000)}d`
}

const CardPreviewImpl = ({ entry }: { entry: ClipboardEntry }) => {
  const item = entry.item
  if (item.kind === 'imageAsset') {
    if (entry.thumbnailDataUri) {
      return <img src={entry.thumbnailDataUri} alt="" draggable={false} />
    }
    return <span>🖼</span>
  }
  if (item.kind === 'color') {
    return <span style={{ background: item.hex, width: '100%', height: '100%', display: 'block' }} />
  }
  if (item.kind === 'url') return <span>↗</span>
  if (item.kind === 'file') return <span>📄</span>
  if (item.kind === 'folder') return <span>📁</span>
  if (item.kind === 'code') return <span>&lt;/&gt;</span>
  return <span>Aa</span>
}

const CardLabelImpl = ({ entry }: { entry: ClipboardEntry }) => {
  const item = entry.item
  if (item.kind === 'text') {
    const preview = item.text.replace(/\s+/g, ' ').slice(0, 120)
    return <span className="clipboard-row-label">{preview}</span>
  }
  if (item.kind === 'code') {
    const preview = item.text.split('\n', 1)[0]?.slice(0, 120) ?? ''
    return <span className="clipboard-row-label is-code">{preview}</span>
  }
  if (item.kind === 'url') {
    return <span className="clipboard-row-label">{item.title || item.url}</span>
  }
  if (item.kind === 'color') {
    return (
      <span className="clipboard-row-label is-color">
        <span
          style={{
            background: item.hex,
            width: 10,
            height: 10,
            borderRadius: 3,
            display: 'inline-block',
            flexShrink: 0,
          }}
        />
        {item.name ? `${item.name} · ${item.hex}` : item.hex}
      </span>
    )
  }
  return <span className="clipboard-row-label">{item.title}</span>
}

const CardSubtitleImpl = ({ entry }: { entry: ClipboardEntry }) => {
  const parts: string[] = []
  parts.push(formatRelativeTime(entry.capturedAt))
  const ext = fileExtensionOf(entry.item)
  if (ext) parts.push(ext)
  return (
    <span className="clipboard-row-subtitle">
      {parts.filter(Boolean).join(' · ')}
    </span>
  )
}

export const CardPreview = memo(CardPreviewImpl)
export const CardLabel = memo(CardLabelImpl)
export const CardSubtitle = memo(CardSubtitleImpl)
