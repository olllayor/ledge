import { shelfColorsForPlan } from '@shared/syncUtils'
import type { BillingPlan, ShelfRecord } from '@shared/schema'

export function defaultShelfName(): string {
  const now = new Date()
  const time = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit'
  }).format(now)
  return `Shelf ${time}`
}

export function nextShelfColor(seed: number, plan: BillingPlan): ShelfRecord['color'] {
  const colors = shelfColorsForPlan(plan)
  return colors[seed % colors.length]
}
