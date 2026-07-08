// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { formatRelativeTime } from './CardPreview'

describe('formatRelativeTime', () => {
  it('returns empty string for an invalid date', () => {
    expect(formatRelativeTime('not a date')).toBe('')
  })

  it('returns "now" for a timestamp under a minute old', () => {
    const now = new Date().toISOString()
    expect(formatRelativeTime(now)).toBe('now')
  })

  it('returns minutes for a timestamp under an hour old', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString()
    expect(formatRelativeTime(fiveMinAgo)).toBe('5m')
  })

  it('returns hours for a timestamp under a day old', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000).toISOString()
    expect(formatRelativeTime(twoHoursAgo)).toBe('2h')
  })

  it('returns days for older timestamps', () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString()
    expect(formatRelativeTime(twoDaysAgo)).toBe('2d')
  })
})
