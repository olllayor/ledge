const DEFAULT_INACTIVITY_MS = 60_000

export class InactivityTimer {
  private timeout: NodeJS.Timeout | null = null
  private readonly durationMs: number

  constructor(
    private readonly onExpire: () => void,
    options: { durationMs?: number } = {},
  ) {
    this.durationMs = options.durationMs ?? DEFAULT_INACTIVITY_MS
  }

  reset(): void {
    this.clear()
    this.timeout = setTimeout(() => {
      this.timeout = null
      this.onExpire()
    }, this.durationMs)
  }

  clear(): void {
    if (this.timeout) {
      clearTimeout(this.timeout)
      this.timeout = null
    }
  }

  isActive(): boolean {
    return this.timeout !== null
  }
}
