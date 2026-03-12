import { createHash } from 'node:crypto'
import { basename, dirname, extname } from 'node:path'
import type { SessionMessage, SessionSource, SessionSummary } from '../shared/types'

interface ParseContext {
  filePath: string
  repoRoot: string
  source: SessionSource
}

export interface ParsedSession {
  session: SessionSummary
  messages: SessionMessage[]
}

const stableId = (...parts: string[]): string => createHash('sha1').update(parts.join('::')).digest('hex')

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

const inferSource = (filePath: string, fallback: SessionSource = 'cli'): SessionSource => {
  const normalized = filePath.toLowerCase()
  if (normalized.includes('opencode')) {
    return 'opencode'
  }
  if (normalized.includes('/.vscode/') || normalized.includes('\\.vscode\\') || normalized.includes('vscode')) {
    return 'vscode'
  }
  if (normalized.includes('copilot-cli') || normalized.includes('copilotcli')) {
    return 'cli'
  }
  return fallback
}

const sourceFromHint = (value: unknown): SessionSource | null => {
  const hint = firstString(value)?.toLowerCase()
  if (!hint) {
    return null
  }
  if (hint.includes('vscode') || hint.includes('visual studio code') || hint.includes('cursor')) {
    return 'vscode'
  }
  if (hint.includes('opencode') || hint.includes('open code')) {
    return 'opencode'
  }
  if (hint.includes('cli') || hint.includes('terminal')) {
    return 'cli'
  }
  return null
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

const toIso = (value: unknown, fallback = new Date().toISOString()): string => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const millis = value > 1_000_000_000_000 ? value : value * 1000
    return new Date(millis).toISOString()
  }

  const asNumber = Number(value)
  if (Number.isFinite(asNumber) && asNumber > 0) {
    const millis = asNumber > 1_000_000_000_000 ? asNumber : asNumber * 1000
    return new Date(millis).toISOString()
  }

  const asText = firstString(value)
  if (asText) {
    const date = new Date(asText)
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString()
    }
  }

  return fallback
}

const toMessage = (candidate: any, sessionId: string, fallbackRole: 'user' | 'assistant', index: number): SessionMessage | null => {
  const roleRaw = firstString(candidate.role, candidate.type, candidate.author, candidate.sender, candidate.from)
  const role = roleRaw?.toLowerCase().includes('assistant') || roleRaw?.toLowerCase().includes('copilot') ? 'assistant' : roleRaw?.toLowerCase().includes('user') ? 'user' : fallbackRole
  const content = firstString(
    candidate.content,
    candidate.text,
    candidate.message,
    candidate.body,
    candidate.output,
    candidate.value,
    candidate.response,
    candidate.markdown
  )

  if (!content) {
    return null
  }

  const timestamp = firstString(candidate.timestamp, candidate.time, candidate.createdAt, candidate.created_at, candidate.date) ?? new Date().toISOString()

  return {
    id: stableId(sessionId, String(index), role, content.slice(0, 24)),
    sessionId,
    role,
    content,
    format: inferFormat(content),
    timestamp: new Date(timestamp).toISOString()
  }
}

const fromTurns = (turns: any[], sessionId: string): SessionMessage[] => {
  const messages: SessionMessage[] = []
  let index = 0
  for (const turn of turns) {
    const userContent = firstString(turn.prompt, turn.input, turn.user, turn.request)
    if (userContent) {
      messages.push({
        id: stableId(sessionId, `u-${index}`, userContent.slice(0, 20)),
        sessionId,
        role: 'user',
        content: userContent,
        format: inferFormat(userContent),
        timestamp: new Date(firstString(turn.timestamp, turn.time, turn.createdAt) ?? Date.now()).toISOString()
      })
    }

    const assistantContent = firstString(turn.response, turn.output, turn.assistant, turn.answer)
    if (assistantContent) {
      messages.push({
        id: stableId(sessionId, `a-${index}`, assistantContent.slice(0, 20)),
        sessionId,
        role: 'assistant',
        content: assistantContent,
        format: inferFormat(assistantContent),
        timestamp: new Date(firstString(turn.timestamp, turn.time, turn.updatedAt, turn.createdAt) ?? Date.now()).toISOString()
      })
    }
    index += 1
  }
  return messages
}

