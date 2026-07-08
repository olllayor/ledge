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
    <>
      <div className="clipboard-filters">
        <div className="clipboard-segmented">
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
        </div>
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
      </div>
      <div className="clipboard-search-wrapper">
        <svg className="clipboard-search-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M6.5 11.5C9.26142 11.5 11.5 9.26142 11.5 6.5C11.5 3.73858 9.26142 1.5 6.5 1.5C3.73858 1.5 1.5 3.73858 1.5 6.5C1.5 9.26142 3.73858 11.5 6.5 11.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M14.5 14.5L10.8 10.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <input
          type="search"
          className="clipboard-search"
          placeholder="Search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          aria-label="Search clipboard history"
        />
      </div>
    </>
  );
}

export const ClipboardFilters = memo(FiltersImpl);
