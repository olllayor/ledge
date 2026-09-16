/**
 * Notch geometry: the measured silhouette of the hardware notch, plus the
 * hover/expand rectangles the reveal monitor uses.
 *
 * Technique ported from Sapphire (github.com/cshariq/Sapphire, AGPL-3.0 —
 * ideas re-implemented here, no code copied): measure the notch from AppKit
 * (`safeAreaInsets` + `auxiliaryTopLeftArea`/`auxiliaryTopRightArea`) instead
 * of guessing a fraction of the display width, and scale every metric against
 * a fixed design reference resolution so the silhouette looks identical on a
 * 14" and a 16" panel.
 */
import type { NativeScreenMetrics, NotchGeometry } from '@shared/schema';

/** Reference panel the notch paddings/radii were designed against. */
const DESIGN_REFERENCE_WIDTH = 1728;
const DESIGN_REFERENCE_HEIGHT = 1117;

/**
 * Sapphire's `fallbackClosedNotchSize` plus the presentation bleed, so a
 * helper-less reveal matches the measured path (185 + 4).
 */
const FALLBACK_NOTCH_WIDTH = 189;
const FALLBACK_NOTCH_HEIGHT = 32;

/** Extra width added to a measured notch so the shoulders bleed past it. */
const MEASURED_NOTCH_WIDTH_BLEED = 4;

/** Watched by the reveal monitor; a hover must reach this far into the band. */
export const HOVER_ENTER_MARGIN = 8;

/**
 * The cursor must leave the revealed panel by this much before it collapses
 * again. An asymmetric exit rect is what stops the flicker loop you get when
 * the enter and exit rects are identical.
 */
export const HOVER_EXIT_MARGIN = 60;

/**
 * After a reveal, ignore the exit edge for this long. Opening the panel of a
 * notch-sized hot zone moves the cursor *out* of the enter rect immediately,
 * which would otherwise collapse the panel in the same frame it appeared.
 */
export const REVEAL_SETTLE_MS = 700;

/** Sapphire clamps the corner-radius scale to this band. */
const CORNER_SCALE_MIN = 0.85;
const CORNER_SCALE_MAX = 1.1;

export interface DisplayRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DisplayLike {
  bounds: DisplayRect;
  workArea: DisplayRect;
}

export type Rect = DisplayRect;

export function scaleForDisplay(bounds: DisplayRect): number {
  const widthScale = bounds.width / DESIGN_REFERENCE_WIDTH;
  const heightScale = bounds.height / DESIGN_REFERENCE_HEIGHT;
  const raw = Math.min(widthScale, heightScale);
  return Math.min(Math.max(raw, CORNER_SCALE_MIN), CORNER_SCALE_MAX);
}

/**
 * Pure measurement maths, mirroring the Swift side so the two can be tested
 * independently: a notch is only real when AppKit reports a positive
 * `safeAreaInsets.top` *and* both auxiliary top areas.
 */
export function measureNotch(input: {
  hasNotch: boolean;
  measuredWidth: number;
  menuBarHeight: number;
  safeAreaTop: number;
  /** Helper's already-flushed height; preferred over recomputing from the menu bar. */
  helperNotchHeight?: number;
  screenshotFallbackWidth?: number;
}): { width: number; height: number } {
  let width = input.screenshotFallbackWidth ?? FALLBACK_NOTCH_WIDTH;
  let height = FALLBACK_NOTCH_HEIGHT;

  if (input.hasNotch && input.measuredWidth > 0) {
    width = input.measuredWidth + MEASURED_NOTCH_WIDTH_BLEED;
  }

  if (input.helperNotchHeight != null && input.helperNotchHeight > 0) {
    height = input.helperNotchHeight;
  } else if (input.menuBarHeight > 0) {
    height = Math.max(0, input.menuBarHeight);
  } else if (input.safeAreaTop > 0) {
    height = input.safeAreaTop;
  }

  return { width, height };
}

/**
 * Resolve the notch silhouette for one Electron display. When the Swift
 * helper has not replied yet (or the display is external) this falls back to
 * a menu-bar-height band with the classic notch width, which keeps the
 * behaviour identical to the pre-geometry panel.
 */
export function resolveNotchGeometry(
  display: DisplayLike,
  metrics: NativeScreenMetrics | null,
): NotchGeometry {
  const measuredWidth =
    metrics && metrics.hasNotch ? metrics.notchWidth : 0;
  const hasNotch = Boolean(metrics?.hasNotch);

  const menuBarHeight = metrics?.menuBarHeight ?? Math.max(0, display.workArea.y - display.bounds.y);
  const measured = measureNotch({
    hasNotch,
    measuredWidth,
    menuBarHeight,
    safeAreaTop: metrics?.safeAreaTop ?? 0,
    helperNotchHeight: metrics?.notchHeight,
  });

  const scale = scaleForDisplay(display.bounds);
  // A notchless display keeps the legacy behaviour: the panel drops below the
  // menu bar instead of hugging it.
  const top = hasNotch ? display.bounds.y : display.bounds.y + menuBarHeight;

  return {
    hasNotch,
    menuBarHeight,
    notchWidth: measured.width,
    notchHeight: measured.height,
    scale,
    cornerRadius: Math.round(10 * scale),
    centerX:
      display.bounds.x + Math.round(display.bounds.width / 2),
    top,
  };
}

/** The hot zone that reveals the panel. */
export function enterRect(geometry: NotchGeometry, bounds: DisplayRect): Rect {
  const width = geometry.notchWidth + HOVER_ENTER_MARGIN * 2;
  const x = bounds.x + Math.round((bounds.width - width) / 2);
  const height = geometry.notchHeight + HOVER_ENTER_MARGIN;
  return { x, y: bounds.y, width, height };
}

/** The rect the cursor must leave for the panel to collapse again. */
export function exitRect(panel: DisplayRect): Rect {
  return {
    x: panel.x - HOVER_EXIT_MARGIN,
    y: panel.y - HOVER_EXIT_MARGIN,
    width: panel.width + HOVER_EXIT_MARGIN * 2,
    height: panel.height + HOVER_EXIT_MARGIN * 2,
  };
}

export function containsPoint(rect: Rect, point: { x: number; y: number }): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}