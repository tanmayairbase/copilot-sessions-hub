import { useEffect, useState } from 'react'
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
      <div
        className="mermaid-diagram"
        data-mermaid-theme={theme}
        dangerouslySetInnerHTML={{ __html: state.svg }}
      />
    )
  }

  if (state.status === 'error') {
    return <div className="mermaid-diagram mermaid-diagram-error">{source}</div>
  }

  return <div className="mermaid-diagram" aria-busy="true" />
}
