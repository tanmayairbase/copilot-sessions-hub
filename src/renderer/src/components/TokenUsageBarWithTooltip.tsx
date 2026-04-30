import type { ReactElement } from 'react'
import type { SessionTokenUsage } from '../../../shared/types'
import { TokenUsageBar } from './TokenUsageBar'
import { TokenUsageTooltipContent } from './TokenUsageTooltipContent'

export interface TokenUsageBarWithTooltipProps {
  usage: SessionTokenUsage
  modelLabel: string | null
}

export function TokenUsageBarWithTooltip({
  usage,
  modelLabel
}: TokenUsageBarWithTooltipProps): ReactElement {
  return (
    <div className="token-usage-bar-host">
      <TokenUsageBar usage={usage} modelLabel={modelLabel} />
      <div className="token-usage-bar-tooltip" role="presentation">
        <TokenUsageTooltipContent usage={usage} />
      </div>
    </div>
  )
}
