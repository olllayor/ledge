import { memo } from 'react';
import type { TypeFilter } from '../hooks/useClipboardEntries';

const TYPES: Array<{ id: TypeFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'text', label: 'Text' },
  { id: 'image', label: 'Image' },
  { id: 'url', label: 'URL' },
  { id: 'file', label: 'File' },
  { id: 'color', label: 'Color' },
  { id: 'code', label: 'Code' },
];

interface ClipboardFiltersProps {
  type: TypeFilter;
  onTypeChange: (type: TypeFilter) => void;
  app: string | 'all';
  onAppChange: (app: string | 'all') => void;
  search: string;
  onSearchChange: (search: string) => void;
  availableApps: string[];
}

function FiltersImpl({
  type,
  onTypeChange,
  app,
  onAppChange,
  search,
  onSearchChange,
  availableApps,
}: ClipboardFiltersProps) {
  return (
    <div className="clipboard-filters">
      {TYPES.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`clipboard-filter-chip${type === t.id ? ' is-active' : ''}`}
          onClick={() => onTypeChange(t.id)}
        >
          {t.label}
        </button>
      ))}
      <select
        className="clipboard-app-filter"
        value={app}
        onChange={(event) => onAppChange(event.target.value)}
        aria-label="Filter by source app"
      >
        <option value="all">All apps ({availableApps.length})</option>
        {availableApps.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </select>
      <input
        type="search"
        className="clipboard-search"
        placeholder="Search…"
        value={search}
        onChange={(event) => onSearchChange(event.target.value)}
        aria-label="Search clipboard history"
      />
    </div>
  );
}

export const ClipboardFilters = memo(FiltersImpl);
