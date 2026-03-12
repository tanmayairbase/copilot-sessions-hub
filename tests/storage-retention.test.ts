import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import type { SessionInsert } from '../src/main/storage'
import { SessionStorage } from '../src/main/storage'

const makeInsert = (id: string, updatedAt: string, userText: string, assistantText: string): SessionInsert => ({
  session: {
    id,
    source: 'cli',
    repoPath: '/tmp/repo',
    title: userText,
    model: 'gpt-5.3-codex',
    createdAt: updatedAt,
    updatedAt,
    messageCount: 2,
    filePath: `/tmp/repo/.copilot/${id}.json`,
    openVscodeTarget: `/tmp/repo/.copilot/${id}.json`,
    openCliCwd: '/tmp/repo'
  },
  messages: [
    {
      id: `${id}-u1`,
      sessionId: id,
      role: 'user',
      content: userText,
      format: 'text',
      timestamp: updatedAt
    },
    {
      id: `${id}-a1`,
      sessionId: id,
      role: 'assistant',
      content: assistantText,
      format: 'text',
      timestamp: updatedAt
    }
  ]
})

describe('SessionStorage archival retention', () => {
  it('retains sessions missing from later syncs as archived', async () => {
    const tempDir = await fs.mkdtemp(join(tmpdir(), 'copilot-storage-retention-'))
    const storage = new SessionStorage(join(tempDir, 'sessions-store.json'))

    storage.mergeFromSync(
      [
        makeInsert('session-a', '2026-03-01T00:00:00.000Z', 'old ask A', 'old answer A'),
        makeInsert('session-b', '2026-03-01T01:00:00.000Z', 'old ask B', 'old answer B')
      ],
      '2026-03-01T02:00:00.000Z'
    )

    const second = storage.mergeFromSync(
      [makeInsert('session-b', '2026-03-15T01:00:00.000Z', 'new ask B', 'new answer B')],
      '2026-03-15T02:00:00.000Z'
    )

    expect(second.archivedSessions).toBe(1)

    const sessions = storage.list('')
    const sessionA = sessions.find((session) => session.id === 'session-a')
    const sessionB = sessions.find((session) => session.id === 'session-b')

    expect(sessionA?.missingFromLastSync).toBe(true)
    expect(sessionA?.lastSeenAt).toBe('2026-03-01T02:00:00.000Z')
    expect(sessionB?.missingFromLastSync).toBe(false)
    expect(sessionB?.lastSeenAt).toBe('2026-03-15T02:00:00.000Z')

    const archivedDetail = storage.getSessionDetail('session-a')
    expect(archivedDetail?.messages).toHaveLength(2)
    expect(archivedDetail?.messages[0]?.content).toContain('old ask A')
  })

  it('unarchives a session when it appears again in a later sync', async () => {
    const tempDir = await fs.mkdtemp(join(tmpdir(), 'copilot-storage-retention-'))
    const storage = new SessionStorage(join(tempDir, 'sessions-store.json'))

    storage.mergeFromSync(
      [makeInsert('session-a', '2026-03-01T00:00:00.000Z', 'first ask', 'first answer')],
      '2026-03-01T02:00:00.000Z'
    )
    storage.mergeFromSync([], '2026-03-10T02:00:00.000Z')

    const third = storage.mergeFromSync(
      [makeInsert('session-a', '2026-03-20T00:00:00.000Z', 'revived ask', 'revived answer')],
      '2026-03-20T02:00:00.000Z'
    )

    expect(third.archivedSessions).toBe(0)

    const sessionA = storage.list('').find((session) => session.id === 'session-a')
    expect(sessionA?.missingFromLastSync).toBe(false)
    expect(sessionA?.lastSeenAt).toBe('2026-03-20T02:00:00.000Z')

    const revivedDetail = storage.getSessionDetail('session-a')
    expect(revivedDetail?.messages[0]?.content).toContain('revived ask')
  })

  it('matches sessions by session ID in search queries', async () => {
    const tempDir = await fs.mkdtemp(join(tmpdir(), 'copilot-storage-retention-'))
    const storage = new SessionStorage(join(tempDir, 'sessions-store.json'))

    storage.mergeFromSync(
      [
        makeInsert('session-alpha-123', '2026-03-01T00:00:00.000Z', 'first ask', 'first answer'),
        makeInsert('session-beta-999', '2026-03-02T00:00:00.000Z', 'second ask', 'second answer')
      ],
      '2026-03-02T02:00:00.000Z'
    )

    const byExactId = storage.list('session-alpha-123')
    expect(byExactId).toHaveLength(1)
    expect(byExactId[0]?.id).toBe('session-alpha-123')

    const byPartialId = storage.list('beta-999')
    expect(byPartialId).toHaveLength(1)
    expect(byPartialId[0]?.id).toBe('session-beta-999')
  })
})
