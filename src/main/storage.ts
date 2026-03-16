import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { SessionDetail, SessionMessage, SessionSummary } from '../shared/types'
import { logError, logInfo, logWarn } from './logger'

export interface SessionInsert {
  session: SessionSummary
  messages: SessionMessage[]
}

export interface MergeSyncResult {
  newSessions: number
  updatedSessions: number
  archivedSessions: number
  totalSessions: number
}

interface PersistedStore {
  sessions: SessionSummary[]
  messages: SessionMessage[]
}

const emptyStore = (): PersistedStore => ({ sessions: [], messages: [] })
const ARCHIVE_PRUNE_MONTHS = 4

const normalize = (value: string): string => value.toLowerCase()
const ensureIso = (value: string | undefined, fallback: string): string => {
  if (!value) {
    return fallback
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return fallback
  }
  return parsed.toISOString()
}
const normalizeSessionSummary = (session: SessionSummary): SessionSummary => {
  const createdAt = ensureIso(session.createdAt, new Date().toISOString())
  const updatedAt = ensureIso(session.updatedAt, createdAt)
  const firstSeenAt = ensureIso(session.firstSeenAt, createdAt)
  const lastSeenAt = ensureIso(session.lastSeenAt, updatedAt)
  const userArchived = Boolean(session.userArchived)
  const userArchivedAt = userArchived
    ? ensureIso(session.userArchivedAt, updatedAt)
    : undefined

  return {
    ...session,
    createdAt,
    updatedAt,
    firstSeenAt,
    lastSeenAt,
    missingFromLastSync: Boolean(session.missingFromLastSync),
    userArchived,
    userArchivedAt
  }
}

const subtractMonthsUtc = (value: string, months: number): Date => {
  const date = new Date(value)
  date.setUTCMonth(date.getUTCMonth() - months)
  return date
}

export class SessionStorage {
  private store: PersistedStore

  constructor(private readonly storagePath: string) {
    logInfo('Initializing session storage', { storagePath })
    this.store = this.load()
  }

