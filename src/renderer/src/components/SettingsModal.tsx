import React, { useEffect, useState } from 'react'
import type { AppConfig, DiscoveryMode } from '@shared/types'

interface Props {
  isOpen: boolean
  config: AppConfig | null
  onClose: () => void
  onSave: (next: AppConfig) => Promise<void>
}

export const SettingsModal = ({ isOpen, config, onClose, onSave }: Props) => {
  const [repoRoots, setRepoRoots] = useState('')
  const [explicitPatterns, setExplicitPatterns] = useState('')
  const [discoveryMode, setDiscoveryMode] = useState<DiscoveryMode>('both')
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    if (!config) {
      return
    }

    setRepoRoots(config.repoRoots.join('\n'))
    setExplicitPatterns(config.explicitPatterns.join('\n'))
    setDiscoveryMode(config.discoveryMode)
  }, [config])

  if (!isOpen) {
    return null
  }

  const submit = async (): Promise<void> => {
    setIsSaving(true)
    setSaveError(null)
    try {
      await onSave({
        repoRoots: repoRoots.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
        explicitPatterns: explicitPatterns.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
        discoveryMode
      })
      onClose()
    } catch (error) {
      setSaveError((error as Error).message)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Sync settings">
      <div className="modal">
        <h3>Sync Settings</h3>
        <p>This controls where session sync looks for data.</p>

        <label>
          Repository roots (one per line)
          <textarea value={repoRoots} onChange={(event) => setRepoRoots(event.target.value)} rows={6} />
        </label>

        <label>
          Discovery mode
          <select value={discoveryMode} onChange={(event) => setDiscoveryMode(event.target.value as DiscoveryMode)}>
            <option value="both">Both autodiscovery and explicit patterns</option>
            <option value="autodiscovery">Autodiscovery only</option>
            <option value="explicit">Explicit patterns only</option>
          </select>
        </label>

        <label>
          Explicit glob patterns (one per line)
          <textarea value={explicitPatterns} onChange={(event) => setExplicitPatterns(event.target.value)} rows={5} />
        </label>

        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" onClick={() => void submit()} disabled={isSaving || !config}>
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
        {saveError && <p className="modal-error">Save failed: {saveError}</p>}
      </div>
    </div>
  )
}
