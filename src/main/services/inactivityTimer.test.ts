import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InactivityTimer } from './inactivityTimer'

describe('InactivityTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('fires onExpire after the default duration', () => {
    const onExpire = vi.fn()
    const timer = new InactivityTimer(onExpire)
    timer.reset()
    vi.advanceTimersByTime(60_000)
    expect(onExpire).toHaveBeenCalledTimes(1)
  })

  it('honors a custom duration', () => {
    const onExpire = vi.fn()
    const timer = new InactivityTimer(onExpire, { durationMs: 5_000 })
    timer.reset()
    vi.advanceTimersByTime(4_999)
    expect(onExpire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onExpire).toHaveBeenCalledTimes(1)
  })

  it('reset() postpones expiry', () => {
    const onExpire = vi.fn()
    const timer = new InactivityTimer(onExpire)
    timer.reset()
    vi.advanceTimersByTime(30_000)
    timer.reset()
    vi.advanceTimersByTime(30_000)
    expect(onExpire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(30_000)
    expect(onExpire).toHaveBeenCalledTimes(1)
  })

  it('clear() cancels a pending expiry', () => {
    const onExpire = vi.fn()
    const timer = new InactivityTimer(onExpire)
    timer.reset()
    timer.clear()
    vi.advanceTimersByTime(120_000)
    expect(onExpire).not.toHaveBeenCalled()
  })

  it('isActive() reflects pending state', () => {
    const onExpire = vi.fn()
    const timer = new InactivityTimer(onExpire)
    expect(timer.isActive()).toBe(false)
    timer.reset()
    expect(timer.isActive()).toBe(true)
    timer.clear()
    expect(timer.isActive()).toBe(false)
  })
})
