import React, { useCallback, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react'
import type { AppConfig, RendererApi, SessionDetail, SessionSource, SessionSummary, SyncResult } from '@shared/types'
import type { DateFilterPreset } from '@shared/format'
import { matchesIstDatePreset, matchesRepositoryFilter } from '@shared/format'
import { SessionDetailView } from './components/SessionDetailView'
import { SessionListSidebar } from './components/SessionListSidebar'
import { SettingsModal } from './components/SettingsModal'

const SIDEBAR_WIDTH_KEY = 'copilot-sessions-sidebar-width'
type DateFilterValue = DateFilterPreset | ''
const SIDEBAR_MIN_WIDTH = 260
const SIDEBAR_COLLAPSE_MIN_WIDTH = 180
const SIDEBAR_MAX_WIDTH = 620
const DETAIL_MIN_WIDTH = 320
const RESIZER_WIDTH = 6

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value))
const getSidebarBounds = (viewportWidth: number): { min: number; max: number } => {
  const max = Math.max(
    SIDEBAR_COLLAPSE_MIN_WIDTH,
    Math.min(SIDEBAR_MAX_WIDTH, viewportWidth - DETAIL_MIN_WIDTH - RESIZER_WIDTH)
  )
  const min = Math.min(SIDEBAR_MIN_WIDTH, max)
  return { min, max }
}
const uiLog = (message: string, meta?: unknown): void => {
  console.info(`[ui] ${message}`, meta ?? {})
}

