import { promises as fs } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ConfigService, getPlatformDefaultRoots } from '../src/main/config'

const getExpectedDefaultRoot = (): string => {
  const home = homedir()
  if (process.platform === 'darwin') {
    return join(home, 'projects/airbase-frontend')
  }
  if (process.platform === 'win32') {
    return join(home, 'projects')
  }
  return join(home, 'projects')
}

const defaultExpectedRoot = getExpectedDefaultRoot()

describe('ConfigService', () => {
  it('returns the existing macOS defaults unchanged', () => {
    expect(getPlatformDefaultRoots('darwin', '/Users/me')).toEqual([
      '/Users/me/projects/airbase-frontend',
      '/Users/me/projects/frontend2',
      '/Users/me/projects',
      '/Users/me/projects/Airbase.Playwright.Automation.Suite'
    ])
  })

  it('returns Windows-specific default roots', () => {
    expect(getPlatformDefaultRoots('win32', 'C:\\Users\\me')).toEqual([
      'C:\\Users\\me/projects',
      'C:\\Users\\me/Documents',
      'C:\\Users\\me/source'
    ])
  })

  it('creates default config when file is missing', async () => {
    const tempDir = await fs.mkdtemp(join(tmpdir(), 'copilot-config-test-'))
    const configPath = join(tempDir, 'config.json')
    const service = new ConfigService(configPath)

    const config = await service.load()

    expect(config.repoRoots).toContain(defaultExpectedRoot)
    expect(config.discoveryMode).toBe('both')
    expect(config.explicitPatterns.length).toBeGreaterThan(0)
    expect(config.appearance).toBe('system')
    expect(config.syncMode).toBe('manual')
    expect(config.backgroundSyncIntervalMinutes).toBe(10)
  })

  it('fills default repo roots when saved config has empty roots', async () => {
    const tempDir = await fs.mkdtemp(join(tmpdir(), 'copilot-config-test-'))
    const configPath = join(tempDir, 'config.json')
    await fs.writeFile(
      configPath,
      JSON.stringify({
        repoRoots: [],
        discoveryMode: 'both',
        explicitPatterns: ['**/.copilot/**/*.json']
      }),
      'utf8'
    )

    const service = new ConfigService(configPath)
    const config = await service.load()

    expect(config.repoRoots).toContain(defaultExpectedRoot)
  })

  it('normalizes background sync settings', async () => {
    const tempDir = await fs.mkdtemp(join(tmpdir(), 'copilot-config-test-'))
    const configPath = join(tempDir, 'config.json')
    await fs.writeFile(
      configPath,
      JSON.stringify({
        repoRoots: [defaultExpectedRoot],
        discoveryMode: 'both',
        explicitPatterns: ['**/.copilot/**/*.json'],
        appearance: 'light',
        syncMode: 'manual-plus-background',
        backgroundSyncIntervalMinutes: 0
      }),
      'utf8'
    )

    const service = new ConfigService(configPath)
    const config = await service.load()
    expect(config.appearance).toBe('light')
    expect(config.syncMode).toBe('manual-plus-background')
    expect(config.backgroundSyncIntervalMinutes).toBe(1)
  })
})
