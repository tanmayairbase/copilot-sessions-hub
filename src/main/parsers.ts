import { createHash } from 'node:crypto'
import { basename, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  ModelTokenUsage,
  SessionMessage,
  SessionExecutionMode,
  SessionSource,
  SessionSummary,
  SessionTokenUsage,
  SessionTokenUsageTotals
} from '../shared/types'

interface ParseContext {
  filePath: string
  repoRoot: string
  source: SessionSource
  cliSummaryBySessionId?: ReadonlyMap<string, string>
}

export interface ParsedSession {
  session: SessionSummary
  messages: SessionMessage[]
}

const stableId = (...parts: string[]): string =>
  createHash('sha1').update(parts.join('::')).digest('hex')

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

const BUILT_IN_TASK_AGENTS = new Set([
  'explore',
  'task',
  'general-purpose',
  'code-review',
  'configure-copilot'
])

const normalizeAgent = (value: unknown): string | null => {
  const normalized = firstString(value)?.replace(/\s+/g, ' ').trim()
  if (!normalized) {
    return null
  }
  const lowered = normalized.toLowerCase()
  if (lowered === 'copilot-agent' || BUILT_IN_TASK_AGENTS.has(lowered)) {
    return null
  }
  return normalized
}

const inferSource = (
  filePath: string,
  fallback: SessionSource = 'cli'
): SessionSource => {
  const normalized = filePath.toLowerCase()
  if (normalized.includes('opencode')) {
    return 'opencode'
  }
  if (
    normalized.includes('/.vscode/') ||
    normalized.includes('\\.vscode\\') ||
    normalized.includes('vscode')
  ) {
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
  if (
    hint.includes('vscode') ||
    hint.includes('visual studio code') ||
    hint.includes('cursor')
  ) {
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
  if (/```|^#\s|\n\s*[-*]\s|\n\s*\n/m.test(value)) {
    return 'markdown'
  }
  return 'text'
}

const normalizeTextForComparison = (value: string): string =>
  value.replace(/\r\n?/g, '\n').replace(/\s+/g, ' ').trim()

const restoreFlattenedBulletList = (value: string): string => {
  const normalized = value.replace(/\r\n?/g, '\n').trim()
  if (normalized.includes('\n')) {
    return normalized
  }
  const bulletSeparators = normalized.match(/\s-\s/g) ?? []
  if (bulletSeparators.length < 2) {
    return normalized
  }
  return normalized.replace(/\s-\s/g, '\n- ')
}

const restoreFlattenedPlanParagraphs = (value: string): string => {
  const normalized = value.replace(/\r\n?/g, '\n').trim()
  if (normalized.includes('\n') || normalized.length < 280) {
    return normalized
  }

  return normalized.replace(
    /([.?!])\s+(Another thing is\b|There(?:'|’)s one caveat though\b|Thinking out loud here\s*->|Not sure\b|Also\b|However\b|One caveat\b|Separately\b|One more thing\b|Lastly\b|Finally\b|With that said\b|That said\b|For testing\b|For staging\b|On login pages\b|For pages that are not behind auth-wall\b|let'?s prepare\b)/g,
    '$1\n\n$2'
  )
}

const addContentVariant = (variants: Set<string>, value: string): void => {
  const normalized = value.replace(/\r\n?/g, '\n').trim()
  if (!normalized) {
    return
  }
  variants.add(normalized)
  const restored = restoreFlattenedBulletList(normalized)
  if (restored !== normalized) {
    variants.add(restored)
  }
  const paragraphRestored = restoreFlattenedPlanParagraphs(normalized)
  if (paragraphRestored !== normalized) {
    variants.add(paragraphRestored)
  }
  if (restored !== normalized) {
    const restoredParagraphs = restoreFlattenedPlanParagraphs(restored)
    if (restoredParagraphs !== restored) {
      variants.add(restoredParagraphs)
    }
  }
}

const extractPlanRequestBody = (value: string): string | null => {
  const match = value.match(/(?:^|\n\n)My request:\s*([\s\S]*)$/i)
  return match?.[1]?.trim() || null
}

const getTransformedUserContentVariants = (value: string): string[] => {
  const normalized = value.replace(/\r\n?/g, '\n').trim()
  if (!normalized) {
    return []
  }

  const variants = new Set<string>()
  const withoutMetadata = normalized
    .replace(
      /^\s*<current_datetime>[\s\S]*?<\/current_datetime>\s*/i,
      ''
    )
    .replace(/\n*<reminder>[\s\S]*?<\/reminder>\s*/gi, '\n\n')
    .trim()

  if (withoutMetadata) {
    addContentVariant(variants, withoutMetadata)
    addContentVariant(
      variants,
      withoutMetadata.replace(/^\[\[PLAN\]\]\s*/, '').trim()
    )
    const planRequestBody = extractPlanRequestBody(withoutMetadata)
    if (planRequestBody) {
      addContentVariant(variants, planRequestBody)
    }
  }

  for (const candidate of [...variants]) {
    addContentVariant(variants, candidate.replace(/^\[[^\]\n]+\]\s*/, '').trim())
  }

  return [...variants].filter(Boolean)
}

const resolveUserMessageContent = (
  contentValue: unknown,
  transformedValue: unknown
): string | null => {
  const content = firstString(contentValue)
  const transformed = firstString(transformedValue)

  if (!transformed) {
    return content
  }

  const transformedVariants = getTransformedUserContentVariants(transformed)
  if (!content) {
    return transformedVariants[0] ?? transformed
  }

  const normalizedContent = normalizeTextForComparison(content)
  const matchingVariants = transformedVariants.filter(
    candidate => normalizeTextForComparison(candidate) === normalizedContent
  )

  if (matchingVariants.length === 0) {
    return content
  }

  return (
    [...matchingVariants].sort((a, b) => {
      const newlineDelta = b.split('\n').length - a.split('\n').length
      if (newlineDelta !== 0) {
        return newlineDelta
      }
      return b.length - a.length
    })[0] ?? content
  )
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

const normalizeSession = (
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
  const hasDirectAgentInstructions =
    source === 'cli' &&
    [
      candidate.transformedContent,
      ...(Array.isArray(candidate.messages)
        ? candidate.messages.map((message: any) => message?.transformedContent)
        : []),
      ...(Array.isArray(candidate.history)
        ? candidate.history.map((message: any) => message?.transformedContent)
        : []),
      ...(Array.isArray(candidate.turns)
        ? candidate.turns.map((turn: any) => turn?.transformedContent)
        : [])
    ].some(
      value => typeof value === 'string' && value.includes('<agent_instructions>')
    )
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
    isSubagentSession: Boolean(parentSessionId) || hasDirectAgentInstructions,
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

const parseJsonLines = (raw: string): unknown[] => {
  const lines = raw
    .split(/\r?\n/)
    .map(line => line.trim())
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
  parentId?: string | null
  data?: Record<string, unknown>
}

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

const parseRecord = (value: unknown): Record<string, unknown> | null => {
  const direct = asRecord(value)
  if (direct) {
    return direct
  }
  const text = firstString(value)
  if (!text) {
    return null
  }
  try {
    return asRecord(JSON.parse(text))
  } catch {
    return null
  }
}

const extractTaskAgentType = (value: unknown): string | null => {
  const record = parseRecord(value)
  if (!record) {
    return null
  }
  return normalizeAgent(
    firstString(
      record['agent_type'],
      record['agentType'],
      record['agent'],
      asRecord(record['metadata'])?.['agentType'],
      asRecord(record['metadata'])?.['agent']
    )
  )
}

const extractTaskAgentFromToolRequests = (value: unknown): string | null => {
  if (!Array.isArray(value)) {
    return null
  }
  for (const item of value) {
    const request = asRecord(item)
    if (!request) {
      continue
    }
    if (firstString(request['name'])?.toLowerCase() !== 'task') {
      continue
    }
    const agent = extractTaskAgentType(request['arguments'])
    if (agent) {
      return agent
    }
  }
  return null
}

const extractAgentFromTransformedInstructions = (value: unknown): string | null => {
  const transformed = firstString(value)
  if (!transformed || !transformed.includes('<agent_instructions>')) {
    return null
  }

  const headingMatch = transformed.match(
    /<agent_instructions>[\s\S]*?^\s*#\s+([^\n]+)/m
  )
  const heading = headingMatch?.[1]?.replace(/[.:]+$/g, '').trim()
  if (!heading || !/\bagent\b/i.test(heading)) {
    return null
  }

  const kebabCaseAgent = heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return normalizeAgent(kebabCaseAgent || heading)
}

const hasEventLogDirectAgentInstructions = (lines: SessionEvent[]): boolean =>
  lines.some(
    line =>
      line.type === 'user.message' &&
      firstString(line.data?.['transformedContent'])?.includes(
        '<agent_instructions>'
      ) === true
  )

const extractEventLogAgent = (
  lines: SessionEvent[],
  sessionStart: SessionEvent | undefined
): string | null => {
  const fromSubagentStarted = lines
    .map(line => {
      if (line.type !== 'subagent.started') {
        return null
      }
      return normalizeAgent(
        firstString(line.data?.['agentDisplayName'], line.data?.['agentName'])
      )
    })
    .find((value): value is string => Boolean(value))
  if (fromSubagentStarted) {
    return fromSubagentStarted
  }

  const fromTaskExecution = lines
    .map(line => {
      if (line.type !== 'tool.execution_start') {
        return null
      }
      const toolName = firstString(line.data?.['toolName'])?.toLowerCase()
      if (toolName !== 'task') {
        return null
      }
      return extractTaskAgentType(line.data?.['arguments'])
    })
    .find((value): value is string => Boolean(value))
  if (fromTaskExecution) {
    return fromTaskExecution
  }

  const fromAssistantRequests = lines
    .map(line => {
      if (line.type !== 'assistant.message') {
        return null
      }
      return extractTaskAgentFromToolRequests(line.data?.['toolRequests'])
    })
    .find((value): value is string => Boolean(value))
  if (fromAssistantRequests) {
    return fromAssistantRequests
  }

  const fromTransformedInstructions = lines
    .map(line => {
      if (line.type !== 'user.message') {
        return null
      }
      return extractAgentFromTransformedInstructions(
        line.data?.['transformedContent']
      )
    })
    .find((value): value is string => Boolean(value))
  if (fromTransformedInstructions) {
    return fromTransformedInstructions
  }

  return normalizeAgent(
    firstString(
      sessionStart?.data?.['agentDisplayName'],
      sessionStart?.data?.['agentName']
    )
  )
}

const normalizeExecutionMode = (
  value: unknown
): SessionExecutionMode | null => {
  const normalized = firstString(value)?.trim().toLowerCase()
  if (normalized === 'plan' || normalized === 'autopilot') {
    return normalized
  }
  return null
}

const inferPlanModeFromTransformedContent = (
  value: unknown
): SessionExecutionMode | null => {
  const transformed = firstString(value)
  if (!transformed) {
    return null
  }
  return transformed.includes('[[PLAN]]') ? 'plan' : null
}

const appendExecutionMode = (
  modes: SessionExecutionMode[],
  mode: SessionExecutionMode | null
): void => {
  if (!mode || modes[modes.length - 1] === mode) {
    return
  }
  modes.push(mode)
}

const inferModeFromPlanExitText = (
  value: unknown
): SessionExecutionMode | null => {
  const text = firstString(value)?.toLowerCase()
  if (!text) {
    return null
  }
  if (text.includes('plan not approved')) {
    return null
  }
  if (text.includes('autopilot mode') || text.includes('exited plan mode')) {
    return 'autopilot'
  }
  return null
}

const extractExitPlanModeResultText = (line: SessionEvent): string | null => {
  const data = asRecord(line.data)
  if (!data) {
    return null
  }

  if (line.type === 'hook.start' || line.type === 'hook.end') {
    const input = asRecord(data['input'])
    if (firstString(input?.['toolName']) !== 'exit_plan_mode') {
      return null
    }
    const toolResult = asRecord(input?.['toolResult'])
    return firstString(
      toolResult?.['textResultForLlm'],
      toolResult?.['sessionLog']
    )
  }

  if (line.type !== 'tool.execution_complete') {
    return null
  }

  if (firstString(data['toolName']) !== 'exit_plan_mode') {
    return null
  }

  const result = asRecord(data['result'])
  return firstString(
    result?.['textResultForLlm'],
    result?.['sessionLog'],
    result?.['detailedContent'],
    result?.['content']
  )
}

const collectEventLogModes = (lines: SessionEvent[]): SessionExecutionMode[] => {
  const modes: SessionExecutionMode[] = []

  for (const line of lines) {
    if (line.type === 'user.message') {
      appendExecutionMode(
        modes,
        normalizeExecutionMode(line.data?.['agentMode']) ??
          inferPlanModeFromTransformedContent(line.data?.['transformedContent'])
      )
    }

    appendExecutionMode(
      modes,
      inferModeFromPlanExitText(extractExitPlanModeResultText(line))
    )
  }

  return modes
}

interface VsCodeSessionMutation {
  kind?: number
  k?: Array<string | number>
  v?: unknown
}

const setNestedValue = (
  target: Record<string, unknown>,
  path: Array<string | number>,
  value: unknown
): void => {
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

const appendNestedValue = (
  target: Record<string, unknown>,
  path: Array<string | number>,
  value: unknown
): void => {
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

const toRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

const toNumberOrNull = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const pathFromUriLike = (value: unknown): string | null => {
  const record = toRecord(value)
  if (!record) {
    return null
  }
  const direct = firstString(record.fsPath, record.path)
  if (direct) {
    return direct
  }
  const external = firstString(record.external)
  if (external?.startsWith('file://')) {
    try {
      return fileURLToPath(external)
    } catch {
      return external
    }
  }
  return external
}

const formatInlineReferenceText = (item: Record<string, unknown>): string | null => {
  const reference = toRecord(item.reference)
  const inlineReference = toRecord(item.inlineReference)
  const location = toRecord(item.location)
  const target = toRecord(item.target)
  const uriPath =
    pathFromUriLike(item.uri) ??
    pathFromUriLike(inlineReference) ??
    pathFromUriLike(reference?.uri) ??
    pathFromUriLike(location?.uri) ??
    pathFromUriLike(target?.uri)
  const rawLabel =
    firstString(
      item.label,
      item.name,
      item.text,
      item.value,
      reference?.label,
      reference?.name,
      reference?.text,
      location?.label,
      location?.name,
      target?.label,
      target?.name
    ) ??
    (uriPath ? basename(uriPath) : null)

  const label = rawLabel ? basename(rawLabel.replaceAll('\\', '/')) : null

  if (!label) {
    return null
  }

  return `\`${label}\``
}

const extractVsCodeReferences = (
  request: Record<string, unknown>
): NonNullable<SessionMessage['references']> => {
  const references: NonNullable<SessionMessage['references']> = []
  const variableData = toRecord(request.variableData)
  const variables = Array.isArray(variableData?.variables)
    ? variableData.variables
    : []

  for (const variable of variables) {
    const variableRecord = toRecord(variable)
    if (!variableRecord) {
      continue
    }
    if (firstString(variableRecord.kind)?.toLowerCase() !== 'file') {
      continue
    }

    const value = toRecord(variableRecord.value)
    const path = pathFromUriLike(value?.uri) ?? firstString(variableRecord.name)
    if (!path) {
      continue
    }

    const range = toRecord(value?.range)
    references.push({
      path,
      startLine: toNumberOrNull(range?.startLineNumber) ?? undefined,
      endLine: toNumberOrNull(range?.endLineNumber) ?? undefined
    })
  }

  const deduped = new Map<
    string,
    NonNullable<SessionMessage['references']>[number]
  >()
  for (const reference of references) {
    deduped.set(
      `${reference.path}:${reference.startLine ?? ''}:${reference.endLine ?? ''}`,
      reference
    )
  }
  return [...deduped.values()]
}

const normalizeLineDelta = (
  edit: Record<string, unknown>
): { addedLines: number; removedLines: number } => {
  const range = toRecord(edit.range)
  const startLine = toNumberOrNull(range?.startLineNumber)
  const endLine = toNumberOrNull(range?.endLineNumber)
  const startColumn = toNumberOrNull(range?.startColumn)
  const endColumn = toNumberOrNull(range?.endColumn)
  const replacement = firstString(edit.text) ?? ''
  const addedLines = Math.max(1, replacement.split('\n').length)

  if (startLine === null || endLine === null) {
    return { addedLines, removedLines: 1 }
  }

  const samePosition =
    startLine === endLine &&
    startColumn !== null &&
    endColumn !== null &&
    startColumn === endColumn
  const removedLines = samePosition ? 0 : Math.max(1, endLine - startLine + 1)
  return { addedLines, removedLines }
}

const extractVsCodeEdits = (
  responseItems: unknown[]
): NonNullable<SessionMessage['edits']> => {
  const byPath = new Map<string, NonNullable<SessionMessage['edits']>[number]>()

  const ensure = (
    path: string
  ): NonNullable<SessionMessage['edits']>[number] => {
    const existing = byPath.get(path)
    if (existing) {
      return existing
    }
    const created: NonNullable<SessionMessage['edits']>[number] = {
      path,
      addedLines: 0,
      removedLines: 0
    }
    byPath.set(path, created)
    return created
  }

  for (const responseItem of responseItems) {
    const item = toRecord(responseItem)
    if (!item) {
      continue
    }
    const kind = firstString(item.kind)?.toLowerCase()

    if (kind === 'codeblockuri') {
      const path = pathFromUriLike(item.uri)
      if (path && item.isEdit === true) {
        ensure(path)
      }
      continue
    }

    if (kind !== 'texteditgroup') {
      continue
    }

    const path = pathFromUriLike(item.uri)
    if (!path) {
      continue
    }
    const aggregate = ensure(path)
    const edits = Array.isArray(item.edits) ? item.edits : []
    const editRecords: Record<string, unknown>[] = []
    for (const entry of edits) {
      if (Array.isArray(entry)) {
        for (const nested of entry) {
          const nestedRecord = toRecord(nested)
          if (nestedRecord) {
            editRecords.push(nestedRecord)
          }
        }
        continue
      }
      const entryRecord = toRecord(entry)
      if (entryRecord) {
        editRecords.push(entryRecord)
      }
    }

    for (const edit of editRecords) {
      const range = toRecord(edit.range)
      const startLine = toNumberOrNull(range?.startLineNumber)
      const endLine = toNumberOrNull(range?.endLineNumber)
      if (startLine !== null) {
        aggregate.startLine = aggregate.startLine
          ? Math.min(aggregate.startLine, startLine)
          : startLine
      }
      if (endLine !== null) {
        aggregate.endLine = aggregate.endLine
          ? Math.max(aggregate.endLine, endLine)
          : endLine
      }

      const delta = normalizeLineDelta(edit)
      aggregate.addedLines = (aggregate.addedLines ?? 0) + delta.addedLines
      aggregate.removedLines =
        (aggregate.removedLines ?? 0) + delta.removedLines
    }
  }

  return [...byPath.values()]
}

const extractVsCodeAssistantText = (
  responseItems: unknown[]
): string | null => {
  const ignoredKinds = new Set([
    'thinking',
    'toolinvocationserialized',
    'mcpserversstarting',
    'texteditgroup',
    'codeblockuri',
    'undostop',
    'questioncarousel',
    'progresstaskserialized',
    'progressmessage',
    'workspaceedit',
    'preparetoolinvocation'
  ])
  const chunks: string[] = []
  const appendInlineChunk = (content: string): void => {
    if (!content) {
      return
    }

    if (chunks.length === 0) {
      chunks.push(content)
      return
    }

    const lastIndex = chunks.length - 1
    const previous = chunks[lastIndex]
    const needsSpace =
      !/[\s([{]$/.test(previous) && !/^[\s).,;:!?}\]]/.test(content)
    chunks[lastIndex] = `${previous}${needsSpace ? ' ' : ''}${content}`
  }

  for (const responseItem of responseItems) {
    const item = toRecord(responseItem)
    if (!item) {
      continue
    }
    const kind = firstString(item.kind)?.toLowerCase()
    if (kind && ignoredKinds.has(kind)) {
      continue
    }
    if (kind === 'inlinereference') {
      const inlineReference = formatInlineReferenceText(item)
      if (inlineReference) {
        appendInlineChunk(inlineReference)
      }
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
    const trimmed = content?.trim()
    if (!trimmed) {
      continue
    }
    if (/^```[\w-]*$/.test(trimmed)) {
      continue
    }
    if (/^[).,;:!?]/.test(trimmed)) {
      appendInlineChunk(trimmed)
      continue
    }
    chunks.push(trimmed)
  }

  const deduped: string[] = []
  for (const chunk of chunks) {
    if (!deduped.includes(chunk)) {
      deduped.push(chunk)
    }
  }

  if (deduped.length === 0) {
    return null
  }
  return deduped.join('\n\n')
}

const parseVsCodeChatSessionLog = (
  raw: string,
  context: ParseContext
): ParsedSession[] => {
  const lines = parseJsonLines(raw) as VsCodeSessionMutation[]
  if (lines.length === 0) {
    return []
  }

  let sessionState: Record<string, unknown> = {}
  for (const line of lines) {
    if (
      line.kind === 0 &&
      line.v &&
      typeof line.v === 'object' &&
      !Array.isArray(line.v)
    ) {
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

  const requests = Array.isArray(sessionState.requests)
    ? sessionState.requests
    : []
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
    const requestTimestamp = toIso(
      requestObject.timestamp,
      toIso(sessionState.creationDate)
    )
    const userText = firstString(
      (requestObject.message as Record<string, unknown> | undefined)?.text,
      requestObject.prompt,
      requestObject.input
    )
    const references = extractVsCodeReferences(requestObject)
    if (userText) {
      messages.push({
        id: stableId(
          sessionId,
          `vscode-u-${messageIndex}`,
          userText.slice(0, 24)
        ),
        sessionId,
        role: 'user',
        content: userText,
        format: inferFormat(userText),
        timestamp: requestTimestamp,
        references: references.length > 0 ? references : undefined
      })
      messageIndex += 1
    }

    const response = Array.isArray(requestObject.response)
      ? requestObject.response
      : []
    const assistantText = extractVsCodeAssistantText(response)
    const edits = extractVsCodeEdits(response)
    if (assistantText) {
      messages.push({
        id: stableId(
          sessionId,
          `vscode-a-${messageIndex}`,
          assistantText.slice(0, 24)
        ),
        sessionId,
        role: 'assistant',
        content: assistantText,
        format: inferFormat(assistantText),
        timestamp: requestTimestamp,
        edits: edits.length > 0 ? edits : undefined
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
      .map(request =>
        firstString(
          (request as Record<string, unknown>)?.modelId,
          (
            (request as Record<string, unknown>)?.modelState as
              | Record<string, unknown>
              | undefined
          )?.modelId
        )
      )
      .find((value): value is string => Boolean(value)) ??
    firstString(
      (
        (sessionState.inputState as Record<string, unknown> | undefined)
          ?.selectedModel as Record<string, unknown> | undefined
      )?.id,
      (
        (sessionState.inputState as Record<string, unknown> | undefined)
          ?.selectedModel as Record<string, unknown> | undefined
      )?.identifier
    )
  const agent = normalizeAgent(
    firstString(
      (
        (sessionState.inputState as Record<string, unknown> | undefined)
          ?.selectedAgent as Record<string, unknown> | undefined
      )?.id,
      (
        (sessionState.inputState as Record<string, unknown> | undefined)
          ?.selectedAgent as Record<string, unknown> | undefined
      )?.name,
      (
        (sessionState.inputState as Record<string, unknown> | undefined)
          ?.selectedAgent as Record<string, unknown> | undefined
      )?.identifier
    )
  )

  const titleSeed =
    messages.find(message => message.role === 'user')?.content ??
    messages[0].content
  const createdAt = toIso(
    sessionState.creationDate,
    messages[0]?.timestamp ?? new Date().toISOString()
  )
  const updatedAt = toIso(
    messages[messages.length - 1]?.timestamp ?? createdAt,
    createdAt
  )

  const session: SessionSummary = {
    id: sessionId,
    source: 'vscode',
    repoPath: context.repoRoot,
    title:
      firstString(sessionState.customTitle)?.trim() || titleSeed.slice(0, 120),
    agent,
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

  const sessionStart = lines.find(line => line.type === 'session.start')
  const sessionId =
    firstString(sessionStart?.data?.['sessionId']) ??
    firstString(
      lines.find(line => line.type === 'user.message')?.data?.['interactionId']
    ) ??
    basename(dirname(context.filePath))

  const repoPath =
    firstString(
      sessionStart?.data?.['context'] &&
        (sessionStart.data['context'] as Record<string, unknown>)['cwd'],
      sessionStart?.data?.['cwd'],
      context.repoRoot
    ) ?? context.repoRoot

  const sourceHint =
    sourceFromHint(sessionStart?.data?.['source']) ??
    sourceFromHint(sessionStart?.data?.['producer']) ??
    sourceFromHint(sessionStart?.data?.['client']) ??
    sourceFromHint(sessionStart?.data?.['hostApplication']) ??
    sourceFromHint(
      lines.find(line => line.type === 'session.metadata')?.data?.['source']
    )

  const copilotVersion = firstString(sessionStart?.data?.['copilotVersion'])
  const versionSource =
    copilotVersion && /^0\.0\.\d+/.test(copilotVersion)
      ? 'vscode'
      : copilotVersion && /^\d+\./.test(copilotVersion)
        ? 'cli'
        : null

  const detectedSource: SessionSource =
    sourceHint ??
    (versionSource as SessionSource | null) ??
    inferSource(context.filePath, context.source)

  const titleFromEvents = [...lines]
    .reverse()
    .map(line => {
      if (line.type === 'session.title_changed') {
        return firstString(line.data?.['title'])
      }
      if (line.type === 'session.task_complete') {
        return firstString(line.data?.['summary'])
      }
      if (line.type === 'session.compaction_complete') {
        return firstString(line.data?.['summaryContent'])
      }
      return null
    })
    .find((value): value is string => Boolean(value?.trim()))

  const messages: SessionMessage[] = []
  const detectedModes = collectEventLogModes(lines)
  let messageIndex = 0
  for (const line of lines) {
    if (line.type === 'user.message') {
      const payload = line.data ?? {}
      const mode =
        normalizeExecutionMode(payload['agentMode']) ??
        inferPlanModeFromTransformedContent(payload['transformedContent'])
      const content = resolveUserMessageContent(
        payload['content'],
        payload['transformedContent']
      )
      if (!content) {
        continue
      }
      const timestamp =
        firstString(line.timestamp, payload['timestamp']) ??
        new Date().toISOString()
      messages.push({
        id: stableId(sessionId, `u-${messageIndex}`, content.slice(0, 24)),
        sessionId,
        role: 'user',
        mode: mode ?? undefined,
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
      const timestamp =
        firstString(line.timestamp, payload['timestamp']) ??
        new Date().toISOString()
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
    .map(line => firstString(line.data?.['model']))
    .find((value): value is string => Boolean(value))
  const detectedAgent = extractEventLogAgent(lines, sessionStart)
  const parentSessionId = firstString(
    sessionStart?.parentId,
    sessionStart?.data?.['parentSessionId'],
    sessionStart?.data?.['parentId']
  )
  const isDirectAgentSession =
    detectedSource === 'cli' && hasEventLogDirectAgentInstructions(lines)

  const titleSeed =
    messages.find(message => message.role === 'user')?.content ??
    messages[0].content
  const cliSummaryTitle =
    detectedSource === 'cli'
      ? firstString(context.cliSummaryBySessionId?.get(sessionId))
      : null
  const preferredTitle = firstString(cliSummaryTitle, titleFromEvents)
  const normalizedPreferredTitle =
    preferredTitle?.replace(/\s+/g, ' ').trim() ?? ''
  const createdAt = new Date(
    firstString(sessionStart?.data?.['startTime'], messages[0]?.timestamp) ??
      Date.now()
  ).toISOString()
  const updatedAt = new Date(
    messages[messages.length - 1]?.timestamp ?? Date.now()
  ).toISOString()

  const session: SessionSummary = {
    id: sessionId,
    source: detectedSource,
    repoPath,
    title: normalizedPreferredTitle
      ? normalizedPreferredTitle.slice(0, 120)
      : titleSeed.slice(0, 120),
    agent: detectedAgent,
    isSubagentSession: Boolean(parentSessionId) || isDirectAgentSession,
    parentSessionId,
    modes: detectedModes.length > 0 ? detectedModes : undefined,
    latestMode: detectedModes.at(-1) ?? null,
    model: firstString(
      lastToolModel,
      sessionStart?.data?.['model'],
      lines.find(line => line.type === 'assistant.message')?.data?.['model']
    ),
    createdAt,
    updatedAt,
    messageCount: messages.length,
    filePath: context.filePath,
    openVscodeTarget: context.filePath,
    openCliCwd: repoPath,
    tokenUsage: extractCliTokenUsage(lines)
  }

  return [{ session, messages }]
}

const ZERO_TOTALS: SessionTokenUsageTotals = {
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0
}

const asNumber = (value: unknown): number => {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

const extractCliTokenUsage = (lines: SessionEvent[]): SessionTokenUsage => {
  // Sum metrics across all session.shutdown events. Resumed sessions emit a
  // separate shutdown per run, each containing only that run's tokens, so the
  // last event alone would lose history.
  const perModel = new Map<string, ModelTokenUsage>()
  let foundShutdown = false

  for (const event of lines) {
    if (event.type !== 'session.shutdown') continue
    const modelMetricsRaw = event.data?.['modelMetrics']
    if (
      !modelMetricsRaw ||
      typeof modelMetricsRaw !== 'object' ||
      Array.isArray(modelMetricsRaw)
    ) {
      continue
    }
    foundShutdown = true

    for (const [modelId, metrics] of Object.entries(
      modelMetricsRaw as Record<string, unknown>
    )) {
      if (!metrics || typeof metrics !== 'object') continue
      const usage = (metrics as Record<string, unknown>)['usage'] as
        | Record<string, unknown>
        | undefined
      const requests = (metrics as Record<string, unknown>)['requests'] as
        | Record<string, unknown>
        | undefined
      const requestCount = requests ? asNumber(requests['count']) : 0

      const existing = perModel.get(modelId) ?? {
        modelId,
        inputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        requestCount: 0
      }
      existing.inputTokens += asNumber(usage?.['inputTokens'])
      existing.cachedInputTokens += asNumber(usage?.['cacheReadTokens'])
      existing.cacheWriteTokens += asNumber(usage?.['cacheWriteTokens'])
      existing.outputTokens += asNumber(usage?.['outputTokens'])
      existing.reasoningTokens += asNumber(usage?.['reasoningTokens'])
      existing.requestCount = (existing.requestCount ?? 0) + requestCount
      perModel.set(modelId, existing)
    }
  }

  if (!foundShutdown) {
    return {
      source: 'unavailable',
      byModel: [],
      totals: { ...ZERO_TOTALS }
    }
  }

  const byModel = Array.from(perModel.values()).map(entry => {
    if (entry.requestCount && entry.requestCount > 0) return entry
    const next: ModelTokenUsage = { ...entry }
    delete next.requestCount
    return next
  })

  const totals = byModel.reduce<SessionTokenUsageTotals>(
    (acc, entry) => ({
      inputTokens: acc.inputTokens + entry.inputTokens,
      cachedInputTokens: acc.cachedInputTokens + entry.cachedInputTokens,
      cacheWriteTokens: acc.cacheWriteTokens + entry.cacheWriteTokens,
      outputTokens: acc.outputTokens + entry.outputTokens,
      reasoningTokens: acc.reasoningTokens + entry.reasoningTokens
    }),
    { ...ZERO_TOTALS }
  )

  return {
    source: 'cli-shutdown',
    byModel,
    totals
  }
}

export const parseSessionArtifacts = (
  raw: string,
  context: ParseContext
): ParsedSession[] => {
  if (
    context.filePath.includes('/chatSessions/') ||
    context.filePath.includes('\\chatSessions\\')
  ) {
    return parseVsCodeChatSessionLog(raw, context)
  }

  if (
    context.filePath.endsWith('/events.jsonl') ||
    context.filePath.endsWith('\\events.jsonl')
  ) {
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
    .map((candidate, index) =>
      normalizeSession(candidate as any, context, index)
    )
    .filter((session): session is ParsedSession => Boolean(session))
}

export const fallbackSessionTitle = (filePath: string): string =>
  basename(filePath)
