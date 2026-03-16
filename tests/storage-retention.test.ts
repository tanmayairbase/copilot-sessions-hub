import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import type { SessionInsert } from '../src/main/storage'
import { SessionStorage } from '../src/main/storage'
import type { SessionMessage, SessionSummary } from '../src/shared/types'

const makeInsert = (
  id: string,
  updatedAt: string,
  userText: string,
  assistantText: string
): SessionInsert => ({
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
    const tempDir = await fs.mkdtemp(
      join(tmpdir(), 'copilot-storage-retention-')
    )
    const storage = new SessionStorage(join(tempDir, 'sessions-store.json'))

    storage.mergeFromSync(
      [
        makeInsert(
          'session-a',
          '2026-03-01T00:00:00.000Z',
          'old ask A',
          'old answer A'
        ),
        makeInsert(
          'session-b',
          '2026-03-01T01:00:00.000Z',
          'old ask B',
          'old answer B'
        )
      ],
      '2026-03-01T02:00:00.000Z'
    )

    const second = storage.mergeFromSync(
      [
        makeInsert(
          'session-b',
          '2026-03-15T01:00:00.000Z',
          'new ask B',
          'new answer B'
        )
      ],
      '2026-03-15T02:00:00.000Z'
    )

    expect(second.archivedSessions).toBe(1)

    const sessions = storage.list('')
    const sessionA = sessions.find(session => session.id === 'session-a')
    const sessionB = sessions.find(session => session.id === 'session-b')

    expect(sessionA?.missingFromLastSync).toBe(true)
    expect(sessionA?.lastSeenAt).toBe('2026-03-01T02:00:00.000Z')
    expect(sessionB?.missingFromLastSync).toBe(false)
    expect(sessionB?.lastSeenAt).toBe('2026-03-15T02:00:00.000Z')

    const archivedDetail = storage.getSessionDetail('session-a')
    expect(archivedDetail?.messages).toHaveLength(2)
    expect(archivedDetail?.messages[0]?.content).toContain('old ask A')
  })

  it('unarchives a session when it appears again in a later sync', async () => {
    const tempDir = await fs.mkdtemp(
      join(tmpdir(), 'copilot-storage-retention-')
    )
    const storage = new SessionStorage(join(tempDir, 'sessions-store.json'))

    storage.mergeFromSync(
      [
        makeInsert(
          'session-a',
          '2026-03-01T00:00:00.000Z',
          'first ask',
          'first answer'
        )
      ],
      '2026-03-01T02:00:00.000Z'
    )
    storage.mergeFromSync([], '2026-03-10T02:00:00.000Z')

    const third = storage.mergeFromSync(
      [
        makeInsert(
          'session-a',
          '2026-03-20T00:00:00.000Z',
          'revived ask',
          'revived answer'
        )
      ],
      '2026-03-20T02:00:00.000Z'
    )

    expect(third.archivedSessions).toBe(0)

    const sessionA = storage
      .list('')
      .find(session => session.id === 'session-a')
    expect(sessionA?.missingFromLastSync).toBe(false)
    expect(sessionA?.lastSeenAt).toBe('2026-03-20T02:00:00.000Z')

    const revivedDetail = storage.getSessionDetail('session-a')
    expect(revivedDetail?.messages[0]?.content).toContain('revived ask')
  })

  it('matches sessions by session ID in search queries', async () => {
    const tempDir = await fs.mkdtemp(
      join(tmpdir(), 'copilot-storage-retention-')
    )
    const storage = new SessionStorage(join(tempDir, 'sessions-store.json'))

    storage.mergeFromSync(
      [
        makeInsert(
          'session-alpha-123',
          '2026-03-01T00:00:00.000Z',
          'first ask',
          'first answer'
        ),
        makeInsert(
          'session-beta-999',
          '2026-03-02T00:00:00.000Z',
          'second ask',
          'second answer'
        )
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

  it('persists local archive state without deleting messages', async () => {
    const tempDir = await fs.mkdtemp(
      join(tmpdir(), 'copilot-storage-retention-')
    )
    const storage = new SessionStorage(join(tempDir, 'sessions-store.json'))

    storage.mergeFromSync(
      [
        makeInsert(
          'session-archive-1',
          '2026-03-03T00:00:00.000Z',
          'ask',
          'answer'
        )
      ],
      '2026-03-03T02:00:00.000Z'
    )

    const archived = storage.setArchived('session-archive-1', true)
    expect(archived?.userArchived).toBe(true)
    expect(archived?.userArchivedAt).toBeTruthy()
    expect(
      storage.getSessionDetail('session-archive-1')?.messages
    ).toHaveLength(2)

    const unarchived = storage.setArchived('session-archive-1', false)
    expect(unarchived?.userArchived).toBe(false)
    expect(unarchived?.userArchivedAt).toBeUndefined()
  })

  it('keeps manual archive when upstream does not change, then unarchives on newer upstream update', async () => {
    const tempDir = await fs.mkdtemp(
      join(tmpdir(), 'copilot-storage-retention-')
    )
    const storage = new SessionStorage(join(tempDir, 'sessions-store.json'))

    storage.mergeFromSync(
      [
        makeInsert(
          'session-archive-2',
          '2026-03-03T00:00:00.000Z',
          'ask',
          'answer'
        )
      ],
      '2026-03-03T02:00:00.000Z'
    )
    storage.setArchived('session-archive-2', true)

    storage.mergeFromSync(
      [
        makeInsert(
          'session-archive-2',
          '2026-03-03T00:00:00.000Z',
          'ask',
          'answer'
        )
      ],
      '2026-03-10T02:00:00.000Z'
    )
    expect(
      storage.list('').find(row => row.id === 'session-archive-2')?.userArchived
    ).toBe(true)

    storage.mergeFromSync(
      [
        makeInsert(
          'session-archive-2',
          '2026-03-20T00:00:00.000Z',
          'ask-new',
          'answer-new'
        )
      ],
      '2026-03-20T02:00:00.000Z'
    )
    expect(
      storage.list('').find(row => row.id === 'session-archive-2')?.userArchived
    ).toBe(false)
  })

  it('prunes manually archived sessions older than four months during sync', async () => {
    const tempDir = await fs.mkdtemp(
      join(tmpdir(), 'copilot-storage-retention-')
    )
    const storagePath = join(tempDir, 'sessions-store.json')
    const summary: SessionSummary = {
      id: 'session-prune-1',
      source: 'cli',
      repoPath: '/tmp/repo',
      title: 'old archived',
      model: 'gpt-5.3-codex',
      createdAt: '2025-10-01T00:00:00.000Z',
      updatedAt: '2025-10-01T00:00:00.000Z',
      messageCount: 1,
      filePath: '/tmp/repo/.copilot/session-prune-1.json',
      openVscodeTarget: '/tmp/repo/.copilot/session-prune-1.json',
      openCliCwd: '/tmp/repo',
      userArchived: true,
      userArchivedAt: '2025-10-01T00:00:00.000Z'
    }
    const message: SessionMessage = {
      id: 'session-prune-1-u1',
      sessionId: 'session-prune-1',
      role: 'user',
      content: 'old',
      format: 'text',
      timestamp: '2025-10-01T00:00:00.000Z'
    }
    await fs.writeFile(
      storagePath,
      `${JSON.stringify({ sessions: [summary], messages: [message] }, null, 2)}\n`,
      'utf8'
    )

    const storage = new SessionStorage(storagePath)
    storage.mergeFromSync([], '2026-03-16T00:00:00.000Z')

    expect(storage.list('')).toHaveLength(0)
    expect(storage.getSessionDetail('session-prune-1')).toBeNull()
  })

  it('keeps starred messages as stale bookmarks when upstream target disappears', async () => {
    const tempDir = await fs.mkdtemp(
      join(tmpdir(), 'copilot-storage-retention-')
    )
    const storage = new SessionStorage(join(tempDir, 'sessions-store.json'))

    storage.mergeFromSync(
      [
        makeInsert(
          'session-star-1',
          '2026-03-03T00:00:00.000Z',
          'ask',
          'answer'
        )
      ],
      '2026-03-03T02:00:00.000Z'
    )
    storage.setMessageStarred('session-star-1', 'session-star-1-a1', true)

    storage.mergeFromSync(
      [
        {
          session: {
            id: 'session-star-1',
            source: 'cli',
            repoPath: '/tmp/repo',
            title: 'ask changed',
            model: 'gpt-5.3-codex',
            createdAt: '2026-03-05T00:00:00.000Z',
            updatedAt: '2026-03-05T00:00:00.000Z',
            messageCount: 2,
            filePath: '/tmp/repo/.copilot/session-star-1.json',
            openVscodeTarget: '/tmp/repo/.copilot/session-star-1.json',
            openCliCwd: '/tmp/repo'
          },
          messages: [
            {
              id: 'session-star-1-u2',
              sessionId: 'session-star-1',
              role: 'user',
              content: 'ask changed',
              format: 'text',
              timestamp: '2026-03-05T00:00:00.000Z'
            },
            {
              id: 'session-star-1-a2',
              sessionId: 'session-star-1',
              role: 'assistant',
              content: 'answer changed',
              format: 'text',
              timestamp: '2026-03-05T00:00:00.000Z'
            }
          ]
        }
      ],
      '2026-03-05T02:00:00.000Z'
    )

    const stars = storage.listStarredMessages('')
    expect(stars).toHaveLength(1)
    expect(stars[0]?.stale).toBe(true)
    expect(stars[0]?.sessionId).toBe('session-star-1')
  })
})
