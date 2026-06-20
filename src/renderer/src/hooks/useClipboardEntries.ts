import { useMemo } from 'react';
import type { AppState, ClipboardCategory, ClipboardEntry } from '@shared/schema';
import { useLedgeState } from './useLedgeState';
import { shallowEqual } from './shallowEqual';
import {
  EMPTY_CLIPBOARD_FILTER,
  distinctSourceApps,
  filterEntries,
  type ClipboardFilterState
} from '../lib/clipboardFilters';

export type TypeFilter = ClipboardFilterState['type']

export interface ClipboardSlice {
  entries: ClipboardEntry[];
  categories: ClipboardCategory[];
}

export function useClipboardEntries(
  filter: ClipboardFilterState = EMPTY_CLIPBOARD_FILTER,
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

  const availableApps = useMemo(() => distinctSourceApps(entries), [entries])

  const filtered = useMemo(() => filterEntries(entries, filter), [entries, filter])

  return { entries, categories, filtered, availableApps };
}
