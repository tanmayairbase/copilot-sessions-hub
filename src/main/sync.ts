import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import fg from 'fast-glob'
import type { AppConfig, SessionSummary, SyncResult } from '../shared/types'
import { logError, logInfo, logWarn } from './logger'
import { loadOpenCodeSessions } from './opencode'
import { parseSessionArtifacts } from './parsers'
import { SessionStorage, type SessionInsert } from './storage'

const MAX_FILE_SIZE_BYTES = 64 * 1024 * 1024

const expandHome = (value: string): string => (value.startsWith('~/') ? join(homedir(), value.slice(2)) : value)

const inRepoRoots = (candidate: string, roots: string[]): boolean => {
  const resolvedCandidate = resolve(candidate)
  return roots.some((root) => resolvedCandidate.startsWith(resolve(root)))
}

const unique = <T>(value: T[]): T[] => [...new Set(value)]

const autodiscoveryPatterns = [
  '**/.copilot/**/*.{json,jsonl}',
  '**/.vscode/**/*copilot*.{json,jsonl}',
  '**/.github/copilot/**/*.{json,jsonl}'
]

const globalCopilotPattern = join(homedir(), '.copilot', 'session-state', '**', '*.{json,jsonl}')
const globalVsCodeChatPattern = join(
  homedir(),
  'Library',
  'Application Support',
  'Code',
  'User',
  'workspaceStorage',
  '*',
  'chatSessions',
  '*.jsonl'
)
const COPILOT_SESSION_STORE_DB_PATH = join(homedir(), '.copilot', 'session-store.db')

const workspaceRepoCache = new Map<string, string | null>()

const repoRootFromVsCodeWorkspaceStorage = async (filePath: string): Promise<string | null> => {
  const normalized = filePath.replaceAll('\\', '/')
  const marker = '/workspaceStorage/'
  const markerIndex = normalized.indexOf(marker)
  if (markerIndex === -1) {
    return null
  }

  const rest = normalized.slice(markerIndex + marker.length)
  const workspaceId = rest.split('/')[0]
  if (!workspaceId) {
    return null
  }
  if (workspaceRepoCache.has(workspaceId)) {
    return workspaceRepoCache.get(workspaceId) ?? null
  }

  const workspaceJsonPath = normalized.slice(0, markerIndex + marker.length) + `${workspaceId}/workspace.json`
  try {
    const raw = await fs.readFile(workspaceJsonPath, 'utf8')
    const parsed = JSON.parse(raw) as { folder?: unknown; configPath?: unknown }
    const folder = typeof parsed.folder === 'string' ? parsed.folder : null
    const configPath = typeof parsed.configPath === 'string' ? parsed.configPath : null

    if (folder?.startsWith('file://')) {
      const repoPath = fileURLToPath(folder)
      workspaceRepoCache.set(workspaceId, repoPath)
      return repoPath
    }

    if (configPath?.startsWith('file://')) {
      const pathFromConfig = fileURLToPath(configPath)
      const repoPath = pathFromConfig.replace(/\/[^/]+\.code-workspace$/, '')
      workspaceRepoCache.set(workspaceId, repoPath || null)
      return repoPath || null
    }
  } catch {
    workspaceRepoCache.set(workspaceId, null)
    return null
  }

  workspaceRepoCache.set(workspaceId, null)
  return null
}

const buildSearchPatterns = (config: AppConfig): string[] => {
  if (config.discoveryMode === 'autodiscovery') {
    return autodiscoveryPatterns
  }

  if (config.discoveryMode === 'explicit') {
    return config.explicitPatterns
  }

  return unique([...autodiscoveryPatterns, ...config.explicitPatterns])
}

interface CliSessionSummaryRow {
  id: string
  summary: string
}

const loadCliSessionSummaryMap = async (): Promise<Map<string, string>> => {
  const summaries = new Map<string, string>()
  if (!(await fs.stat(COPILOT_SESSION_STORE_DB_PATH).then(() => true).catch(() => false))) {
    return summaries
  }

  let DatabaseSyncClass: typeof import('node:sqlite').DatabaseSync
  try {
    const sqliteModule = await import('node:sqlite')
    DatabaseSyncClass = sqliteModule.DatabaseSync
  } catch (error) {
    logWarn('CLI summary lookup skipped: node:sqlite unavailable', {
      reason: (error as Error).message
    })
    return summaries
  }

  const database = new DatabaseSyncClass(COPILOT_SESSION_STORE_DB_PATH)
  try {
    const rows = database
      .prepare(
        `SELECT id, summary
         FROM sessions
         WHERE summary IS NOT NULL
           AND TRIM(summary) != ''`
      )
      .all() as unknown as CliSessionSummaryRow[]
    for (const row of rows) {
      const cleaned = row.summary.replace(/\s+/g, ' ').trim()
      if (cleaned) {
        summaries.set(row.id, cleaned)
      }
    }
    logInfo('Loaded CLI session summaries', { count: summaries.size })
  } catch (error) {
    logWarn('Failed loading CLI session summaries', {
      dbPath: COPILOT_SESSION_STORE_DB_PATH,
      reason: (error as Error).message
    })
  } finally {
    database.close()
  }

  return summaries
}