const normalizeSession = (candidate: any, context: ParseContext, ordinal: number): ParsedSession | null => {
  const sessionId = firstString(candidate.id, candidate.sessionId, candidate.uuid) ?? stableId(context.filePath, String(ordinal))

  let messages: SessionMessage[] = []

  if (Array.isArray(candidate.messages)) {
    messages = candidate.messages
      .map((message: unknown, index: number) =>
        toMessage(message, sessionId, index % 2 === 0 ? 'user' : 'assistant', index)
      )
      .filter((message: SessionMessage | null): message is SessionMessage => Boolean(message))
  } else if (Array.isArray(candidate.turns)) {
    messages = fromTurns(candidate.turns, sessionId)
  } else if (Array.isArray(candidate.history)) {
    messages = candidate.history
      .map((message: unknown, index: number) =>
        toMessage(message, sessionId, index % 2 === 0 ? 'user' : 'assistant', index)
      )
      .filter((message: SessionMessage | null): message is SessionMessage => Boolean(message))
  }

  if (messages.length === 0 && Array.isArray(candidate)) {
    messages = candidate
      .map((message, index) => toMessage(message, sessionId, index % 2 === 0 ? 'user' : 'assistant', index))
      .filter((message): message is SessionMessage => Boolean(message))
  }

  if (messages.length === 0) {
    return null
  }

  const userSeed = messages.find((message) => message.role === 'user')?.content ?? messages[0].content
  const title = firstString(candidate.title, candidate.name, candidate.topic) ?? userSeed.slice(0, 80)

  const createdAt = new Date(
    firstString(candidate.createdAt, candidate.created_at, candidate.startedAt, messages[0]?.timestamp) ?? Date.now()
  ).toISOString()

  const updatedAt = new Date(
    firstString(candidate.updatedAt, candidate.updated_at, candidate.lastActivityAt, messages[messages.length - 1]?.timestamp) ?? Date.now()
  ).toISOString()

  const repoPath = firstString(candidate.repoPath, candidate.workspacePath, candidate.cwd, candidate.repository, context.repoRoot) ?? context.repoRoot

  const source =
    sourceFromHint(candidate.source) ??
    sourceFromHint(candidate.client) ??
    sourceFromHint(candidate.producer) ??
    inferSource(context.filePath, context.source)

  const session: SessionSummary = {
    id: sessionId,
    source,
    repoPath,
    title,
    model: firstString(candidate.model, candidate.modelName, candidate.metadata?.model),
    createdAt,
    updatedAt,
    messageCount: messages.length,
    filePath: context.filePath,
    openVscodeTarget: context.filePath,
    openCliCwd: repoPath,
  }

  return { session, messages }
}

const parseJsonLines = (raw: string): unknown[] => {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const output: unknown[] = []
  for (const line of lines) {
    try {
      output.push(JSON.parse(line))
    } catch {
      continue
    }
  }
  return output
}

interface SessionEvent {
  type?: string
  timestamp?: string
  data?: Record<string, unknown>
}

interface VsCodeSessionMutation {
  kind?: number
  k?: Array<string | number>
  v?: unknown
}

const setNestedValue = (target: Record<string, unknown>, path: Array<string | number>, value: unknown): void => {
  if (path.length === 0) {
    return
  }

  let current: unknown = target
  for (let index = 0; index < path.length; index += 1) {
    const key = path[index]
    const isLast = index === path.length - 1
    const nextKey = path[index + 1]

    if (typeof key === 'number') {
      if (!Array.isArray(current)) {
        return
      }

      while (current.length <= key) {
        current.push(typeof nextKey === 'number' ? [] : {})
      }

      if (isLast) {
        current[key] = value
        return
      }

      if (current[key] === null || current[key] === undefined) {
        current[key] = typeof nextKey === 'number' ? [] : {}
      }
      current = current[key]
      continue
    }

    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return
    }

    const object = current as Record<string, unknown>
    if (isLast) {
      object[key] = value
      return
    }

    if (object[key] === null || object[key] === undefined) {
      object[key] = typeof nextKey === 'number' ? [] : {}
    }
    current = object[key]
  }
}

const appendNestedValue = (target: Record<string, unknown>, path: Array<string | number>, value: unknown): void => {
  if (path.length === 0) {
    return
  }

  let current: unknown = target
  for (let index = 0; index < path.length; index += 1) {
    const key = path[index]
    const isLast = index === path.length - 1
    const nextKey = path[index + 1]

    if (typeof key === 'number') {
      if (!Array.isArray(current)) {
        return
      }
      while (current.length <= key) {
        current.push(typeof nextKey === 'number' ? [] : {})
      }
      if (isLast) {
        const existing = current[key]
        if (Array.isArray(existing) && Array.isArray(value)) {
          existing.push(...value)
          return
        }
        current[key] = value
        return
      }
      if (current[key] === null || current[key] === undefined) {
        current[key] = typeof nextKey === 'number' ? [] : {}
      }
      current = current[key]
      continue
    }

    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return
    }
    const object = current as Record<string, unknown>

    if (isLast) {
      const existing = object[key]
      if (Array.isArray(existing) && Array.isArray(value)) {
        existing.push(...value)
        return
      }
      if (Array.isArray(existing)) {
        existing.push(value)
        return
      }
      object[key] = value
      return
    }

    if (object[key] === null || object[key] === undefined) {
      object[key] = typeof nextKey === 'number' ? [] : {}
    }
    current = object[key]
  }
}

