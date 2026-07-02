import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import { get as getHttps } from 'node:https'
import { basename, dirname, extname, join } from 'node:path'
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http'
import type {
  AppUpdateInfo,
  AppUpdateStatus,
  UpdateDownloadProgress
} from '../shared/types'
import { logInfo, logWarn } from './logger'

const GITHUB_LATEST_RELEASE_URL =
  'https://api.github.com/repos/tanmayairbase/AgentStash/releases/latest'
const UPDATE_CHECK_INTERVAL_MS = 48 * 60 * 60 * 1000
const REQUEST_TIMEOUT_MS = 30_000
const MAX_REDIRECTS = 5

interface PersistedUpdateState {
  lastCheckedAt: string | null
  latest: AppUpdateInfo | null
  dismissedVersion: string | null
}

export interface GitHubReleaseAsset {
  name: string
  browser_download_url: string
  size: number
  digest?: string | null
}

export interface GitHubLatestRelease {
  tag_name: string
  html_url: string
  published_at: string
  assets: GitHubReleaseAsset[]
}

interface HttpBufferResponse {
  statusCode: number
  headers: IncomingHttpHeaders
  body: Buffer
}

type ResponseHandler<T> = (response: IncomingMessage) => Promise<T>

const defaultState = (): PersistedUpdateState => ({
  lastCheckedAt: null,
  latest: null,
  dismissedVersion: null
})

const normalizeVersion = (version: string): string =>
  version.trim().replace(/^v/i, '')

const parseVersionParts = (version: string): number[] =>
  normalizeVersion(version)
    .split(/[.-]/)
    .map(part => Number.parseInt(part, 10))
    .filter(part => Number.isFinite(part))

export const compareVersions = (left: string, right: string): number => {
  const leftParts = parseVersionParts(left)
  const rightParts = parseVersionParts(right)
  const length = Math.max(leftParts.length, rightParts.length)

  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index] ?? 0
    const rightPart = rightParts[index] ?? 0
    if (leftPart !== rightPart) {
      return leftPart > rightPart ? 1 : -1
    }
  }

  return 0
}

export const isDueForCheck = (lastCheckedAt: string | null): boolean => {
  if (!lastCheckedAt) {
    return true
  }
  const lastCheckedTime = Date.parse(lastCheckedAt)
  if (!Number.isFinite(lastCheckedTime)) {
    return true
  }
  return Date.now() - lastCheckedTime >= UPDATE_CHECK_INTERVAL_MS
}

const requestWithRedirects = <T>(
  url: string,
  headers: Record<string, string>,
  handleResponse: ResponseHandler<T>,
  redirectsRemaining = MAX_REDIRECTS
): Promise<T> =>
  new Promise((resolve, reject) => {
    const request = getHttps(
      url,
      {
        headers,
        timeout: REQUEST_TIMEOUT_MS
      },
      response => {
        const statusCode = response.statusCode ?? 0
        const location = response.headers.location
        if (
          statusCode >= 300 &&
          statusCode < 400 &&
          location &&
          redirectsRemaining > 0
        ) {
          response.resume()
          let nextUrl: string
          try {
            nextUrl = new URL(location, url).toString()
          } catch (error) {
            reject(
              new Error(
                `Invalid update redirect URL: ${(error as Error).message}`
              )
            )
            return
          }
          requestWithRedirects(
            nextUrl,
            headers,
            handleResponse,
            redirectsRemaining - 1
          )
            .then(resolve)
            .catch(reject)
          return
        }

        handleResponse(response).then(resolve).catch(reject)
      }
    )
    request.on('timeout', () => {
      request.destroy(new Error(`Request timed out: ${url}`))
    })
    request.on('error', reject)
  })

const requestBuffer = (url: string): Promise<HttpBufferResponse> =>
  requestWithRedirects(
    url,
    {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'AgentStash'
    },
    response =>
      new Promise((resolve, reject) => {
        const chunks: Buffer[] = []
        response.on('data', chunk => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        })
        response.on('error', reject)
        response.on('end', () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks)
          })
        })
      })
  )

const fetchLatestRelease = async (): Promise<GitHubLatestRelease> => {
  const response = await requestBuffer(GITHUB_LATEST_RELEASE_URL)
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`GitHub update check failed (${response.statusCode})`)
  }

  return JSON.parse(response.body.toString('utf8')) as GitHubLatestRelease
}

export const findMacArmAsset = (
  release: GitHubLatestRelease
): GitHubReleaseAsset | null => {
  const releaseVersion = normalizeVersion(release.tag_name)
  return (
    release.assets.find(asset => {
      const name = asset.name.toLowerCase()
      return (
        name.includes('agentstash') &&
        name.includes(releaseVersion.toLowerCase()) &&
        name.endsWith('-arm64.dmg')
      )
    }) ?? null
  )
}

