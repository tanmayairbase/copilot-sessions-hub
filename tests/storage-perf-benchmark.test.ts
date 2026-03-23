import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionStorage } from '../src/main/storage'
import { createHighVolumeBenchmarkFixtures } from './helpers/perf-benchmark-fixtures'

const measure = <T>(fn: () => T): { value: T; durationMs: number } => {
  const startedAt = performance.now()
  const value = fn()
  return {
    value,
    durationMs: performance.now() - startedAt
  }
}

const assertOptionalBudget = (
  label: string,
  durationMs: number,
  budgetMs: number
): void => {
  expect(Number.isFinite(durationMs), `${label} should produce a numeric duration`).toBe(true)
  expect(durationMs).toBeGreaterThanOrEqual(0)

  if (process.env.CI === 'true') {
    return
  }

  expect(durationMs, `${label} expected under ${budgetMs}ms (non-CI)`).toBeLessThan(budgetMs)
}

describe('SessionStorage performance fixtures', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('supports deterministic high-volume list/search/detail measurements', async () => {
    const tempDir = await fs.mkdtemp(join(tmpdir(), 'copilot-storage-perf-'))

    try {
      const storage = new SessionStorage(join(tempDir, 'sessions-store.json'))
      const fixtures = createHighVolumeBenchmarkFixtures()

      const sync = measure(() =>
        storage.mergeFromSync(fixtures.rows, '2026-03-25T00:00:00.000Z')
      )
      const listAll = measure(() => storage.list(''))
      const listNeedle = measure(() => storage.list(fixtures.needle))
      const detailCold = measure(() =>
        storage.getSessionDetail(fixtures.targetSessionId)
      )
      const detailWarm = measure(() =>
        storage.getSessionDetail(fixtures.targetSessionId)
      )

      expect(sync.value.totalSessions).toBe(fixtures.rows.length)
      expect(sync.value.newSessions).toBe(fixtures.rows.length)
      expect(listAll.value).toHaveLength(fixtures.rows.length)
      expect(listNeedle.value).toHaveLength(fixtures.expectedNeedleMatches)
      expect(
        listNeedle.value.every(session =>
          session.title.toLowerCase().includes(fixtures.needle)
        )
      ).toBe(true)
      expect(detailCold.value?.id).toBe(fixtures.targetSessionId)
      expect(detailCold.value?.messages).toHaveLength(fixtures.messagesPerSession)
      expect(detailWarm.value?.messages).toHaveLength(fixtures.messagesPerSession)

      assertOptionalBudget('mergeFromSync(1500 sessions)', sync.durationMs, 8_000)
      assertOptionalBudget('list(\'\')', listAll.durationMs, 3_000)
      assertOptionalBudget('list(needle)', listNeedle.durationMs, 3_000)
      assertOptionalBudget('getSessionDetail(cold)', detailCold.durationMs, 2_000)
      assertOptionalBudget('getSessionDetail(warm)', detailWarm.durationMs, 2_000)
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  })
})
