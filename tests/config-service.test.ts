import { promises as fs } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ConfigService } from '../src/main/config'

const defaultAirbaseRoot = join(homedir(), 'projects/airbase-frontend')

describe('ConfigService', () => {
  it('creates default config when file is missing', async () => {
    const tempDir = await fs.mkdtemp(join(tmpdir(), 'copilot-config-test-'))
    const configPath = join(tempDir, 'config.json')
    const service = new ConfigService(configPath)

    const config = await service.load()

    expect(config.repoRoots).toContain(defaultAirbaseRoot)
    expect(config.discoveryMode).toBe('both')
    expect(config.explicitPatterns.length).toBeGreaterThan(0)
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

    expect(config.repoRoots).toContain(defaultAirbaseRoot)
  })
})
