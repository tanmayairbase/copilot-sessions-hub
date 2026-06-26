import { basename } from 'node:path'
import type { SessionSource } from '../../shared/types'
import { parseClaudeCodeSessionLog } from './claude'
import { parseEventLog } from './copilot'
import { normalizeSession } from './generic'
import { parseJsonLines, type ParseContext, type ParsedSession } from './helpers'
import { parseVsCodeChatSessionLog } from './vscode'

export type { ParseContext, ParsedSession } from './helpers'

interface SessionRoute {
  matchesPath: (filePath: string) => boolean
  // Only set when this route's parser always tags the session with one fixed
  // source (e.g. Claude Code logs are always 'claude'). Event logs are
  // omitted here because parseEventLog derives the source from file content.
  fixedSource?: SessionSource
  parse: (raw: string, context: ParseContext) => ParsedSession[]
}

const hasPathSegment = (segment: string) => {
  const backslashSegment = segment.replace(/\//g, '\\')
  return (filePath: string): boolean =>
    filePath.includes(`/${segment}/`) ||
    filePath.includes(`\\${backslashSegment}\\`)
}

const hasFileSuffix = (suffix: string) => (filePath: string): boolean =>
  filePath.endsWith(`/${suffix}`) || filePath.endsWith(`\\${suffix}`)

const ROUTES: SessionRoute[] = [
  {
    matchesPath: hasPathSegment('chatSessions'),
    fixedSource: 'vscode',
    parse: parseVsCodeChatSessionLog
  },
  {
    matchesPath: hasFileSuffix('events.jsonl'),
    parse: parseEventLog
  },
  {
    matchesPath: hasPathSegment('.claude/projects'),
    fixedSource: 'claude',
    parse: parseClaudeCodeSessionLog
  }
]

// Lets sync.ts label a file's source without re-deriving the same path
// matchers it uses for parser dispatch below.
export const matchFixedSessionSource = (filePath: string): SessionSource | null =>
  ROUTES.find(route => route.matchesPath(filePath))?.fixedSource ?? null

const parseGenericSessionLog = (
  raw: string,
  context: ParseContext
): ParsedSession[] => {
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

export const parseSessionArtifacts = (
  raw: string,
  context: ParseContext
): ParsedSession[] => {
  const route = ROUTES.find(candidate => candidate.matchesPath(context.filePath))
  if (route) {
    return route.parse(raw, context)
  }
  return parseGenericSessionLog(raw, context)
}

export const fallbackSessionTitle = (filePath: string): string => basename(filePath)
