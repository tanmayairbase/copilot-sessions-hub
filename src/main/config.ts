import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import type { AppConfig } from '../shared/types'
import { logError, logInfo, logWarn } from './logger'

const defaultPatterns = [
  '**/.copilot/**/*.{json,jsonl}',
  '**/.vscode/**/*copilot*.{json,jsonl}',
  '**/.github/copilot/**/*.{json,jsonl}'
]

const appConfigSchema = z.object({
  repoRoots: z.array(z.string()).default([]),
  discoveryMode: z.enum(['autodiscovery', 'explicit', 'both']).default('both'),
  explicitPatterns: z.array(z.string()).default(defaultPatterns),
  appearance: z.enum(['system', 'light', 'dark']).default('system'),
  syncMode: z.enum(['manual', 'manual-plus-background']).default('manual'),
  backgroundSyncIntervalMinutes: z.number().int().default(10)
})

const expandHome = (value: string): string => {
  if (value.startsWith('~/')) {
    return join(homedir(), value.slice(2))
  }
  return value
}

const defaultRoots = [
  '~/projects/airbase-frontend',
  '~/projects/frontend2',
  '~/projects',
  '~/projects/Airbase.Playwright.Automation.Suite'
].map(expandHome)

export class ConfigService {
  private cachedConfig: AppConfig | null = null

  constructor(private readonly configPath: string) {}

  private normalizeConfig(config: AppConfig): AppConfig {
    const repoRoots =
      config.repoRoots.length > 0
        ? config.repoRoots.map(expandHome)
        : defaultRoots
    const explicitPatterns =
      config.explicitPatterns.length > 0
        ? config.explicitPatterns
        : defaultPatterns
    const interval = Number.isFinite(config.backgroundSyncIntervalMinutes)
      ? Math.max(
          1,
          Math.min(1440, Math.trunc(config.backgroundSyncIntervalMinutes))
        )
      : 10
    return {
      ...config,
      repoRoots,
      explicitPatterns,
      appearance: config.appearance ?? 'system',
      syncMode: config.syncMode ?? 'manual',
      backgroundSyncIntervalMinutes: interval
    }
  }

  async load(): Promise<AppConfig> {
    try {
      logInfo('Loading config file', { configPath: this.configPath })
      const raw = await fs.readFile(this.configPath, 'utf8')
      const parsed = appConfigSchema.parse(JSON.parse(raw))
      const normalized = this.normalizeConfig({
        ...parsed,
        repoRoots: parsed.repoRoots.map(expandHome)
      })

      if (
        normalized.repoRoots.length !== parsed.repoRoots.length ||
        normalized.explicitPatterns.length !== parsed.explicitPatterns.length
      ) {
        logWarn('Config missing defaults, auto-filling', {
          requestedRepoRoots: parsed.repoRoots.length,
          normalizedRepoRoots: normalized.repoRoots.length
        })
        await this.save(normalized)
      }

      logInfo('Config loaded', {
        repoRoots: normalized.repoRoots.length,
        discoveryMode: normalized.discoveryMode,
        explicitPatterns: normalized.explicitPatterns.length
      })
      this.cachedConfig = normalized
      return normalized
    } catch (error) {
      logWarn('Config missing or invalid, creating fallback config', {
        configPath: this.configPath,
        reason: (error as Error).message
      })
      const fallback: AppConfig = {
        repoRoots: defaultRoots,
        discoveryMode: 'both',
        explicitPatterns: defaultPatterns,
        appearance: 'system',
        syncMode: 'manual',
        backgroundSyncIntervalMinutes: 10
      }
      await this.save(fallback)
      return fallback
    }
  }

  async save(config: AppConfig): Promise<AppConfig> {
    const parsed = appConfigSchema.parse({
      ...config,
      repoRoots: config.repoRoots
        .map(value => expandHome(value.trim()))
        .filter(Boolean)
    })
    const normalized = this.normalizeConfig(parsed)

    try {
      await fs.mkdir(dirname(this.configPath), { recursive: true })
      await fs.writeFile(
        this.configPath,
        `${JSON.stringify(normalized, null, 2)}\n`,
        'utf8'
      )
      logInfo('Config saved', {
        configPath: this.configPath,
        repoRoots: normalized.repoRoots.length,
        discoveryMode: normalized.discoveryMode,
        explicitPatterns: normalized.explicitPatterns.length
      })
      this.cachedConfig = normalized
      return normalized
    } catch (error) {
      logError('Failed to save config', {
        configPath: this.configPath,
        reason: (error as Error).message
      })
      throw error
    }
  }

  getPath(): string {
    return this.configPath
  }

  getCachedAppearance(): AppConfig['appearance'] {
    return this.cachedConfig?.appearance ?? 'system'
  }
}
