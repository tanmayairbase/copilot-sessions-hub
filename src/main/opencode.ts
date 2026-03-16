import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { SessionMessage, SessionSummary } from '../shared/types'
import { logError, logInfo, logWarn } from './logger'
import type { SessionInsert } from './storage'

const OPENCODE_DB_PATH = join(
  homedir(),
  '.local',
  'share',
  'opencode',
  'opencode.db'
)
const EPOCH_SECONDS_THRESHOLD = 10_000_000_000

interface OpenCodeSessionRow {
  id: string
  title: string
  directory: string
  time_created: number | string
  time_updated: number | string
}

interface OpenCodeMessageRow {
  id: string
  session_id: string
  time_created: number | string
  time_updated: number | string
  data: string
}

interface OpenCodePartRow {
  id: string
  message_id: string
  time_created: number | string
  data: string
}

const asString = (value: unknown): string | null => {
  if (typeof value === 'string' && value.trim()) {
    return value
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return null
}

const firstString = (...values: unknown[]): string | null => {
  for (const value of values) {
    const candidate = asString(value)
    if (candidate) {
      return candidate
    }
  }
  return null
}

const toIso = (value: unknown): string => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const millis = value < EPOCH_SECONDS_THRESHOLD ? value * 1000 : value
    return new Date(millis).toISOString()
  }

  const asNumber = Number(value)
  if (Number.isFinite(asNumber) && asNumber > 0) {
    const millis =
      asNumber < EPOCH_SECONDS_THRESHOLD ? asNumber * 1000 : asNumber
    return new Date(millis).toISOString()
  }

  const candidate = firstString(value)
  if (candidate) {
    const parsed = new Date(candidate)
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString()
    }
  }

  return new Date().toISOString()
}

const parseJsonRecord = (raw: unknown): Record<string, unknown> => {
  const value = typeof raw === 'string' ? raw : ''
  if (!value) {
    return {}
  }

  try {
    const parsed = JSON.parse(value) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // OpenCode rows are JSON blobs; skip malformed rows.
  }

  return {}
}

