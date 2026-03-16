import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionSummary } from '../src/shared/types'
import { SessionListSidebar } from '../src/renderer/src/components/SessionListSidebar'

const sessions: SessionSummary[] = [
  {
    id: '1',
    source: 'cli',
    repoPath: '/repos/a',
    title: 'Implement auth parser',
    model: 'gpt-5.3-codex',
    createdAt: '2026-03-10T10:00:00.000Z',
    updatedAt: '2026-03-10T10:30:00.000Z',
    messageCount: 4,
    filePath: '/repos/a/.copilot/session1.json',
    openVscodeTarget: '/repos/a/.copilot/session1.json',
    openCliCwd: '/repos/a'
  }
]

const archivedSession: SessionSummary = {
  ...sessions[0],
  id: '2',
  title: 'Archived parser notes',
  userArchived: true
}

describe('SessionListSidebar', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders sessions and supports search, selection, and filters', () => {
    const onSelect = vi.fn()
    const onQueryChange = vi.fn()
    const onToggleRepo = vi.fn()
    const onToggleModel = vi.fn()
    const onToggleOrigin = vi.fn()
    const onDateFilterChange = vi.fn()
    const onClearFilters = vi.fn()

    render(
        <SessionListSidebar
          sessions={sessions}
          archivedSearchMatches={[]}
          selectedId={null}
          onSelect={onSelect}
          onSetArchived={vi.fn()}
          query=""
          onQueryChange={onQueryChange}
        onClearFilters={onClearFilters}
        repoOptions={['/repos/a', '/repos/b']}
        selectedRepos={[]}
        onToggleRepo={onToggleRepo}
        modelOptions={['gpt-5.3-codex', 'claude-sonnet-4.5']}
        selectedModels={[]}
        onToggleModel={onToggleModel}
        originOptions={['vscode', 'cli', 'opencode']}
        selectedOrigins={[]}
        onToggleOrigin={onToggleOrigin}
          dateFilter=""
          onDateFilterChange={onDateFilterChange}
          archivedFilter="hide"
          onArchivedFilterChange={vi.fn()}
          hasActiveFilters={false}
        />
    )

    fireEvent.click(screen.getByText('Implement auth parser'))
    expect(onSelect).toHaveBeenCalledWith('1')

    fireEvent.change(screen.getByLabelText('Search sessions'), { target: { value: 'auth' } })
    expect(onQueryChange).toHaveBeenCalledWith('auth')

    expect(screen.queryByLabelText('Repository filter')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }))

    fireEvent.click(screen.getByLabelText('Repository filter'))
    fireEvent.click(screen.getByLabelText('Repository: /repos/a'))
    expect(onToggleRepo).toHaveBeenCalledWith('/repos/a')

    fireEvent.click(screen.getByLabelText('Model filter'))
    fireEvent.click(screen.getByLabelText('Model: gpt-5.3-codex'))
    expect(onToggleModel).toHaveBeenCalledWith('gpt-5.3-codex')

    fireEvent.click(screen.getByLabelText('Origin filter'))
    fireEvent.click(screen.getByLabelText('Origin: vscode'))
    expect(onToggleOrigin).toHaveBeenCalledWith('vscode')

    fireEvent.change(screen.getByLabelText('Date filter'), { target: { value: 'last7' } })
    expect(onDateFilterChange).toHaveBeenCalledWith('last7')
  })

  it('shows clear-search button only when query exists and clears search', () => {
    const onQueryChange = vi.fn()
    render(
      <SessionListSidebar
        sessions={sessions}
        archivedSearchMatches={[]}
        selectedId={null}
        onSelect={vi.fn()}
        onSetArchived={vi.fn()}
        query="auth"
        onQueryChange={onQueryChange}
        onClearFilters={vi.fn()}
        repoOptions={['/repos/a']}
        selectedRepos={[]}
        onToggleRepo={vi.fn()}
        modelOptions={['gpt-5.3-codex']}
        selectedModels={[]}
        onToggleModel={vi.fn()}
        originOptions={['vscode', 'cli', 'opencode']}
        selectedOrigins={[]}
        onToggleOrigin={vi.fn()}
        dateFilter=""
        onDateFilterChange={vi.fn()}
        archivedFilter="hide"
        onArchivedFilterChange={vi.fn()}
        hasActiveFilters={false}
      />
    )

    fireEvent.click(screen.getByLabelText('Clear search'))
    expect(onQueryChange).toHaveBeenCalledWith('')
  })

  it('closes an open dropdown when clicking outside filters', () => {
    render(
      <SessionListSidebar
        sessions={sessions}
        archivedSearchMatches={[]}
        selectedId={null}
        onSelect={vi.fn()}
        onSetArchived={vi.fn()}
        query=""
        onQueryChange={vi.fn()}
        onClearFilters={vi.fn()}
        repoOptions={['/repos/a']}
        selectedRepos={[]}
        onToggleRepo={vi.fn()}
        modelOptions={['gpt-5.3-codex']}
        selectedModels={[]}
        onToggleModel={vi.fn()}
        originOptions={['vscode', 'cli', 'opencode']}
        selectedOrigins={[]}
        onToggleOrigin={vi.fn()}
        dateFilter=""
        onDateFilterChange={vi.fn()}
        archivedFilter="hide"
        onArchivedFilterChange={vi.fn()}
        hasActiveFilters={false}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Filters' }))
    fireEvent.click(screen.getByLabelText('Repository filter'))
    expect(screen.getByLabelText('Repository: /repos/a')).toBeTruthy()

    fireEvent.mouseDown(document.body)
    expect(screen.queryByLabelText('Repository: /repos/a')).toBeNull()
  })

  it('shows active filter indicator when filters are applied', () => {
    const onClearFilters = vi.fn()
    const { container } = render(
      <SessionListSidebar
        sessions={sessions}
        archivedSearchMatches={[]}
        selectedId={null}
        onSelect={vi.fn()}
        onSetArchived={vi.fn()}
        query=""
        onQueryChange={vi.fn()}
        onClearFilters={onClearFilters}
        repoOptions={['/repos/a']}
        selectedRepos={['/repos/a']}
        onToggleRepo={vi.fn()}
        modelOptions={['gpt-5.3-codex']}
        selectedModels={[]}
        onToggleModel={vi.fn()}
        originOptions={['vscode', 'cli', 'opencode']}
        selectedOrigins={[]}
        onToggleOrigin={vi.fn()}
        dateFilter=""
        onDateFilterChange={vi.fn()}
        archivedFilter="hide"
        onArchivedFilterChange={vi.fn()}
        hasActiveFilters={true}
      />
    )

    expect(container.querySelector('.filters-active-dot')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(onClearFilters).toHaveBeenCalledTimes(1)
  })

  it('shows archived badge for sessions missing from latest sync', () => {
    render(
      <SessionListSidebar
        sessions={[{ ...sessions[0], missingFromLastSync: true }]}
        archivedSearchMatches={[]}
        selectedId={null}
        onSelect={vi.fn()}
        onSetArchived={vi.fn()}
        query=""
        onQueryChange={vi.fn()}
        onClearFilters={vi.fn()}
        repoOptions={['/repos/a']}
        selectedRepos={[]}
        onToggleRepo={vi.fn()}
        modelOptions={['gpt-5.3-codex']}
        selectedModels={[]}
        onToggleModel={vi.fn()}
        originOptions={['vscode', 'cli', 'opencode']}
        selectedOrigins={[]}
        onToggleOrigin={vi.fn()}
        dateFilter=""
        onDateFilterChange={vi.fn()}
        archivedFilter="hide"
        onArchivedFilterChange={vi.fn()}
        hasActiveFilters={false}
      />
    )

    expect(screen.getByText('Archived')).toBeTruthy()
  })

  it('shows collapsed archived search section and expands on click', () => {
    render(
      <SessionListSidebar
        sessions={sessions}
        archivedSearchMatches={[archivedSession]}
        selectedId={null}
        onSelect={vi.fn()}
        onSetArchived={vi.fn()}
        query="parser"
        onQueryChange={vi.fn()}
        onClearFilters={vi.fn()}
        repoOptions={['/repos/a']}
        selectedRepos={[]}
        onToggleRepo={vi.fn()}
        modelOptions={['gpt-5.3-codex']}
        selectedModels={[]}
        onToggleModel={vi.fn()}
        originOptions={['vscode', 'cli', 'opencode']}
        selectedOrigins={[]}
        onToggleOrigin={vi.fn()}
        dateFilter=""
        onDateFilterChange={vi.fn()}
        archivedFilter="hide"
        onArchivedFilterChange={vi.fn()}
        hasActiveFilters={false}
      />
    )

    expect(screen.getByText('Archived matches (1)')).toBeTruthy()
    expect(screen.queryByText('Archived parser notes')).toBeNull()
    fireEvent.click(screen.getByText('Archived matches (1)'))
    expect(screen.getByText('Archived parser notes')).toBeTruthy()
  })

  it('opens context menu and archives session', () => {
    const onSetArchived = vi.fn()
    render(
      <SessionListSidebar
        sessions={sessions}
        archivedSearchMatches={[]}
        selectedId={null}
        onSelect={vi.fn()}
        onSetArchived={onSetArchived}
        query=""
        onQueryChange={vi.fn()}
        onClearFilters={vi.fn()}
        repoOptions={['/repos/a']}
        selectedRepos={[]}
        onToggleRepo={vi.fn()}
        modelOptions={['gpt-5.3-codex']}
        selectedModels={[]}
        onToggleModel={vi.fn()}
        originOptions={['vscode', 'cli', 'opencode']}
        selectedOrigins={[]}
        onToggleOrigin={vi.fn()}
        dateFilter=""
        onDateFilterChange={vi.fn()}
        archivedFilter="hide"
        onArchivedFilterChange={vi.fn()}
        hasActiveFilters={false}
      />
    )

    fireEvent.contextMenu(screen.getByText('Implement auth parser'))
    fireEvent.click(screen.getByText('Archive session'))
    expect(onSetArchived).toHaveBeenCalledWith('1', true)
  })

  it('shows unarchive action for archived sessions', () => {
    const onSetArchived = vi.fn()
    render(
      <SessionListSidebar
        sessions={[archivedSession]}
        archivedSearchMatches={[]}
        selectedId={null}
        onSelect={vi.fn()}
        onSetArchived={onSetArchived}
        query=""
        onQueryChange={vi.fn()}
        onClearFilters={vi.fn()}
        repoOptions={['/repos/a']}
        selectedRepos={[]}
        onToggleRepo={vi.fn()}
        modelOptions={['gpt-5.3-codex']}
        selectedModels={[]}
        onToggleModel={vi.fn()}
        originOptions={['vscode', 'cli', 'opencode']}
        selectedOrigins={[]}
        onToggleOrigin={vi.fn()}
        dateFilter=""
        onDateFilterChange={vi.fn()}
        archivedFilter="show"
        onArchivedFilterChange={vi.fn()}
        hasActiveFilters={true}
      />
    )

    fireEvent.contextMenu(screen.getByText('Archived parser notes'))
    fireEvent.click(screen.getByText('Unarchive session'))
    expect(onSetArchived).toHaveBeenCalledWith('2', false)
  })
})