export const syncSessions = async (config: AppConfig, storage: SessionStorage): Promise<SyncResult> => {
  const repoRoots = unique(config.repoRoots.map(expandHome).map((value) => resolve(value)))
  const patterns = buildSearchPatterns(config)
  const cliSummaryBySessionId = await loadCliSessionSummaryMap()
  logInfo('Starting sync', {
    repoRoots: repoRoots.length,
    discoveryMode: config.discoveryMode,
    patterns: patterns.length,
    cliSummaries: cliSummaryBySessionId.size
  })

  const result: SyncResult = {
    filesScanned: 0,
    sessionsImported: 0,
    skippedFiles: 0,
    errors: []
  }

  const files = new Set<string>()

  for (const root of repoRoots) {
    try {
      const stat = await fs.stat(root)
      if (!stat.isDirectory()) {
        logWarn('Configured repo root is not a directory, skipping', { root })
        continue
      }
    } catch (error) {
      logWarn('Configured repo root does not exist, skipping', {
        root,
        reason: (error as Error).message
      })
      continue
    }

    const rootEntries = await fg(patterns, {
      cwd: root,
      absolute: true,
      onlyFiles: true,
      suppressErrors: true,
      unique: true,
      ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**', '**/release/**']
    })
    logInfo('Scanned repo root', { root, filesFound: rootEntries.length })

    for (const entry of rootEntries) {
      files.add(entry)
    }
  }

  const globalEntries = await fg(globalCopilotPattern, {
    absolute: true,
    onlyFiles: true,
    suppressErrors: true,
    unique: true,
    ignore: ['**/node_modules/**', '**/.git/**']
  })
  logInfo('Scanned global copilot session path', { filesFound: globalEntries.length })

  for (const entry of globalEntries) {
    files.add(entry)
  }

  const globalVsCodeEntries = await fg(globalVsCodeChatPattern, {
    absolute: true,
    onlyFiles: true,
    suppressErrors: true,
    unique: true
  })
  logInfo('Scanned VS Code workspace chat sessions', { filesFound: globalVsCodeEntries.length })
  for (const entry of globalVsCodeEntries) {
    files.add(entry)
  }

  const inserts: SessionInsert[] = []
  let ignoredByRepoFilter = 0

  for (const filePath of files) {
    result.filesScanned += 1

    try {
      const stat = await fs.stat(filePath)
      if (stat.size > MAX_FILE_SIZE_BYTES) {
        result.skippedFiles += 1
        logWarn('Skipping artifact file above size limit', {
          filePath,
          fileSizeBytes: stat.size,
          limitBytes: MAX_FILE_SIZE_BYTES
        })
        continue
      }

      const raw = await fs.readFile(filePath, 'utf8')

      const repoRootFromWorkspace = await repoRootFromVsCodeWorkspaceStorage(filePath)
      const repoRoot =
        repoRootFromWorkspace ??
        repoRoots.find((root) => filePath.startsWith(root)) ??
        repoRoots.find((root) => filePath.includes(root.split('/').at(-1) ?? '')) ??
        filePath

      const parsed = parseSessionArtifacts(raw, {
        filePath,
        repoRoot,
        source:
          filePath.toLowerCase().includes('chatsessions') || filePath.toLowerCase().includes('vscode') ? 'vscode' : 'cli',
        cliSummaryBySessionId
      })
      logInfo('Parsed session artifact file', { filePath, sessionsFound: parsed.length })

      for (const artifact of parsed) {
        if (!inRepoRoots(artifact.session.repoPath, repoRoots)) {
          ignoredByRepoFilter += 1
          continue
        }
        inserts.push(artifact)
      }
    } catch (error) {
      logError('Failed processing artifact file', {
        filePath,
        reason: (error as Error).message
      })
      result.errors.push(`${filePath}: ${(error as Error).message}`)
    }
  }

  const openCodeSessions = await loadOpenCodeSessions(repoRoots)
  if (openCodeSessions.length > 0) {
    inserts.push(...openCodeSessions)
  }

  const dedupedById = new Map<string, SessionInsert>()
  for (const insert of inserts) {
    const current = dedupedById.get(insert.session.id)
    if (!current || new Date(insert.session.updatedAt) > new Date(current.session.updatedAt)) {
      dedupedById.set(insert.session.id, insert)
    }
  }

  const finalInserts = [...dedupedById.values()].sort((a, b) => {
    return new Date(b.session.updatedAt).getTime() - new Date(a.session.updatedAt).getTime()
  })

  const mergeResult = storage.mergeFromSync(finalInserts)
  result.sessionsImported = finalInserts.length

  if (result.errors.length > 20) {
    result.errors = result.errors.slice(0, 20)
  }

  logInfo('Sync completed', {
    filesScanned: result.filesScanned,
    sessionsImported: result.sessionsImported,
    totalSessionsRetained: mergeResult.totalSessions,
    newlyDiscovered: mergeResult.newSessions,
    updatedExisting: mergeResult.updatedSessions,
    archivedSessions: mergeResult.archivedSessions,
    skippedFiles: result.skippedFiles,
    ignoredByRepoFilter,
    errors: result.errors.length
  })

  return result
}

export const getSessionOpenTargets = (session: SessionSummary): { vscodeTarget: string; cliCwd: string } => ({
  vscodeTarget: session.openVscodeTarget || session.filePath,
  cliCwd: session.openCliCwd || session.repoPath
})
