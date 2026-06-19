import { useMemo } from 'react';
import type { AppState, ClipboardCategory, ClipboardEntry, ShelfItemRecord } from '@shared/schema';
import { useLedgeState } from './useLedgeState';
import { shallowEqual } from './shallowEqual';

export type TypeFilter = 'all' | 'text' | 'image' | 'url' | 'file' | 'color' | 'code';

export interface ClipboardFilterState {
  type: TypeFilter;
  app: string | 'all';
  category: string | 'all';
  search: string;
}

export interface ClipboardSlice {
  entries: ClipboardEntry[];
  categories: ClipboardCategory[];
}

type Item = ShelfItemRecord;

const EMPTY_FILTER: ClipboardFilterState = {
  type: 'all',
  app: 'all',
  category: 'all',
  search: '',
};

function entryHaystack(entry: ClipboardEntry): string {
  const parts: string[] = [];
  parts.push(entry.sourceAppName);
  parts.push(entry.sourceBundleId);
  const item = entry.item;
  switch (item.kind) {
    case 'text':
    case 'code':
      parts.push(item.text);
      break;
    case 'url':
      parts.push(item.url);
      parts.push(item.title);
      break;
    case 'imageAsset':
    case 'file':
    case 'folder':
      parts.push(item.title);
      parts.push(item.file.originalPath);
      parts.push(item.file.resolvedPath);
      break;
    case 'color':
      parts.push(item.hex);
      parts.push(item.name ?? '');
      break;
  }
  return parts.join(' ').toLowerCase();
}

function entryMatchesType(entry: ClipboardEntry, type: TypeFilter): boolean {
  if (type === 'all') return true;
  const item: Item = entry.item;
  switch (type) {
    case 'text':
      return item.kind === 'text';
    case 'image':
      return item.kind === 'imageAsset';
    case 'url':
      return item.kind === 'url';
    case 'file':
      return item.kind === 'file' || item.kind === 'folder';
    case 'color':
      return item.kind === 'color';
    case 'code':
      return item.kind === 'code';
    default:
      return false;
  }
}

export function useClipboardEntries(
  filter: ClipboardFilterState = EMPTY_FILTER,
): ClipboardSlice & { filtered: ClipboardEntry[]; availableApps: string[] } {
  const selector = useMemo(
    () => (s: AppState) => ({
      entries: s.clipboardHistory,
      categories: s.clipboardCategories,
    }),
    [],
  );
  const { state } = useLedgeState(selector, shallowEqual);
  const entries = state?.entries ?? [];
  const categories = state?.categories ?? [];

  const availableApps = useMemo(() => {
    const set = new Set<string>();
    for (const entry of entries) {
      if (entry.sourceAppName) set.add(entry.sourceAppName);
    }
    return Array.from(set).sort();
  }, [entries]);

  const filtered = useMemo(() => {
    const search = filter.search.trim().toLowerCase();
    return entries.filter((entry) => {
      if (!entryMatchesType(entry, filter.type)) return false;
      if (filter.app !== 'all' && entry.sourceAppName !== filter.app) return false;
      if (filter.category !== 'all' && !entry.categoryIds.includes(filter.category)) return false;
      if (search && !entryHaystack(entry).includes(search)) return false;
      return true;
    });
  }, [entries, filter]);

  return { entries, categories, filtered, availableApps };
}
