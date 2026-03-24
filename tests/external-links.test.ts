import { describe, expect, it, vi } from 'vitest'
import { registerExternalLinkHandlers } from '../src/main/external-links'
import { normalizeExternalUrl } from '../src/shared/links'

describe('normalizeExternalUrl', () => {
  it('accepts browser-safe external protocols only', () => {
    expect(normalizeExternalUrl('https://github.com/foo/bar/pull/123')).toBe(
      'https://github.com/foo/bar/pull/123'
    )
    expect(normalizeExternalUrl('mailto:test@example.com')).toBe(
      'mailto:test@example.com'
    )
    expect(normalizeExternalUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeExternalUrl('file:///tmp/test.txt')).toBeNull()
  })
})

describe('registerExternalLinkHandlers', () => {
  it('opens external URLs in the default browser for same-window navigation', async () => {
    let willNavigate:
      | ((event: { preventDefault: () => void }, url: string) => void)
      | undefined
    const openExternal = vi.fn()
    const preventDefault = vi.fn()

    registerExternalLinkHandlers(
      {
        on: (_event, listener) => {
          willNavigate = listener
        },
        setWindowOpenHandler: () => {}
      },
      openExternal
    )

    willNavigate?.({ preventDefault }, 'https://example.com/docs')

    expect(preventDefault).toHaveBeenCalledOnce()
    expect(openExternal).toHaveBeenCalledWith('https://example.com/docs')
  })

  it('opens external URLs in the default browser for new-window requests and denies Electron window creation', () => {
    let windowOpenHandler:
      | ((details: { url: string }) => { action: 'allow' | 'deny' })
      | undefined
    const openExternal = vi.fn()

    registerExternalLinkHandlers(
      {
        on: () => {},
        setWindowOpenHandler: handler => {
          windowOpenHandler = handler
        }
      },
      openExternal
    )

    const result = windowOpenHandler?.({
      url: 'https://github.com/org/repo/pull/42'
    })

    expect(result).toEqual({ action: 'deny' })
    expect(openExternal).toHaveBeenCalledWith('https://github.com/org/repo/pull/42')
  })

  it('ignores unsupported protocols during same-window navigation', () => {
    let willNavigate:
      | ((event: { preventDefault: () => void }, url: string) => void)
      | undefined
    const openExternal = vi.fn()
    const preventDefault = vi.fn()

    registerExternalLinkHandlers(
      {
        on: (_event, listener) => {
          willNavigate = listener
        },
        setWindowOpenHandler: () => {}
      },
      openExternal
    )

    willNavigate?.({ preventDefault }, 'javascript:alert(1)')

    expect(preventDefault).not.toHaveBeenCalled()
    expect(openExternal).not.toHaveBeenCalled()
  })
})
