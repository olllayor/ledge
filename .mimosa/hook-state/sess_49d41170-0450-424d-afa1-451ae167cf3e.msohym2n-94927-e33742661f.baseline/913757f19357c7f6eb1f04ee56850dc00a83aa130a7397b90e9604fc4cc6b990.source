import { BrowserWindow } from 'electron'
import { join } from 'node:path'
import { URL } from 'node:url'

export type RendererView = 'shelf' | 'preferences' | 'clipboard' | 'quickPaste' | 'peek' | 'notchDropout'

const STANDALONE_HTML: Record<string, string> = {
  quickPaste: 'quickPaste.html',
  peek: 'peekWindow.html',
  notchDropout: 'notchDropout.html',
}

export async function loadRenderer(window: BrowserWindow, view: RendererView): Promise<void> {
  if (process.env.ELECTRON_RENDERER_URL) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL)
    if (view in STANDALONE_HTML) {
      url.pathname = `/${STANDALONE_HTML[view]}`
    } else {
      url.searchParams.set('view', view)
    }
    await window.loadURL(url.toString())
    return
  }

  if (view in STANDALONE_HTML) {
    await window.loadFile(join(__dirname, '../renderer', STANDALONE_HTML[view]))
  } else {
    await window.loadFile(join(__dirname, '../renderer/index.html'), {
      query: { view },
    })
  }
}
