import { memo, useCallback, useEffect,  useRef, useState, type RefObject } from 'react';
import type { AppState, IngestPayload, ShelfItemRecord } from '@shared/schema';
import { getExportableItems, getHeroCountLabel, getHeroMode, type HeroMode, type SessionMode } from './shelfFlow';
import {
  getHeroPreviewSource,
  heroStackClassName,
  isExternalTransfer,
  payloadsFromTransfer,
} from './shelfDrop';
import {
  IconClose,
  IconMenuDots,
  IconChevronDown,
  IconChevronLeft,
  IconGrid,
  IconFolder,
  IconArrowUpRight,
} from './Icons';

function EmptyStateIllustration() {
  return (
    <svg
      viewBox="0 0 96 96"
      aria-hidden="true"
      className="empty-state-illustration"
    >
      <defs>
        <clipPath id="doc-clip">
          <rect x="0" y="0" width="28" height="36" rx="4" />
        </clipPath>
      </defs>
      {/* Back-left doc */}
      <g className="empty-state-doc empty-state-doc-left">
        <rect
          x="14"
          y="22"
          width="28"
          height="36"
          rx="4"
          fill="var(--surface)"
          stroke="var(--line)"
          strokeWidth="1"
        />
        <rect x="18" y="30" width="20" height="2" rx="1" fill="var(--line-strong)" opacity="0.6" />
        <rect x="18" y="36" width="16" height="2" rx="1" fill="var(--line-strong)" opacity="0.4" />
        <rect x="18" y="42" width="12" height="2" rx="1" fill="var(--line-strong)" opacity="0.3" />
      </g>
      {/* Back-right doc */}
      <g className="empty-state-doc empty-state-doc-right">
        <rect
          x="54"
          y="22"
          width="28"
          height="36"
          rx="4"
          fill="var(--surface)"
          stroke="var(--line)"
          strokeWidth="1"
        />
        <rect x="58" y="30" width="20" height="2" rx="1" fill="var(--line-strong)" opacity="0.6" />
        <rect x="58" y="36" width="16" height="2" rx="1" fill="var(--line-strong)" opacity="0.4" />
        <rect x="58" y="42" width="12" height="2" rx="1" fill="var(--line-strong)" opacity="0.3" />
      </g>
      {/* Front-center doc */}
      <g className="empty-state-doc empty-state-doc-center">
        <rect
          x="34"
          y="30"
          width="28"
          height="36"
          rx="4"
          fill="var(--surface-strong)"
          stroke="var(--line-strong)"
          strokeWidth="1"
        />
        <rect x="38" y="38" width="20" height="2" rx="1" fill="var(--ink-faint)" opacity="0.5" />
        <rect x="38" y="44" width="16" height="2" rx="1" fill="var(--ink-faint)" opacity="0.35" />
        <rect x="38" y="50" width="12" height="2" rx="1" fill="var(--ink-faint)" opacity="0.25" />
      </g>
      {/* Shelf base */}
      <rect
        x="12"
        y="72"
        width="72"
        height="8"
        rx="4"
        fill="var(--surface)"
        stroke="var(--line)"
        strokeWidth="1"
        opacity="0.8"
      />
    </svg>
  );
}

interface ShelfViewState {
  liveShelf: AppState['liveShelf'];
  preferences: {
    shelfInteraction: AppState['preferences']['shelfInteraction'];
    shakeEnabled: AppState['preferences']['shakeEnabled'];
  };
  permissionStatus: AppState['permissionStatus'];
}

interface ShelfViewProps {
  state: ShelfViewState;
}

