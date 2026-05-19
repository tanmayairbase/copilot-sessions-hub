import { homedir } from 'node:os'
import { join } from 'node:path'
import fg from 'fast-glob'

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const normalizeGlobPath = (value: string): string => value.replace(/\\/g, '/')

const getGlobalVsCodeChatPattern = (): string => {
  if (process.platform === 'darwin') {
    return normalizeGlobPath(
      join(
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
    )
  }

  if (process.platform === 'win32') {
    return normalizeGlobPath(
      join(
        process.env.APPDATA || homedir(),
        'Code',
        'User',
        'workspaceStorage',
        '*',
        'chatSessions',
        '*.jsonl'
      )
    )
  }

  return normalizeGlobPath(
    join(
      homedir(),
      '.config',
      'Code',
      'User',
      'workspaceStorage',
      '*',
      'chatSessions',
      '*.jsonl'
    )
  )
}

const validate = async (): Promise<void> => {
  console.log('=== Windows VS Code Pattern Validation ===\n')
  console.log('Platform:', process.platform)

  if (process.platform !== 'win32') {
    console.log('This is not Windows, skipping validation')
    return
  }

  const pattern = getGlobalVsCodeChatPattern()
  console.log('\nPattern to search:', pattern)

  try {
    const files = await fg(pattern, {
      absolute: true,
      onlyFiles: true,
      suppressErrors: true,
      unique: true
    })

    console.log(`\nFound ${files.length} VS Code chat session files:`)
    files.forEach(file => {
      console.log(`  - ${file}`)
    })
  } catch (error) {
    console.log('\nError during search:', getErrorMessage(error))
    process.exitCode = 1
  }
}

void validate()
