import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AppConfig } from '../src/shared/types'
import { SettingsModal } from '../src/renderer/src/components/SettingsModal'

const baseConfig: AppConfig = {
  repoRoots: ['/Users/me/projects/frontend2'],
  discoveryMode: 'both',
  explicitPatterns: ['**/.copilot/**/*.json']
}

describe('SettingsModal', () => {
  it('saves updated repo roots', async () => {
    const onClose = vi.fn()
    const onSave = vi.fn(async () => undefined)

    render(
      <SettingsModal
        isOpen={true}
        config={baseConfig}
        onClose={onClose}
        onSave={onSave}
      />
    )

    fireEvent.change(screen.getByLabelText('Repository roots (one per line)'), {
      target: { value: '/Users/me/projects/airbase-frontend' }
    })

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({
        repoRoots: ['/Users/me/projects/airbase-frontend'],
        discoveryMode: 'both',
        explicitPatterns: ['**/.copilot/**/*.json']
      })
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })
})
