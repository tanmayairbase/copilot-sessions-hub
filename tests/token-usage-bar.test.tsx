import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TokenUsageBar } from '../src/renderer/src/components/TokenUsageBar'
import type { SessionTokenUsage } from '../src/shared/types'

const usage = (
  overrides: Partial<SessionTokenUsage['totals']> & {
    source?: SessionTokenUsage['source']
    byModel?: SessionTokenUsage['byModel']
  } = {}
): SessionTokenUsage => ({
  source: overrides.source ?? 'cli-shutdown',
  byModel: overrides.byModel ?? [],
  totals: {
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    ...overrides
  }
})

describe('TokenUsageBar', () => {
  it('renders one segment per non-zero category', () => {
    render(
      <TokenUsageBar
        usage={usage({
          inputTokens: 1000,
          cachedInputTokens: 500,
          cacheWriteTokens: 0,
          outputTokens: 100
        })}
        modelLabel="gpt-5.4"
      />
    )
    expect(screen.queryByTestId('token-bar-segment-input')).not.toBeNull()
    expect(screen.queryByTestId('token-bar-segment-cached')).not.toBeNull()
    expect(screen.queryByTestId('token-bar-segment-output')).not.toBeNull()
    // cacheWriteTokens === 0 so omitted
    expect(screen.queryByTestId('token-bar-segment-cache-write')).toBeNull()
  })

  it('omits all zero-valued segments', () => {
    render(
      <TokenUsageBar
        usage={usage({
          inputTokens: 0,
          cachedInputTokens: 100,
          cacheWriteTokens: 0,
          outputTokens: 0
        })}
        modelLabel="gpt-5.4"
      />
    )
    expect(screen.queryByTestId('token-bar-segment-input')).toBeNull()
    expect(screen.queryByTestId('token-bar-segment-output')).toBeNull()
    expect(screen.queryByTestId('token-bar-segment-cached')).not.toBeNull()
  })

  it('weights each non-zero segment by its token count', () => {
    render(
      <TokenUsageBar
        usage={usage({
          inputTokens: 1000,
          cachedInputTokens: 500,
          cacheWriteTokens: 200,
          outputTokens: 100
        })}
        modelLabel="claude-opus-4.7"
      />
    )
    expect(
      screen.getByTestId('token-bar-segment-input').getAttribute('data-weight')
    ).toBe('1000')
    expect(
      screen.getByTestId('token-bar-segment-cached').getAttribute('data-weight')
    ).toBe('500')
    expect(
      screen
        .getByTestId('token-bar-segment-cache-write')
        .getAttribute('data-weight')
    ).toBe('200')
    expect(
      screen.getByTestId('token-bar-segment-output').getAttribute('data-weight')
    ).toBe('100')
  })

  it('renders a single unavailable segment when source is unavailable', () => {
    render(
      <TokenUsageBar
        usage={usage({ source: 'unavailable' })}
        modelLabel={null}
      />
    )
    expect(screen.queryByTestId('token-bar-segment-unavailable')).not.toBeNull()
    expect(screen.queryByTestId('token-bar-segment-input')).toBeNull()
  })
})
