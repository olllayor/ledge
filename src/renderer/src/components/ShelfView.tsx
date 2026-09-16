import { memo, useCallback, useEffect,  useRef, useState, type RefObject } from 'react';
import type { AppState, IngestPayload, ShelfItemRecord } from '@shared/schema';
import { getExportableItems, getHeroCountLabel, getHeroMode, type HeroMode, type MenuTarget, type SessionMode } from '../lib/shelfFlow';
import { isBareEscape } from '../lib/keyboard';
import {
  getHeroPreviewSource,
  heroStackClassName,
  isExternalTransfer,
  payloadsFromTransfer,
} from '../lib/shelfDrop';
import {
  IconClose,
  IconMenuDots,
  IconChevronDown,
} from './Icons';

interface ShelfViewState {
  liveShelfId: string | null;
  liveShelfItems: ShelfItemRecord[];
  liveShelfUpdatedAt: string | null;
  autoCloseShelf: boolean | undefined;
  doubleClickAction: 'open' | 'reveal' | undefined;
  shakeEnabled: boolean;
  nativeHelperAvailable: boolean;
  accessibilityTrusted: boolean;
  lastError: string | null;
  syncPlan: AppState['sync']['plan'];
}

interface ShelfViewProps {
  state: ShelfViewState;
}

interface OverflowAction {
  id: string;
  label: string;
  destructive?: boolean;
  disabled?: boolean;
  onSelect(): Promise<void> | void;
}

const PING_INTERVAL_MS = 1000;

function isActionableFileItem(item: ShelfItemRecord): boolean {
  return (item.kind === 'file' || item.kind === 'folder' || item.kind === 'imageAsset') && !('file' in item && item.file.isMissing);
}

