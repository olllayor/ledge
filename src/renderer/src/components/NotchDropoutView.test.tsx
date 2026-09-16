// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react'
import { NotchDropoutView } from './NotchDropoutView'

interface MockLedge {
  getState: ReturnType<typeof vi.fn>
  clipboardGetRecent: ReturnType<typeof vi.fn>
  subscribeState: ReturnType<typeof vi.fn>
  onNotchDropoutStateChanged: ReturnType<typeof vi.fn>
  clipboardCopy: ReturnType<typeof vi.fn>
  clipboardStartItemDrag: ReturnType<typeof vi.fn>
  notchDropoutDragState: ReturnType<typeof vi.fn>
  notchDropoutHide: ReturnType<typeof vi.fn>
  notchDropoutGeometry: ReturnType<typeof vi.fn>
  onNotchDropoutGeometry: ReturnType<typeof vi.fn>
  showToast: ReturnType<typeof vi.fn>
}

function getLedge(): MockLedge {
  return (window as unknown as { ledge: MockLedge }).ledge
}

let stateListeners: Array<(state: { clipboardHistory: unknown[] }) => void> = []
let hintListeners: Array<(hint: { state: string }) => void> = []
let geometryListeners: Array<(geometry: unknown) => void> = []

function setupLedgeBridge() {
  stateListeners = []
  hintListeners = []
  geometryListeners = []
  const ledge: MockLedge = {
    getState: vi.fn(async () => ({ clipboardHistory: [] })),
    clipboardGetRecent: vi.fn(async () => []),
    subscribeState: vi.fn((cb: (state: { clipboardHistory: unknown[] }) => void) => {
      stateListeners.push(cb)
      return () => {
        stateListeners = stateListeners.filter((l) => l !== cb)
      }
    }),
    onNotchDropoutStateChanged: vi.fn((cb: (hint: { state: string }) => void) => {
      hintListeners.push(cb)
      return () => {
        hintListeners = hintListeners.filter((l) => l !== cb)
      }
    }),
    clipboardCopy: vi.fn(async () => true),
    clipboardStartItemDrag: vi.fn(() => true),
    notchDropoutDragState: vi.fn(),
    notchDropoutHide: vi.fn(),
    notchDropoutGeometry: vi.fn(async () => null),
    onNotchDropoutGeometry: vi.fn((cb: (geometry: unknown) => void) => {
      geometryListeners.push(cb)
      return () => {
        geometryListeners = geometryListeners.filter((l) => l !== cb)
      }
    }),
    showToast: vi.fn(),
  }
  ;(window as unknown as { ledge: MockLedge }).ledge = ledge
}

