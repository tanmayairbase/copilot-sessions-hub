import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  AppConfig,
  RendererApi,
  SessionDetail,
  SessionSummary,
  SyncResult
} from '../src/shared/types'
import { App } from '../src/renderer/src/App'

const baseSession: SessionSummary = {
  id: 'session-1',
  source: 'cli',
  repoPath: '/repos/a',
  title: 'Session title',
  model: 'gpt-5.3-codex',
  createdAt: '2026-03-10T10:00:00.000Z',
  updatedAt: '2026-03-10T10:30:00.000Z',
  messageCount: 1,
  filePath: '/repos/a/.copilot/events.jsonl',
  openVscodeTarget: '/repos/a/.copilot/events.jsonl',
  openCliCwd: '/repos/a'
}

const config: AppConfig = {
  repoRoots: ['/repos/a'],
  discoveryMode: 'both',
  explicitPatterns: []
}

const syncResult: SyncResult = {
  filesScanned: 1,
  sessionsImported: 1,
  skippedFiles: 0,
  errors: []
}

const buildDetail = (messageCount: number): SessionDetail => ({
  ...baseSession,
  messageCount,
  messages: Array.from({ length: messageCount }).map((_, index) => ({
    id: `m-${index + 1}`,
    sessionId: baseSession.id,
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `message ${index + 1}`,
    format: 'text',
    timestamp: `2026-03-10T10:${String(index).padStart(2, '0')}:00.000Z`
  }))
})

describe('App sync detail refresh', () => {
  afterEach(() => {
    cleanup()
  })

  it('refreshes selected session detail after sync when the session remains selected', async () => {
    let currentMessageCount = 1

    const api: RendererApi = {
      getConfig: vi.fn(async () => config),
      saveConfig: vi.fn(async () => config),
      openConfigFile: vi.fn(async () => undefined),
      syncSessions: vi.fn(async () => {
        currentMessageCount = 2
        return syncResult
      }),
      listSessions: vi.fn(async () => [
        {
          ...baseSession,
          messageCount: currentMessageCount
        }
      ]),
      getSessionDetail: vi.fn(async () => buildDetail(currentMessageCount)),
      openSessionInTool: vi.fn(async () => ({ ok: true, message: 'ok' })),
      setSessionArchived: vi.fn(async () => null),
      setMessageStarred: vi.fn(async () => null),
      listStarredMessages: vi.fn(async () => [])
    }

    ;(window as Window & { copilotSessions?: RendererApi }).copilotSessions = api

    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('Messages: 1')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Sync' }))

    await waitFor(() => {
      expect(screen.getByText('Messages: 2')).toBeTruthy()
    })

    expect(api.syncSessions).toHaveBeenCalledTimes(1)
    expect(api.getSessionDetail).toHaveBeenCalledTimes(2)
  })
})
