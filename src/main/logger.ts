import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

type LogLevel = 'INFO' | 'WARN' | 'ERROR'

let logFilePath: string | null = null

const formatMeta = (meta?: Record<string, unknown>): string => {
  if (!meta || Object.keys(meta).length === 0) {
    return ''
  }
  try {
    return ` ${JSON.stringify(meta)}`
  } catch {
    return ' {"meta":"unserializable"}'
  }
}

const writeLog = (
  level: LogLevel,
  message: string,
  meta?: Record<string, unknown>
): void => {
  const line = `[${new Date().toISOString()}] [${level}] ${message}${formatMeta(meta)}`
  console.log(line)

  if (!logFilePath) {
    return
  }

  try {
    appendFileSync(logFilePath, `${line}\n`, 'utf8')
  } catch (error) {
    console.error(
      `[logger] failed to write log file: ${(error as Error).message}`
    )
  }
}

export const initializeLogger = (userDataPath: string): string => {
  const logDir = join(userDataPath, 'logs')
  mkdirSync(logDir, { recursive: true })
  logFilePath = join(logDir, 'app.log')
  writeLog('INFO', 'Logger initialized', { logFilePath })
  return logFilePath
}

export const logInfo = (
  message: string,
  meta?: Record<string, unknown>
): void => {
  writeLog('INFO', message, meta)
}

export const logWarn = (
  message: string,
  meta?: Record<string, unknown>
): void => {
  writeLog('WARN', message, meta)
}

export const logError = (
  message: string,
  meta?: Record<string, unknown>
): void => {
  writeLog('ERROR', message, meta)
}
