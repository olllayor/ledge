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
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
            title="Clear all entries"
          >
            Clear
          </button>
          <button type="button" className="chrome-button" onClick={handleClose} title="Close">
            ×
          </button>
        </div>
      </header>
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
      <div className="clipboard-body">
        <ClipboardCategories
          categories={categories}
          selected={category}
          onSelect={setCategory}
          onCreate={actions.createCategory}
          onRename={actions.renameCategory}
          onRemove={actions.removeCategory}
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
                {filtered.map((entry) => (
                  <ClipboardCard
                    key={entry.id}
                    entry={entry}
                    isSelected={selectedId === entry.id}
                    onSelect={setSelectedId}
                    onCopy={handleCopy}
                    onRemove={actions.removeEntry}
                    onDragStart={(entry) => {
                      const ok = actions.startItemDrag(entry);
                      if (!ok) window.ledge?.showToast('This item cannot be dragged out', 'info');
                    }}
                  />
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
