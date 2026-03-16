import React, { useEffect, useRef, useState } from 'react'
import type {
  SessionSource,
  SessionSummary,
  StarredMessageSummary
} from '@shared/types'
import type { DateFilterPreset } from '@shared/format'
import {
  formatSessionOrigin,
  formatTimestampIST,
  toSearchPreview,
  toTildePath
} from '@shared/format'

type DateFilterValue = DateFilterPreset | ''
type OriginFilterValue = SessionSource
type FilterMenu = 'repository' | 'model' | 'origin' | null
export type ArchivedFilterValue = 'hide' | 'show' | 'only'
export type StarredFilterValue = 'all' | 'only'

interface Props {
  sessions: SessionSummary[]
  starredMessages: StarredMessageSummary[]
  archivedSearchMatches: SessionSummary[]
  selectedId: string | null
  onSelect: (id: string) => void
  onSelectStarredMessage: (sessionId: string, messageId: string) => void
  onSetArchived: (sessionId: string, archived: boolean) => void
  query: string
  onQueryChange: (query: string) => void
  onClearFilters: () => void
  repoOptions: string[]
  selectedRepos: string[]
  onToggleRepo: (repoPath: string) => void
  modelOptions: string[]
  selectedModels: string[]
  onToggleModel: (model: string) => void
  originOptions: OriginFilterValue[]
  selectedOrigins: OriginFilterValue[]
  onToggleOrigin: (origin: OriginFilterValue) => void
  dateFilter: DateFilterValue
  onDateFilterChange: (value: DateFilterValue) => void
  archivedFilter: ArchivedFilterValue
  onArchivedFilterChange: (value: ArchivedFilterValue) => void
  starredFilter: StarredFilterValue
  onStarredFilterChange: (value: StarredFilterValue) => void
  hasActiveFilters: boolean
}

interface MultiSelectProps {
  menuId: Exclude<FilterMenu, null>
  label: string
  options: string[]
  selected: string[]
  onToggle: (value: string) => void
  formatOption?: (value: string) => string
  emptyLabel: string
  isOpen: boolean
  onOpen: (menu: Exclude<FilterMenu, null>) => void
}

