import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertDigestMatches,
  compareVersions,
  digestToSha256,
  findMacArmAsset,
  isDueForCheck,
  resolveDownloadTarget,
  UpdateService,
  type GitHubLatestRelease
} from '../src/main/updates'

const sha256 = (value: string): string =>
  createHash('sha256').update(value).digest('hex')

const release = (assetNames: string[]): GitHubLatestRelease => ({
  tag_name: '12.0.0',
  html_url: 'https://github.com/tanmayairbase/AgentStash/releases/tag/12.0.0',
  published_at: '2026-07-01T00:00:00.000Z',
  assets: assetNames.map(name => ({
    name,
    browser_download_url: `https://example.com/${name}`,
    size: 100,
    digest: `sha256:${sha256(name)}`
  }))
})

describe('app update helpers', () => {
  it('compares semver-like versions', () => {
    expect(compareVersions('12.0.0', '11.0.0')).toBe(1)
    expect(compareVersions('11.0.0', '11.0.0')).toBe(0)
    expect(compareVersions('10.9.0', '11.0.0')).toBe(-1)
    expect(compareVersions('v11.0.1', '11.0.0')).toBe(1)
  })

  it('detects whether throttled update checks are due', () => {
    expect(isDueForCheck(null)).toBe(true)
    expect(isDueForCheck('not-a-date')).toBe(true)
    expect(
      isDueForCheck(new Date(Date.now() - 49 * 60 * 60 * 1000).toISOString())
    ).toBe(true)
    expect(isDueForCheck(new Date(Date.now() - 1_000).toISOString())).toBe(
      false
    )
  })

  it('selects the matching Apple Silicon DMG asset', () => {
    const asset = findMacArmAsset(
      release([
        'AgentStash.Setup.12.0.0.exe',
        'AgentStash-12.0.0-x64.dmg',
        'AgentStash-12.0.0-arm64.dmg'
      ])
    )

    expect(asset?.name).toBe('AgentStash-12.0.0-arm64.dmg')
    expect(findMacArmAsset(release(['AgentStash-12.0.0-x64.dmg']))).toBeNull()
  })

  it('normalizes GitHub SHA-256 digests', () => {
    expect(digestToSha256('sha256:ABC123')).toBe('abc123')
    expect(digestToSha256('md5:abc123')).toBeNull()
    expect(digestToSha256(null)).toBeNull()
  })

  it('verifies downloaded file digests', async () => {
    const tempDir = await fs.mkdtemp(join(tmpdir(), 'agentstash-update-test-'))
    const filePath = join(tempDir, 'update.dmg')
    await fs.writeFile(filePath, 'trusted', 'utf8')

    await expect(
      assertDigestMatches(filePath, sha256('trusted'))
    ).resolves.toBeUndefined()
    await expect(
      assertDigestMatches(filePath, sha256('tampered'))
    ).rejects.toThrow('Downloaded update failed SHA-256 verification.')
  })

  it('reuses existing downloads only when their digest matches', async () => {
    const tempDir = await fs.mkdtemp(join(tmpdir(), 'agentstash-update-test-'))
    const assetName = 'AgentStash-12.0.0-arm64.dmg'
    await fs.writeFile(join(tempDir, assetName), 'trusted', 'utf8')

    await expect(
      resolveDownloadTarget(tempDir, assetName, sha256('trusted'))
    ).resolves.toEqual({
      filePath: join(tempDir, assetName),
      existing: true
    })
    await expect(
      resolveDownloadTarget(tempDir, assetName, sha256('different'))
    ).resolves.toEqual({
      filePath: join(tempDir, 'AgentStash-12.0.0-arm64 (1).dmg'),
      existing: false
    })
  })

  it('does not reuse colliding files when no digest is available', async () => {
    const tempDir = await fs.mkdtemp(join(tmpdir(), 'agentstash-update-test-'))
    const assetName = 'AgentStash-12.0.0-arm64.dmg'
    await fs.writeFile(join(tempDir, assetName), 'unknown contents', 'utf8')

    await expect(
      resolveDownloadTarget(tempDir, assetName, null)
    ).resolves.toEqual({
      filePath: join(tempDir, 'AgentStash-12.0.0-arm64 (1).dmg'),
      existing: false
    })
  })

  it('suppresses update checks on unsupported platforms', async () => {
    const tempDir = await fs.mkdtemp(join(tmpdir(), 'agentstash-update-test-'))
    const service = new UpdateService(
      join(tempDir, 'update-state.json'),
      '11.0.0',
      tempDir,
      'win32',
      'x64'
    )

    await expect(
      service.checkForUpdates({ force: true })
    ).resolves.toMatchObject({
      updateAvailable: false,
      latest: null
    })
    await expect(service.downloadLatest()).rejects.toThrow(
      'App updates are currently available for Apple Silicon Macs only.'
    )
  })
})
