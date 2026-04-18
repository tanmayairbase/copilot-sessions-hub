import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react'
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
  explicitPatterns: [],
  appearance: 'light',
  syncMode: 'manual',
  backgroundSyncIntervalMinutes: 10
}

const backgroundConfig: AppConfig = {
  ...config,
  syncMode: 'manual-plus-background',
  backgroundSyncIntervalMinutes: 1
}

const syncResult: SyncResult = {
  filesScanned: 1,
  sessionsImported: 1,
  skippedFiles: 0,
  durationSeconds: 1,
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

    ;(window as Window & { copilotSessions?: RendererApi }).copilotSessions =
      api

    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('Messages: 1')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Sync' }))

    await waitFor(() => {
      expect(screen.getByText('Messages: 2')).toBeTruthy()
    })

    expect(
      screen.getByText(
        'Last sync: imported 1 sessions, scanned 1 files, skipped 0, in 1s'
      )
    ).toBeTruthy()

    expect(api.syncSessions).toHaveBeenCalledTimes(1)
    expect(api.getSessionDetail).toHaveBeenCalledTimes(2)
  })

  it('schedules periodic background sync and prevents overlap storms', async () => {
    let currentMessageCount = 1
    let resolveFirstSync: (result: SyncResult) => void = () => undefined
    const firstSyncPromise = new Promise<SyncResult>(resolve => {
      resolveFirstSync = resolve
    })
    let intervalCallback: () => void = () => undefined
    const setIntervalSpy = vi
      .spyOn(window, 'setInterval')
      .mockImplementation((callback: TimerHandler) => {
        intervalCallback = callback as () => void
        return 1
      })
    const clearIntervalSpy = vi
      .spyOn(window, 'clearInterval')
      .mockImplementation(() => undefined)

    const api: RendererApi = {
      getConfig: vi.fn(async () => backgroundConfig),
      saveConfig: vi.fn(async () => backgroundConfig),
      openConfigFile: vi.fn(async () => undefined),
      syncSessions: vi.fn(async () => {
        currentMessageCount += 1
        if (currentMessageCount === 2) {
          return firstSyncPromise
        }
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

    ;(window as Window & { copilotSessions?: RendererApi }).copilotSessions =
      api
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('Messages: 1')).toBeTruthy()
      expect(screen.getByText('Background sync enabled')).toBeTruthy()
    })

    intervalCallback()
    await waitFor(() => {
      expect(api.syncSessions).toHaveBeenCalledTimes(1)
      expect(screen.getByText('Background sync running...')).toBeTruthy()
    })

    intervalCallback()
    expect(api.syncSessions).toHaveBeenCalledTimes(1)

    resolveFirstSync(syncResult)
    await waitFor(() => {
      expect(api.syncSessions).toHaveBeenCalledTimes(1)
    })
    await waitFor(() => {
      expect(screen.getByText('Messages: 2')).toBeTruthy()
    })
    expect(screen.queryByText(/Sync complete:/)).toBeNull()

    setIntervalSpy.mockRestore()
    clearIntervalSpy.mockRestore()
  })

  it('applies light theme and skips sync when only appearance changes', async () => {
    const darkConfig: AppConfig = {
      ...config,
      appearance: 'dark'
    }

    const api: RendererApi = {
      getConfig: vi.fn(async () => config),
      saveConfig: vi.fn(async () => darkConfig),
      openConfigFile: vi.fn(async () => undefined),
      syncSessions: vi.fn(async () => syncResult),
      listSessions: vi.fn(async () => [baseSession]),
      getSessionDetail: vi.fn(async () => buildDetail(1)),
      openSessionInTool: vi.fn(async () => ({ ok: true, message: 'ok' })),
      setSessionArchived: vi.fn(async () => null),
      setMessageStarred: vi.fn(async () => null),
      listStarredMessages: vi.fn(async () => [])
    }

    ;(window as Window & { copilotSessions?: RendererApi }).copilotSessions =
      api

    render(<App />)

    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe('light')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Appearance' }), {
      target: { value: 'dark' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(api.saveConfig).toHaveBeenCalledWith(darkConfig)
      expect(screen.getByText('Settings saved.')).toBeTruthy()
    })

    expect(api.syncSessions).not.toHaveBeenCalled()
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('hides sub-agent sessions by default and can show them from filters', async () => {
    const visibleSession: SessionSummary = {
      ...baseSession,
      id: 'session-visible',
      title: 'Visible session'
    }
    const hiddenSubagentSession: SessionSummary = {
      ...baseSession,
      id: 'session-subagent',
      title: 'Hidden sub-agent session',
      isSubagentSession: true
    }

    const api: RendererApi = {
      getConfig: vi.fn(async () => config),
      saveConfig: vi.fn(async () => config),
      openConfigFile: vi.fn(async () => undefined),
      syncSessions: vi.fn(async () => syncResult),
      listSessions: vi.fn(async () => [visibleSession, hiddenSubagentSession]),
      getSessionDetail: vi.fn(async sessionId => {
        const detail = buildDetail(1)
        return {
          ...detail,
          ...(sessionId === hiddenSubagentSession.id
            ? hiddenSubagentSession
            : visibleSession),
          messages: detail.messages
        }
      }),
      openSessionInTool: vi.fn(async () => ({ ok: true, message: 'ok' })),
      setSessionArchived: vi.fn(async () => null),
      setMessageStarred: vi.fn(async () => null),
      listStarredMessages: vi.fn(async () => [])
    }

    ;(window as Window & { copilotSessions?: RendererApi }).copilotSessions =
      api

    render(<App />)

    await waitFor(() => {
      expect(screen.getAllByText('Visible session').length).toBeGreaterThan(0)
    })
    expect(screen.queryByText('Hidden sub-agent session')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Filters' }))
    fireEvent.change(screen.getByLabelText('Sub-agents filter'), {
      target: { value: 'show' }
    })

    await waitFor(() => {
      expect(screen.getAllByText('Hidden sub-agent session').length).toBeGreaterThan(0)
    })
  })
})
