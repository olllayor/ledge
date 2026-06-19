import { useCallback, useState } from 'react';
import type { ClipboardEntry, ShelfColor } from '@shared/schema';
import { useClipboardEntries, type TypeFilter } from '../hooks/useClipboardEntries';
import { ClipboardCard } from './ClipboardCard';
import { ClipboardCategories } from './ClipboardCategories';
import { ClipboardFilters } from './ClipboardFilters';

function copyEntryToClipboard(entry: ClipboardEntry): Promise<boolean> {
  // The quick-paste IPC path handles writing the entry to the system
  // clipboard correctly for every kind (text/url/code/color/file/
  // folder/imageAsset). Reuse it for in-app copy.
  if (!window.ledge) return Promise.resolve(false);
  return window.ledge
    .clipboardQuickPastePaste({ entryId: entry.id, previousBundleId: '' })
    .then(() => true)
    .catch(() => false);
}

export function ClipboardView() {
  const [type, setType] = useState<TypeFilter>('all');
  const [app, setApp] = useState<string | 'all'>('all');
  const [category, setCategory] = useState<string | 'all'>('all');
  const [search, setSearch] = useState('');

  const { entries, categories, filtered, availableApps } = useClipboardEntries({
    type,
    app,
    category,
    search,
  });

  const handleCopy = useCallback((entry: ClipboardEntry) => {
    void copyEntryToClipboard(entry).then((ok) => {
      if (ok) window.ledge?.showToast('Copied to clipboard', 'success');
    });
  }, []);

  const handleRemove = useCallback((entry: ClipboardEntry) => {
    void window.ledge?.clipboardEntryRemove({ entryId: entry.id });
  }, []);

  const handleAssign = useCallback((entry: ClipboardEntry, categoryId: string) => {
    void window.ledge?.clipboardEntryAssign({ entryId: entry.id, categoryId });
  }, []);

  const handleUnassign = useCallback((entry: ClipboardEntry, categoryId: string) => {
    void window.ledge?.clipboardEntryUnassign({ entryId: entry.id, categoryId });
  }, []);

  const handleDragStart = useCallback((entry: ClipboardEntry) => {
    const ok = window.ledge?.clipboardStartItemDrag({ entryId: entry.id });
    if (!ok) {
      window.ledge?.showToast('This item cannot be dragged out', 'info');
    }
  }, []);

  const handleCreateCategory = useCallback((name: string, color: ShelfColor) => {
    void window.ledge?.clipboardCategoryCreate({ name, color });
  }, []);

  const handleRenameCategory = useCallback((id: string, name: string) => {
    void window.ledge?.clipboardCategoryRename({ id, name });
  }, []);

  const handleRemoveCategory = useCallback((id: string) => {
    void window.ledge?.clipboardCategoryRemove({ id });
  }, []);

  const handleClearAll = useCallback(() => {
    if (entries.length === 0) return;
    void window.ledge?.clipboardEntryClearAll();
  }, [entries.length]);

  const handlePruneNow = useCallback(() => {
    void window.ledge?.clipboardPruneNow();
  }, []);

  const handleClose = useCallback(() => {
    window.close();
  }, []);

  return (
    <main className="clipboard-shell">
      <header className="clipboard-topbar">
        <h1>Clipboard</h1>
        <div className="clipboard-topbar-actions">
          <button type="button" className="chrome-button" onClick={handlePruneNow} title="Prune old entries">
            ⟳
          </button>
          <button
            type="button"
            className="chrome-button"
            onClick={handleClearAll}
            disabled={entries.length === 0}
            title="Clear all entries (categories kept)"
          >
            Clear
          </button>
          <button type="button" className="chrome-button" onClick={handleClose} title="Close">
            ×
          </button>
        </div>
      </header>
      <ClipboardFilters
        type={type}
        onTypeChange={setType}
        app={app}
        onAppChange={setApp}
        search={search}
        onSearchChange={setSearch}
        availableApps={availableApps}
      />
      <div className="clipboard-body">
        <ClipboardCategories
          categories={categories}
          selected={category}
          onSelect={setCategory}
          onCreate={handleCreateCategory}
          onRename={handleRenameCategory}
          onRemove={handleRemoveCategory}
        />
        <section className="clipboard-grid" aria-label="Clipboard entries">
          {filtered.length === 0 ? (
            <div className="clipboard-empty">
              <span className="clipboard-empty-eyebrow">Empty</span>
              <span className="clipboard-empty-cta">
                {entries.length === 0
                  ? 'No clipboard items yet — copy something to get started.'
                  : 'No entries match the current filters.'}
              </span>
            </div>
          ) : (
            filtered.map((entry) => (
              <ClipboardCard
                key={entry.id}
                entry={entry}
                categories={categories}
                onCopy={handleCopy}
                onRemove={handleRemove}
                onAssign={handleAssign}
                onUnassign={handleUnassign}
                onDragStart={handleDragStart}
              />
            ))
          )}
        </section>
      </div>
    </main>
  );
}
