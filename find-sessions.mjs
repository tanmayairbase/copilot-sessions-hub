import { promises as fs } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const findSessions = async () => {
  try {
    const home = homedir();
    console.log('User home:', home);
    
    // Check Copilot CLI sessions
    const cliPath = join(home, '.copilot', 'session-state');
    console.log('\nChecking CLI sessions at:', cliPath);
    try {
      const cliDirs = await fs.readdir(cliPath);
      console.log('CLI session directories:', cliDirs.slice(0, 5));
    } catch (e) {
      console.log('No CLI sessions found:', e.message);
    }
    
    // Check VS Code chat sessions (Windows)
    const appData = process.env.APPDATA;
    const vsCodePath = join(appData, 'Code', 'User', 'workspaceStorage');
    console.log('\nChecking VS Code chat sessions at:', vsCodePath);
    try {
      const workspaceDirs = await fs.readdir(vsCodePath);
      console.log('Workspace storage dirs:', workspaceDirs.slice(0, 5));
      
      for (const dir of workspaceDirs.slice(0, 3)) {
        const chatPath = join(vsCodePath, dir, 'chatSessions');
        try {
          const files = await fs.readdir(chatPath);
          if (files.length > 0) {
            console.log(`\nFound ${files.length} chat session files in workspace ${dir}:`);
            for (const file of files) {
              console.log(`  - ${file}`);
            }
          }
        } catch (e) {
          // silently skip
        }
      }
    } catch (e) {
      console.log('No VS Code chat sessions found:', e.message);
    }
  } catch (error) {
    console.error('Error:', error);
  }
};

findSessions();
