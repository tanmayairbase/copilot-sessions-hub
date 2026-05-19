// Show what the pattern looks like
import { homedir } from 'os';
import { join } from 'path';

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
    // Linux
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
  // fast-glob on Windows requires forward slashes, not backslashes
  return pattern.replaceAll('\\', '/')
}

console.log('Platform:', process.platform);
console.log('APPDATA:', process.env.APPDATA);
console.log('Pattern (after fix):');
console.log(' ', getGlobalVsCodeChatPattern());
