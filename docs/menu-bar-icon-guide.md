# Menu-bar icon design guide

> How to derive a crisp, on-brand tray icon from the Ledge app logo.
> The tray slot is unforgiving — 16×16 px (32×32 @2x), monochrome, and
> rendered through macOS's template-image pipeline. The full-color app
> icon will not survive that compression. This guide walks the
> design from logo → tray.

## Why a separate icon

Ledge's app icon (`build/icon.png`, derived from `build/icon-source.png`)
is a 1024×1024 full-color mark with soft gradients, shadow filters, and
a pastel background — designed for Finder, the Dock, the `.icns` bundle,
the landing page, and the renderer sidebar at ≥48 px.

The menu-bar tray is a different surface:

| Surface | Size | Color | Rendering |
|---|---|---|---|
| App icon | 16 → 1024 px | Full color, gradients, shadow | sips + iconutil |
| Menu bar | 16 px / 32 px @2x | **Monochrome template** (alpha-only) | electron `Tray` + `nativeImage` |
| Dock | 128 → 1024 px | Full color | macOS composites |

macOS renders tray icons as **template images**: it keeps only the alpha
channel and re-tints the silhouette to match the user's menu-bar
appearance (dark mode, light mode, accent color tinting). Anything
that's not silhouette — color, gradient, shadow, background — is
dropped. A full-color app icon uploaded as a tray icon will look
muddy, blurred, and the wrong color.

## The existing tray icon

`build/tray-icon.svg` is the source of truth:

```svg
<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
  <!-- Card resting on a ledge tray (template: black on transparent) -->
  <rect x="5" y="3" width="6" height="6" rx="1" fill="black"/>
  <path d="M2 9.5 L2 11 Q2 12 3 12 L13 12 Q14 12 14 11 L14 9.5 L12.5 9.5 L12.5 11 L3.5 11 L3.5 9.5 Z" fill="black"/>
</svg>
```

Three rules it follows:

1. **`viewBox="0 0 16 16"`** — the icon is authored at native pixel
   size, not blown up from a 1024 px master. This keeps strokes and
   corners pixel-aligned.
2. **`fill="black"` only** — no gradients, no opacity, no background
   rect. The alpha mask *is* the icon.
3. **Two glyphs, ~10 px wide each** — the card and the ledge. Anything
   smaller disappears when scaled to 16 px.

`scripts/build-brand.mjs` renders this SVG to
`tray-icon.png` (16×16) and `tray-icon@2x.png` (32×32) using
ImageMagick, and `src/main/tray.ts` loads the PNG as a template image.

## Deriving a new tray icon from a new app logo

### 1. Pick the silhouette, not the palette

Open the new app logo and ask: **"if I crush this to 16×16 black on
transparent, what survives?"** Most of the answer is "the outline of
the most prominent shape." That's what you design for.

Common survivors:
- A single bold letterform (a monogram).
- A geometric mark — a square, triangle, arrow, dot.
- One dominant object from the logo (the card, the shelf, the lid).

Common non-survivors:
- Multi-color gradients (lose all color, gain only luminance).
- Thin strokes under ~1.5 px (blur into nothingness at 16 px).
- Text smaller than ~8 px (illegible).
- Background fills (the menu bar *is* the background).

### 2. Rebuild as a 16×16 SVG, not a downsized PNG

Do not export the 1024 px logo as a 16 px PNG. macOS will not
re-anti-alias it the way the App Store expects, and you lose all the
vector advantages.

Author a fresh `build/tray-icon.svg`:

```svg
<svg width="16" height="16" viewBox="0 0 16 16"
     xmlns="http://www.w3.org/2000/svg" fill="black">
  <!-- One shape, 1-2 strokes, all aligned to the 16 px grid -->
</svg>
```

Conventions:
- **Stroke or fill, not both.** Pick one. Fill reads chunkier and
  pixel-aligned; stroke reads more delicate but blurs fast.
- **Integer coordinates** wherever possible (`x="4"` not `x="4.2"`).
  This keeps edges sharp.
- **No anti-aliased gradients.** No `<linearGradient>`, no opacity
  ramps. Pure black or pure transparent.
