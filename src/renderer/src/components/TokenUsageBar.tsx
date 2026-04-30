import type { ReactElement } from 'react'
import type { SessionTokenUsage } from '../../../shared/types'

export interface TokenUsageBarProps {
  usage: SessionTokenUsage
  modelLabel: string | null
}

interface SegmentSpec {
  key: 'input' | 'cached' | 'cache-write' | 'output'
  weight: number
  cssVar: string
  label: string
}

export function TokenUsageBar({ usage }: TokenUsageBarProps): ReactElement {
  if (usage.source === 'unavailable') {
    return (
      <div className="token-usage-bar token-usage-bar--unavailable">
        <span
          data-testid="token-bar-segment-unavailable"
          className="token-usage-bar__segment token-usage-bar__segment--unavailable"
          aria-label="Token usage not reported"
        />
      </div>
    )
  }

  const { totals } = usage
  const candidates: SegmentSpec[] = [
    {
      key: 'input',
      weight: totals.inputTokens,
      cssVar: 'var(--token-bar-input)',
      label: 'Input'
    },
    {
      key: 'cached',
      weight: totals.cachedInputTokens,
      cssVar: 'var(--token-bar-cached)',
      label: 'Cached read'
    },
    {
      key: 'cache-write',
      weight: totals.cacheWriteTokens,
      cssVar: 'var(--token-bar-cache-write)',
      label: 'Cache write'
    },
    {
      key: 'output',
      weight: totals.outputTokens,
      cssVar: 'var(--token-bar-output)',
      label: 'Output'
    }
  ]

  const segments = candidates.filter(s => s.weight > 0)

  return (
    <div className="token-usage-bar" role="presentation">
      {segments.map(segment => (
        <span
          key={segment.key}
          data-testid={`token-bar-segment-${segment.key}`}
          data-weight={String(segment.weight)}
          className={`token-usage-bar__segment token-usage-bar__segment--${segment.key}`}
          style={{
            flex: `${segment.weight} 0 4px`,
            background: segment.cssVar
          }}
          aria-label={`${segment.label}: ${segment.weight.toLocaleString()} tokens`}
        />
      ))}
    </div>
  )
}
