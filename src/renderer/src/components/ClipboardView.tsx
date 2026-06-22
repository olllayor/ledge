import { useCallback, useMemo, useState } from 'react';
import type { ClipboardEntry } from '@shared/schema';
import { useClipboardEntries, type TypeFilter } from '../hooks/useClipboardEntries';
import { useClipboardActions } from '../hooks/useClipboardActions';
import { ClipboardCard } from './ClipboardCard';
import { ClipboardCategories } from './ClipboardCategories';
import { ClipboardFilters } from './ClipboardFilters';

export function ClipboardView() {
  const [type, setType] = useState<TypeFilter>('all');
  const [app, setApp] = useState<string | 'all'>('all');
  const [category, setCategory] = useState<string | 'all'>('all');
  const [search, setSearch] = useState('');

  // Memoise the filter object so `useClipboardEntries` can keep its
  // derived `filtered` array stable across renders that don't change
  // any filter field. Without this, every state update in the parent
  // (e.g. typing in the search box) would invalidate the inner
  // `useMemo` and re-run the entry filter even when none of the
  // fields actually changed.
  const filter = useMemo(
    () => ({ type, app, category, search }),
    [type, app, category, search],
  );
  const { entries, categories, filtered, availableApps } = useClipboardEntries(filter);
  const actions = useClipboardActions();

  const handleCopy = useCallback((entry: ClipboardEntry) => {
    void actions.copyEntry(entry).then((ok) => {
      if (ok) window.ledge?.showToast('Copied to clipboard', 'success');
    });
  }, [actions]);

  const handleClearAll = useCallback(() => {
    if (entries.length === 0) return;
    void actions.clearAllEntries();
  }, [actions, entries.length]);

  const handleClose = useCallback(() => {
    window.close();
  }, []);

  return (
    <main className="clipboard-shell">
      <header className="clipboard-topbar">
        <h1>Clipboard</h1>
        <div className="clipboard-topbar-actions">
          <button type="button" className="chrome-button" onClick={actions.pruneNow} title="Prune old entries">
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
          onCreate={actions.createCategory}
          onRename={actions.renameCategory}
          onRemove={actions.removeCategory}
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
                onRemove={actions.removeEntry}
                onAssign={actions.assignEntry}
                onUnassign={actions.unassignEntry}
                onDragStart={(entry) => {
                  const ok = actions.startItemDrag(entry);
                  if (!ok) window.ledge?.showToast('This item cannot be dragged out', 'info');
                }}
              />
            ))
          )}
        </section>
      </div>
    </main>
  );
}
