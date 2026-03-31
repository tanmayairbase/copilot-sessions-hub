import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppConfig } from '../src/shared/types'
import { SessionStorage } from '../src/main/storage'

const { fgMock, loadOpenCodeSessionsMock } = vi.hoisted(() => ({
  fgMock: vi.fn(),
  loadOpenCodeSessionsMock: vi.fn()
}))

vi.mock('fast-glob', () => ({
  default: fgMock
}))

vi.mock('../src/main/opencode', () => ({
  loadOpenCodeSessions: loadOpenCodeSessionsMock
}))

import { syncSessions } from '../src/main/sync'

const buildConfig = (repoRoot: string): AppConfig => ({
  repoRoots: [repoRoot],
  discoveryMode: 'explicit',
  explicitPatterns: ['**/*.jsonl'],
  appearance: 'system',
  syncMode: 'manual',
  backgroundSyncIntervalMinutes: 10
})

const writeEventLog = async (filePath: string, cwd: string): Promise<void> => {
  const raw = [
    JSON.stringify({
      type: 'session.start',
      data: {
        sessionId: 'session-outside-root',
        copilotVersion: '1.0.3',
        startTime: '2026-03-28T10:00:00.000Z',
        context: { cwd }
      },
      timestamp: '2026-03-28T10:00:00.000Z'
    }),
    JSON.stringify({
      type: 'user.message',
      data: {
        content: 'Should this session show up?'
      },
      timestamp: '2026-03-28T10:01:00.000Z'
    }),
    JSON.stringify({
      type: 'assistant.message',
      data: {
        content: 'No, this repo is outside the configured roots.'
      },
      timestamp: '2026-03-28T10:01:01.000Z'
    })
  ].join('\n')

  await fs.mkdir(dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, raw, 'utf8')
}

describe('syncSessions repo root filtering', () => {
  beforeEach(() => {
    fgMock.mockReset()
    loadOpenCodeSessionsMock.mockReset()
    loadOpenCodeSessionsMock.mockResolvedValue([])
  })

  it('excludes sessions whose repo path only shares a string prefix with a configured root', async () => {
    const tempDir = await fs.mkdtemp(join(tmpdir(), 'copilot-sync-roots-'))
    const configuredRepoRoot = join(tempDir, 'projects', 'hiring')
    const outsideRepoRoot = join(tempDir, 'projects', 'hiring-sandbox')
    const artifactPath = join(
      tempDir,
      '.copilot',
      'session-state',
      'session-outside-root',
      'events.jsonl'
    )
    const storage = new SessionStorage(join(tempDir, 'sessions-store.json'))

    await fs.mkdir(configuredRepoRoot, { recursive: true })
    await fs.mkdir(outsideRepoRoot, { recursive: true })
    await writeEventLog(artifactPath, outsideRepoRoot)

    fgMock.mockImplementation(
      async (_patterns: unknown, options?: { cwd?: string }) => {
        if (options?.cwd === configuredRepoRoot) {
          return []
        }
        return [artifactPath]
      }
    )

    const result = await syncSessions(buildConfig(configuredRepoRoot), storage)

    expect(result.filesScanned).toBe(1)
    expect(result.sessionsImported).toBe(0)
    expect(storage.list('')).toHaveLength(0)
  })
})
