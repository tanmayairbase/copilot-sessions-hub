import { describe, expect, it } from 'vitest'
import { computeCost, costTier, priceFor, providerOf } from '../src/shared/pricing'

describe('priceFor', () => {
  it('returns the OpenAI rate for gpt-5.4', () => {
    const rate = priceFor('gpt-5.4')
    expect(rate).toEqual({
      provider: 'openai',
      input: 2.5,
      cachedInput: 0.25,
      cacheWrite: 0,
      output: 15
    })
  })

  it.each([
    // OpenAI — no cache write
    ['gpt-4.1', 'openai', 2, 0.5, 0, 8],
    ['gpt-5-mini', 'openai', 0.25, 0.025, 0, 2],
    ['gpt-5.2', 'openai', 1.75, 0.175, 0, 14],
    ['gpt-5.2-codex', 'openai', 1.75, 0.175, 0, 14],
    ['gpt-5.3-codex', 'openai', 1.75, 0.175, 0, 14],
    ['gpt-5.4', 'openai', 2.5, 0.25, 0, 15],
    ['gpt-5.4-mini', 'openai', 0.75, 0.075, 0, 4.5],
    ['gpt-5.4-nano', 'openai', 0.2, 0.02, 0, 1.25],
    ['gpt-5.5', 'openai', 5, 0.5, 0, 30],
    // Anthropic — has cache write
    ['claude-haiku-4.5', 'anthropic', 1, 0.1, 1.25, 5],
    ['claude-sonnet-4', 'anthropic', 3, 0.3, 3.75, 15],
    ['claude-sonnet-4.5', 'anthropic', 3, 0.3, 3.75, 15],
    ['claude-sonnet-4.6', 'anthropic', 3, 0.3, 3.75, 15],
    ['claude-opus-4.5', 'anthropic', 5, 0.5, 6.25, 25],
    ['claude-opus-4.6', 'anthropic', 5, 0.5, 6.25, 25],
    ['claude-opus-4.7', 'anthropic', 5, 0.5, 6.25, 25],
    // Google — no cache write
    ['gemini-2.5-pro', 'google', 1.25, 0.125, 0, 10],
    ['gemini-3-flash', 'google', 0.5, 0.05, 0, 3],
    ['gemini-3.1-pro', 'google', 2, 0.2, 0, 12],
    // xAI
    ['grok-code-fast-1', 'xai', 0.2, 0.02, 0, 1.5],
    // GitHub fine-tuned
    ['raptor-mini', 'github', 0.25, 0.025, 0, 2],
    ['goldeneye', 'github', 1.25, 0.125, 0, 10]
  ])(
    '%s → %s rate (in=%s, cached=%s, cacheWrite=%s, out=%s)',
    (modelId, provider, input, cachedInput, cacheWrite, output) => {
      expect(priceFor(modelId as string)).toEqual({
        provider,
        input,
        cachedInput,
        cacheWrite,
        output
      })
    }
  )

  it('strips -preview suffix when matching gemini ids', () => {
    expect(priceFor('gemini-3.1-pro-preview')).toEqual(priceFor('gemini-3.1-pro'))
  })

  it('is case-insensitive', () => {
    expect(priceFor('GPT-5.4')).toEqual(priceFor('gpt-5.4'))
  })

  it('returns null for unknown models', () => {
    expect(priceFor('made-up-model-x')).toBeNull()
  })
})

describe('providerOf', () => {
  it.each([
    ['gpt-5.4', 'openai'],
    ['gpt-4.1', 'openai'],
    ['o1-preview', 'openai'],
    ['o3-mini', 'openai'],
    ['claude-opus-4.7', 'anthropic'],
    ['claude-sonnet-4.6', 'anthropic'],
    ['gemini-3.1-pro-preview', 'google'],
    ['gemini-2.5-pro', 'google'],
    ['grok-code-fast-1', 'xai'],
    ['raptor-mini', 'github'],
    ['goldeneye', 'github']
  ])('classifies %s as %s', (modelId, provider) => {
    expect(providerOf(modelId)).toBe(provider)
  })

  it('returns null for unknown model ids', () => {
    expect(providerOf('mystery-llm-9000')).toBeNull()
  })
})

describe('computeCost', () => {
  it('does not double-count reasoning for OpenAI (already inside outputTokens)', () => {
    // gpt-5.4: input=$2.50, cached=$0.25, output=$15.00 per 1M
    // Sample: 249,568 input · 211,328 cached · 4,904 output (incl. 3,167 reasoning)
    const cost = computeCost({
      modelId: 'gpt-5.4',
      inputTokens: 249_568,
      cachedInputTokens: 211_328,
      cacheWriteTokens: 0,
      outputTokens: 4_904,
      reasoningTokens: 3_167
    })
    // expected = ((249568-211328)*2.5 + 211328*0.25 + 4904*15) / 1_000_000
    //         = (95_600 + 52_832 + 73_560) / 1_000_000
    //         = 0.221992
    expect(cost).toBeCloseTo(0.221992, 6)
  })

  it('adds reasoning to output for Anthropic and bills cache writes', () => {
    // claude-opus-4.7: input=$5, cached=$0.5, cacheWrite=$6.25, output=$25
    const cost = computeCost({
      modelId: 'claude-opus-4.7',
      inputTokens: 100_000,
      cachedInputTokens: 50_000,
      cacheWriteTokens: 20_000,
      outputTokens: 4_000,
      reasoningTokens: 1_000
    })
    // expected = ((100000-50000)*5 + 50000*0.5 + 20000*6.25 + (4000+1000)*25) / 1e6
    //         = (250_000 + 25_000 + 125_000 + 125_000) / 1e6
    //         = 0.525
    expect(cost).toBeCloseTo(0.525, 6)
  })

  it('keeps input fully billable when cached reads exceed input', () => {
    const cost = computeCost({
      modelId: 'gpt-5.4',
      inputTokens: 1_000,
      cachedInputTokens: 1_200,
      cacheWriteTokens: 0,
      outputTokens: 100,
      reasoningTokens: 0
    })
    expect(cost).toBeCloseTo(0.0043, 6)
  })

  it('returns null for an unknown model (no rate)', () => {
    expect(
      computeCost({
        modelId: 'mystery-llm-9000',
        inputTokens: 1_000_000,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 1_000_000,
        reasoningTokens: 0
      })
    ).toBeNull()
  })

  it('returns 0 for a known model with all-zero counts', () => {
    expect(
      computeCost({
        modelId: 'gpt-5.4',
        inputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0
      })
    ).toBe(0)
  })
})

describe('costTier', () => {
  it.each([
    [0, '$'],
    [0.75, '$'],
    [1.99, '$'],
    [2, '$$'],
    [3.5, '$$'],
    [4.99, '$$'],
    [5, '$$$'],
    [42, '$$$']
  ])('%s USD → %s', (cost, tier) => {
    expect(costTier(cost)).toBe(tier)
  })

  it('returns null when cost is null (unavailable)', () => {
    expect(costTier(null)).toBeNull()
  })
})
