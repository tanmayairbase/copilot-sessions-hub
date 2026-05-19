import { promises as fs } from 'fs';
import { join } from 'path';

const readAppLog = async () => {
  try {
    const appDataPath = process.env.APPDATA;
    const logPath = join(appDataPath, 'Copilot Sessions Hub', 'logs', 'app.log');
    
    console.log('Reading log from:', logPath);
    const content = await fs.readFile(logPath, 'utf8');
    
    // Print last 50 lines
    const lines = content.split('\n').slice(-50);
    console.log('\n=== Last 50 lines of app.log ===\n');
    lines.forEach(line => console.log(line));
    
  } catch (error) {
    console.error('Error reading log:', error.message);
  }
};

readAppLog();
