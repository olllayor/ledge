// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { NotchDropoutView } from './NotchDropoutView'

interface MockLedge {
  clipboardGetRecent: ReturnType<typeof vi.fn>
  subscribeState: ReturnType<typeof vi.fn>
  onNotchDropoutStateChanged: ReturnType<typeof vi.fn>
  clipboardCopy: ReturnType<typeof vi.fn>
  clipboardStartItemDrag: ReturnType<typeof vi.fn>
  notchDropoutDragState: ReturnType<typeof vi.fn>
  notchDropoutHide: ReturnType<typeof vi.fn>
  showToast: ReturnType<typeof vi.fn>
}

function getLedge(): MockLedge {
  return (window as unknown as { ledge: MockLedge }).ledge
}

let stateListeners: Array<(state: { clipboardHistory: unknown[] }) => void> = []
let hintListeners: Array<(hint: { state: string }) => void> = []

function setupLedgeBridge() {
  stateListeners = []
  hintListeners = []
  const ledge: MockLedge = {
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
})
