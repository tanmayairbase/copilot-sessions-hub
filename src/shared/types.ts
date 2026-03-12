export type SessionSource = 'cli' | 'vscode' | 'opencode'

export type DiscoveryMode = 'autodiscovery' | 'explicit' | 'both'

export interface AppConfig {
  repoRoots: string[]
  discoveryMode: DiscoveryMode
  explicitPatterns: string[]
}

export interface SessionSummary {
  id: string
  source: SessionSource
  repoPath: string
  title: string
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
}

export interface SessionMessage {
  id: string
  sessionId: string
  role: 'user' | 'assistant'
  content: string
  format: 'markdown' | 'text' | 'ansi'
  timestamp: string
}

export interface SessionDetail extends SessionSummary {
  messages: SessionMessage[]
}

export interface SyncResult {
  filesScanned: number
  sessionsImported: number
  skippedFiles: number
  errors: string[]
}

export interface RendererApi {
  getConfig: () => Promise<AppConfig>
  saveConfig: (config: AppConfig) => Promise<AppConfig>
  openConfigFile: () => Promise<void>
  syncSessions: () => Promise<SyncResult>
  listSessions: (query: string) => Promise<SessionSummary[]>
  getSessionDetail: (sessionId: string) => Promise<SessionDetail | null>
  openSessionInTool: (sessionId: string, tool: 'vscode' | 'cli') => Promise<{ ok: boolean; message: string }>
}
