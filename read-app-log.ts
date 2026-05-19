import { promises as fs } from 'node:fs'
import { join } from 'node:path'

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const readAppLog = async (): Promise<void> => {
  const appDataPath = process.env.APPDATA ?? null
  if (!appDataPath) {
    console.error('APPDATA is not set, cannot locate the Windows app log')
    process.exitCode = 1
    return
  }

  const logPath = join(appDataPath, 'Copilot Sessions Hub', 'logs', 'app.log')
  console.log('Reading log from:', logPath)

  try {
    const content = await fs.readFile(logPath, 'utf8')
    const lines = content.split('\n').slice(-50)
    console.log('\n=== Last 50 lines of app.log ===\n')
    lines.forEach(line => console.log(line))
  } catch (error) {
    console.error('Error reading log:', getErrorMessage(error))
    process.exitCode = 1
  }
}

void readAppLog()