const extractVsCodeAssistantText = (responseItems: unknown[]): string | null => {
  const chunks: string[] = []
  for (const responseItem of responseItems) {
    if (!responseItem || typeof responseItem !== 'object' || Array.isArray(responseItem)) {
      continue
    }
    const item = responseItem as Record<string, unknown>
    const kind = firstString(item.kind)?.toLowerCase()
    if (kind === 'thinking' || kind === 'toolinvocationserialized' || kind === 'mcpserversstarting') {
      continue
    }

    const content = firstString(
      item.value,
      item.text,
      item.message,
      item.markdown,
      (item.markdownContent as Record<string, unknown> | undefined)?.value,
      (item.markdownContent as Record<string, unknown> | undefined)?.text,
      (item.content as Record<string, unknown> | undefined)?.value,
      (item.content as Record<string, unknown> | undefined)?.text
    )
    if (content) {
      chunks.push(content)
    }
  }

  if (chunks.length === 0) {
    return null
  }
  return [...new Set(chunks)].join('\n\n')
}

const parseVsCodeChatSessionLog = (raw: string, context: ParseContext): ParsedSession[] => {
  const lines = parseJsonLines(raw) as VsCodeSessionMutation[]
  if (lines.length === 0) {
    return []
  }

  let sessionState: Record<string, unknown> = {}
  for (const line of lines) {
    if (line.kind === 0 && line.v && typeof line.v === 'object' && !Array.isArray(line.v)) {
      sessionState = line.v as Record<string, unknown>
      continue
    }
    if (line.kind === 1 && Array.isArray(line.k)) {
      setNestedValue(sessionState, line.k, line.v)
      continue
    }
    if (line.kind === 2 && Array.isArray(line.k)) {
      appendNestedValue(sessionState, line.k, line.v)
    }
  }

  const requests = Array.isArray(sessionState.requests) ? sessionState.requests : []
  const sessionId =
    firstString(sessionState.sessionId) ??
    basename(context.filePath, extname(context.filePath))

  const messages: SessionMessage[] = []
  let messageIndex = 0
  for (const request of requests) {
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
      continue
    }
    const requestObject = request as Record<string, unknown>
    const requestTimestamp = toIso(requestObject.timestamp, toIso(sessionState.creationDate))
    const userText = firstString(
      (requestObject.message as Record<string, unknown> | undefined)?.text,
      requestObject.prompt,
      requestObject.input
    )
    if (userText) {
      messages.push({
        id: stableId(sessionId, `vscode-u-${messageIndex}`, userText.slice(0, 24)),
        sessionId,
        role: 'user',
        content: userText,
        format: inferFormat(userText),
        timestamp: requestTimestamp
      })
      messageIndex += 1
    }

    const response = Array.isArray(requestObject.response) ? requestObject.response : []
    const assistantText = extractVsCodeAssistantText(response)
    if (assistantText) {
      messages.push({
        id: stableId(sessionId, `vscode-a-${messageIndex}`, assistantText.slice(0, 24)),
        sessionId,
        role: 'assistant',
        content: assistantText,
        format: inferFormat(assistantText),
        timestamp: requestTimestamp
      })
      messageIndex += 1
    }
  }

  if (messages.length === 0) {
    return []
  }

  const model =
    [...requests]
      .reverse()
      .map((request) =>
        firstString(
          (request as Record<string, unknown>)?.modelId,
          ((request as Record<string, unknown>)?.modelState as Record<string, unknown> | undefined)?.modelId
        )
      )
      .find((value): value is string => Boolean(value)) ??
    firstString(
      ((sessionState.inputState as Record<string, unknown> | undefined)?.selectedModel as Record<string, unknown> | undefined)?.id,
      ((sessionState.inputState as Record<string, unknown> | undefined)?.selectedModel as Record<string, unknown> | undefined)
        ?.identifier
    )

  const titleSeed = messages.find((message) => message.role === 'user')?.content ?? messages[0].content
  const createdAt = toIso(sessionState.creationDate, messages[0]?.timestamp ?? new Date().toISOString())
  const updatedAt = toIso(messages[messages.length - 1]?.timestamp ?? createdAt, createdAt)

  const session: SessionSummary = {
    id: sessionId,
    source: 'vscode',
    repoPath: context.repoRoot,
    title: firstString(sessionState.customTitle)?.trim() || titleSeed.slice(0, 120),
    model,
    createdAt,
    updatedAt,
    messageCount: messages.length,
    filePath: context.filePath,
    openVscodeTarget: context.filePath,
    openCliCwd: context.repoRoot
  }

  return [{ session, messages }]
}

