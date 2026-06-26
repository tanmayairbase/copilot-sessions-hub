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

const writeClaudeSessionLog = async (
  filePath: string,
  cwd: string
): Promise<void> => {
  const raw = [
    JSON.stringify({
      type: 'user',
      uuid: 'u1',
      message: { role: 'user', content: 'Can you fix the bug?' },
      timestamp: '2026-01-01T10:00:00.000Z',
      cwd,
      sessionId: 'session-claude-sync-1'
    }),
    JSON.stringify({
      type: 'assistant',
      uuid: 'a1',
      message: {
        role: 'assistant',
        model: 'claude-sonnet-4-6',
        content: [{ type: 'text', text: 'Sure, fixed it.' }]
      },
      timestamp: '2026-01-01T10:00:05.000Z',
      cwd,
      sessionId: 'session-claude-sync-1'
    })
  ].join('\n')

  await fs.mkdir(dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, raw, 'utf8')
}

const mockGlobalGlobOnly = (matches: Record<string, string[]>): void => {
  fgMock.mockImplementation(
    async (patterns: unknown, options?: { cwd?: string }) => {
      if (options?.cwd) {
        return []
      }
      const patternKey = Array.isArray(patterns) ? patterns[0] : patterns
      for (const [needle, files] of Object.entries(matches)) {
        if (typeof patternKey === 'string' && patternKey.includes(needle)) {
          return files
        }
      }
      return []
    }
  )
}

describe('syncSessions Claude Code discovery', () => {
  beforeEach(() => {
    fgMock.mockReset()
    loadOpenCodeSessionsMock.mockReset()
    loadOpenCodeSessionsMock.mockResolvedValue([])
  })

  it('discovers and imports a Claude Code session within a configured repo root', async () => {
    const tempDir = await fs.mkdtemp(join(tmpdir(), 'copilot-sync-claude-'))
    const repoRoot = join(tempDir, 'projects', 'my-app')
    const artifactPath = join(
      tempDir,
      '.claude',
      'projects',
      '-projects-my-app',
      'session-claude-sync-1.jsonl'
    )
    const storage = new SessionStorage(join(tempDir, 'sessions-store.json'))

    await fs.mkdir(repoRoot, { recursive: true })
    await writeClaudeSessionLog(artifactPath, repoRoot)

    mockGlobalGlobOnly({ '.claude/projects': [artifactPath] })

    const result = await syncSessions(buildConfig(repoRoot), storage)

    expect(result.sessionsImported).toBe(1)
    const sessions = storage.list('')
    expect(sessions).toHaveLength(1)
    expect(sessions[0].source).toBe('claude')
    expect(sessions[0].repoPath).toBe(repoRoot)
  })

  it('excludes a Claude Code session whose cwd is outside every configured repo root', async () => {
    const tempDir = await fs.mkdtemp(join(tmpdir(), 'copilot-sync-claude-'))
    const configuredRepoRoot = join(tempDir, 'projects', 'my-app')
    const outsideCwd = join(tempDir, 'projects', 'unrelated-app')
    const artifactPath = join(
      tempDir,
      '.claude',
      'projects',
      '-projects-unrelated-app',
      'session-claude-sync-2.jsonl'
    )
    const storage = new SessionStorage(join(tempDir, 'sessions-store.json'))

    await fs.mkdir(configuredRepoRoot, { recursive: true })
    await fs.mkdir(outsideCwd, { recursive: true })
    await writeClaudeSessionLog(artifactPath, outsideCwd)

    mockGlobalGlobOnly({ '.claude/projects': [artifactPath] })

    const result = await syncSessions(
      buildConfig(configuredRepoRoot),
      storage
    )

    expect(result.sessionsImported).toBe(0)
    expect(storage.list('')).toHaveLength(0)
  })
})
