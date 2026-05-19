import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const findSessions = async (): Promise<void> => {
  const home = homedir()
  console.log('User home:', home)

  const cliPath = join(home, '.copilot', 'session-state')
  console.log('\nChecking CLI sessions at:', cliPath)
  try {
    const cliDirs = await fs.readdir(cliPath)
    console.log('CLI session directories:', cliDirs.slice(0, 5))
  } catch (error) {
    console.log('No CLI sessions found:', getErrorMessage(error))
  }

  const appData = process.env.APPDATA ?? null
  if (!appData) {
    console.log('\nAPPDATA is not set, skipping Windows VS Code chat lookup')
    return
  }

  const vsCodePath = join(appData, 'Code', 'User', 'workspaceStorage')
  console.log('\nChecking VS Code chat sessions at:', vsCodePath)
  try {
    const workspaceDirs = await fs.readdir(vsCodePath)
    console.log('Workspace storage dirs:', workspaceDirs.slice(0, 5))

    for (const dir of workspaceDirs.slice(0, 3)) {
      const chatPath = join(vsCodePath, dir, 'chatSessions')
      try {
        const files = await fs.readdir(chatPath)
        if (files.length > 0) {
          console.log(
            `\nFound ${files.length} chat session files in workspace ${dir}:`
          )
          for (const file of files) {
            console.log(`  - ${file}`)
          }
        }
      } catch {
        // Ignore workspaces without chatSessions.
      }
    }
  } catch (error) {
    console.log('No VS Code chat sessions found:', getErrorMessage(error))
  }
}

void findSessions().catch(error => {
  console.error('Error:', getErrorMessage(error))
  process.exitCode = 1
})