- **Padding 1 px on every edge.** The menu bar reserves a 1 px
  optical margin; a tray icon that touches the bounding box reads
  cramped.
- **Symmetry beats detail.** At 16 px, the human eye averages over
  the whole shape. A perfectly centered mark with even negative
  space reads as "designed" even if individual strokes are crude.

### 3. Validate at three sizes

Before you commit, render and check:

```bash
# Requires ImageMagick (brew install imagemagick)
magick build/tray-icon.svg -resize 16x16 build/tray-icon.png
magick build/tray-icon.svg -resize 32x32 build/tray-icon@2x.png

# Open both at 100% and 200% in Preview, then place them on a
# sample menu bar background (light gray + dark gray) to confirm
# the silhouette reads on both.
```

Pay attention to:
- **Letterform legibility** — can you tell "L" from "I" at 16 px?
- **Stroke weight** — if you used strokes, do they vanish on @1x?
- **Negative space** — does the background leak through in a way
  that breaks the silhouette?

### 4. Wire it into the build

`scripts/build-brand.mjs` already handles tray regeneration as the
last step. The flow is:

```
build/tray-icon.svg  ──▶  magick -resize 16x16  ──▶  build/tray-icon.png
                       └─▶  magick -resize 32x32  ──▶  build/tray-icon@2x.png
```

`src/main/tray.ts` loads the PNG with the right template flag:

```ts
const trayPath = join(resourcesDir, 'tray-icon.png')
const fallbackPath = join(resourcesDir, 'icon.png')
// Tray is created with nativeImage.createFromPath() inside
// createTrayImage(), then handed to `new Tray(...)`. macOS
// re-tints the alpha channel to match the menu bar appearance.
```

You do **not** need to touch `tray.ts` to change the icon — replace
`build/tray-icon.svg` and run `pnpm brand:build`.

### 5. Update `pnpm dev` to verify

`pnpm dev` runs `brand:build` first, so any change to the SVG is
picked up on the next `pnpm dev` cycle. To force a rebuild of just
the icons:

```bash
pnpm brand:build
```

Then quit and relaunch the app to see the new tray icon (Electron
caches the tray image per session).

## Common mistakes

- **Color.** Any non-black/non-transparent fill becomes a hard edge
  the menu bar can't tint away. Result: a tiny blue smudge in a
  black-and-white row of icons.
- **Transparent fills inside the silhouette.** A "hollow" letter
  with a 1 px transparent center looks fine at 32 px and disappears
  at 16 px. Either fill the negative space or thicken the stroke.
- **Excessive detail.** A faithful 16 px reproduction of a complex
  logo is almost always worse than a re-drawn simple mark. Step
  back and pick the one shape that means "Ledge."
- **Rounded everything.** Generous `rx` values look soft at 64 px
  and mushy at 16 px. Use `rx="1"` max for 16 px viewboxes.
- **Skipping @2x.** The Retina menu bar is 32 px; if you only ship
  16 px, the icon is upscaled and blurry on every modern Mac.

## When to redesign vs. reuse

If the new app logo is **a different concept entirely** (e.g.
switching from the shelf+card to a wordmark or a different
metaphor), the tray icon should be redrawn from scratch. Don't try
to shrink a wordmark — at 16 px a wordmark is just a black blob.

If the new logo is **a refinement of the same concept** (different
shades, sharper edges, but the same shelf+card), the existing
`tray-icon.svg` may already work. Try shipping it unchanged and
look at it on the menu bar before redesigning.

## Checklist

- [ ] Source authored as `build/tray-icon.svg` at `viewBox="0 0 16 16"`
- [ ] Pure black `fill="black"`, no gradients, no opacity
- [ ] Integer coordinates, 1 px padding on all edges
- [ ] One dominant shape; multi-element icons kept under 3 parts
- [ ] Rendered to `tray-icon.png` (16×16) and `tray-icon@2x.png` (32×32)
- [ ] Visually checked on a light menu bar and a dark menu bar
- [ ] Verified at 100% and 200% zoom in Preview
- [ ] `pnpm brand:build` regenerates without warnings
- [ ] `pnpm dev` shows the new icon after a relaunch
