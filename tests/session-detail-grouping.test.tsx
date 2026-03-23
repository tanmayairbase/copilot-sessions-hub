import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionDetail } from '../src/shared/types'
import { SessionDetailView } from '../src/renderer/src/components/SessionDetailView'

const detail: SessionDetail = {
  id: 's1',
  source: 'cli',
  repoPath: '/repos/a',
  title: 'Session title',
  agent: 'security-upgrade-agent',
  model: 'copilot/gpt-5.3-codex',
  createdAt: '2026-03-11T10:00:00.000Z',
  updatedAt: '2026-03-11T10:05:00.000Z',
  messageCount: 4,
  filePath: '/repos/a/events.jsonl',
  openVscodeTarget: '/repos/a/events.jsonl',
  openCliCwd: '/repos/a',
  messages: [
    {
      id: 'm1',
      sessionId: 's1',
      role: 'assistant',
      content: 'line one',
      format: 'text',
      timestamp: '2026-03-11T10:00:10.000Z'
    },
    {
      id: 'm2',
      sessionId: 's1',
      role: 'assistant',
      content: 'line two',
      format: 'text',
      timestamp: '2026-03-11T10:00:40.000Z'
    },
    {
      id: 'm3',
      sessionId: 's1',
      role: 'user',
      content: 'Use `pnpm build` before deploy.',
      format: 'text',
      timestamp: '2026-03-11T10:01:00.000Z',
      references: [
        { path: '/repos/a/src/index.tsx', startLine: 48, endLine: 52 }
      ]
    },
    {
      id: 'm4',
      sessionId: 's1',
      role: 'assistant',
      content: 'answer',
      format: 'text',
      timestamp: '2026-03-11T10:02:00.000Z',
      edits: [
        {
          path: '/repos/a/src/index.tsx',
          startLine: 88,
          endLine: 88,
          addedLines: 1,
          removedLines: 1
        }
      ]
    }
  ]
}

describe('SessionDetailView grouping', () => {
  afterEach(() => {
    cleanup()
  })

  it('combines contiguous messages with same role and HH:mm into one bubble', () => {
    render(<SessionDetailView detail={detail} />)

    const assistantBubbles = screen.getAllByLabelText('assistant message')
    expect(assistantBubbles).toHaveLength(2)
    expect(screen.getByText('Origin: CLI')).toBeTruthy()
    expect(screen.getByText('Agent: security-upgrade-agent')).toBeTruthy()
    expect(screen.getByText('Model: gpt-5.3-codex')).toBeTruthy()
    expect(screen.getByText('index.tsx:48-52')).toBeTruthy()
    expect(screen.getByText('Edited index.tsx +1 -1 (88-88)')).toBeTruthy()
    expect(screen.getByText('pnpm build')).toBeTruthy()
    expect(screen.getByText(/line one/)).toBeTruthy()
    expect(screen.getByText(/line two/)).toBeTruthy()
    expect(screen.queryByText('Read-only transcript')).toBeNull()
  })

  it('triggers copy callback from header icon button', () => {
    const onCopySessionId = vi.fn()
    render(
      <SessionDetailView detail={detail} onCopySessionId={onCopySessionId} />
    )

    fireEvent.click(screen.getByLabelText('Copy session ID'))
    expect(onCopySessionId).toHaveBeenCalledWith('s1')
  })

  it('shows chunked transcript loading controls for large sessions', () => {
    const start = new Date('2026-03-11T00:00:00.000Z').getTime()
    const largeDetail: SessionDetail = {
      ...detail,
      id: 's-large',
      messageCount: 260,
      messages: Array.from({ length: 260 }).map((_, index) => ({
        id: `m-large-${index + 1}`,
        sessionId: 's-large',
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: `line ${index + 1}`,
        format: 'text',
        timestamp: new Date(start + index * 60_000).toISOString()
      }))
    }

    render(<SessionDetailView detail={largeDetail} />)
    expect(screen.getByText('line 260')).toBeTruthy()
    expect(screen.queryByText('line 1')).toBeNull()
    expect(screen.getByText(/Load older messages/)).toBeTruthy()

    fireEvent.click(screen.getByText(/Load older messages/))
    expect(screen.getByText('line 1')).toBeTruthy()
  })
})