export const digestToSha256 = (
  digest: string | null | undefined
): string | null => {
  if (!digest) {
    return null
  }
  const normalized = digest.trim().toLowerCase()
  return normalized.startsWith('sha256:')
    ? normalized.slice('sha256:'.length)
    : null
}

const sha256File = async (filePath: string): Promise<string> => {
  const hash = createHash('sha256')
  const stream = createReadStream(filePath)
  for await (const chunk of stream) {
    hash.update(chunk)
  }
  return hash.digest('hex')
}

export const assertDigestMatches = async (
  filePath: string,
  expectedDigest: string | null
): Promise<void> => {
  if (!expectedDigest) {
    return
  }
  const actualDigest = await sha256File(filePath)
  if (actualDigest !== expectedDigest) {
    throw new Error('Downloaded update failed SHA-256 verification.')
  }
}

const appendFileCounter = (filePath: string, counter: number): string => {
  const extension = extname(filePath)
  const base = filePath.slice(0, filePath.length - extension.length)
  return `${base} (${counter})${extension}`
}

export const resolveDownloadTarget = async (
  downloadsPath: string,
  assetName: string,
  expectedDigest: string | null
): Promise<{ filePath: string; existing: boolean }> => {
  const safeAssetName = basename(assetName)
  const basePath = join(downloadsPath, safeAssetName)

  for (let index = 0; index < 100; index += 1) {
    const candidate =
      index === 0 ? basePath : appendFileCounter(basePath, index)
    if (!existsSync(candidate)) {
      return { filePath: candidate, existing: false }
    }
    if (!expectedDigest) {
      continue
    }
    try {
      const actualDigest = await sha256File(candidate)
      if (actualDigest === expectedDigest) {
        return { filePath: candidate, existing: true }
      }
    } catch (error) {
      logWarn('Failed hashing existing update download', {
        filePath: candidate,
        reason: (error as Error).message
      })
    }
  }

  throw new Error('Could not choose a Downloads filename for the update.')
}

const downloadFile = (
  url: string,
  filePath: string,
  onProgress?: (progress: UpdateDownloadProgress) => void
): Promise<void> =>
  requestWithRedirects(
    url,
    {
      'User-Agent': 'AgentStash'
    },
    response =>
      new Promise((resolve, reject) => {
        const statusCode = response.statusCode ?? 0
        if (statusCode < 200 || statusCode >= 300) {
          response.resume()
          reject(new Error(`Update download failed (${statusCode})`))
          return
        }

        const totalBytes = Number.parseInt(
          response.headers['content-length'] ?? '',
          10
        )
        const normalizedTotalBytes = Number.isFinite(totalBytes)
          ? totalBytes
          : null
        let bytesReceived = 0
        const writer = createWriteStream(filePath)

        response.on('data', chunk => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          bytesReceived += buffer.length
          onProgress?.({
            phase: 'downloading',
            bytesReceived,
            totalBytes: normalizedTotalBytes,
            percent: normalizedTotalBytes
              ? Math.min(
                  100,
                  Math.round((bytesReceived / normalizedTotalBytes) * 100)
                )
              : null,
            filePath
          })
        })
        response.pipe(writer)
        response.on('error', reject)
        writer.on('error', reject)
        writer.on('finish', () => {
          writer.close(error => {
            if (error) {
              reject(error)
              return
            }
            resolve()
          })
        })
      })
  )

export class UpdateService {
  private cachedState: PersistedUpdateState | null = null

  constructor(
    private readonly statePath: string,
    private readonly currentVersion: string,
    private readonly downloadsPath: string,
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly arch: string = process.arch
  ) {}

  private isSupportedPlatform(): boolean {
    return this.platform === 'darwin' && this.arch === 'arm64'
  }

  private async loadState(): Promise<PersistedUpdateState> {
    if (this.cachedState) {
      return this.cachedState
    }

    try {
      const raw = await fs.readFile(this.statePath, 'utf8')
      const parsed = JSON.parse(raw) as Partial<PersistedUpdateState>
      this.cachedState = {
        lastCheckedAt: parsed.lastCheckedAt ?? null,
        latest: parsed.latest ?? null,
        dismissedVersion: parsed.dismissedVersion ?? null
      }
    } catch (error) {
      logWarn('Update state missing or invalid, using defaults', {
        statePath: this.statePath,
        reason: (error as Error).message
      })
      this.cachedState = defaultState()
      await this.saveState(this.cachedState)
    }

    return this.cachedState
  }

