import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ClipboardEntry } from '@shared/schema';
import { useClipboardEntries, type TypeFilter } from '../hooks/useClipboardEntries';
import { useClipboardActions } from '../hooks/useClipboardActions';
import { useLedgeState } from '../hooks/useLedgeState';
import { ClipboardCard } from './ClipboardView/ClipboardCard';
import { ClipboardCategories } from './ClipboardView/ClipboardCategories';
import { ClipboardFilters } from './ClipboardView/ClipboardFilters';
import { IconClose } from './Icons';

export function ClipboardView() {
  const [type, setType] = useState<TypeFilter>('all');
  const [app, setApp] = useState<string | 'all'>('all');
  const [category, setCategory] = useState<string | 'all'>('all');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [recentlyCleared, setRecentlyCleared] = useState<ClipboardEntry[] | null>(null);
  const undoTimerRef = useRef<number | null>(null);

  const filter = useMemo(
    () => ({ type, app, category, search }),
    [type, app, category, search],
  );
  const { entries, categories, filtered, availableApps } = useClipboardEntries(filter);
  const { state: clipboardSettings } = useLedgeState((s) => s.clipboardSettings);
  const isHistoryEnabled = clipboardSettings?.enabled ?? true;
  const {
    copyEntry,
    removeEntry,
    togglePin,
    startItemDrag,
    createCategory,
    renameCategory,
    removeCategory,
    clearAllEntries,
    restoreHistory,
    pruneNow
  } = useClipboardActions();

  const handleCopy = useCallback((entry: ClipboardEntry) => {
    void copyEntry(entry).then((ok) => {
      if (ok) window.ledge?.showToast('Copied to clipboard', 'success');
    });
  }, [copyEntry]);

  const handleDragStart = useCallback((entry: ClipboardEntry) => {
    const ok = startItemDrag(entry);
    if (!ok) window.ledge?.showToast('This item cannot be dragged out', 'info');
  }, [startItemDrag]);

  const handleClearAll = useCallback(() => {
    if (entries.length === 0) return;
    if (!confirmingClear) {
      setConfirmingClear(true);
      return;
    }
    // Confirm step: snapshot then clear.
    const snapshot = [...entries];
    setRecentlyCleared(snapshot);
    setConfirmingClear(false);
    void clearAllEntries();
    if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current);
    undoTimerRef.current = window.setTimeout(() => setRecentlyCleared(null), 5000);
  }, [clearAllEntries, confirmingClear, entries]);

  const handleCancelClear = useCallback(() => setConfirmingClear(false), []);

  const handleUndoClear = useCallback(() => {
    if (!recentlyCleared) return;
    // Merge, not replace: entries captured during the undo window must
    // survive the restore. Union by id, newest first.
    const snapshotIds = new Set(recentlyCleared.map((entry) => entry.id));
    const capturedDuringWindow = entries.filter((entry) => !snapshotIds.has(entry.id));
    const merged = [...recentlyCleared, ...capturedDuringWindow].sort(
      (a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt),
    );
    void restoreHistory(merged);
    setRecentlyCleared(null);
    if (undoTimerRef.current) {
      window.clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    window.ledge?.showToast('History restored', 'success');
  }, [entries, recentlyCleared, restoreHistory]);

  useEffect(() => {
    return () => {
      if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current);
    };
  }, []);

  // Reset confirm if entries become empty externally.
  useEffect(() => {
    if (entries.length === 0) setConfirmingClear(false);
  }, [entries.length]);

  const handleClose = useCallback(() => {
    window.close();
  }, []);

  const activeCategoryName = useMemo(() => {
    if (category === 'all') return null;
    return categories.find((c) => c.id === category)?.name ?? category;
  }, [categories, category]);

  const hasActiveFilters = type !== 'all' || app !== 'all' || category !== 'all' || search.trim().length > 0;
  const filteredCountLabel = `${filtered.length} of ${entries.length}`;

  const clearAllFilters = useCallback(() => {
    setType('all');
    setApp('all');
    setCategory('all');
    setSearch('');
  }, []);

  const PAGE_SIZE = 100;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [type, app, category, search, entries.length]);
  const visibleEntries = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);
  const remaining = filtered.length - visibleEntries.length;

  return (
    <main className="clipboard-shell">
      <header className="clipboard-topbar">
        <h1>Clipboard</h1>
        <div className="clipboard-topbar-actions">
          <button
            type="button"
            className="chrome-button"
            onClick={() => void pruneNow()}
            title="Prune old entries — removes items older than 30 days and trims to your History limit"
            aria-label="Prune old entries (30 days / history limit)"
            style={{ width: 'auto', padding: '0 10px', borderRadius: 6, fontSize: 11, fontWeight: 500 }}
          >
            Prune
          </button>
          {confirmingClear ? (
            <div className="clipboard-clear-confirm" role="alertdialog" aria-label="Confirm clear history">
              <span className="clipboard-clear-confirm-label">Clear {entries.length}?</span>
              <button type="button" className="ghost-button small" onClick={handleCancelClear}>Cancel</button>
              <button type="button" className="ghost-button small is-danger" onClick={handleClearAll}>Clear</button>
            </div>
          ) : (
            <button
              type="button"
              className="chrome-button"
              onClick={handleClearAll}
              disabled={entries.length === 0}
              title={entries.length > 0 ? `Clear all ${entries.length} entries` : 'No entries to clear'}
              style={{ width: 'auto', padding: '0 10px', borderRadius: 6, fontSize: 11, fontWeight: 500 }}
            >
              Clear
            </button>
          )}
          <button type="button" className="chrome-button" onClick={handleClose} title="Close">
            <IconClose />
          </button>
        </div>
      </header>
      {!isHistoryEnabled && (
        <div className="permission-banner clipboard-paused-banner" role="status" aria-live="polite">
          <div>
            <p className="banner-title">History paused</p>
            <p className="banner-copy">Capture is off — new copies are ignored. Enable in Preferences → Clipboard to resume.</p>
          </div>
        </div>
      )}
      {recentlyCleared && (
        <div className="undo-bar clipboard-undo-bar" role="status" aria-live="polite">
          <span className="undo-bar-label">Cleared {recentlyCleared.length} {recentlyCleared.length === 1 ? 'entry' : 'entries'}</span>
          <button type="button" className="undo-bar-action" onClick={handleUndoClear}>Undo</button>
        </div>
      )}
      <div className="clipboard-toolbar">
        <ClipboardFilters
          type={type}
          onTypeChange={setType}
          app={app}
          onAppChange={setApp}
          search={search}
          onSearchChange={setSearch}
          availableApps={availableApps}
        />
      </div>
      {hasActiveFilters && (
        <div className="clipboard-active-filters" aria-label="Active filters">
          <span className="clipboard-active-filters-label">{filteredCountLabel}</span>
          {type !== 'all' && (
            <span className="clipboard-active-chip">
              Type: {type}
              <button type="button" aria-label="Clear type filter" onClick={() => setType('all')}>
                ×
              </button>
            </span>
          )}
          {app !== 'all' && (
            <span className="clipboard-active-chip">
              App: {app}
              <button type="button" aria-label="Clear app filter" onClick={() => setApp('all')}>
                ×
              </button>
            </span>
          )}
          {category !== 'all' && (
            <span className="clipboard-active-chip">
              Category: {activeCategoryName}
              <button type="button" aria-label="Clear category filter" onClick={() => setCategory('all')}>
                ×
              </button>
            </span>
          )}
          {search.trim() && (
            <span className="clipboard-active-chip">
              Search: “{search.trim().slice(0, 24)}{search.trim().length > 24 ? '…' : ''}”
              <button type="button" aria-label="Clear search" onClick={() => setSearch('')}>
                ×
              </button>
            </span>
          )}
          <button type="button" className="clipboard-filter-clear-all" onClick={clearAllFilters}>
            Clear all
          </button>
        </div>
      )}
      <div className="clipboard-body">
        <ClipboardCategories
          categories={categories}
          selected={category}
          onSelect={setCategory}
          onCreate={createCategory}
          onRename={renameCategory}
          onRemove={removeCategory}
        />
        <section className="clipboard-list" aria-label="Clipboard entries">
          {filtered.length === 0 ? (
            <div className="clipboard-empty">
              <span className="clipboard-empty-eyebrow">
                {entries.length === 0 ? 'No entries yet' : 'No matches'}
              </span>
              <span className="clipboard-empty-cta">
                {entries.length === 0
                  ? 'Copy something to start building your history.'
                  : 'Try adjusting your filters or search.'}
              </span>
            </div>
          ) : (
            <>
              <div className="clipboard-list-header">
                <span>Content</span>
                <span>Source</span>
                <span />
              </div>
              <div className="clipboard-list-body">
                {visibleEntries.map((entry) => (
                  <ClipboardCard
                    key={entry.id}
                    entry={entry}
                    categories={categories}
                    isSelected={selectedId === entry.id}
                    onSelect={setSelectedId}
                    onCopy={handleCopy}
                    onRemove={removeEntry}
                    onTogglePin={togglePin}
                    onDragStart={handleDragStart}
                  />
                ))}
                {remaining > 0 && (
                  <div className="clipboard-load-more">
                    <button
                      type="button"
                      className="ghost-button small"
                      onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                    >
                      Show {Math.min(PAGE_SIZE, remaining)} more ({remaining} remaining)
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
