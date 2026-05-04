import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SessionCostChip } from '../src/renderer/src/components/SessionCostChip'
import type { ModelTokenUsage, SessionTokenUsage } from '../src/shared/types'

const usage = (
  byModel: ModelTokenUsage[],
  source: SessionTokenUsage['source'] = 'cli-shutdown'
): SessionTokenUsage => {
  const totals = byModel.reduce(
    (a, m) => ({
      inputTokens: a.inputTokens + m.inputTokens,
      cachedInputTokens: a.cachedInputTokens + m.cachedInputTokens,
      cacheWriteTokens: a.cacheWriteTokens + m.cacheWriteTokens,
      outputTokens: a.outputTokens + m.outputTokens,
      reasoningTokens: a.reasoningTokens + m.reasoningTokens
    }),
    {
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0
    }
  )
  return { source, byModel, totals }
}

const m = (
  overrides: Partial<ModelTokenUsage> & { modelId: string }
): ModelTokenUsage => ({
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  ...overrides
})

describe('SessionCostChip', () => {
  it('renders $ for cost under $2', () => {
    // gpt-5.4-mini: in 0.75, out 4.5. 100k input + 100k output = 0.075 + 0.45 = $0.525
    render(
      <SessionCostChip
        usage={usage([
          m({
            modelId: 'gpt-5.4-mini',
            inputTokens: 100_000,
            outputTokens: 100_000
          })
        ])}
      />
    )
    expect(screen.getByTestId('session-cost-chip').textContent).toBe('$')
  })

  it('renders $$ for cost between $2 and $5', () => {
    // gpt-5.4: in 2.5, out 15. 200k input + 200k output = 0.5 + 3 = $3.5
    render(
      <SessionCostChip
        usage={usage([
          m({ modelId: 'gpt-5.4', inputTokens: 200_000, outputTokens: 200_000 })
        ])}
      />
    )
    expect(screen.getByTestId('session-cost-chip').textContent).toBe('$$')
  })

  it('renders $$$ for cost ≥ $5', () => {
    // gpt-5.4: 500k input + 500k output = 1.25 + 7.5 = $8.75
    render(
      <SessionCostChip
        usage={usage([
          m({ modelId: 'gpt-5.4', inputTokens: 500_000, outputTokens: 500_000 })
        ])}
      />
    )
    expect(screen.getByTestId('session-cost-chip').textContent).toBe('$$$')
  })

  it('exposes precise cost via title attribute', () => {
    render(
      <SessionCostChip
        usage={usage([
          m({ modelId: 'gpt-5.4', inputTokens: 200_000, outputTokens: 200_000 })
        ])}
      />
    )
    const chip = screen.getByTestId('session-cost-chip')
    expect(chip.getAttribute('title')).toMatch(/\$3\.50/)
  })

  it('renders nothing when usage source is unavailable', () => {
    const { container } = render(
      <SessionCostChip usage={usage([], 'unavailable')} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when no model has known pricing', () => {
    const { container } = render(
      <SessionCostChip
        usage={usage([
          m({
            modelId: 'completely-unknown-model',
            inputTokens: 1000,
            outputTokens: 1000
          })
        ])}
      />
    )
    expect(container.firstChild).toBeNull()
  })

  it('still renders a tier when the session mixes priced and unpriced models', () => {
    render(
      <SessionCostChip
        usage={usage([
          m({
            modelId: 'gpt-5.4',
            inputTokens: 200_000,
            outputTokens: 200_000
          }),
          m({
            modelId: 'completely-unknown-model',
            inputTokens: 999_999,
            outputTokens: 999_999
          })
        ])}
      />
    )
    expect(screen.getByTestId('session-cost-chip').textContent).toBe('$$')
  })

  it('renders nothing when usage prop is missing', () => {
    const { container } = render(<SessionCostChip usage={undefined} />)
    expect(container.firstChild).toBeNull()
  })
})
