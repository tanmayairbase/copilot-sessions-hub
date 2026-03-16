import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type {
  MessageStarRecord,
  SessionDetail,
  SessionMessage,
  SessionSummary,
  StarredMessageSummary
} from '../shared/types'
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
  stars: MessageStarRecord[]
}

const emptyStore = (): PersistedStore => ({ sessions: [], messages: [], stars: [] })
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

const normalizeStarRecord = (star: MessageStarRecord): MessageStarRecord => {
  const createdAt = ensureIso(star.createdAt, new Date().toISOString())
  const updatedAt = ensureIso(star.updatedAt, createdAt)
  return {
    sessionId: star.sessionId,
    messageId: star.messageId,
    createdAt,
    updatedAt,
    stale: Boolean(star.stale),
    lastKnownRole: star.lastKnownRole === 'assistant' ? 'assistant' : 'user',
    lastKnownContent: typeof star.lastKnownContent === 'string' ? star.lastKnownContent : '',
    lastKnownTimestamp: ensureIso(star.lastKnownTimestamp, updatedAt)
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
      const parsedStars = Array.isArray((parsed as { stars?: unknown }).stars)
        ? ((parsed as { stars?: MessageStarRecord[] }).stars ?? []).map((star) => normalizeStarRecord(star))
        : []
      const normalized: PersistedStore = {
        sessions: parsed.sessions.map((session) => normalizeSessionSummary(session)),
        messages: parsed.messages,
        stars: parsedStars
      }
      logInfo('Storage loaded', {
        sessions: normalized.sessions.length,
        messages: normalized.messages.length,
        stars: normalized.stars.length
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
      messages: this.store.messages.length,
      stars: this.store.stars.length
    })
  }

  private reconcileStars(
    stars: MessageStarRecord[],
    sessionsById: ReadonlyMap<string, SessionSummary>,
    messagesBySession: ReadonlyMap<string, SessionMessage[]>
  ): MessageStarRecord[] {
    const output: MessageStarRecord[] = []
    for (const star of stars.map((entry) => normalizeStarRecord(entry))) {
      if (!sessionsById.has(star.sessionId)) {
        continue
      }
      const liveMessage = (messagesBySession.get(star.sessionId) ?? []).find((message) => message.id === star.messageId)
      if (liveMessage) {
        output.push(
          normalizeStarRecord({
            ...star,
            stale: false,
            lastKnownRole: liveMessage.role,
            lastKnownContent: liveMessage.content,
            lastKnownTimestamp: liveMessage.timestamp
          })
        )
        continue
      }
      output.push(
        normalizeStarRecord({
          ...star,
          stale: true
        })
      )
    }
    return output
  }

  replaceAll(rows: SessionInsert[]): void {
    logInfo('Replacing storage content', { rows: rows.length })
    const sessions = rows.map((row) => normalizeSessionSummary(row.session))
    const messages = rows.flatMap((row) => row.messages)
    const sessionsById = new Map(sessions.map((session) => [session.id, session]))
    const messagesBySession = new Map<string, SessionMessage[]>()
    for (const message of messages) {
      const entries = messagesBySession.get(message.sessionId) ?? []
      entries.push(message)
      messagesBySession.set(message.sessionId, entries)
    }

    this.store.sessions = sessions
    this.store.messages = messages
    this.store.stars = this.reconcileStars(this.store.stars, sessionsById, messagesBySession)
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
    this.store.stars = this.reconcileStars(this.store.stars, nextSessionsById, nextMessagesBySession)
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

    const starredMessageIds = new Set(
      this.store.stars.filter((star) => star.sessionId === sessionId && !star.stale).map((star) => star.messageId)
    )

    const messages = this.store.messages
      .filter((row) => row.sessionId === sessionId)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      .map((message) => ({
        ...message,
        userStarred: starredMessageIds.has(message.id)
      }))

    logInfo('Loaded session detail', { sessionId, messages: messages.length })
    return { ...session, messages }
  }

  listStarredMessages(query: string): StarredMessageSummary[] {
    const sessionsById = new Map(this.store.sessions.map((session) => [session.id, session]))
    const messagesBySession = new Map<string, SessionMessage[]>()
    for (const message of this.store.messages) {
      const entries = messagesBySession.get(message.sessionId) ?? []
      entries.push(message)
      messagesBySession.set(message.sessionId, entries)
    }

    const rows: StarredMessageSummary[] = []
    for (const star of this.store.stars.map((entry) => normalizeStarRecord(entry))) {
      const session = sessionsById.get(star.sessionId)
      if (!session) {
        continue
      }
      const liveMessage = (messagesBySession.get(star.sessionId) ?? []).find((message) => message.id === star.messageId)
      rows.push({
        sessionId: star.sessionId,
        messageId: star.messageId,
        sessionTitle: session.title,
        sessionSource: session.source,
        repoPath: session.repoPath,
        role: liveMessage?.role ?? star.lastKnownRole,
        content: liveMessage?.content ?? star.lastKnownContent,
        timestamp: liveMessage?.timestamp ?? star.lastKnownTimestamp,
        stale: !liveMessage || star.stale,
        starredAt: star.updatedAt
      })
    }

    const trimmed = query.trim().toLowerCase()
    const filtered = trimmed
      ? rows.filter((row) =>
          [row.messageId, row.sessionTitle, row.repoPath, row.role, row.content, row.sessionSource]
            .join('\n')
            .toLowerCase()
            .includes(trimmed)
        )
      : rows
    return filtered.sort((a, b) => new Date(b.starredAt).getTime() - new Date(a.starredAt).getTime())
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

  setMessageStarred(sessionId: string, messageId: string, starred: boolean): MessageStarRecord | null {
    const session = this.store.sessions.find((row) => row.id === sessionId)
    if (!session) {
      logWarn('Cannot update message star state: session not found', { sessionId, messageId, starred })
      return null
    }

    const index = this.store.stars.findIndex((entry) => entry.sessionId === sessionId && entry.messageId === messageId)
    const now = new Date().toISOString()
    const liveMessage = this.store.messages.find((message) => message.sessionId === sessionId && message.id === messageId)

    if (!starred) {
      if (index === -1) {
        return null
      }
      this.store.stars.splice(index, 1)
      this.persist()
      logInfo('Updated message star state', { sessionId, messageId, starred })
      return null
    }

    if (!liveMessage && index === -1) {
      logWarn('Cannot star message: message not found', { sessionId, messageId })
      return null
    }

    const next = normalizeStarRecord({
      sessionId,
      messageId,
      createdAt: index >= 0 ? this.store.stars[index]!.createdAt : now,
      updatedAt: now,
      stale: !liveMessage,
      lastKnownRole: liveMessage?.role ?? this.store.stars[index]?.lastKnownRole ?? 'assistant',
      lastKnownContent: liveMessage?.content ?? this.store.stars[index]?.lastKnownContent ?? '',
      lastKnownTimestamp: liveMessage?.timestamp ?? this.store.stars[index]?.lastKnownTimestamp ?? now
    })

    if (index >= 0) {
      this.store.stars[index] = next
    } else {
      this.store.stars.push(next)
    }
    this.persist()
    logInfo('Updated message star state', { sessionId, messageId, starred })
    return next
  }
}