export const App = () => {
  const apiRef = useMemo(
    () => (window as Window & { copilotSessions?: RendererApi }).copilotSessions ?? null,
    []
  )
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedDetail, setSelectedDetail] = useState<SessionDetail | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [isSyncing, setIsSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null)
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [selectedRepos, setSelectedRepos] = useState<string[]>([])
  const [selectedModels, setSelectedModels] = useState<string[]>([])
  const [selectedOrigins, setSelectedOrigins] = useState<SessionSource[]>([])
  const [dateFilter, setDateFilter] = useState<DateFilterValue>('')
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const value = Number(window.localStorage.getItem(SIDEBAR_WIDTH_KEY) ?? '360')
    const bounds = getSidebarBounds(window.innerWidth)
    return clamp(value, bounds.min, bounds.max)
  })

  const ensureApi = useCallback((): RendererApi => {
    if (!apiRef) {
      throw new Error('Renderer bridge unavailable. Restart the app after rebuilding.')
    }
    return apiRef
  }, [apiRef])

  const refreshList = useCallback(async (query: string): Promise<void> => {
    uiLog('Refreshing session list', { query })
    const rows = await ensureApi().listSessions(query)
    setSessions(rows)
    setSelectedId((previous) => (rows.some((row) => row.id === previous) ? previous : (rows[0]?.id ?? null)))
    uiLog('Session list refreshed', { query, count: rows.length })
  }, [ensureApi])

  useEffect(() => {
    const init = async (): Promise<void> => {
      try {
        uiLog('Initializing app state')
        const loadedConfig = await ensureApi().getConfig()
        setConfig(loadedConfig)
        uiLog('Config loaded in renderer', {
          repoRoots: loadedConfig.repoRoots.length,
          discoveryMode: loadedConfig.discoveryMode
        })
        await refreshList('')
      } catch (error) {
        const message = `Init failed: ${(error as Error).message}`
        setToast(message)
        uiLog('Initialization failed', { message })
      }
    }

    void init()
  }, [ensureApi, refreshList])

  useEffect(() => {
    if (!selectedId) {
      setSelectedDetail(null)
      return
    }

    void ensureApi()
      .getSessionDetail(selectedId)
      .then((detail) => {
        setSelectedDetail(detail)
      })
      .catch((error) => {
        setToast(`Failed loading session: ${(error as Error).message}`)
      })
  }, [ensureApi, selectedId])

  useEffect(() => {
    void refreshList(searchQuery).catch((error) => {
      setToast(`Search failed: ${(error as Error).message}`)
    })
  }, [refreshList, searchQuery])

  const repositoryOptions = useMemo(() => (config?.repoRoots ?? []).slice().sort((a, b) => a.localeCompare(b)), [config])
  const modelOptions = useMemo(
    () =>
      [...new Set(sessions.map((session) => session.model).filter((model): model is string => Boolean(model)))]
        .sort((a, b) => a.localeCompare(b)),
    [sessions]
  )
  const originOptions = useMemo(() => ['vscode', 'cli', 'opencode'] as SessionSource[], [])

  useEffect(() => {
    setSelectedRepos((current) => current.filter((repoPath) => repositoryOptions.includes(repoPath)))
  }, [repositoryOptions])

  useEffect(() => {
    setSelectedModels((current) => current.filter((model) => modelOptions.includes(model)))
  }, [modelOptions])

  useEffect(() => {
    setSelectedOrigins((current) => current.filter((source) => originOptions.includes(source)))
  }, [originOptions])

  useEffect(() => {
    const onResize = (): void => {
      const bounds = getSidebarBounds(window.innerWidth)
      setSidebarWidth((current) => {
        const next = clamp(current, bounds.min, bounds.max)
        if (next !== current) {
          window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(next))
        }
        return next
      })
    }

    window.addEventListener('resize', onResize)
    window.addEventListener('focus', onResize)
    window.visualViewport?.addEventListener('resize', onResize)
    onResize()
    const resizeSyncTimer = window.setTimeout(onResize, 50)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('focus', onResize)
      window.visualViewport?.removeEventListener('resize', onResize)
      window.clearTimeout(resizeSyncTimer)
    }
  }, [])

  const filteredSessions = useMemo(() => {
    return sessions.filter((session) => {
      if (!matchesRepositoryFilter(session.repoPath, selectedRepos)) {
        return false
      }
      if (selectedModels.length > 0 && (!session.model || !selectedModels.includes(session.model))) {
        return false
      }
      if (selectedOrigins.length > 0 && !selectedOrigins.includes(session.source)) {
        return false
      }
      if (dateFilter && !matchesIstDatePreset(session.updatedAt, dateFilter)) {
        return false
      }
      return true
    })
  }, [dateFilter, selectedModels, selectedOrigins, selectedRepos, sessions])

  useEffect(() => {
    setSelectedId((previous) =>
      filteredSessions.some((session) => session.id === previous) ? previous : (filteredSessions[0]?.id ?? null)
    )
  }, [filteredSessions])

  const onToggleRepo = useCallback((repoPath: string): void => {
    setSelectedRepos((current) =>
      current.includes(repoPath) ? current.filter((item) => item !== repoPath) : [...current, repoPath]
    )
  }, [])

  const onToggleModel = useCallback((model: string): void => {
    setSelectedModels((current) =>
      current.includes(model) ? current.filter((item) => item !== model) : [...current, model]
    )
  }, [])

  const onToggleOrigin = useCallback((source: SessionSource): void => {
    setSelectedOrigins((current) =>
      current.includes(source) ? current.filter((item) => item !== source) : [...current, source]
    )
  }, [])
  const onClearFilters = useCallback((): void => {
    setSelectedRepos([])
    setSelectedModels([])
    setSelectedOrigins([])
    setDateFilter('')
  }, [])

  const onSync = async (): Promise<void> => {
    setIsSyncing(true)
    uiLog('Starting sync from UI')
    try {
      const result = await ensureApi().syncSessions()
      setSyncResult(result)
      await refreshList(searchQuery)
      setToast(`Sync complete: ${result.sessionsImported} sessions imported from ${result.filesScanned} files.`)
      uiLog('Sync completed in UI', result)
    } catch (error) {
      const message = `Sync failed: ${(error as Error).message}`
      setToast(message)
      uiLog('Sync failed in UI', { message })
    } finally {
      setIsSyncing(false)
    }
  }

  const onSaveConfig = async (next: AppConfig): Promise<void> => {
    try {
      uiLog('Saving config from settings modal', {
        repoRoots: next.repoRoots.length,
        discoveryMode: next.discoveryMode,
        explicitPatterns: next.explicitPatterns.length
      })
      const saved = await ensureApi().saveConfig(next)
      setConfig(saved)
      setToast('Config saved. Syncing...')
      uiLog('Config saved, triggering sync', { repoRoots: saved.repoRoots.length })
      const result = await ensureApi().syncSessions()
      setSyncResult(result)
      await refreshList(searchQuery)
      setToast(`Config saved and synced: ${result.sessionsImported} sessions imported from ${result.filesScanned} files.`)
    } catch (error) {
      const message = `Config save failed: ${(error as Error).message}`
      setToast(message)
      uiLog('Config save failed', { message })
      throw error
    }
  }

  const onOpenConfigFile = async (): Promise<void> => {
    try {
      await ensureApi().openConfigFile()
      setToast('Opened config file.')
    } catch (error) {
      setToast(`Open config failed: ${(error as Error).message}`)
    }
  }

  const onCopySessionId = useCallback(async (sessionId: string): Promise<void> => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(sessionId)
      } else {
        const input = document.createElement('textarea')
        input.value = sessionId
        input.setAttribute('readonly', 'true')
        input.style.position = 'fixed'
        input.style.left = '-10000px'
        document.body.appendChild(input)
        input.select()
        const copied = document.execCommand('copy')
        document.body.removeChild(input)
        if (!copied) {
          throw new Error('Clipboard API unavailable')
        }
      }
      setToast('Session ID copied.')
    } catch (error) {
      setToast(`Copy failed: ${(error as Error).message}`)
    }
  }, [])

  const startResize = (event: ReactMouseEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = sidebarWidth

    const onMove = (moveEvent: globalThis.MouseEvent): void => {
      const bounds = getSidebarBounds(window.innerWidth)
      const next = clamp(startWidth + (moveEvent.clientX - startX), bounds.min, bounds.max)
      setSidebarWidth(next)
      window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(next))
    }

    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const syncErrors = useMemo(() => {
    if (!syncResult || syncResult.errors.length === 0) {
      return null
    }
    return `${syncResult.errors.length} file errors captured during sync.`
  }, [syncResult])
  const hasActiveFilters = selectedRepos.length > 0 || selectedModels.length > 0 || selectedOrigins.length > 0 || Boolean(dateFilter)

  return (
    <div className="app-root">
      <header className="topbar">
        <h1>Copilot Sessions Hub</h1>

        <div className="topbar-actions">
          <button type="button" onClick={() => void onSync()} disabled={isSyncing}>
            {isSyncing ? 'Syncing...' : 'Sync'}
          </button>
          <button type="button" onClick={() => setShowSettings(true)} disabled={!config}>
            Settings
          </button>
          <button type="button" onClick={() => void onOpenConfigFile()}>
            Open Config JSON
          </button>
        </div>
      </header>

      <main className="layout">
        <div className="sidebar-shell" style={{ width: `${sidebarWidth}px` }}>
          <SessionListSidebar
            sessions={filteredSessions}
            selectedId={selectedId}
            onSelect={setSelectedId}
            query={searchQuery}
            onQueryChange={setSearchQuery}
            onClearFilters={onClearFilters}
            repoOptions={repositoryOptions}
            selectedRepos={selectedRepos}
            onToggleRepo={onToggleRepo}
            modelOptions={modelOptions}
            selectedModels={selectedModels}
            onToggleModel={onToggleModel}
            originOptions={originOptions}
            selectedOrigins={selectedOrigins}
            onToggleOrigin={onToggleOrigin}
            dateFilter={dateFilter}
            onDateFilterChange={setDateFilter}
            hasActiveFilters={hasActiveFilters}
          />
        </div>

        <div className="resizer" onMouseDown={startResize} role="separator" aria-orientation="vertical" />

        <SessionDetailView detail={selectedDetail} onCopySessionId={onCopySessionId} />
      </main>

      {(syncResult || toast) && (
        <footer className="statusbar">
          {toast && <span>{toast}</span>}
          {syncResult && (
            <span>
              Last sync: imported {syncResult.sessionsImported} sessions, scanned {syncResult.filesScanned} files,
              skipped {syncResult.skippedFiles}
            </span>
          )}
          {syncErrors && <span>{syncErrors}</span>}
        </footer>
      )}

      <SettingsModal isOpen={showSettings} config={config} onClose={() => setShowSettings(false)} onSave={onSaveConfig} />
    </div>
  )
}
