export type Provider = 'openai' | 'anthropic' | 'google' | 'xai' | 'github'

export interface ModelRate {
  provider: Provider
  input: number
  cachedInput: number
  cacheWrite: number
  output: number
}

const RATES: Record<string, ModelRate> = {
  // OpenAI
  'gpt-4.1': { provider: 'openai', input: 2, cachedInput: 0.5, cacheWrite: 0, output: 8 },
  'gpt-5-mini': { provider: 'openai', input: 0.25, cachedInput: 0.025, cacheWrite: 0, output: 2 },
  'gpt-5.2': { provider: 'openai', input: 1.75, cachedInput: 0.175, cacheWrite: 0, output: 14 },
  'gpt-5.2-codex': { provider: 'openai', input: 1.75, cachedInput: 0.175, cacheWrite: 0, output: 14 },
  'gpt-5.3-codex': { provider: 'openai', input: 1.75, cachedInput: 0.175, cacheWrite: 0, output: 14 },
  'gpt-5.4': { provider: 'openai', input: 2.5, cachedInput: 0.25, cacheWrite: 0, output: 15 },
  'gpt-5.4-mini': { provider: 'openai', input: 0.75, cachedInput: 0.075, cacheWrite: 0, output: 4.5 },
  'gpt-5.4-nano': { provider: 'openai', input: 0.2, cachedInput: 0.02, cacheWrite: 0, output: 1.25 },
  'gpt-5.5': { provider: 'openai', input: 5, cachedInput: 0.5, cacheWrite: 0, output: 30 },
  // Anthropic
  'claude-haiku-4.5': { provider: 'anthropic', input: 1, cachedInput: 0.1, cacheWrite: 1.25, output: 5 },
  'claude-sonnet-4': { provider: 'anthropic', input: 3, cachedInput: 0.3, cacheWrite: 3.75, output: 15 },
  'claude-sonnet-4.5': { provider: 'anthropic', input: 3, cachedInput: 0.3, cacheWrite: 3.75, output: 15 },
  'claude-sonnet-4.6': { provider: 'anthropic', input: 3, cachedInput: 0.3, cacheWrite: 3.75, output: 15 },
  'claude-opus-4.5': { provider: 'anthropic', input: 5, cachedInput: 0.5, cacheWrite: 6.25, output: 25 },
  'claude-opus-4.6': { provider: 'anthropic', input: 5, cachedInput: 0.5, cacheWrite: 6.25, output: 25 },
  'claude-opus-4.7': { provider: 'anthropic', input: 5, cachedInput: 0.5, cacheWrite: 6.25, output: 25 },
  // Google
  'gemini-2.5-pro': { provider: 'google', input: 1.25, cachedInput: 0.125, cacheWrite: 0, output: 10 },
  'gemini-3-flash': { provider: 'google', input: 0.5, cachedInput: 0.05, cacheWrite: 0, output: 3 },
  'gemini-3.1-pro': { provider: 'google', input: 2, cachedInput: 0.2, cacheWrite: 0, output: 12 },
  // xAI
  'grok-code-fast-1': { provider: 'xai', input: 0.2, cachedInput: 0.02, cacheWrite: 0, output: 1.5 },
  // GitHub fine-tuned
  'raptor-mini': { provider: 'github', input: 0.25, cachedInput: 0.025, cacheWrite: 0, output: 2 },
  goldeneye: { provider: 'github', input: 1.25, cachedInput: 0.125, cacheWrite: 0, output: 10 }
}

const normalizeModelId = (modelId: string): string => {
  return modelId.toLowerCase().replace(/-preview$/, '')
}

export const providerOf = (modelId: string): Provider | null => {
  const m = modelId.toLowerCase()
  if (m.startsWith('gpt-') || /^o[13](-|$)/.test(m)) return 'openai'
  if (m.startsWith('claude-')) return 'anthropic'
  if (m.startsWith('gemini-')) return 'google'
  if (m.startsWith('grok-')) return 'xai'
  if (m === 'raptor-mini' || m === 'goldeneye') return 'github'
  return null
}

export const priceFor = (modelId: string): ModelRate | null => {
  return RATES[normalizeModelId(modelId)] ?? null
}

export interface ModelTokenCounts {
  modelId: string
  inputTokens: number
  cachedInputTokens: number
  cacheWriteTokens: number
  outputTokens: number
  reasoningTokens: number
  requestCount?: number
}

const billableInputTokens = ({
  inputTokens,
  cachedInputTokens
}: Pick<ModelTokenCounts, 'inputTokens' | 'cachedInputTokens'>): number => {
  if (cachedInputTokens > 0 && cachedInputTokens <= inputTokens) {
    return inputTokens - cachedInputTokens
  }
  return inputTokens
}

export const computeCost = (counts: ModelTokenCounts): number | null => {
  const rate = priceFor(counts.modelId)
  if (!rate) return null
  const billableInput = billableInputTokens(counts)
  const billableOutput =
    rate.provider === 'anthropic'
      ? counts.outputTokens + counts.reasoningTokens
      : counts.outputTokens
  return (
    (billableInput * rate.input +
      counts.cachedInputTokens * rate.cachedInput +
      counts.cacheWriteTokens * rate.cacheWrite +
      billableOutput * rate.output) /
    1_000_000
  )
}

export type CostTier = '$' | '$$' | '$$$'

export const costTier = (costUsd: number | null): CostTier | null => {
  if (costUsd === null || costUsd === undefined || Number.isNaN(costUsd)) {
    return null
  }
  if (costUsd < 2) return '$'
  if (costUsd < 5) return '$$'
  return '$$$'
}
