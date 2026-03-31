export type SessionSource = 'cli' | 'vscode' | 'opencode'
export type SessionExecutionMode = 'plan' | 'autopilot'

export type DiscoveryMode = 'autodiscovery' | 'explicit' | 'both'
export type SyncMode = 'manual' | 'manual-plus-background'

export interface AppConfig {
  repoRoots: string[]
  discoveryMode: DiscoveryMode
  explicitPatterns: string[]
  syncMode: SyncMode
  backgroundSyncIntervalMinutes: number
}

export interface SessionSummary {
  id: string
  source: SessionSource
  repoPath: string
  title: string
  agent?: string | null
  modes?: SessionExecutionMode[]
  latestMode?: SessionExecutionMode | null
  model: string | null
  createdAt: string
  updatedAt: string
  messageCount: number
  filePath: string
  openVscodeTarget: string
  openCliCwd: string
  firstSeenAt?: string
  lastSeenAt?: string
  missingFromLastSync?: boolean
  userArchived?: boolean
  userArchivedAt?: string
}

export interface SessionMessage {
  id: string
  sessionId: string
  role: 'user' | 'assistant'
  mode?: SessionExecutionMode | null
  content: string
  format: 'markdown' | 'text' | 'ansi'
  timestamp: string
  userStarred?: boolean
  references?: Array<{
    path: string
    startLine?: number
    endLine?: number
  }>
  edits?: Array<{
    path: string
    startLine?: number
    endLine?: number
    addedLines?: number
    removedLines?: number
  }>
}

export interface MessageStarRecord {
  sessionId: string
  messageId: string
  createdAt: string
  updatedAt: string
  stale: boolean
  lastKnownRole: 'user' | 'assistant'
  lastKnownContent: string
  lastKnownTimestamp: string
}

export interface StarredMessageSummary {
  sessionId: string
  messageId: string
  sessionTitle: string
  sessionSource: SessionSource
  repoPath: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  stale: boolean
  starredAt: string
}

export interface SessionDetail extends SessionSummary {
  messages: SessionMessage[]
}

export interface SyncResult {
  filesScanned: number
  sessionsImported: number
  skippedFiles: number
  durationSeconds: number
  errors: string[]
}

export interface RendererApi {
  getConfig: () => Promise<AppConfig>
  saveConfig: (config: AppConfig) => Promise<AppConfig>
  openConfigFile: () => Promise<void>
  syncSessions: () => Promise<SyncResult>
  listSessions: (query: string) => Promise<SessionSummary[]>
  getSessionDetail: (sessionId: string) => Promise<SessionDetail | null>
  openSessionInTool: (
    sessionId: string,
    tool: 'vscode' | 'cli'
  ) => Promise<{ ok: boolean; message: string }>
  setSessionArchived: (
    sessionId: string,
    archived: boolean
  ) => Promise<SessionSummary | null>
  setMessageStarred: (
    sessionId: string,
    messageId: string,
    starred: boolean
  ) => Promise<MessageStarRecord | null>
  listStarredMessages: (query: string) => Promise<StarredMessageSummary[]>
}