function ShelfView({ state }: ShelfViewProps) {
  const liveShelf = state.liveShelf;
  const items = liveShelf?.items ?? [];
  const primaryItem = items[0] ?? null;
  const itemCount = items.length;
  const heroMode = getHeroMode(items);
  const shelfInteraction = state.preferences.shelfInteraction;
  const autoCloseShelf = shelfInteraction.autoCloseShelf ?? false;
  const doubleClickAction = shelfInteraction.doubleClickAction ?? 'open';
  const [isImporting, setIsImporting] = useState(false);
  const [sessionMode, setSessionMode] = useState<SessionMode>('idle');
  const [isHovering, setIsHovering] = useState(false);
  const [undoState, setUndoState] = useState<{ paths: string[] } | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const itemSheetRef = useRef<HTMLDivElement | null>(null);
  const lastUpdatedAtRef = useRef(liveShelf?.updatedAt ?? '');
  const dragDepthRef = useRef(0);
  const undoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPingRef = useRef(0);
  const PING_INTERVAL_MS = 1000;
  const UNDO_TIMEOUT = 5000;
  const isAcceptingDrop = sessionMode === 'acceptingDrop';
  const isExporting = sessionMode === 'exporting';
  const isMenuOpen = sessionMode === 'menuOpen';
  const isItemListOpen = sessionMode === 'itemListOpen';
  const banner = !state.permissionStatus.nativeHelperAvailable
    ? {
        title: 'Native helper is unavailable',
        copy: state.permissionStatus.lastError || 'Rebuild the bundled helper to re-enable shake detection.',
      }
    : state.preferences.shakeEnabled && !state.permissionStatus.accessibilityTrusted
      ? {
          title: 'Accessibility access is off',
          copy: 'Enable it if you want shake-to-open.',
        }
      : state.permissionStatus.lastError
        ? {
            title: 'Native helper reported an error',
            copy: state.permissionStatus.lastError,
          }
        : null;

  useEffect(() => {
    dragDepthRef.current = 0;
    setSessionMode('idle');
  }, [liveShelf?.id]);

  useEffect(() => {
    const nextUpdatedAt = liveShelf?.updatedAt ?? '';
    const didMutateShelf = lastUpdatedAtRef.current !== '' && lastUpdatedAtRef.current !== nextUpdatedAt;

    if (didMutateShelf && sessionMode === 'exporting') {
      setSessionMode('idle');
    }

    lastUpdatedAtRef.current = nextUpdatedAt;
  }, [liveShelf?.updatedAt, sessionMode]);

  useEffect(() => {
    if (liveShelf || itemCount !== 0) {
      return;
    }

    dragDepthRef.current = 0;
    setSessionMode('idle');
  }, [itemCount, liveShelf]);


  useEffect(() => {
    const handleFocus = () => {
      setSessionMode((current) => (current === 'exporting' ? 'idle' : current));
    };

    window.addEventListener('focus', handleFocus);
    return () => {
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  useEffect(() => {
    if (sessionMode !== 'menuOpen' && sessionMode !== 'itemListOpen') {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (sessionMode === 'menuOpen') {
        if (menuRef.current?.contains(target) || menuButtonRef.current?.contains(target)) {
          return;
        }
      }

      if (sessionMode === 'itemListOpen' && itemSheetRef.current?.contains(target)) {
        return;
      }

      setSessionMode('idle');
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }

      setSessionMode('idle');
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [sessionMode]);

  const pushPayloads = useCallback(async (payloads: IngestPayload[]) => {
    if (payloads.length === 0) {
      return;
    }

    setIsImporting(true);
    setSessionMode('idle');

    try {
      if (!liveShelf) {
        await window.ledge.createShelf({ reason: 'manual' });
      }

      await window.ledge.addPayloads(payloads);
    } finally {
      setIsImporting(false);
    }
  }, [liveShelf]);

  const resetDropState = useCallback(() => {
    dragDepthRef.current = 0;
    setSessionMode((current) => (current === 'acceptingDrop' ? 'idle' : current));
  }, []);

  const pingInteraction = useCallback(() => {
    const now = Date.now();
    if (now - lastPingRef.current < PING_INTERVAL_MS) {
      return;
    }
    lastPingRef.current = now;
    window.ledge.shelfInteractionPing();
  }, []);

  const handleExportAndClear = useCallback(() => {
    const exportable = getExportableItems(items);
    if (exportable.length === 0) return false;

    const didStartDrag =
      exportable.length === 1
        ? window.ledge.startItemDrag(exportable[0]!.id)
        : window.ledge.startItemsDrag(exportable.map((i) => i.id));

    if (didStartDrag) {
      const paths = (
        exportable as { file: { resolvedPath?: string; originalPath?: string; isMissing: boolean } }[]
      )
        .filter((i) => !i.file.isMissing)
        .map((i) => i.file.resolvedPath || i.file.originalPath)
        .filter((p): p is string => Boolean(p));
      if (paths.length > 0) {
        setUndoState({ paths });
        if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
        undoTimeoutRef.current = setTimeout(() => setUndoState(null), UNDO_TIMEOUT);
      }
      window.ledge.clearShelf();
    }

    return didStartDrag;
  }, [items]);

  const handleDragEnter = useCallback((event: React.DragEvent<HTMLElement>) => {
    if (isExporting || !isExternalTransfer(event.dataTransfer)) {
      return;
    }

    dragDepthRef.current += 1;
    setSessionMode('acceptingDrop');
    pingInteraction();
  }, [isExporting, pingInteraction]);

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLElement>) => {
    if (isExporting || !isExternalTransfer(event.dataTransfer)) {
      return;
    }

    const nextDepth = Math.max(0, dragDepthRef.current - 1);
    dragDepthRef.current = nextDepth;

    if (nextDepth === 0 && !event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setSessionMode((current) => (current === 'acceptingDrop' ? 'idle' : current));
    }
  }, [isExporting]);

  const handleDragOver = useCallback((event: React.DragEvent<HTMLElement>) => {
    if (isExporting || !isExternalTransfer(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    pingInteraction();

    if (sessionMode !== 'acceptingDrop') {
      setSessionMode('acceptingDrop');
    }
  }, [isExporting, sessionMode, pingInteraction]);

  const handleDrop = useCallback(async (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    resetDropState();
    pingInteraction();
    await pushPayloads(await payloadsFromTransfer(event.dataTransfer));
  }, [resetDropState, pingInteraction, pushPayloads]);

  const handlePaste = useCallback(async (event: React.ClipboardEvent<HTMLDivElement>) => {
    const payloads = await payloadsFromTransfer(event.clipboardData);
    if (payloads.length === 0) {
      return;
    }

    event.preventDefault();
    await pushPayloads(payloads);
  }, [pushPayloads]);

  const openItemSheet = useCallback(() => {
    setSessionMode('itemListOpen');
  }, []);

  const openOverflowMenu = useCallback(async () => {
    if (!liveShelf) {
      return;
    }
    await window.ledge.showShelfContextMenu();
  }, [liveShelf]);

  const closeTransientSurface = useCallback(() => {
    dragDepthRef.current = 0;
    setSessionMode('idle');
  }, []);

  const handleExportStart = useCallback(() => {
    setSessionMode('exporting');
  }, []);

  const handleExportEnd = useCallback(() => {
    setSessionMode((current) => (current === 'exporting' ? 'idle' : current));
  }, []);

  return (
    <main
      className={`shelf-shell${isAcceptingDrop ? ' is-accepting-drop' : ''}${isExporting ? ' is-exporting' : ''}${isItemListOpen ? ' has-item-sheet' : ''}`}
      onPaste={handlePaste}
      tabIndex={0}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onPointerDown={pingInteraction}
      onKeyDown={pingInteraction}
      onPointerEnter={() => {
        if (isExporting) {
          setSessionMode('idle');
        }
        setIsHovering(true);
      }}
      onPointerLeave={() => {
        setIsHovering(false);
      }}
    >
      <div className="drag-handle" />

      {isItemListOpen && liveShelf ? (
        <ItemSheet
          items={items}
          sheetRef={itemSheetRef}
          doubleClickAction={doubleClickAction}
          onClose={closeTransientSurface}
        />
      ) : (
        <>
          <header className="shelf-topbar">
            <button
              className="chrome-button chrome-button-close"
              onClick={() => void window.ledge.closeShelf()}
              aria-label="Close shelf"
            >
              <IconClose />
            </button>

            <button
              ref={menuButtonRef}
              className="chrome-button chrome-button-menu"
              onClick={openOverflowMenu}
              disabled={!liveShelf || isExporting}
              aria-label="Open shelf actions"
              aria-haspopup="menu"
              aria-expanded={isMenuOpen}
            >
              <IconMenuDots />
            </button>
          </header>

          <section
            className={`drop-surface compact ${itemCount === 0 ? 'is-empty' : ''}${isAcceptingDrop ? ' is-accepting' : ''}`}
          >
            {itemCount === 0 ? (
              <div className="empty-state compact">
                <EmptyStateIllustration />
                <p className="surface-title compact">Drop files here</p>
              </div>
            ) : primaryItem ? (
              <div className="hero-wrapper">
                <HeroItemMemo
                  items={items}
                  item={primaryItem}
                  heroMode={heroMode}
                  isImporting={isImporting}
                  isExporting={isExporting}
                  dragLocked={isMenuOpen || isItemListOpen}
                  autoCloseShelf={autoCloseShelf}
                  doubleClickAction={doubleClickAction}
                  onExportStart={handleExportStart}
                  onExportEnd={handleExportEnd}
                  onExportItems={handleExportAndClear}
                  onOpenItemSheet={openItemSheet}
                />
                {isHovering && !isExporting && !isImporting && itemCount > 0 && (
                  <button
                    className="drag-button"
                    onClick={handleExportAndClear}
                    aria-label="Drag items out"
                  >
                    <IconArrowUpRight />
                  </button>
                )}
              </div>
            ) : (
              <div className="empty-state compact">
                <EmptyStateIllustration />
                <p className="surface-title compact">Drop files here</p>
              </div>
            )}
          </section>

          {banner ? (
            <section className="permission-banner compact">
              <div>
                <p className="banner-title">{banner.title}</p>
                <p className="banner-copy">{banner.copy}</p>
              </div>
              <button className="ghost-button small" onClick={() => void window.ledge.openPermissionSettings()}>
                Open Settings
              </button>
            </section>
          ) : null}

          {undoState ? (
            <div className="undo-bar">
              <span className="undo-bar-label">Items exported</span>
              <button
                className="undo-bar-action"
                onClick={() => {
                  void window.ledge.addPayloads([{ kind: 'fileDrop', paths: undoState.paths }]);
                  setUndoState(null);
                  if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
                }}
                type="button"
              >
                Undo
              </button>
            </div>
          ) : null}
        </>
      )}
    </main>
  );
}

function shelfItemsEqual(a: ShelfItemRecord[], b: ShelfItemRecord[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const itemA = a[i];
    const itemB = b[i];
    if (
      itemA.id !== itemB.id ||
      itemA.kind !== itemB.kind ||
      itemA.title !== itemB.title ||
      itemA.subtitle !== itemB.subtitle ||
      itemA.preview.summary !== itemB.preview.summary ||
      itemA.preview.detail !== itemB.preview.detail ||
      itemA.order !== itemB.order
    ) {
      return false;
    }
    if (itemA.kind === 'file' && itemB.kind === 'file') {
      if (
        itemA.file.originalPath !== itemB.file.originalPath ||
        itemA.file.resolvedPath !== itemB.file.resolvedPath ||
        itemA.file.isStale !== itemB.file.isStale ||
        itemA.file.isMissing !== itemB.file.isMissing
      ) {
        return false;
      }
      if (itemA.mimeType !== itemB.mimeType) return false;
    }
    if (itemA.kind === 'folder' && itemB.kind === 'folder') {
      if (
        itemA.file.originalPath !== itemB.file.originalPath ||
        itemA.file.resolvedPath !== itemB.file.resolvedPath ||
        itemA.file.isStale !== itemB.file.isStale ||
        itemA.file.isMissing !== itemB.file.isMissing
      ) {
        return false;
      }
    }
    if (itemA.kind === 'imageAsset' && itemB.kind === 'imageAsset') {
      if (
        itemA.file.originalPath !== itemB.file.originalPath ||
        itemA.file.resolvedPath !== itemB.file.resolvedPath ||
        itemA.file.isStale !== itemB.file.isStale ||
        itemA.file.isMissing !== itemB.file.isMissing
      ) {
        return false;
      }
      if (itemA.mimeType !== itemB.mimeType) return false;
    }
    if (itemA.kind === 'text' && itemB.kind === 'text') {
      if (itemA.text !== itemB.text) return false;
      if (itemA.savedFilePath !== itemB.savedFilePath) return false;
    }
    if (itemA.kind === 'url' && itemB.kind === 'url') {
      if (itemA.url !== itemB.url) return false;
      if (itemA.savedFilePath !== itemB.savedFilePath) return false;
    }
  }
  return true;
}

const ShelfViewMemo = memo(ShelfView, (prevProps, nextProps) => {
  const prevShelf = prevProps.state.liveShelf;
  const nextShelf = nextProps.state.liveShelf;

  if (prevShelf?.id !== nextShelf?.id) return false;
  if (prevShelf?.updatedAt !== nextShelf?.updatedAt) return false;
  if (!shelfItemsEqual(prevShelf?.items ?? [], nextShelf?.items ?? [])) return false;

  const prevPrefs = prevProps.state.preferences;
  const nextPrefs = nextProps.state.preferences;
  if (prevPrefs.shelfInteraction.doubleClickAction !== nextPrefs.shelfInteraction.doubleClickAction) return false;
  if (prevPrefs.shelfInteraction.autoCloseShelf !== nextPrefs.shelfInteraction.autoCloseShelf) return false;
  if (prevPrefs.shakeEnabled !== nextPrefs.shakeEnabled) return false;

  const prevPerm = prevProps.state.permissionStatus;
  const nextPerm = nextProps.state.permissionStatus;
  if (prevPerm.nativeHelperAvailable !== nextPerm.nativeHelperAvailable) return false;
  if (prevPerm.accessibilityTrusted !== nextPerm.accessibilityTrusted) return false;
  if (prevPerm.lastError !== nextPerm.lastError) return false;

  return true;
});

export { ShelfViewMemo as ShelfView };

const HeroGlyphMemo = memo(HeroGlyph);
HeroGlyph.displayName = 'HeroGlyph';
HeroGlyphMemo.displayName = 'HeroGlyphMemo';

const HeroItemMemo = memo(HeroItem);
HeroItem.displayName = 'HeroItem';
HeroItemMemo.displayName = 'HeroItemMemo';

interface ItemSheetProps {
  items: ShelfItemRecord[];
  sheetRef: RefObject<HTMLDivElement | null>;
  doubleClickAction: 'open' | 'reveal';
  onClose(): void;
}

function ItemSheet({ items, sheetRef, doubleClickAction, onClose }: ItemSheetProps) {
  function handleCellDoubleClick(itemId: string) {
    if (doubleClickAction === 'reveal') {
      void window.ledge.revealItem(itemId);
    } else {
      void window.ledge.openItem(itemId);
    }
  }

  return (
    <section ref={sheetRef} className="item-sheet" aria-label="Shelf items">
      <header className="item-sheet-header">
        <button className="ghost-button icon-button" onClick={onClose} aria-label="Back">
          <IconChevronLeft />
        </button>
        <div className="item-sheet-header-center">
          <p className="item-sheet-title">{items.length} Files</p>
          <p className="item-sheet-copy">{items.length > 0 ? 'Items in shelf' : ''}</p>
        </div>
        <div className="item-sheet-actions" aria-hidden="true">
          <span className="ghost-button icon-button active" aria-label="Grid view (only mode)">
            <IconGrid />
          </span>
        </div>
      </header>
      <div className="item-sheet-grid">
        {items.map((item) => (
          <div
            className="item-grid-cell"
            key={item.id}
            onContextMenu={(e) => {
              e.preventDefault();
              window.ledge.showItemContextMenu(item.id);
            }}
            onDoubleClick={() => handleCellDoubleClick(item.id)}
          >
            <div className="item-grid-preview">
              {getHeroPreviewSource(item) ? (
                <img src={getHeroPreviewSource(item) || undefined} alt={item.title} width={88} height={88} />
              ) : (
                <HeroGlyphMemo kind={item.kind} />
              )}
            </div>
            <p className="item-grid-title">{item.title}</p>
            <p className="item-grid-subtitle">{item.preview.summary || item.subtitle || 'File'}</p>
          </div>
        ))}
        {items.length > 0 && (
          <button className="item-grid-cell action-cell" onClick={() => window.ledge.revealItem(items[0]?.id)} type="button">
            <div className="item-grid-preview action-preview">
              <IconFolder />
            </div>
            <p className="item-grid-title">Reveal in Finder</p>
          </button>
        )}
      </div>
    </section>
  );
}

interface HeroItemProps {
  items: ShelfItemRecord[];
  item: ShelfItemRecord;
  heroMode: HeroMode;
  isImporting: boolean;
  isExporting: boolean;
  dragLocked: boolean;
  autoCloseShelf: boolean;
  doubleClickAction: 'open' | 'reveal';
  onExportStart(): void;
  onExportEnd(): void;
  onExportItems(): boolean;
  onOpenItemSheet(): void;
}

function HeroItem({
  items,
  item,
  heroMode,
  isImporting,
  isExporting,
  dragLocked,
  autoCloseShelf,
  doubleClickAction,
  onExportStart,
  onExportEnd,
  onExportItems,
  onOpenItemSheet,
}: HeroItemProps) {
  const previewSrc = getHeroPreviewSource(item);
  const needsRelink = 'file' in item && item.file.isMissing;
  const exportableItems = getExportableItems(items);
  const canDragOut = exportableItems.length > 0 && !dragLocked && !isImporting;
  const statusLabel = isImporting ? 'Importing…' : getHeroCountLabel(items, heroMode);
  const collageItems = heroMode === 'collage' ? items.slice(0, 3).map((entry, index) => ({ item: entry, index })) : [];
  const stackLayers = heroMode === 'stack' ? items.slice(0, Math.min(3, items.length)) : [];
  const dragLabel =
    exportableItems.length > 1
      ? `Drag out ${exportableItems.length} items`
      : exportableItems.length === 1
        ? `Drag out ${exportableItems[0]!.title}`
        : undefined;

  function handleHeroDragStart(event: React.DragEvent<HTMLDivElement>) {
    if (!canDragOut) {
      return;
    }

    event.preventDefault();
    if (onExportItems()) {
      onExportStart();
    } else {
      onExportEnd();
    }
  }

  function handleHeroDoubleClick() {
    if (isExporting) {
      return;
    }
    if (doubleClickAction === 'reveal') {
      void window.ledge.revealItem(item.id);
    } else {
      void window.ledge.openItem(item.id);
    }
  }

  return (
    <div
      className={`hero-item is-${heroMode}${canDragOut ? ' is-draggable' : ''}${isExporting ? ' is-exporting' : ''}`}
      draggable={canDragOut}
      onDragStart={handleHeroDragStart}
      onDragEnd={() => {
        const wasExporting = isExporting;
        onExportEnd();
        if (autoCloseShelf && wasExporting) {
          void window.ledge.closeShelf();
        }
      }}
      onDoubleClick={handleHeroDoubleClick}
      onContextMenu={(e) => {
        e.preventDefault();
        window.ledge.showItemContextMenu(item.id);
      }}
      title={dragLabel}
    >
      <div className={`hero-stage is-${heroMode}${isExporting ? ' is-exporting' : ''}`}>
        {heroMode === 'collage' ? (
          <div className={`hero-collage${isExporting ? ' is-muted' : ''}`} aria-hidden="true">
            {collageItems.map(({ item: collageItem, index }) => {
              const src = getHeroPreviewSource(collageItem);
              const stackClassName = heroStackClassName(index, collageItems.length);
              return (
                <div key={collageItem.id} className={`hero-stack-card ${stackClassName}`}>
                  {src ? (
                    <img src={src} alt="" className="hero-stack-image" draggable={false} width={104} height={132} />
                  ) : (
                    <HeroGlyphMemo kind={collageItem.kind} />
                  )}
                </div>
              );
            })}
          </div>
        ) : heroMode === 'stack' ? (
          <div className="hero-deck" aria-hidden="true">
            {stackLayers.slice(1, 3).map((entry, index) => (
              <div key={entry.id} className={`hero-deck-shadow hero-deck-shadow-${index + 1}`} />
            ))}
            <div className={`hero-artwork hero-artwork-deck ${isExporting ? 'is-exporting' : ''}`}>
              {previewSrc ? (
                <img src={previewSrc} alt="" className="hero-image" draggable={false} width={88} height={88} />
              ) : (
                <HeroGlyphMemo kind={item.kind} />
              )}
            </div>
          </div>
        ) : (
          <div className={`hero-artwork ${isExporting ? 'is-exporting' : ''}`}>
            {previewSrc ? (
              <img src={previewSrc} alt="" className="hero-image" draggable={false} width={88} height={88} />
            ) : (
              <HeroGlyphMemo kind={item.kind} />
            )}
          </div>
        )}

        {isExporting ? <div className="hero-export-veil" aria-hidden="true" /> : null}
      </div>

      <button
        className={`hero-count-button${isExporting ? ' is-exporting' : ''}`}
        onClick={onOpenItemSheet}
        disabled={items.length < 2}
        aria-label={isImporting ? "Importing items" : `Open shelf with ${items.length} ${items.length === 1 ? "item" : "items"}`}
      >
        <span>{statusLabel}</span>
        {items.length >= 2 ? <IconChevronDown /> : null}
      </button>
      {needsRelink ? (
        <button className="hero-relink-button" type="button" onClick={() => void window.ledge.relinkItem(item.id)}>
          Relink
        </button>
      ) : null}
    </div>
  );
}

function HeroGlyph({ kind }: { kind: ShelfItemRecord['kind'] }) {
  if (kind === 'folder') {
    return (
      <svg viewBox="0 0 96 96" aria-hidden="true">
        <path
          d="M16 28a10 10 0 0 1 10-10h16l8 8h20a10 10 0 0 1 10 10v28a12 12 0 0 1-12 12H24A12 12 0 0 1 12 64V28h4Z"
          fill="rgba(255,255,255,0.96)"
        />
        <path
          d="M20 34h56a8 8 0 0 1 8 8v20a10 10 0 0 1-10 10H24A10 10 0 0 1 14 62V40a6 6 0 0 1 6-6Z"
          fill="rgba(230,232,235,0.95)"
        />
      </svg>
    );
  }

  if (kind === 'url') {
    return (
      <svg viewBox="0 0 96 96" aria-hidden="true">
        <path
          d="M38 58l20-20m-7-10h8a16 16 0 1 1 0 32h-8m-6 0h-8a16 16 0 0 1 0-32h8"
          fill="none"
          stroke="rgba(255,255,255,0.96)"
          strokeWidth="8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (kind === 'text') {
    return (
      <svg viewBox="0 0 96 96" aria-hidden="true">
        <path d="M28 16h30l18 18v42a8 8 0 0 1-8 8H28a8 8 0 0 1-8-8V24a8 8 0 0 1 8-8Z" fill="rgba(255,255,255,0.96)" />
        <path d="M58 16v18h18" fill="rgba(225,228,232,0.95)" />
        <path d="M34 50h28M34 60h20" stroke="rgba(136,139,144,0.8)" strokeWidth="6" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 96 96" aria-hidden="true">
      <path
        d="M28 14h30l18 18v40a10 10 0 0 1-10 10H28a10 10 0 0 1-10-10V24a10 10 0 0 1 10-10Z"
        fill="rgba(255,255,255,0.97)"
      />
      <path d="M58 14v18a8 8 0 0 0 8 8h18" fill="rgba(224,226,230,0.95)" />
      <path d="M34 56h24" stroke="rgba(206,210,216,0.9)" strokeWidth="6" strokeLinecap="round" />
    </svg>
  );
}

