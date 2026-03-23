import type { SessionInsert } from '../../src/main/storage'
import type { SessionMessage, SessionSummary } from '../../src/shared/types'

export interface BenchmarkFixtureOptions {
  sessionCount: number
  messagesPerSession: number
  needle: string
  needleEvery: number
  targetSessionIndex: number
  baseRepoPath?: string
  baseTimestamp?: string
}

export interface BenchmarkFixtureSet {
  rows: SessionInsert[]
  needle: string
  expectedNeedleMatches: number
  targetSessionId: string
  messagesPerSession: number
}

const DEFAULT_BASE_TIMESTAMP = '2026-03-01T00:00:00.000Z'
const MODELS = ['gpt-5.3-codex', 'gpt-5.4-mini', 'claude-sonnet-4.5'] as const
const AGENTS = ['chat', 'edit', 'review'] as const

const makeSessionId = (index: number): string =>
  `bench-session-${String(index + 1).padStart(4, '0')}`

const makeMessage = (
  sessionId: string,
  sessionIndex: number,
  messageIndex: number,
  timestamp: string,
  needle: string,
  includeNeedle: boolean
): SessionMessage => {
  const role = messageIndex % 2 === 0 ? 'user' : 'assistant'
  const format =
    messageIndex % 6 === 0
      ? 'markdown'
      : messageIndex % 5 === 0
        ? 'ansi'
        : 'text'
  const marker = includeNeedle && messageIndex === 0 ? ` ${needle}` : ''

  return {
    id: `${sessionId}-m-${String(messageIndex + 1).padStart(2, '0')}`,
    sessionId,
    role,
    format,
    timestamp,
    content:
      role === 'user'
        ? `Please inspect repo module-${sessionIndex % 12} for regression${marker}.`
        : `Reviewed changes in src/module-${sessionIndex % 12}.ts and validated behavior.${marker}`,
    references:
      messageIndex % 4 === 0
        ? [
            {
              path: `src/module-${sessionIndex % 12}.ts`,
              startLine: 10 + messageIndex,
              endLine: 20 + messageIndex
            }
          ]
        : undefined,
    edits:
      role === 'assistant' && messageIndex % 3 === 1
        ? [
            {
              path: `src/module-${sessionIndex % 12}.ts`,
              startLine: 50 + messageIndex,
              endLine: 52 + messageIndex,
              addedLines: 4,
              removedLines: 1
            }
          ]
        : undefined
  }
}

export const generateBenchmarkFixtures = (
  options: BenchmarkFixtureOptions
): BenchmarkFixtureSet => {
  const baseTimestamp = options.baseTimestamp ?? DEFAULT_BASE_TIMESTAMP
  const baseTimeMs = new Date(baseTimestamp).getTime()
  const rows: SessionInsert[] = []
  let expectedNeedleMatches = 0

  for (let sessionIndex = 0; sessionIndex < options.sessionCount; sessionIndex += 1) {
    const includeNeedle = sessionIndex % options.needleEvery === 0
    if (includeNeedle) {
      expectedNeedleMatches += 1
    }

    const sessionId = makeSessionId(sessionIndex)
    const createdTimeMs = baseTimeMs + sessionIndex * 60_000
    const updatedTimeMs =
      createdTimeMs + (options.messagesPerSession - 1) * 15_000

    const messages = Array.from({ length: options.messagesPerSession }, (_, i) =>
      makeMessage(
        sessionId,
        sessionIndex,
        i,
        new Date(createdTimeMs + i * 15_000).toISOString(),
        options.needle,
        includeNeedle
      )
    )

    const summary: SessionSummary = {
      id: sessionId,
      source: sessionIndex % 2 === 0 ? 'cli' : 'vscode',
      repoPath: `${options.baseRepoPath ?? '/repos/perf'}/repo-${sessionIndex % 25}`,
      title: includeNeedle
        ? `Investigate ${options.needle} regression ${sessionIndex + 1}`
        : `Session ${sessionIndex + 1} routine maintenance`,
      agent: AGENTS[sessionIndex % AGENTS.length],
      model: MODELS[sessionIndex % MODELS.length],
      createdAt: new Date(createdTimeMs).toISOString(),
      updatedAt: new Date(updatedTimeMs).toISOString(),
      messageCount: options.messagesPerSession,
      filePath: `/repos/perf/repo-${sessionIndex % 25}/.copilot/sessions/${sessionId}.jsonl`,
      openVscodeTarget: `/repos/perf/repo-${sessionIndex % 25}`,
      openCliCwd: `/repos/perf/repo-${sessionIndex % 25}`
    }

    rows.push({ session: summary, messages })
  }

  const clampedTargetIndex = Math.max(
    0,
    Math.min(options.targetSessionIndex, options.sessionCount - 1)
  )

  return {
    rows,
    needle: options.needle,
    expectedNeedleMatches,
    targetSessionId: makeSessionId(clampedTargetIndex),
    messagesPerSession: options.messagesPerSession
  }
}

export const createHighVolumeBenchmarkFixtures = (
  overrides: Partial<BenchmarkFixtureOptions> = {}
): BenchmarkFixtureSet =>
  generateBenchmarkFixtures({
    sessionCount: 1_500,
    messagesPerSession: 8,
    needle: 'needle-perf',
    needleEvery: 7,
    targetSessionIndex: 1_234,
    ...overrides
  })
