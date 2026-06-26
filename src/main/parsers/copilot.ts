import { basename, dirname } from 'node:path'
import type {
  ModelTokenUsage,
  SessionExecutionMode,
  SessionMessage,
  SessionSource,
  SessionSummary,
  SessionTokenUsage
} from '../../shared/types'
import {
  appendExecutionMode,
  asNumber,
  asRecord,
  firstString,
  inferFormat,
  inferSource,
  normalizeAgent,
  parseJsonLines,
  sourceFromHint,
  stableId,
  sumModelTotals,
  ZERO_TOTALS,
  type ParseContext,
  type ParsedSession
} from './helpers'

interface SessionEvent {
  type?: string
  timestamp?: string
  parentId?: string | null
  data?: Record<string, unknown>
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

const extractAgentFromTransformedInstructions = (
  value: unknown
): string | null => {
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

const normalizeExecutionMode = (value: unknown): SessionExecutionMode | null => {
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
    .replace(/^\s*<current_datetime>[\s\S]*?<\/current_datetime>\s*/i, '')
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

export const extractCliTokenUsage = (lines: SessionEvent[]): SessionTokenUsage => {
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
        cacheWrite1hTokens: 0,
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

  return {
    source: 'cli-shutdown',
    byModel,
    totals: sumModelTotals(byModel)
  }
}

export const parseEventLog = (
  raw: string,
  context: ParseContext
): ParsedSession[] => {
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
    isSubagentSession: Boolean(parentSessionId),
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
