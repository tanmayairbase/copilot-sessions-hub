import { describe, expect, it } from 'vitest'
import {
  isOpenCodeInternalMetadataSession,
  normalizeOpenCodeSessionTitle
} from '../src/main/opencode'

describe('OpenCode session helpers', () => {
  it('extracts plain title text from JSON-wrapped session titles', () => {
    expect(
      normalizeOpenCodeSessionTitle('{"title":"Mileage Without Maps spec"}')
    ).toBe('Mileage Without Maps spec')
    expect(normalizeOpenCodeSessionTitle('Regular title')).toBe('Regular title')
  })

  it('detects internal metadata generator sessions', () => {
    expect(
      isOpenCodeInternalMetadataSession(
        [
          {
            id: 'message-1',
            session_id: 'session-1',
            time_created: 1,
            time_updated: 1,
            data: JSON.stringify({
              role: 'user',
              agent: 'build'
            })
          }
        ],
        new Map([
          [
            'message-1',
            [
              {
                id: 'part-1',
                message_id: 'message-1',
                time_created: 1,
                data: JSON.stringify({
                  type: 'text',
                  text:
                    'Generate metadata for a coding agent based on the user prompt.\nReturn JSON only.'
                })
              }
            ]
          ]
        ])
      )
    ).toBe(true)
  })

  it('does not misclassify normal build-agent sessions as internal metadata sessions', () => {
    expect(
      isOpenCodeInternalMetadataSession(
        [
          {
            id: 'message-1',
            session_id: 'session-1',
            time_created: 1,
            time_updated: 1,
            data: JSON.stringify({
              role: 'user',
              agent: 'build'
            })
          }
        ],
        new Map([
          [
            'message-1',
            [
              {
                id: 'part-1',
                message_id: 'message-1',
                time_created: 1,
                data: JSON.stringify({
                  type: 'text',
                  text:
                    'Can we check if UUID package is completely unused in the codebase and if so create a draft PR?'
                })
              }
            ]
          ]
        ])
      )
    ).toBe(false)
  })
})