  private load(): PersistedStore {
    try {
      if (!existsSync(this.storagePath)) {
        logWarn('Storage file missing, using empty store', { storagePath: this.storagePath })
        return emptyStore()
      }
      const raw = readFileSync(this.storagePath, 'utf8')
      const parsed = JSON.parse(raw) as PersistedStore
      if (!Array.isArray(parsed.sessions) || !Array.isArray(parsed.messages)) {
        logWarn('Storage file invalid structure, using empty store', { storagePath: this.storagePath })
        return emptyStore()
      }
      const normalized: PersistedStore = {
        sessions: parsed.sessions.map((session) => normalizeSessionSummary(session)),
        messages: parsed.messages
      }
      logInfo('Storage loaded', {
        sessions: normalized.sessions.length,
        messages: normalized.messages.length
      })
      return normalized
    } catch (error) {
      logError('Failed to load storage file, using empty store', {
        storagePath: this.storagePath,
        reason: (error as Error).message
      })
      return emptyStore()
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.storagePath), { recursive: true })
    writeFileSync(this.storagePath, `${JSON.stringify(this.store, null, 2)}\n`, 'utf8')
    logInfo('Storage persisted', {
      storagePath: this.storagePath,
      sessions: this.store.sessions.length,
      messages: this.store.messages.length
    })
  }

  replaceAll(rows: SessionInsert[]): void {
    logInfo('Replacing storage content', { rows: rows.length })
    this.store.sessions = rows.map((row) => normalizeSessionSummary(row.session))
    this.store.messages = rows.flatMap((row) => row.messages)
    this.persist()
  }

  mergeFromSync(rows: SessionInsert[], syncedAt = new Date().toISOString()): MergeSyncResult {
    logInfo('Merging sync rows into storage', { rows: rows.length, syncedAt })

    const existingSessionsById = new Map(
      this.store.sessions.map((session) => [session.id, normalizeSessionSummary(session)])
    )
    const existingMessagesBySession = new Map<string, SessionMessage[]>()
    for (const message of this.store.messages) {
      const rowsForSession = existingMessagesBySession.get(message.sessionId) ?? []
      rowsForSession.push(message)
      existingMessagesBySession.set(message.sessionId, rowsForSession)
    }

    const nextSessionsById = new Map(existingSessionsById)
    const nextMessagesBySession = new Map(existingMessagesBySession)
    const seenInCurrentSync = new Set<string>()
    let newSessions = 0
    let updatedSessions = 0

    for (const row of rows) {
      const normalizedIncoming = normalizeSessionSummary(row.session)
      const existing = nextSessionsById.get(normalizedIncoming.id)
      seenInCurrentSync.add(normalizedIncoming.id)

      if (existing) {
        updatedSessions += 1
      } else {
        newSessions += 1
      }

      const upstreamChanged = existing
        ? new Date(normalizedIncoming.updatedAt).getTime() > new Date(existing.updatedAt).getTime() ||
          normalizedIncoming.messageCount !== existing.messageCount
        : true
      const preserveManualArchive = Boolean(existing?.userArchived && !upstreamChanged)
      const archiveTimestamp = preserveManualArchive ? existing?.userArchivedAt : undefined

      nextSessionsById.set(normalizedIncoming.id, {
        ...normalizedIncoming,
        firstSeenAt: existing?.firstSeenAt ?? normalizedIncoming.firstSeenAt ?? syncedAt,
        lastSeenAt: syncedAt,
        missingFromLastSync: false,
        userArchived: preserveManualArchive,
        userArchivedAt: archiveTimestamp
      })
      nextMessagesBySession.set(normalizedIncoming.id, row.messages)
    }

    for (const [sessionId, session] of nextSessionsById.entries()) {
      if (seenInCurrentSync.has(sessionId)) {
        continue
      }
      nextSessionsById.set(sessionId, {
        ...normalizeSessionSummary(session),
        missingFromLastSync: true
      })
    }

    const pruneCutoff = subtractMonthsUtc(syncedAt, ARCHIVE_PRUNE_MONTHS).getTime()
    let prunedArchivedSessions = 0
    for (const [sessionId, session] of nextSessionsById.entries()) {
      if (!session.userArchived) {
        continue
      }
      const archivedAt = ensureIso(session.userArchivedAt, session.updatedAt)
      if (new Date(archivedAt).getTime() >= pruneCutoff) {
        continue
      }
      nextSessionsById.delete(sessionId)
      nextMessagesBySession.delete(sessionId)
      prunedArchivedSessions += 1
    }

    this.store.sessions = [...nextSessionsById.values()]
    this.store.messages = [...nextMessagesBySession.values()].flat()
    this.persist()

    const archivedSessions = this.store.sessions.filter((session) => session.missingFromLastSync).length
    const result: MergeSyncResult = {
      newSessions,
      updatedSessions,
      archivedSessions,
      totalSessions: this.store.sessions.length
    }

    logInfo('Sync merge completed', {
      newSessions: result.newSessions,
      updatedSessions: result.updatedSessions,
      archivedSessions: result.archivedSessions,
      prunedArchivedSessions,
      totalSessions: result.totalSessions
    })
    return result
  }

  list(query: string): SessionSummary[] {
    const trimmed = query.trim()
    if (!trimmed) {
      const results = [...this.store.sessions].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      )
      logInfo('Listed sessions without query', { count: results.length })
      return results
    }

    const needle = normalize(trimmed)
    const messageBySession = new Map<string, string[]>()
    for (const message of this.store.messages) {
      const rows = messageBySession.get(message.sessionId) ?? []
      rows.push(message.content)
      messageBySession.set(message.sessionId, rows)
    }

    const results = this.store.sessions
      .filter((session) => {
        const haystack = [
          session.id,
          session.title,
          session.repoPath,
          session.model ?? '',
          ...(messageBySession.get(session.id) ?? [])
        ]
          .join('\n')
          .toLowerCase()
        return haystack.includes(needle)
      })
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    logInfo('Listed sessions with query', { query: trimmed, count: results.length })
    return results
  }

  getSessionDetail(sessionId: string): SessionDetail | null {
    const session = this.store.sessions.find((row) => row.id === sessionId)
    if (!session) {
      logWarn('Session detail not found', { sessionId })
      return null
    }

    const messages = this.store.messages
      .filter((row) => row.sessionId === sessionId)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

    logInfo('Loaded session detail', { sessionId, messages: messages.length })
    return { ...session, messages }
  }

  setArchived(sessionId: string, archived: boolean): SessionSummary | null {
    const index = this.store.sessions.findIndex((row) => row.id === sessionId)
    if (index === -1) {
      logWarn('Cannot set archive state: session not found', { sessionId, archived })
      return null
    }

    const current = normalizeSessionSummary(this.store.sessions[index]!)
    const next = normalizeSessionSummary({
      ...current,
      userArchived: archived,
      userArchivedAt: archived ? new Date().toISOString() : undefined
    })
    this.store.sessions[index] = next
    this.persist()
    logInfo('Updated session archive state', { sessionId, archived })
    return next
  }
}
