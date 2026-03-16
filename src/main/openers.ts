import { spawn } from 'node:child_process'
import { platform } from 'node:os'
import { shell } from 'electron'

const execDetached = (
  command: string,
  args: string[],
  cwd?: string
): Promise<boolean> =>
  new Promise(resolve => {
    const child = spawn(command, args, {
      cwd,
      detached: true,
      stdio: 'ignore'
    })

    child.once('error', () => resolve(false))
    child.once('spawn', () => {
      child.unref()
      resolve(true)
    })
  })

const escapeDoubleQuoted = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')

export const openInVscode = async (
  target: string,
  fallbackDir: string
): Promise<{ ok: boolean; message: string }> => {
  const ok = await execDetached('code', ['--reuse-window', target])
  if (ok) {
    return { ok: true, message: 'Opened session artifact in VS Code.' }
  }

  if (platform() === 'darwin') {
    const macOk = await execDetached('open', [
      '-a',
      'Visual Studio Code',
      target
    ])
    if (macOk) {
      return { ok: true, message: 'Opened session artifact in VS Code.' }
    }
  }

  await shell.openPath(fallbackDir)
  return {
    ok: false,
    message: 'VS Code CLI not found. Opened repo folder path instead.'
  }
}

export const openInCli = async (
  cwd: string,
  sessionId: string
): Promise<{ ok: boolean; message: string }> => {
  const os = platform()
  const escapedCwd = escapeDoubleQuoted(cwd)
  const escapedSessionId = escapeDoubleQuoted(sessionId)
  const resumeCommand = `cd "${escapedCwd}" && if command -v copilot >/dev/null 2>&1; then copilot --resume "${escapedSessionId}"; elif command -v gh >/dev/null 2>&1; then gh copilot; else echo "Install copilot CLI or gh CLI first."; fi`

  if (os === 'darwin') {
    const script = `tell application "Terminal" to do script "${resumeCommand}"`
    const ok = await execDetached('osascript', ['-e', script], cwd)
    return ok
      ? {
          ok: true,
          message: `Opened Terminal and attempted session resume: ${sessionId}`
        }
      : { ok: false, message: 'Could not open Terminal command.' }
  }

  if (os === 'win32') {
    const ok = await execDetached(
      'cmd.exe',
      [
        '/c',
        'start',
        'cmd.exe',
        '/k',
        `cd /d "${cwd}" && (copilot --resume "${sessionId}" || gh copilot)`
      ],
      cwd
    )
    return ok
      ? {
          ok: true,
          message: `Opened command prompt and attempted session resume: ${sessionId}`
        }
      : { ok: false, message: 'Could not open command prompt.' }
  }

  const opened = await execDetached(
    'x-terminal-emulator',
    ['-e', `bash -lc '${resumeCommand}'`],
    cwd
  )
  if (opened) {
    return {
      ok: true,
      message: `Opened terminal and attempted session resume: ${sessionId}`
    }
  }

  await shell.openPath(cwd)
  return {
    ok: false,
    message: 'Could not open terminal. Opened folder instead.'
  }
}
