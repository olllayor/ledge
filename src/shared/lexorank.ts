import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';

/**
 * Fractional string ranks ("lexorank") for the per-item sync API.
 *
 * The Convex `shelfItems` table stores `order` as a string so that two
 * clients can insert between the same pair of neighbors without ever
 * colliding or renumbering each other — something the local numeric
 * `order` model cannot express. These helpers are the only sanctioned
 * way to produce and compare those strings.
 *
 * `null` means the open start/end of the sequence, so:
 *   rankBetween(null, null)   -> first rank
 *   rankBetween(rank, null)   -> a rank after `rank` (append)
 *   rankBetween(null, rank)   -> a rank before `rank` (prepend)
 *
 * The underlying keys use base-62 digits ('0'-'9' then 'A'-'Z'), whose
 * ASCII code-unit order matches plain string comparison — the same
 * comparison the server applies when sorting items by rank.
 */

export type Rank = string;

export function rankBetween(before: Rank | null, after: Rank | null): Rank {
  // The underlying library silently returns an invalid key for reversed
  // anchors (only equal anchors throw), so the guard lives here.
  if (before !== null && after !== null && compareRanks(before, after) >= 0) {
    throw new Error(`rankBetween: anchors out of order (${before} >= ${after})`)
  }
  return generateKeyBetween(before, after)
}

/** N ranks strictly between `before` and `after` (null = open end). */
export function ranksBetween(
  before: Rank | null,
  after: Rank | null,
  count: number,
): Rank[] {
  if (count <= 0) {
    return [];
  }
  return generateNKeysBetween(before, after, count);
}

/** Code-unit comparison — matches how Convex sorts `order` strings. */
export function compareRanks(a: Rank, b: Rank): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