const inferFormat = (value: string): SessionMessage['format'] => {
  if (value.includes('\u001b[')) {
    return 'ansi'
  }
  if (/```|^#\s|\n\s*[-*]\s/m.test(value)) {
    return 'markdown'
  }
  return 'text'
}

const inRepoRoots = (candidate: string, roots: string[]): boolean => {
  const resolvedCandidate = resolve(candidate)
  return roots.some(root => resolvedCandidate.startsWith(resolve(root)))
}

const normalizeRole = (value: unknown): SessionMessage['role'] | null => {
  const role = firstString(value)?.toLowerCase()
  if (!role) {
    return null
  }
  if (role.includes('assistant')) {
    return 'assistant'
  }
  if (role.includes('user')) {
    return 'user'
  }
  return null
}

const collectMessageContent = (
  role: SessionMessage['role'],
  messageData: Record<string, unknown>,
  parts: OpenCodePartRow[]
): string | null => {
  const textParts: string[] = []
  const reasoningParts: string[] = []

  for (const part of parts) {
    const partData = parseJsonRecord(part.data)
    const type = firstString(partData.type)?.toLowerCase()
    const text = firstString(partData.text)
    if (!text) {
      continue
    }

    if (type === 'text') {
      textParts.push(text)
      continue
    }

    if (type === 'reasoning' && role === 'assistant') {
      reasoningParts.push(text)
    }
  }

  if (textParts.length > 0) {
    return textParts.join('\n\n').trim()
  }

  if (role === 'assistant' && reasoningParts.length > 0) {
    return reasoningParts.join('\n\n').trim()
  }

  return firstString(messageData.summary)?.trim() ?? null
}

export const loadOpenCodeSessions = async (
  repoRoots: string[]
): Promise<SessionInsert[]> => {
  if (!existsSync(OPENCODE_DB_PATH)) {
    logInfo('OpenCode database not found, skipping OpenCode sync', {
      dbPath: OPENCODE_DB_PATH
    })
    return []
  }

  let DatabaseSyncClass: typeof import('node:sqlite').DatabaseSync
  try {
    const sqliteModule = await import('node:sqlite')
    DatabaseSyncClass = sqliteModule.DatabaseSync
  } catch (error) {
    logWarn('OpenCode sync skipped: node:sqlite unavailable', {
      reason: (error as Error).message
    })
    return []
  }

  const inserts: SessionInsert[] = []
  const database = new DatabaseSyncClass(OPENCODE_DB_PATH)

  try {
    const sessionRows = database
      .prepare(
        `SELECT id, title, directory, time_created, time_updated
         FROM session
         WHERE COALESCE(time_archived, 0) = 0
         ORDER BY time_updated DESC`
      )
      .all() as unknown as OpenCodeSessionRow[]

    for (const sessionRow of sessionRows) {
      if (
        !sessionRow.directory ||
        !inRepoRoots(sessionRow.directory, repoRoots)
      ) {
        continue
      }

      const scopedSessionId = `opencode:${sessionRow.id}`
      const messageRows = database
        .prepare(
          `SELECT id, session_id, time_created, time_updated, data
           FROM message
           WHERE session_id = ?
           ORDER BY time_created ASC`
        )
        .all(sessionRow.id) as unknown as OpenCodeMessageRow[]

      if (messageRows.length === 0) {
        continue
      }

      const partRows = database
        .prepare(
          `SELECT id, message_id, time_created, data
           FROM part
           WHERE session_id = ?
           ORDER BY time_created ASC`
        )
        .all(sessionRow.id) as unknown as OpenCodePartRow[]

      const partsByMessage = new Map<string, OpenCodePartRow[]>()
      for (const partRow of partRows) {
        const rows = partsByMessage.get(partRow.message_id) ?? []
        rows.push(partRow)
        partsByMessage.set(partRow.message_id, rows)
      }

      const messages: SessionMessage[] = []
      let lastModel: string | null = null

      for (const messageRow of messageRows) {
        const messageData = parseJsonRecord(messageRow.data)
        const role = normalizeRole(messageData.role)
        if (!role) {
          continue
        }

        const messageContent = collectMessageContent(
          role,
          messageData,
          partsByMessage.get(messageRow.id) ?? []
        )
        if (!messageContent) {
          continue
        }

        if (role === 'assistant') {
          lastModel =
            firstString(
              messageData.model,
              messageData.modelID,
              messageData.providerID
            ) ?? lastModel
        }

        messages.push({
          id: `opencode:${messageRow.id}`,
          sessionId: scopedSessionId,
          role,
          content: messageContent,
          format: inferFormat(messageContent),
          timestamp: toIso(messageRow.time_created)
        })
      }

      if (messages.length === 0) {
        continue
      }

      const titleSeed =
        messages.find(message => message.role === 'user')?.content ??
        messages[0].content
      const summary: SessionSummary = {
        id: scopedSessionId,
        source: 'opencode',
        repoPath: sessionRow.directory,
        title: firstString(sessionRow.title)?.trim() || titleSeed.slice(0, 120),
        model: lastModel,
        createdAt: toIso(sessionRow.time_created),
        updatedAt: toIso(sessionRow.time_updated),
        messageCount: messages.length,
        filePath: `${OPENCODE_DB_PATH}#${sessionRow.id}`,
        openVscodeTarget: sessionRow.directory,
        openCliCwd: sessionRow.directory
      }

      inserts.push({ session: summary, messages })
    }

    logInfo('OpenCode sync completed', {
      dbPath: OPENCODE_DB_PATH,
      sessionsImported: inserts.length
    })
    return inserts
  } catch (error) {
    logError('OpenCode sync failed', {
      dbPath: OPENCODE_DB_PATH,
      reason: (error as Error).message
    })
    return []
  } finally {
    database.close()
  }
}
