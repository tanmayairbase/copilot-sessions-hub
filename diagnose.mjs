import { promises as fs } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const diagnose = async () => {
  console.log('=== Copilot Sessions Hub - Windows Diagnostics ===\n');
  
  const home = homedir();
  const appData = process.env.APPDATA;
  const localAppData = process.env.LOCALAPPDATA;
  
  console.log('System Paths:');
  console.log('  Home:', home);
  console.log('  APPDATA:', appData);
  console.log('  LOCALAPPDATA:', localAppData);
  console.log('  Platform:', process.platform);
  
  // Check CLI sessions
  console.log('\n1. Copilot CLI Sessions (~/.copilot/session-state):');
  const cliPath = join(home, '.copilot', 'session-state');
  try {
    const stat = await fs.stat(cliPath);
    if (stat.isDirectory()) {
      const entries = await fs.readdir(cliPath);
      console.log(`   ✓ Directory exists with ${entries.length} items`);
      entries.slice(0, 3).forEach(e => console.log(`     - ${e}`));
    }
  } catch (e) {
    console.log(`   ✗ Not found: ${e.message}`);
  }
  
  // Check VS Code chat sessions
  console.log('\n2. VS Code Chat Sessions (%APPDATA%\\Code\\User\\workspaceStorage):');
  const vsCodePath = join(appData, 'Code', 'User', 'workspaceStorage');
  try {
    const stat = await fs.stat(vsCodePath);
    if (stat.isDirectory()) {
      const workspaceDirs = await fs.readdir(vsCodePath);
      console.log(`   ✓ Directory exists with ${workspaceDirs.length} workspace folders`);
      
      let totalSessions = 0;
      for (const dir of workspaceDirs.slice(0, 5)) {
        const chatPath = join(vsCodePath, dir, 'chatSessions');
        try {
          const files = await fs.readdir(chatPath);
          if (files.length > 0) {
            totalSessions += files.length;
            console.log(`     - Workspace ${dir}: ${files.length} session(s)`);
            files.slice(0, 2).forEach(f => console.log(`       • ${f}`));
          }
        } catch (e) {
          // silently skip
        }
      }
      console.log(`   Total sessions found: ${totalSessions}`);
    }
  } catch (e) {
    console.log(`   ✗ Not found: ${e.message}`);
  }
  
  // Check app config
  console.log('\n3. App Configuration (%APPDATA%\\Copilot Sessions Hub):');
  const appConfigDir = join(appData, 'Copilot Sessions Hub');
  try {
    const stat = await fs.stat(appConfigDir);
    if (stat.isDirectory()) {
      console.log(`   ✓ App directory exists`);
      
      // Try to read config
      const configPath = join(appConfigDir, 'config.json');
      try {
        const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
        console.log(`   ✓ Config found:`);
        console.log(`     - Repo roots: ${config.repoRoots?.length ?? 0}`);
        config.repoRoots?.slice(0, 3).forEach(r => console.log(`       • ${r}`));
        console.log(`     - Discovery mode: ${config.discoveryMode}`);
        console.log(`     - Explicit patterns: ${config.explicitPatterns?.length ?? 0}`);
      } catch (e) {
        console.log(`   - Config not found or invalid`);
      }
      
      // Check logs
      const logPath = join(appConfigDir, 'logs', 'app.log');
      try {
        const stat = await fs.stat(logPath);
        console.log(`   ✓ Log file exists (${Math.round(stat.size / 1024)}KB)`);
      } catch (e) {
        console.log(`   - Log file not found`);
      }
    }
  } catch (e) {
    console.log(`   ✗ App directory not found: ${e.message}`);
  }
  
  // Check repo roots from default config
  console.log('\n4. Default Repo Roots (Windows):');
  const defaultRoots = [
    join(home, 'projects'),
    join(home, 'Documents'),
    join(home, 'source')
  ];
  for (const root of defaultRoots) {
    try {
      const stat = await fs.stat(root);
      if (stat.isDirectory()) {
        console.log(`   ✓ ${root}`);
      }
    } catch (e) {
      console.log(`   ✗ ${root}`);
    }
  }
};

diagnose().catch(console.error);
