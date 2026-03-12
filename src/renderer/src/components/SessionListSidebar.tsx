import React, { useEffect, useRef, useState } from 'react'
import type { SessionSource, SessionSummary } from '@shared/types'
import type { DateFilterPreset } from '@shared/format'
import { formatSessionOrigin, formatTimestampIST, toSearchPreview, toTildePath } from '@shared/format'

type DateFilterValue = DateFilterPreset | ''
type OriginFilterValue = SessionSource
type FilterMenu = 'repository' | 'model' | 'origin' | null

interface Props {
  sessions: SessionSummary[]
  selectedId: string | null
  onSelect: (id: string) => void
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
        <div className="filter-dropdown-menu" role="listbox" aria-multiselectable="true">
        {options.length === 0 && <p className="filter-empty">{emptyLabel}</p>}
        {options.map((option) => (
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
  selectedId,
  onSelect,
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
  hasActiveFilters
}: Props) => {
  const filterRootRef = useRef<HTMLDivElement>(null)
  const [openMenu, setOpenMenu] = useState<FilterMenu>(null)
  const [filtersExpanded, setFiltersExpanded] = useState(false)

  useEffect(() => {
    const onMouseDown = (event: MouseEvent): void => {
      if (filterRootRef.current?.contains(event.target as Node)) {
        return
      }
      setOpenMenu(null)
    }
    const onEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpenMenu(null)
      }
    }

    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('keydown', onEscape)
    return () => {
      window.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('keydown', onEscape)
    }
  }, [])

  const toggleMenu = (menu: Exclude<FilterMenu, null>): void => {
    setOpenMenu((current) => (current === menu ? null : menu))
  }
  const toggleFilters = (): void => {
    setFiltersExpanded((current) => {
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

  return (
    <aside className="sidebar">
      <div className="sidebar-search-wrap">
        <div className="sidebar-search-input-wrap">
          <input
            aria-label="Search sessions"
            className="sidebar-search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
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
          <button type="button" className="filters-toggle" aria-expanded={filtersExpanded} onClick={toggleFilters}>
            <span className="filters-toggle-icon-wrap">
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M4 6h16l-6 7v5l-4 2v-7z" />
              </svg>
              {hasActiveFilters && <span className="filters-active-dot" aria-hidden="true" />}
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
              onToggle={(value) => onToggleOrigin(value as OriginFilterValue)}
              formatOption={(origin) => formatSessionOrigin(origin as OriginFilterValue)}
              emptyLabel="No origins available"
              isOpen={openMenu === 'origin'}
              onOpen={toggleMenu}
            />
            <label className="filter-group">
              <span className="filter-label">Date</span>
              <select
                className="filter-select"
                value={dateFilter}
                onChange={(event) => onDateFilterChange(event.target.value as DateFilterValue)}
                aria-label="Date filter"
              >
                <option value="">All</option>
                <option value="today">Today</option>
                <option value="yesterday">Yesterday</option>
                <option value="last7">Last 7 days</option>
                <option value="last30">Last 30 days</option>
              </select>
            </label>
          </div>
        )}
      </div>

      <div className="session-list" role="listbox" aria-label="Session list">
        {sessions.map((session) => {
          const isActive = session.id === selectedId
          return (
            <button
              key={session.id}
              className={`session-item ${isActive ? 'active' : ''}`}
              onClick={() => onSelect(session.id)}
              type="button"
            >
              <div className="session-title">{toSearchPreview(session.title, 72)}</div>
              <div className="session-meta">
                {session.missingFromLastSync && <span className="session-archived-badge">Archived</span>}
                <span>{formatSessionOrigin(session.source)}</span>
                <span>{formatTimestampIST(session.updatedAt)}</span>
              </div>
              <div className="session-path">{toTildePath(session.repoPath)}</div>
            </button>
          )
        })}
        {sessions.length === 0 && <p className="empty-list">No sessions found. Try syncing or changing search.</p>}
      </div>
    </aside>
  )
}