describe('NotchDropoutView', () => {
  beforeEach(() => {
    setupLedgeBridge()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders the clipboard brand', () => {
    render(<NotchDropoutView />)
    expect(screen.getByText('Clipboard')).toBeTruthy()
  })

  it('shows empty state when no entries', () => {
    render(<NotchDropoutView />)
    expect(screen.getByText('No items')).toBeTruthy()
  })

  it('renders thumbnail buttons for entries', async () => {
    const entries = [
      {
        id: 'e1',
        item: { kind: 'text', text: 'Hello world', title: 'Hello world' },
        capturedAt: new Date().toISOString(),
        categoryIds: [],
      },
      {
        id: 'e2',
        item: { kind: 'url', url: 'https://example.com', title: 'Example' },
        capturedAt: new Date().toISOString(),
        categoryIds: [],
      },
    ]
    getLedge().clipboardGetRecent.mockResolvedValue(entries)

    render(<NotchDropoutView />)

    const buttons = await screen.findAllByRole('button')
    expect(buttons.length).toBeGreaterThanOrEqual(2)
  })

  it('has close button that calls notchDropoutHide', () => {
    render(<NotchDropoutView />)
    const closeButton = screen.getByTitle('Close')
    closeButton.click()
    expect(getLedge().notchDropoutHide).toHaveBeenCalled()
  })

  it('expands on mouse enter and collapses on mouse leave', () => {
    const { container } = render(<NotchDropoutView />)
    const main = container.querySelector('.notch-dropout')
    expect(main).toBeTruthy()
    expect(main!.classList.contains('is-expanded')).toBe(false)

    fireEvent.mouseEnter(main!)
    expect(main!.classList.contains('is-expanded')).toBe(true)

    fireEvent.mouseLeave(main!)
    expect(main!.classList.contains('is-expanded')).toBe(false)
  })

  it('subscribes to state updates', () => {
    render(<NotchDropoutView />)
    expect(getLedge().subscribeState).toHaveBeenCalled()
  })

  it('subscribes to notch dropout state changes', () => {
    render(<NotchDropoutView />)
    expect(getLedge().onNotchDropoutStateChanged).toHaveBeenCalled()
  })

  const notchedGeometry = {
    hasNotch: true,
    menuBarHeight: 38,
    notchWidth: 204,
    notchHeight: 38,
    scale: 1,
    cornerRadius: 10,
    centerX: 864,
    top: 0,
  }

  it('shapes the collapsed band around the measured notch', async () => {
    getLedge().notchDropoutGeometry.mockResolvedValue(notchedGeometry)

    render(<NotchDropoutView />)

    const main = await waitFor(() => {
      const element = document.querySelector('.notch-dropout')
      expect(element?.getAttribute('data-notch')).toBe('true')
      return element as HTMLElement
    })

    // The spacer is exactly the hardware cut-out width.
    expect(main.style.getPropertyValue('--notch-width')).toBe('204px')
    expect(main.style.getPropertyValue('--notch-height')).toBe('38px')
    expect(document.querySelector('.notch-dropout-band-gap')).toBeTruthy()
    // The legacy header is replaced by the band in the notched layout.
    expect(document.querySelector('.notch-dropout-header')).toBeNull()
  })

  it('applies pushed geometry updates', async () => {
    render(<NotchDropoutView />)

    await waitFor(() => {
      expect(getLedge().onNotchDropoutGeometry).toHaveBeenCalled()
    })

    await act(async () => {
      geometryListeners.forEach((listener) => listener(notchedGeometry))
    })

    expect(document.querySelector('.notch-dropout-band-gap')).toBeTruthy()
  })

  it('keeps the header layout when the display has no notch', async () => {
    getLedge().notchDropoutGeometry.mockResolvedValue({
      ...notchedGeometry,
      hasNotch: false,
    })

    render(<NotchDropoutView />)

    await waitFor(() => {
      expect(document.querySelector('.notch-dropout')?.getAttribute('data-notch')).toBe('false')
    })
    expect(document.querySelector('.notch-dropout-band-gap')).toBeNull()
    expect(screen.getByText('Clipboard')).toBeTruthy()
  })

  it('fills the expanded body with clipboard rows on a notched display', async () => {
    const entries = Array.from({ length: 6 }, (_, i) => ({
      id: `e${i}`,
      item: { kind: 'text', text: `entry-${i}`, title: `Entry ${i}` },
      capturedAt: new Date().toISOString(),
      categoryIds: [],
    }))
    getLedge().getState.mockResolvedValue({ clipboardHistory: entries })
    getLedge().notchDropoutGeometry.mockResolvedValue(notchedGeometry)

    const { container } = render(<NotchDropoutView />)
    await waitFor(() => {
      expect(container.querySelector('.notch-dropout')?.getAttribute('data-notch')).toBe('true')
      expect(container.querySelectorAll('.notch-dropout-thumb').length).toBeGreaterThan(0)
    })

    const main = container.querySelector('.notch-dropout')!
    expect(container.querySelector('.notch-dropout-body')).toBeNull()

    await act(async () => {
      fireEvent.mouseEnter(main)
    })

    expect(container.querySelector('.notch-dropout-body')).toBeTruthy()
    expect(container.querySelectorAll('.notch-dropout-row').length).toBe(6)
  })
})
