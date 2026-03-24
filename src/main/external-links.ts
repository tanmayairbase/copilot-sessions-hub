import { normalizeExternalUrl } from '../shared/links'

interface NavigationEventLike {
  preventDefault: () => void
}

interface WindowOpenDetailsLike {
  url: string
}

interface WebContentsLike {
  on: (
    event: 'will-navigate',
    listener: (event: NavigationEventLike, url: string) => void
  ) => void
  setWindowOpenHandler: (
    handler: (details: WindowOpenDetailsLike) => { action: 'allow' | 'deny' }
  ) => void
}

export const registerExternalLinkHandlers = (
  webContents: WebContentsLike,
  openExternal: (url: string) => Promise<unknown> | unknown
): void => {
  webContents.setWindowOpenHandler(({ url }) => {
    const normalized = normalizeExternalUrl(url)
    if (normalized) {
      void Promise.resolve(openExternal(normalized))
    }
    return { action: 'deny' }
  })

  webContents.on('will-navigate', (event, url) => {
    const normalized = normalizeExternalUrl(url)
    if (!normalized) {
      return
    }

    event.preventDefault()
    void Promise.resolve(openExternal(normalized))
  })
}