  private async saveState(
    state: PersistedUpdateState
  ): Promise<PersistedUpdateState> {
    await fs.mkdir(dirname(this.statePath), { recursive: true })
    await fs.writeFile(
      this.statePath,
      `${JSON.stringify(state, null, 2)}\n`,
      'utf8'
    )
    this.cachedState = state
    return state
  }

  private toStatus(state: PersistedUpdateState): AppUpdateStatus {
    const updateAvailable = state.latest
      ? compareVersions(state.latest.version, this.currentVersion) > 0
      : false
    return {
      currentVersion: this.currentVersion,
      latest: updateAvailable ? state.latest : null,
      lastCheckedAt: state.lastCheckedAt,
      dismissedVersion: state.dismissedVersion,
      updateAvailable,
      notificationVisible:
        updateAvailable && state.dismissedVersion !== state.latest?.version
    }
  }

  async getStatus(): Promise<AppUpdateStatus> {
    return this.toStatus(await this.loadState())
  }

  async checkForUpdates(options?: {
    force?: boolean
  }): Promise<AppUpdateStatus> {
    const state = await this.loadState()
    if (!this.isSupportedPlatform()) {
      return this.toStatus(state)
    }
    if (!options?.force && !isDueForCheck(state.lastCheckedAt)) {
      return this.toStatus(state)
    }

    logInfo('Checking for app updates', {
      currentVersion: this.currentVersion,
      force: Boolean(options?.force)
    })
    let release: GitHubLatestRelease
    try {
      release = await fetchLatestRelease()
    } catch (error) {
      await this.saveState({
        ...state,
        lastCheckedAt: new Date().toISOString()
      })
      throw error
    }
    const asset = findMacArmAsset(release)
    const latest =
      asset && compareVersions(release.tag_name, this.currentVersion) > 0
        ? {
            version: normalizeVersion(release.tag_name),
            releaseUrl: release.html_url,
            publishedAt: release.published_at,
            assetName: asset.name,
            assetUrl: asset.browser_download_url,
            assetSize: asset.size,
            assetDigest: digestToSha256(asset.digest)
          }
        : null
    const next = await this.saveState({
      ...state,
      lastCheckedAt: new Date().toISOString(),
      latest
    })
    logInfo('App update check completed', {
      updateAvailable: Boolean(latest),
      latestVersion: latest?.version ?? null
    })
    return this.toStatus(next)
  }

  async dismissLatest(): Promise<AppUpdateStatus> {
    const state = await this.loadState()
    if (!state.latest) {
      return this.toStatus(state)
    }
    return this.toStatus(
      await this.saveState({
        ...state,
        dismissedVersion: state.latest.version
      })
    )
  }

  async downloadLatest(
    onProgress?: (progress: UpdateDownloadProgress) => void
  ): Promise<{ status: AppUpdateStatus; filePath: string }> {
    const state = await this.loadState()
    if (!this.isSupportedPlatform()) {
      throw new Error(
        'App updates are currently available for Apple Silicon Macs only.'
      )
    }
    if (!state.latest) {
      throw new Error('No update is available to download.')
    }

    const originalDismissedVersion = state.dismissedVersion
    const downloadingState = await this.saveState({
      ...state,
      dismissedVersion: state.latest.version
    })
    const target = await resolveDownloadTarget(
      this.downloadsPath,
      state.latest.assetName,
      state.latest.assetDigest
    )
    try {
      if (!target.existing) {
        const partialPath = `${target.filePath}.download`
        await fs.rm(partialPath, { force: true })
        try {
          await downloadFile(state.latest.assetUrl, partialPath, onProgress)
          onProgress?.({
            phase: 'verifying',
            bytesReceived: state.latest.assetSize,
            totalBytes: state.latest.assetSize,
            percent: 100,
            filePath: partialPath
          })
          await assertDigestMatches(partialPath, state.latest.assetDigest)
          await fs.rename(partialPath, target.filePath)
        } catch (error) {
          await fs.rm(partialPath, { force: true })
          throw error
        }
      } else {
        onProgress?.({
          phase: 'verifying',
          bytesReceived: state.latest.assetSize,
          totalBytes: state.latest.assetSize,
          percent: 100,
          filePath: target.filePath
        })
        await assertDigestMatches(target.filePath, state.latest.assetDigest)
      }

      logInfo('App update downloaded', {
        filePath: target.filePath,
        version: state.latest.version,
        existing: target.existing
      })
      return {
        status: this.toStatus(downloadingState),
        filePath: target.filePath
      }
    } catch (error) {
      const latestState = await this.loadState()
      await this.saveState({
        ...latestState,
        dismissedVersion: originalDismissedVersion
      })
      throw error
    }
  }
}
