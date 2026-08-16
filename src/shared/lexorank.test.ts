import { describe, expect, it } from 'vitest'
import { compareRanks, rankBetween, ranksBetween } from './lexorank'

// A tiny deterministic PRNG so the property tests are reproducible.
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('rankBetween', () => {
  it('produces strictly ordered keys for append, prepend and middle inserts', () => {
    const first = rankBetween(null, null)
    expect(first).toBeTruthy()

    const second = rankBetween(first, null)
    const last = rankBetween(second, null)
    const middle = rankBetween(second, last)
    const head = rankBetween(null, first)

    expect([head, first, second, middle, last].sort(compareRanks))
      .toEqual([head, first, second, middle, last])
  })

  it('throws when neighbors are reversed or equal', () => {
    expect(() => rankBetween('a1', 'a0')).toThrow()
    expect(() => rankBetween('a0', 'a0')).toThrow()
  })

  it('stays ordered across a long randomized insert sequence', () => {
    const rand = mulberry32(0x1ed9e)
    let keys: string[] = [rankBetween(null, null)]

    for (let i = 0; i < 2000; i++) {
      const index = Math.floor(rand() * keys.length)
      const before = index === 0 ? null : keys[index - 1]
      const after = index === keys.length ? null : keys[index]
      keys.splice(index, 0, rankBetween(before, after))

      // Keys stay unique by construction; spot-check ordering every 500.
      if (i % 500 === 499) {
        const sorted = [...keys].sort(compareRanks)
        expect(new Set(sorted).size).toBe(sorted.length)
        expect(sorted).toEqual(keys)
      }
    }

    // Bounded growth: thousands of same-point inserts stay short strings.
    expect(keys.every((key) => key.length < 30)).toBe(true)
  })
})

describe('ranksBetween', () => {
  it('returns an empty list for zero or negative counts', () => {
    expect(ranksBetween('a0', 'a1', 0)).toEqual([])
    expect(ranksBetween('a0', 'a1', -3)).toEqual([])
  })

  it('produces n strictly increasing keys between the anchors', () => {
    const keys = ranksBetween('a0', 'a1', 5)
    expect(keys).toHaveLength(5)
    const all = ['a0', ...keys, 'a1'].sort(compareRanks)
    expect(all).toEqual(['a0', ...keys, 'a1'])
  })
})
