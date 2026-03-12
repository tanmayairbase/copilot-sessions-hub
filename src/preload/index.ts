import { contextBridge, ipcRenderer } from 'electron'
import type { AppConfig, RendererApi } from '../shared/types'

const api: RendererApi = {
  getConfig: async () => ipcRenderer.invoke('config:get'),
  saveConfig: async (config: AppConfig) => ipcRenderer.invoke('config:save', config),
  openConfigFile: async () => ipcRenderer.invoke('config:open-file'),
  syncSessions: async () => ipcRenderer.invoke('sessions:sync'),
  listSessions: async (query: string) => ipcRenderer.invoke('sessions:list', query),
  getSessionDetail: async (sessionId: string) => ipcRenderer.invoke('sessions:get', sessionId),
  openSessionInTool: async (sessionId: string, tool: 'vscode' | 'cli') => ipcRenderer.invoke('sessions:open-tool', sessionId, tool)
}

contextBridge.exposeInMainWorld('copilotSessions', api)
