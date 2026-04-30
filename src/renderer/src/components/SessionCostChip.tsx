import type { ReactElement } from 'react'
import { computeCost, costTier } from '../../../shared/pricing'
import type { SessionTokenUsage } from '../../../shared/types'

export interface SessionCostChipProps {
  usage: SessionTokenUsage | undefined
}

const fmtUsd = (n: number): string => {
  if (n > 0 && n < 0.01) return '<$0.01'
  return `$${n.toFixed(2)}`
}

export function SessionCostChip({
  usage
}: SessionCostChipProps): ReactElement | null {
  if (!usage || usage.source === 'unavailable') return null

  let total = 0
  let priced = false
  for (const model of usage.byModel) {
    const cost = computeCost(model)
    if (cost !== null) {
      total += cost
      priced = true
    }
  }
  if (!priced) return null

  const tier = costTier(total)
  if (!tier) return null

  return (
    <span
      data-testid="session-cost-chip"
      className="session-cost-chip"
      title={`Estimated cost: ${fmtUsd(total)}`}
    >
      {tier}
    </span>
  )
}
