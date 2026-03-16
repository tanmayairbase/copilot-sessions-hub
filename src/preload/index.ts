import { contextBridge, ipcRenderer } from 'electron'
import type { AppConfig, RendererApi } from '../shared/types'

const api: RendererApi = {
  getConfig: async () => ipcRenderer.invoke('config:get'),
  saveConfig: async (config: AppConfig) =>
    ipcRenderer.invoke('config:save', config),
  openConfigFile: async () => ipcRenderer.invoke('config:open-file'),
  syncSessions: async () => ipcRenderer.invoke('sessions:sync'),
  listSessions: async (query: string) =>
    ipcRenderer.invoke('sessions:list', query),
  listStarredMessages: async (query: string) =>
    ipcRenderer.invoke('sessions:list-starred', query),
  getSessionDetail: async (sessionId: string) =>
    ipcRenderer.invoke('sessions:get', sessionId),
  openSessionInTool: async (sessionId: string, tool: 'vscode' | 'cli') =>
    ipcRenderer.invoke('sessions:open-tool', sessionId, tool),
  setSessionArchived: async (sessionId: string, archived: boolean) =>
    ipcRenderer.invoke('sessions:set-archived', sessionId, archived),
  setMessageStarred: async (
    sessionId: string,
    messageId: string,
    starred: boolean
  ) =>
    ipcRenderer.invoke(
      'sessions:set-message-starred',
      sessionId,
      messageId,
      starred
    )
}

contextBridge.exposeInMainWorld('copilotSessions', api)
