import { describe, expect, it } from 'vitest'
import {
  getGlobalClaudeCodePattern,
  getGlobalCopilotPattern,
  getGlobalVsCodeChatPattern
} from '../src/main/sync'

describe('sync platform path helpers', () => {
  it('builds the global Claude Code session glob from the home directory', () => {
    expect(getGlobalClaudeCodePattern('/Users/me')).toBe(
      '/Users/me/.claude/projects/**/*.jsonl'
    )
  })

  it('normalizes the global Claude Code session glob for Windows homes', () => {
    expect(getGlobalClaudeCodePattern('C:\\Users\\me')).toBe(
      'C:/Users/me/.claude/projects/**/*.jsonl'
    )
  })

  it('preserves the macOS VS Code chat session pattern', () => {
    expect(getGlobalVsCodeChatPattern('darwin', '/Users/me')).toBe(
      '/Users/me/Library/Application Support/Code/User/workspaceStorage/*/chatSessions/*.jsonl'
    )
  })

  it('builds the Windows VS Code chat session pattern from APPDATA with forward slashes', () => {
    expect(
      getGlobalVsCodeChatPattern(
        'win32',
        'C:\\Users\\me',
        'C:\\Users\\me\\AppData\\Roaming'
      )
    ).toBe(
      'C:/Users/me/AppData/Roaming/Code/User/workspaceStorage/*/chatSessions/*.jsonl'
    )
  })

  it('normalizes the global Copilot session glob for Windows homes', () => {
    expect(getGlobalCopilotPattern('C:\\Users\\me')).toBe(
      'C:/Users/me/.copilot/session-state/**/*.{json,jsonl}'
    )
  })
})
