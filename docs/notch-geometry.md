# Notch geometry, hover hysteresis, and swipe-to-reveal

How Ledge's notch panel decides *where* and *how big* it is, and when it opens.

## Where the numbers come from

Electron cannot see a MacBook notch: `screen.getAllDisplays()` exposes only
`bounds` and `workArea`, which describe the menu-bar *height* but not the
cut-out. The Swift helper therefore answers a `screen.metrics` request with, per
display:

| field | source (AppKit) |
|-------|-----------------|
| `displayId` | `CGDirectDisplayID` from `deviceDescription["NSScreenNumber"]` |
| `frame` / `visibleFrame` | `screen.frame` / `screen.visibleFrame`, flipped into Quartz coordinates |
| `hasNotch` | `safeAreaInsets.top > 0` |
| `notchWidth` | `auxiliaryTopRightArea.minX - auxiliaryTopLeftArea.maxX` (raw, no padding) |
| `notchHeight` | menu-bar height, minus a hair so the band sits flush |
| `menuBarHeight`, `safeAreaTop` | `frame.maxY - visibleFrame.maxY` (top inset only, not menu+Dock), `safeAreaInsets.top` |

`NotchMetricsService` caches the snapshot (30s TTL, one in-flight request,
refreshed on `display-added`/`display-removed`/`display-metrics-changed`) and
resolves it per Electron display by id, then by frame, then by nearest centre
within 100pt — so an external monitor never inherits the built-in's notch.

When the helper is absent, out of date, or reports no notch, `resolveNotchGeometry`
falls back to the pre-geometry behaviour: a 189pt-wide band at menu-bar height,
anchored *below* the menu bar instead of flush to the top. Nothing about the
panel breaks — it just stops being notch-shaped.

## Layout

* **Notched display** — the window is anchored flush to the top edge and the
  collapsed state is a band that *flanks* the cut-out: content sits left and
  right of a spacer exactly `notchWidth` wide. Nothing is ever painted inside the
  notch, because the notch is a physical cut-out; pixels there are not visible.
  Expanding grows the two shoulders outward and drops a scrollable list of
  clipboard entries below the band.
* **Notchless display** — the legacy header pill, below the menu bar.

Measured values reach CSS as custom properties (`--notch-width`,
`--notch-height`, `--notch-radius`, the last scaled against a 1728×1117 design
reference, clamped to 0.85–1.10).

## Reveal and collapse

`NotchHoverMonitor` polls the cursor (80ms near the notch, 250ms when it is far
away) and uses two *different* rects:

1. **Enter** — the notch band plus 8pt, with a 50ms debounce.
2. **Exit** — the revealed panel inflated by 60pt, plus a 700ms settle window
   after each reveal.

Identical enter/exit rects are what makes notch panels strobe: the panel appears
under the cursor, the cursor is instantly "outside" the hot zone, the panel
collapses, and the next pixel of movement re-opens it. The settle window covers
the same transition from the other side.

Swipe-to-reveal (a two-finger scroll in the top-centre band) comes from the
helper's event tap → `notch.revealRequested`; a scroll needs |vertical delta| >
6, a dominating vertical axis (either sign — natural scrolling flips the point
delta), and one trigger per gesture (trackpad momentum keeps streaming deltas
for a second after the fingers lift).

## Debugging

```bash
# What does the helper measure on this machine?
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"screen.metrics"}' \
  | native/DropShelfNativeAgent/.build/debug/DropShelfNativeAgent
```

The whole feature is behind `LEDGE_NOTCH_DROPOUT=1` (see
`src/main/services/featureFlags.ts`); with the flag off, no polling, no metrics
request, and no reveal watch is installed.

## Attribution

The techniques here — measuring the notch from `safeAreaInsets` +
`auxiliaryTopLeftArea`/`auxiliaryTopRightArea`, scaling against a design
reference resolution, asymmetric hover margins, and swipe-to-reveal — were
learned from [Sapphire](https://github.com/cshariq/Sapphire) (`Sapphire/Notch/`,
AGPL-3.0). Sapphire's code is **not** copied: Ledge is MIT, so every piece above
is an independent TypeScript/Swift implementation of the same ideas, written
against Electron's APIs rather than AppKit/SwiftUI ones.