function ShelfView({ state }: ShelfViewProps) {
  const liveShelf = state.liveShelfId
    ? { id: state.liveShelfId, items: state.liveShelfItems, updatedAt: state.liveShelfUpdatedAt }
    : null;
  const items = state.liveShelfItems;
  const primaryItem = items[0] ?? null;
  const itemCount = items.length;
  const heroMode = getHeroMode(items);
  const [isImporting, setIsImporting] = useState(false);
  const [sessionMode, setSessionMode] = useState<SessionMode>('idle');
  const [menuTarget, setMenuTarget] = useState<MenuTarget>('shelf');
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const itemSheetRef = useRef<HTMLDivElement | null>(null);
  const lastUpdatedAtRef = useRef(liveShelf?.updatedAt ?? '');
  const dragDepthRef = useRef(0);
  // Throttled keep-alive for the main-process inactivity timer. Without
  // these pings the auto-retract timer expires 60 s after the last IPC
  // mutation even while the user is actively hovering and reading, and
  // the shelf retracts under the cursor.
  const lastPingRef = useRef(0);
  const isAcceptingDrop = sessionMode === 'acceptingDrop';
  const isExporting = sessionMode === 'exporting';
  const isMenuOpen = sessionMode === 'menuOpen';
  const isItemListOpen = sessionMode === 'itemListOpen';
  const banner = !state.nativeHelperAvailable
    ? {
        title: 'Native helper is unavailable',
        copy: state.lastError || 'Rebuild the bundled helper to re-enable shake detection.',
      }
    : state.shakeEnabled && !state.accessibilityTrusted
      ? {
          title: 'Accessibility access is off',
          copy: 'Enable it if you want shake-to-open.',
        }
      : state.lastError
        ? {
            title: 'Native helper reported an error',
            copy: state.lastError,
          }
        : null;

  useEffect(() => {
    dragDepthRef.current = 0;
    setMenuTarget('shelf');
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
    setMenuTarget('shelf');
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

      setMenuTarget('shelf');
      setSessionMode('idle');
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      // Only bare Escape dismisses; modifier-carrying presses are left
      // for future shortcuts (Cmd+Escape etc.) to claim.
      if (!isBareEscape(event)) {
        return;
      }

      setMenuTarget('shelf');
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
    setMenuTarget('shelf');
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

  const handleDragEnter = useCallback((event: React.DragEvent<HTMLElement>) => {
    if (isExporting || !isExternalTransfer(event.dataTransfer)) {
      return;
    }

    dragDepthRef.current += 1;
    setMenuTarget('shelf');
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
      setMenuTarget('shelf');
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
    setMenuTarget('shelf');
    setSessionMode('itemListOpen');
  }, []);

  const openOverflowMenu = useCallback(() => {
    if (!liveShelf) {
      return;
    }

    setMenuTarget(primaryItem ? 'frontItem' : 'shelf');
    setSessionMode('menuOpen');
  }, [liveShelf, primaryItem]);

  const closeTransientSurface = useCallback(() => {
    dragDepthRef.current = 0;
    setMenuTarget('shelf');
    setSessionMode('idle');
  }, []);

  const handleExportStart = useCallback(() => {
    setSessionMode('exporting');
  }, []);

  const handleExportEnd = useCallback(() => {
    setSessionMode((current) => (current === 'exporting' ? 'idle' : current));
  }, []);

  async function moveItem(itemId: string, direction: -1 | 1) {
    if (!liveShelf) {
      return;
    }

    const currentItems = [...items];
    const index = currentItems.findIndex((item) => item.id === itemId);
    const targetIndex = index + direction;
    if (index === -1 || targetIndex < 0 || targetIndex >= currentItems.length) {
      return;
    }

    const next = [...currentItems];
    const [entry] = next.splice(index, 1);
    next.splice(targetIndex, 0, entry);
    await window.ledge.reorderItems(next.map((item) => item.id));
  }

  const menuActions: OverflowAction[] = [];
  if (primaryItem) {
    if (isActionableFileItem(primaryItem)) {
      const missing = 'file' in primaryItem && primaryItem.file.isMissing;
      menuActions.push(
        {
          id: 'quick-look',
          label: 'Quick Look',
          disabled: missing,
          onSelect: async () => {
            closeTransientSurface();
            await window.ledge.previewItem(primaryItem.id);
          },
        },
        {
          id: 'reveal',
          label: 'Reveal in Finder',
          disabled: missing,
          onSelect: async () => {
            closeTransientSurface();
            await window.ledge.revealItem(primaryItem.id);
          },
        },
        {
          id: 'open',
          label: 'Open',
          disabled: missing,
          onSelect: async () => {
            closeTransientSurface();
            await window.ledge.openItem(primaryItem.id);
          },
        },
        {
          id: 'share-all',
          label: 'Share All',
          disabled: getExportableItems(items).length === 0,
          onSelect: async () => {
            closeTransientSurface();
            await window.ledge.shareShelfItems();
          },
        },
      );
    } else if (primaryItem.kind === 'text' || primaryItem.kind === 'url') {
      menuActions.push(
        {
          id: 'copy',
          label: 'Copy',
          onSelect: async () => {
            closeTransientSurface();
            await window.ledge.copyItem(primaryItem.id);
          },
        },
        {
          id: 'save',
          label: 'Save',
          onSelect: async () => {
            closeTransientSurface();
            await window.ledge.saveItem(primaryItem.id);
          },
        },
      );

      if (primaryItem.kind === 'url') {
        menuActions.push({
          id: 'open-url',
          label: 'Open',
          onSelect: async () => {
            closeTransientSurface();
            await window.ledge.openItem(primaryItem.id);
          },
        });
      }
    }
  }

  if (liveShelf) {
    menuActions.push({
      id: 'show-items',
      label: 'Show Items',
      disabled: itemCount < 2,
      onSelect: () => {
        openItemSheet();
      },
    });

    menuActions.push(
      {
        id: 'clear',
        label: 'Clear Shelf',
        destructive: true,
        disabled: itemCount === 0,
        onSelect: async () => {
          closeTransientSurface();
          await window.ledge.clearShelf();
        },
      },
      {
        id: 'close',
        label: 'Close Shelf',
        onSelect: async () => {
          closeTransientSurface();
          await window.ledge.closeShelf();
        },
      },
    );
  }

  return (
    <main className="shelf-shell" onPaste={handlePaste} tabIndex={0} onPointerDown={pingInteraction} onKeyDown={pingInteraction}>
      <section
        className={`shelf-panel${isAcceptingDrop ? ' is-accepting-drop' : ''}${isExporting ? ' is-exporting' : ''}${isItemListOpen ? ' has-item-sheet' : ''}`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onPointerEnter={() => {
          if (isExporting) {
            setSessionMode('idle');
          }
        }}
      >
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

        {isMenuOpen && menuActions.length > 0 ? (
          <OverflowMenu actions={menuActions} menuRef={menuRef} menuTarget={menuTarget} />
        ) : null}

        <section
          className={`drop-surface compact ${itemCount === 0 ? 'is-empty' : ''}${isAcceptingDrop ? ' is-accepting' : ''}`}
        >
          {itemCount === 0 ? (
            <div className="empty-state compact">
              <p className="surface-title compact">Drop files here</p>
            </div>
          ) : primaryItem ? (
            <HeroItemMemo
              items={items}
              item={primaryItem}
              heroMode={heroMode}
              isImporting={isImporting}
              isExporting={isExporting}
              dragLocked={isMenuOpen || isItemListOpen}
              onExportStart={handleExportStart}
              onExportEnd={handleExportEnd}
              onOpenItemSheet={openItemSheet}
            />
          ) : (
            <div className="empty-state compact">
              <p className="surface-title compact">Drop files here</p>
            </div>
          )}

          {liveShelf && isItemListOpen ? (
            <ItemSheet items={items} sheetRef={itemSheetRef} onMove={moveItem} onClose={closeTransientSurface} />
          ) : null}
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
      </section>
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
  const prev = prevProps.state;
  const next = nextProps.state;

  if (prev.liveShelfId !== next.liveShelfId) return false;
  if (prev.liveShelfUpdatedAt !== next.liveShelfUpdatedAt) return false;
  if (!shelfItemsEqual(prev.liveShelfItems, next.liveShelfItems)) return false;

  if (prev.doubleClickAction !== next.doubleClickAction) return false;
  if (prev.autoCloseShelf !== next.autoCloseShelf) return false;
  if (prev.shakeEnabled !== next.shakeEnabled) return false;

  if (prev.nativeHelperAvailable !== next.nativeHelperAvailable) return false;
  if (prev.accessibilityTrusted !== next.accessibilityTrusted) return false;
  if (prev.lastError !== next.lastError) return false;
  if (prev.syncPlan !== next.syncPlan) return false;

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
  onMove(itemId: string, direction: -1 | 1): Promise<void>;
  onClose(): void;
}

function ItemSheet({ items, sheetRef, onMove, onClose }: ItemSheetProps) {
  return (
    <section ref={sheetRef} className="item-sheet" aria-label="Shelf items">
      <header className="item-sheet-header">
        <div>
          <p className="item-sheet-title">Items</p>
          <p className="item-sheet-copy">Reorder or remove without leaving the compact view.</p>
        </div>
        <button className="ghost-button small" onClick={onClose}>
          Done
        </button>
      </header>
      <div className="item-sheet-list">
        {items.map((item, index) => (
          <ItemSheetRow
            key={item.id}
            item={item}
            isFirst={index === 0}
            isLast={index === items.length - 1}
            onMove={onMove}
          />
        ))}
      </div>
    </section>
  );
}

interface ItemSheetRowProps {
  item: ShelfItemRecord;
  isFirst: boolean;
  isLast: boolean;
  onMove(itemId: string, direction: -1 | 1): Promise<void>;
}

function ItemSheetRow({ item, isFirst, isLast, onMove }: ItemSheetRowProps) {
  const fileBacked = isActionableFileItem(item);
  const missing = fileBacked && 'file' in item && item.file.isMissing;
  const previewCopy = missing ? 'Missing from disk' : item.subtitle || item.preview.summary;

  return (
    <article className={`item-sheet-row${missing ? ' is-missing' : ''}`}>
      <div className="item-sheet-copy-block">
        <div className="item-sheet-kind">{item.kind}</div>
        <div className="item-sheet-text">
          <p className="item-sheet-row-title">{item.title}</p>
          <p className="item-sheet-row-copy">{previewCopy}</p>
        </div>
      </div>
      <div className="item-sheet-controls">
        <button
          className="ghost-button small"
          disabled={isFirst}
          onClick={() => void onMove(item.id, -1)}
          aria-label="Move up"
        >
          ↑
        </button>
        <button
          className="ghost-button small"
          disabled={isLast}
          onClick={() => void onMove(item.id, 1)}
          aria-label="Move down"
        >
          ↓
        </button>
      </div>
    </article>
  );
}

interface OverflowMenuProps {
  actions: OverflowAction[];
  menuRef: RefObject<HTMLDivElement | null>;
  menuTarget: MenuTarget;
}

function OverflowMenu({ actions, menuRef, menuTarget }: OverflowMenuProps) {
  return (
    <div ref={menuRef} className="overflow-menu" role="menu" aria-label="Shelf actions">
      {menuTarget === 'frontItem' && (
        <p className="overflow-menu-heading">Front item</p>
      )}
      {actions.map((action) => (
        <button
          key={action.id}
          className={`overflow-menu-item${action.destructive ? ' is-destructive' : ''}`}
          disabled={action.disabled}
          role="menuitem"
          onClick={() => void action.onSelect()}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}

interface HeroItemProps {
  items: ShelfItemRecord[];
  item: ShelfItemRecord;
  heroMode: HeroMode;
  isImporting: boolean;
  isExporting: boolean;
  dragLocked: boolean;
  onExportStart(): void;
  onExportEnd(): void;
  onOpenItemSheet(): void;
}

function HeroItem({
  items,
  item,
  heroMode,
  isImporting,
  isExporting,
  dragLocked,
  onExportStart,
  onExportEnd,
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

    // Cancel the renderer's HTML5 drag and start the native macOS file
    // drag from the main process instead (webContents.startDrag). The
    // sendSync round-trip blocks until the native drag session starts,
    // so a true return value means the export is really underway.
    event.preventDefault();
    const didStartDrag =
      exportableItems.length === 1
        ? window.ledge.startItemDrag(exportableItems[0]!.id)
        : window.ledge.startItemsDrag(exportableItems.map((i) => i.id));

    if (didStartDrag) {
      onExportStart();
    } else {
      onExportEnd();
    }
  }

  function handleHeroDoubleClick() {
    if (isExporting) {
      return;
    }
    void window.ledge.openItem(item.id);
  }

  return (
    <div
      className={`hero-item is-${heroMode}${canDragOut ? ' is-draggable' : ''}${isExporting ? ' is-exporting' : ''}`}
      draggable={canDragOut}
      onDragStart={handleHeroDragStart}
      onDragEnd={onExportEnd}
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