const parseEventLog = (raw: string, context: ParseContext): ParsedSession[] => {
  const lines = parseJsonLines(raw) as SessionEvent[]
  if (lines.length === 0) {
    return []
  }

  const sessionStart = lines.find((line) => line.type === 'session.start')
  const sessionId =
    firstString(sessionStart?.data?.['sessionId']) ??
    firstString(lines.find((line) => line.type === 'user.message')?.data?.['interactionId']) ??
    basename(dirname(context.filePath))

  const repoPath =
    firstString(
      sessionStart?.data?.['context'] && (sessionStart.data['context'] as Record<string, unknown>)['cwd'],
      sessionStart?.data?.['cwd'],
      context.repoRoot
    ) ?? context.repoRoot

  const sourceHint =
    sourceFromHint(sessionStart?.data?.['source']) ??
    sourceFromHint(sessionStart?.data?.['producer']) ??
    sourceFromHint(sessionStart?.data?.['client']) ??
    sourceFromHint(sessionStart?.data?.['hostApplication']) ??
    sourceFromHint(lines.find((line) => line.type === 'session.metadata')?.data?.['source'])

  const copilotVersion = firstString(sessionStart?.data?.['copilotVersion'])
  const versionSource =
    copilotVersion && /^0\.0\.\d+/.test(copilotVersion)
      ? 'vscode'
      : copilotVersion && /^\d+\./.test(copilotVersion)
        ? 'cli'
        : null

  const detectedSource: SessionSource =
    sourceHint ?? (versionSource as SessionSource | null) ?? inferSource(context.filePath, context.source)

  const messages: SessionMessage[] = []
  let messageIndex = 0
  for (const line of lines) {
    if (line.type === 'user.message') {
      const payload = line.data ?? {}
      const content = firstString(payload['content'], payload['transformedContent'])
      if (!content) {
        continue
      }
      const timestamp = firstString(line.timestamp, payload['timestamp']) ?? new Date().toISOString()
      messages.push({
        id: stableId(sessionId, `u-${messageIndex}`, content.slice(0, 24)),
        sessionId,
        role: 'user',
        content,
        format: inferFormat(content),
        timestamp: new Date(timestamp).toISOString()
      })
      messageIndex += 1
      continue
    }

    if (line.type === 'assistant.message') {
      const payload = line.data ?? {}
      const content = firstString(payload['content'])
      if (!content) {
        continue
      }
      const timestamp = firstString(line.timestamp, payload['timestamp']) ?? new Date().toISOString()
      messages.push({
        id: stableId(sessionId, `a-${messageIndex}`, content.slice(0, 24)),
        sessionId,
        role: 'assistant',
        content,
        format: inferFormat(content),
        timestamp: new Date(timestamp).toISOString()
      })
      messageIndex += 1
    }
  }

  if (messages.length === 0) {
    return []
  }

  const lastToolModel = [...lines]
    .reverse()
    .map((line) => firstString(line.data?.['model']))
    .find((value): value is string => Boolean(value))

  const titleSeed = messages.find((message) => message.role === 'user')?.content ?? messages[0].content
  const createdAt =
    new Date(firstString(sessionStart?.data?.['startTime'], messages[0]?.timestamp) ?? Date.now()).toISOString()
  const updatedAt = new Date(messages[messages.length - 1]?.timestamp ?? Date.now()).toISOString()

  const session: SessionSummary = {
    id: sessionId,
    source: detectedSource,
    repoPath,
    title: titleSeed.slice(0, 120),
    model: firstString(
      lastToolModel,
      sessionStart?.data?.['model'],
      lines.find((line) => line.type === 'assistant.message')?.data?.['model']
    ),
    createdAt,
    updatedAt,
    messageCount: messages.length,
    filePath: context.filePath,
    openVscodeTarget: context.filePath,
    openCliCwd: repoPath
  }

  return [{ session, messages }]
}

export const parseSessionArtifacts = (raw: string, context: ParseContext): ParsedSession[] => {
  if (
    context.filePath.includes('/chatSessions/') ||
    context.filePath.includes('\\chatSessions\\')
  ) {
    return parseVsCodeChatSessionLog(raw, context)
  }

  if (context.filePath.endsWith('/events.jsonl') || context.filePath.endsWith('\\events.jsonl')) {
    return parseEventLog(raw, context)
  }

  const candidates: unknown[] = []

  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        candidates.push(item)
      }
    } else {
      candidates.push(parsed)
      if (Array.isArray((parsed as any).sessions)) {
        candidates.push(...(parsed as any).sessions)
      }
    }
  } catch {
    candidates.push(...parseJsonLines(raw))
  }

  if (candidates.length === 0) {
    return []
  }

  return candidates
    .map((candidate, index) => normalizeSession(candidate as any, context, index))
    .filter((session): session is ParsedSession => Boolean(session))
}

export const fallbackSessionTitle = (filePath: string): string => basename(filePath)
