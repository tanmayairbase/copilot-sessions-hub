import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { TranscriptTheme } from './SessionDetailView'

type MermaidApi = (typeof import('mermaid'))['default']

let mermaidModulePromise: Promise<MermaidApi> | null = null

const loadMermaid = (): Promise<MermaidApi> => {
  if (!mermaidModulePromise) {
    mermaidModulePromise = import('mermaid').then(module => module.default)
    mermaidModulePromise.catch(() => {
      mermaidModulePromise = null
    })
  }
  return mermaidModulePromise
}

// mermaid shares global state (theme + id counters) and is not safe to call
// concurrently, so every render is queued behind the previous one. We also only
// re-initialize when the theme actually changes.
let mermaidRenderChain: Promise<unknown> = Promise.resolve()
let initializedTheme: TranscriptTheme | null = null

const renderMermaid = (theme: TranscriptTheme, source: string): Promise<string> => {
  const run = mermaidRenderChain.then(async () => {
    const mermaid = await loadMermaid()
    if (initializedTheme !== theme) {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        // Without this, a failed render draws mermaid's "bomb" error diagram
        // into a temp node appended to <body> and then throws before cleaning
        // it up, leaving orphaned error graphics stuck on the page. We render
        // our own error state instead (see the 'error' branch below).
        suppressErrorRendering: true,
        theme: theme === 'light' ? 'default' : 'dark'
      })
      initializedTheme = theme
    }
    const renderId = `mermaid-${Math.random().toString(36).slice(2)}`
    const { svg } = await mermaid.render(renderId, source)
    return svg
  })
  // Keep the chain alive regardless of this render's outcome so a single
  // failure doesn't wedge every subsequent diagram.
  mermaidRenderChain = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

type DiagramState =
  | { status: 'pending' }
  | { status: 'ready'; svg: string }
  | { status: 'error' }

// Fullscreen lightbox for a rendered diagram. Rendered through a portal so the
// overlay escapes the scrollable message column and covers the whole window.
const MermaidLightbox = ({
  svg,
  theme,
  onClose
}: {
  svg: string
  theme: TranscriptTheme
  onClose: () => void
}) => {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  return createPortal(
    <div
      className="mermaid-lightbox-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Expanded diagram"
      onClick={onClose}
    >
      <button
        type="button"
        className="mermaid-lightbox-close"
        aria-label="Close expanded diagram"
        onClick={onClose}
      >
        <kbd>Esc</kbd>
        <span>to close</span>
      </button>
      <div
        className="mermaid-lightbox-content"
        data-mermaid-theme={theme}
        onClick={event => event.stopPropagation()}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>,
    document.body
  )
}

// Renders a single mermaid diagram. The component owns the async render and the
// resulting SVG lives in React state, so re-renders (theme toggles, sync
// refreshes) leave it untouched instead of wiping an imperatively injected node.
export const MermaidDiagram = ({
  source,
  theme
}: {
  source: string
  theme: TranscriptTheme
}) => {
  const [state, setState] = useState<DiagramState>({ status: 'pending' })
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    let cancelled = false
    setState({ status: 'pending' })

    renderMermaid(theme, source).then(
      svg => {
        if (!cancelled) {
          setState({ status: 'ready', svg })
        }
      },
      error => {
        console.error('Failed to render mermaid diagram', error)
        if (!cancelled) {
          setState({ status: 'error' })
        }
      }
    )

    return () => {
      cancelled = true
    }
  }, [source, theme])

  if (state.status === 'ready') {
    return (
      <>
        <div
          className="mermaid-diagram mermaid-diagram-clickable"
          data-mermaid-theme={theme}
          role="button"
          tabIndex={0}
          title="Click to expand"
          aria-label="Expand diagram"
          onClick={() => setExpanded(true)}
          onKeyDown={event => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              setExpanded(true)
            }
          }}
          dangerouslySetInnerHTML={{ __html: state.svg }}
        />
        {expanded && (
          <MermaidLightbox
            svg={state.svg}
            theme={theme}
            onClose={() => setExpanded(false)}
          />
        )}
      </>
    )
  }

  if (state.status === 'error') {
    return <div className="mermaid-diagram mermaid-diagram-error">{source}</div>
  }

  return <div className="mermaid-diagram" aria-busy="true" />
}
