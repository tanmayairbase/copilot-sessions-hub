import type { SessionMessage, SessionSummary } from '../../shared/types'
import {
  firstString,
  inferFormat,
  inferSource,
  normalizeAgent,
  sourceFromHint,
  stableId,
  type ParseContext,
  type ParsedSession
} from './helpers'

const toMessage = (
  candidate: any,
  sessionId: string,
  fallbackRole: 'user' | 'assistant',
  index: number
): SessionMessage | null => {
  const roleRaw = firstString(
    candidate.role,
    candidate.type,
    candidate.author,
    candidate.sender,
    candidate.from
  )
  const role =
    roleRaw?.toLowerCase().includes('assistant') ||
    roleRaw?.toLowerCase().includes('copilot')
      ? 'assistant'
      : roleRaw?.toLowerCase().includes('user')
        ? 'user'
        : fallbackRole
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

  const timestamp =
    firstString(
      candidate.timestamp,
      candidate.time,
      candidate.createdAt,
      candidate.created_at,
      candidate.date
    ) ?? new Date().toISOString()

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
    const userContent = firstString(
      turn.prompt,
      turn.input,
      turn.user,
      turn.request
    )
    if (userContent) {
      messages.push({
        id: stableId(sessionId, `u-${index}`, userContent.slice(0, 20)),
        sessionId,
        role: 'user',
        content: userContent,
        format: inferFormat(userContent),
        timestamp: new Date(
          firstString(turn.timestamp, turn.time, turn.createdAt) ?? Date.now()
        ).toISOString()
      })
    }

    const assistantContent = firstString(
      turn.response,
      turn.output,
      turn.assistant,
      turn.answer
    )
    if (assistantContent) {
      messages.push({
        id: stableId(sessionId, `a-${index}`, assistantContent.slice(0, 20)),
        sessionId,
        role: 'assistant',
        content: assistantContent,
        format: inferFormat(assistantContent),
        timestamp: new Date(
          firstString(
            turn.timestamp,
            turn.time,
            turn.updatedAt,
            turn.createdAt
          ) ?? Date.now()
        ).toISOString()
      })
    }
    index += 1
  }
  return messages
}

export const normalizeSession = (
  candidate: any,
  context: ParseContext,
  ordinal: number
): ParsedSession | null => {
  const sessionId =
    firstString(candidate.id, candidate.sessionId, candidate.uuid) ??
    stableId(context.filePath, String(ordinal))

  let messages: SessionMessage[] = []

  if (Array.isArray(candidate.messages)) {
    messages = candidate.messages
      .map((message: unknown, index: number) =>
        toMessage(
          message,
          sessionId,
          index % 2 === 0 ? 'user' : 'assistant',
          index
        )
      )
      .filter((message: SessionMessage | null): message is SessionMessage =>
        Boolean(message)
      )
  } else if (Array.isArray(candidate.turns)) {
    messages = fromTurns(candidate.turns, sessionId)
  } else if (Array.isArray(candidate.history)) {
    messages = candidate.history
      .map((message: unknown, index: number) =>
        toMessage(
          message,
          sessionId,
          index % 2 === 0 ? 'user' : 'assistant',
          index
        )
      )
      .filter((message: SessionMessage | null): message is SessionMessage =>
        Boolean(message)
      )
  }

  if (messages.length === 0 && Array.isArray(candidate)) {
    messages = candidate
      .map((message, index) =>
        toMessage(
          message,
          sessionId,
          index % 2 === 0 ? 'user' : 'assistant',
          index
        )
      )
      .filter((message): message is SessionMessage => Boolean(message))
  }

  if (messages.length === 0) {
    return null
  }

  const userSeed =
    messages.find(message => message.role === 'user')?.content ??
    messages[0].content
  const title =
    firstString(candidate.title, candidate.name, candidate.topic) ??
    userSeed.slice(0, 80)

  const createdAt = new Date(
    firstString(
      candidate.createdAt,
      candidate.created_at,
      candidate.startedAt,
      messages[0]?.timestamp
    ) ?? Date.now()
  ).toISOString()

  const updatedAt = new Date(
    firstString(
      candidate.updatedAt,
      candidate.updated_at,
      candidate.lastActivityAt,
      messages[messages.length - 1]?.timestamp
    ) ?? Date.now()
  ).toISOString()

  const repoPath =
    firstString(
      candidate.repoPath,
      candidate.workspacePath,
      candidate.cwd,
      candidate.repository,
      context.repoRoot
    ) ?? context.repoRoot

  const source =
    sourceFromHint(candidate.source) ??
    sourceFromHint(candidate.client) ??
    sourceFromHint(candidate.producer) ??
    inferSource(context.filePath, context.source)
  const parentSessionId = firstString(
    candidate.parentSessionId,
    candidate.parentId,
    candidate.parent_id,
    candidate.sessionParentId,
    candidate.session_parent_id
  )

  const session: SessionSummary = {
    id: sessionId,
    source,
    repoPath,
    title,
    agent: normalizeAgent(
      firstString(
        candidate.agent,
        candidate.agentName,
        candidate.metadata?.agent,
        candidate.metadata?.agentName
      )
    ),
    isSubagentSession: Boolean(parentSessionId),
    parentSessionId,
    model: firstString(
      candidate.model,
      candidate.modelName,
      candidate.metadata?.model
    ),
    createdAt,
    updatedAt,
    messageCount: messages.length,
    filePath: context.filePath,
    openVscodeTarget: context.filePath,
    openCliCwd: repoPath
  }

  return { session, messages }
}
