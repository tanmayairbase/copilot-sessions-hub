import { promises as fs } from 'fs';
import { homedir, platform } from 'os';
import { join } from 'path';
import fg from 'fast-glob';

const getGlobalVsCodeChatPattern = (): string => {
  if (process.platform === 'darwin') {
    return join(
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
  }
  if (process.platform === 'win32') {
    return join(
      process.env.APPDATA || homedir(),
      'Code',
      'User',
      'workspaceStorage',
      '*',
      'chatSessions',
      '*.jsonl'
    )
  }
  // Linux
  return join(
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

const validate = async () => {
  console.log('=== Windows VS Code Pattern Validation ===\n');
  console.log('Platform:', process.platform);
  
  if (process.platform !== 'win32') {
    console.log('⚠ This is not Windows, skipping validation');
    return;
  }
  
  const pattern = getGlobalVsCodeChatPattern();
  console.log('\nPattern to search:', pattern);
  console.log('Pattern (readable):', pattern.replace(/\\/g, '\\\\'));
  
  try {
    const files = await fg(pattern, {
      absolute: true,
      onlyFiles: true,
      suppressErrors: true,
      unique: true
    });
    
    console.log(`\n✓ Found ${files.length} VS Code chat session files:`);
    files.forEach(f => {
      console.log(`  - ${f}`);
    });
  } catch (error) {
    console.log('\n✗ Error during search:', error.message);
  }
};

validate();
