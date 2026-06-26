import { basename, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SessionMessage, SessionSummary } from '../../shared/types'
import {
  asRecord,
  firstString,
  inferFormat,
  normalizeAgent,
  parseJsonLines,
  stableId,
  toIso,
  type ParseContext,
  type ParsedSession
} from './helpers'

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

const toNumberOrNull = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const pathFromUriLike = (value: unknown): string | null => {
  const record = asRecord(value)
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

const formatInlineReferenceText = (
  item: Record<string, unknown>
): string | null => {
  const reference = asRecord(item.reference)
  const inlineReference = asRecord(item.inlineReference)
  const location = asRecord(item.location)
  const target = asRecord(item.target)
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
    ) ?? (uriPath ? basename(uriPath) : null)

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
  const variableData = asRecord(request.variableData)
  const variables = Array.isArray(variableData?.variables)
    ? variableData.variables
    : []

  for (const variable of variables) {
    const variableRecord = asRecord(variable)
    if (!variableRecord) {
      continue
    }
    if (firstString(variableRecord.kind)?.toLowerCase() !== 'file') {
      continue
    }

    const value = asRecord(variableRecord.value)
    const path = pathFromUriLike(value?.uri) ?? firstString(variableRecord.name)
    if (!path) {
      continue
    }

    const range = asRecord(value?.range)
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
  const range = asRecord(edit.range)
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
    const item = asRecord(responseItem)
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
          const nestedRecord = asRecord(nested)
          if (nestedRecord) {
            editRecords.push(nestedRecord)
          }
        }
        continue
      }
      const entryRecord = asRecord(entry)
      if (entryRecord) {
        editRecords.push(entryRecord)
      }
    }

    for (const edit of editRecords) {
      const range = asRecord(edit.range)
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

const extractVsCodeAssistantText = (responseItems: unknown[]): string | null => {
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
    const item = asRecord(responseItem)
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

export const parseVsCodeChatSessionLog = (
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
