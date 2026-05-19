import { homedir } from 'node:os'
import { join } from 'node:path'

const normalizeGlobPath = (value: string): string => value.replace(/\\/g, '/')

const getGlobalVsCodeChatPattern = (): string => {
  let pattern: string

  if (process.platform === 'darwin') {
    pattern = join(
      homedir(),
      'Library',
      'Application Support',
      'Code',
      'User',
      'workspaceStorage',
      '*',
      'chatSessions',
      '*.jsonl'
    )
  } else if (process.platform === 'win32') {
    pattern = join(
      process.env.APPDATA || homedir(),
      'Code',
      'User',
      'workspaceStorage',
      '*',
      'chatSessions',
      '*.jsonl'
    )
  } else {
    pattern = join(
      homedir(),
      '.config',
      'Code',
      'User',
      'workspaceStorage',
      '*',
      'chatSessions',
      '*.jsonl'
    )
  }

  return normalizeGlobPath(pattern)
}

console.log('Platform:', process.platform)
console.log('APPDATA:', process.env.APPDATA ?? '(not set)')
console.log('Pattern (after fix):')
console.log(' ', getGlobalVsCodeChatPattern())