const MultiSelectFilter = ({
  menuId,
  label,
  options,
  selected,
  onToggle,
  formatOption,
  emptyLabel,
  isOpen,
  onOpen
}: MultiSelectProps) => {
  return (
    <div className="filter-group">
      <span className="filter-label">{label}</span>
      <button
        type="button"
        className="filter-trigger"
        onClick={() => onOpen(menuId)}
        aria-expanded={isOpen}
        aria-label={`${label} filter`}
      >
        {selected.length > 0 ? `${selected.length} selected` : 'All'}
      </button>
      {isOpen && (
        <div
          className="filter-dropdown-menu"
          role="listbox"
          aria-multiselectable="true"
        >
          {options.length === 0 && <p className="filter-empty">{emptyLabel}</p>}
          {options.map(option => (
            <label key={option} className="filter-option">
              <input
                type="checkbox"
                checked={selected.includes(option)}
                onChange={() => onToggle(option)}
                aria-label={`${label}: ${option}`}
              />
              <span>{formatOption ? formatOption(option) : option}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

export const SessionListSidebar = ({
  sessions,
  starredMessages,
  archivedSearchMatches,
  selectedId,
  onSelect,
  onSelectStarredMessage,
  onSetArchived,
  query,
  onQueryChange,
  onClearFilters,
  repoOptions,
  selectedRepos,
  onToggleRepo,
  modelOptions,
  selectedModels,
  onToggleModel,
  originOptions,
  selectedOrigins,
  onToggleOrigin,
  dateFilter,
  onDateFilterChange,
  archivedFilter,
  onArchivedFilterChange,
  starredFilter,
  onStarredFilterChange,
  hasActiveFilters
}: Props) => {
  const filterRootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [openMenu, setOpenMenu] = useState<FilterMenu>(null)
  const [filtersExpanded, setFiltersExpanded] = useState(false)
  const [starredExpanded, setStarredExpanded] = useState(false)
  const [archivedExpanded, setArchivedExpanded] = useState(false)
  const [contextMenu, setContextMenu] = useState<{
    sessionId: string
    x: number
    y: number
    archived: boolean
  } | null>(null)

  useEffect(() => {
    const onMouseDown = (event: MouseEvent): void => {
      if (filterRootRef.current?.contains(event.target as Node)) {
        return
      }
      setOpenMenu(null)
      if (menuRef.current?.contains(event.target as Node)) {
        return
      }
      setContextMenu(null)
    }
    const onEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpenMenu(null)
        setContextMenu(null)
      }
    }

    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('keydown', onEscape)
    return () => {
      window.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('keydown', onEscape)
    }
  }, [])

  useEffect(() => {
    setStarredExpanded(false)
    setArchivedExpanded(false)
  }, [query])

  const toggleMenu = (menu: Exclude<FilterMenu, null>): void => {
    setOpenMenu(current => (current === menu ? null : menu))
  }
  const toggleFilters = (): void => {
    setFiltersExpanded(current => {
      if (current) {
        setOpenMenu(null)
      }
      return !current
    })
  }
  const clearFilters = (): void => {
    onClearFilters()
    setOpenMenu(null)
  }
  const showArchivedSection =
    query.trim().length > 0 &&
    archivedFilter === 'hide' &&
    archivedSearchMatches.length > 0

  const renderSessionRow = (
    session: SessionSummary,
    options?: { forceArchivedStyle?: boolean }
  ) => {
    const isActive = session.id === selectedId
    const isArchived = Boolean(
      session.userArchived || options?.forceArchivedStyle
    )

    return (
      <button
        key={session.id}
        className={`session-item ${isActive ? 'active' : ''} ${isArchived ? 'archived' : ''}`}
        onClick={() => onSelect(session.id)}
        onContextMenu={event => {
          event.preventDefault()
          setContextMenu({
            sessionId: session.id,
            x: event.clientX,
            y: event.clientY,
            archived: Boolean(session.userArchived)
          })
        }}
        type="button"
      >
        <div className="session-title">
          {toSearchPreview(session.title, 72)}
        </div>
        <div className="session-meta">
          {(session.userArchived || session.missingFromLastSync) && (
            <span className="session-archived-badge">Archived</span>
          )}
          <span>{formatSessionOrigin(session.source)}</span>
          <span>{formatTimestampIST(session.updatedAt)}</span>
        </div>
        <div className="session-path">{toTildePath(session.repoPath)}</div>
      </button>
    )
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-search-wrap">
        <div className="sidebar-search-input-wrap">
          <input
            aria-label="Search sessions"
            className="sidebar-search"
            value={query}
            onChange={event => onQueryChange(event.target.value)}
            placeholder="Search messages, title, repo, model"
          />
          {query.trim().length > 0 && (
            <button
              type="button"
              className="sidebar-search-clear"
              onClick={() => onQueryChange('')}
              aria-label="Clear search"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M18.3 5.71L12 12l6.3 6.29-1.42 1.42L10.59 13.4 4.29 19.7l-1.42-1.41L9.17 12 2.87 5.71 4.29 4.3l6.3 6.3 6.29-6.3z" />
              </svg>
            </button>
          )}
        </div>

        <div className="filters-toolbar">
          <button
            type="button"
            className="filters-toggle"
            aria-expanded={filtersExpanded}
            onClick={toggleFilters}
          >
            <span className="filters-toggle-icon-wrap">
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M4 6h16l-6 7v5l-4 2v-7z" />
              </svg>
              {hasActiveFilters && (
                <span className="filters-active-dot" aria-hidden="true" />
              )}
            </span>
            <span>Filters</span>
          </button>
          <button
            type="button"
            className="filters-clear"
            onClick={clearFilters}
            disabled={!hasActiveFilters}
            aria-label="Clear filters"
          >
            Clear
          </button>
        </div>

        {filtersExpanded && (
          <div className="filters-row" ref={filterRootRef}>
            <MultiSelectFilter
              menuId="repository"
              label="Repository"
              options={repoOptions}
              selected={selectedRepos}
              onToggle={onToggleRepo}
              formatOption={toTildePath}
              emptyLabel="No repositories configured"
              isOpen={openMenu === 'repository'}
              onOpen={toggleMenu}
            />
            <MultiSelectFilter
              menuId="model"
              label="Model"
              options={modelOptions}
              selected={selectedModels}
              onToggle={onToggleModel}
              emptyLabel="No model values yet"
              isOpen={openMenu === 'model'}
              onOpen={toggleMenu}
            />
            <MultiSelectFilter
              menuId="origin"
              label="Origin"
              options={originOptions}
              selected={selectedOrigins}
              onToggle={value => onToggleOrigin(value as OriginFilterValue)}
              formatOption={origin =>
                formatSessionOrigin(origin as OriginFilterValue)
              }
              emptyLabel="No origins available"
              isOpen={openMenu === 'origin'}
              onOpen={toggleMenu}
            />
            <label className="filter-group">
              <span className="filter-label">Date</span>
              <select
                className="filter-select"
                value={dateFilter}
                onChange={event =>
                  onDateFilterChange(event.target.value as DateFilterValue)
                }
                aria-label="Date filter"
              >
                <option value="">All</option>
                <option value="today">Today</option>
                <option value="yesterday">Yesterday</option>
                <option value="last7">Last 7 days</option>
                <option value="last30">Last 30 days</option>
              </select>
            </label>
            <label className="filter-group">
              <span className="filter-label">Archived</span>
              <select
                className="filter-select"
                value={archivedFilter}
                onChange={event =>
                  onArchivedFilterChange(
                    event.target.value as ArchivedFilterValue
                  )
                }
                aria-label="Archived filter"
              >
                <option value="hide">Hide archived</option>
                <option value="show">Show archived</option>
                <option value="only">Only archived</option>
              </select>
            </label>
            <label className="filter-group">
              <span className="filter-label">Starred</span>
              <select
                className="filter-select"
                value={starredFilter}
                onChange={event =>
                  onStarredFilterChange(
                    event.target.value as StarredFilterValue
                  )
                }
                aria-label="Starred filter"
              >
                <option value="all">All sessions</option>
                <option value="only">Only starred</option>
              </select>
            </label>
          </div>
        )}
      </div>

      <div
        className={`session-list ${starredMessages.length === 0 ? 'session-list-no-starred' : ''}`}
        role="listbox"
        aria-label="Session list"
      >
        {starredMessages.length > 0 && (
          <section
            className={`starred-section ${starredExpanded ? 'expanded' : ''}`}
            aria-label="Starred messages"
          >
            <button
              type="button"
              className="starred-toggle"
              aria-expanded={starredExpanded}
              onClick={() => setStarredExpanded(value => !value)}
            >
              <span>Starred ({starredMessages.length})</span>
              <span>{starredExpanded ? '▾' : '▸'}</span>
            </button>
            {starredExpanded && (
              <div className="starred-list">
                {starredMessages.map(star => (
                  <button
                    key={`${star.sessionId}:${star.messageId}`}
                    type="button"
                    className={`starred-item ${star.stale ? 'stale' : ''}`}
                    onClick={() =>
                      onSelectStarredMessage(star.sessionId, star.messageId)
                    }
                  >
                    <div className="starred-item-top">
                      <span className="starred-item-role">
                        {star.role === 'user' ? 'You' : 'Copilot'}
                      </span>
                      {star.stale && (
                        <span className="starred-item-stale">Stale</span>
                      )}
                    </div>
                    <div className="starred-item-content">
                      {toSearchPreview(star.content, 92)}
                    </div>
                    <div className="starred-item-meta">
                      <span>{toSearchPreview(star.sessionTitle, 48)}</span>
                      <span>{formatTimestampIST(star.timestamp)}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}
        {sessions.map(session => renderSessionRow(session))}
        {showArchivedSection && (
          <section
            className="archived-search-section"
            aria-label="Archived search matches"
          >
            <button
              type="button"
              className="archived-search-toggle"
              aria-expanded={archivedExpanded}
              onClick={() => setArchivedExpanded(value => !value)}
            >
              <span>Archived matches ({archivedSearchMatches.length})</span>
              <span>{archivedExpanded ? '▾' : '▸'}</span>
            </button>
            {archivedExpanded && (
              <div className="archived-search-list">
                {archivedSearchMatches.map(session =>
                  renderSessionRow(session, { forceArchivedStyle: true })
                )}
              </div>
            )}
          </section>
        )}
        {sessions.length === 0 && !showArchivedSection && (
          <p className="empty-list">
            No sessions found. Try syncing or changing search.
          </p>
        )}
      </div>
      {contextMenu && (
        <div
          ref={menuRef}
          className="session-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          role="menu"
          aria-label="Session actions"
        >
          <button
            type="button"
            role="menuitem"
            className="session-context-item"
            onClick={() => {
              onSetArchived(contextMenu.sessionId, !contextMenu.archived)
              setContextMenu(null)
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M4 4h16v4H4z" />
              <path d="M5 9h14v11H5z" />
            </svg>
            <span>
              {contextMenu.archived ? 'Unarchive session' : 'Archive session'}
            </span>
          </button>
        </div>
      )}
    </aside>
  )
}
