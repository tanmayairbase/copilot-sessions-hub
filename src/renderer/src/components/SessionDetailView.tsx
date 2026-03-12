import React from 'react'
import AnsiToHtml from 'ansi-to-html'
import { marked } from 'marked'
import type { SessionDetail, SessionMessage } from '@shared/types'
import { formatMinuteKeyIST, formatSessionOrigin, formatTimestampIST } from '@shared/format'

const ansiConverter = new AnsiToHtml({ fg: '#e6edf3', bg: '#161b22', newline: true, escapeXML: true })

const renderAssistantContent = (content: string): string => {
  if (content.includes('\u001b[')) {
    return `<pre class="ansi-output">${ansiConverter.toHtml(content)}</pre>`
  }

  return marked.parse(content, { breaks: true }) as string
}

interface Props {
  detail: SessionDetail | null
  onCopySessionId?: (sessionId: string) => Promise<void> | void
}

interface MessageGroup {
  id: string
  role: SessionMessage['role']
  combinedContent: string
  timestamp: string
  references: NonNullable<SessionMessage['references']>
  edits: NonNullable<SessionMessage['edits']>
}

const toFileLabel = (path: string): string => {
  const normalized = path.replaceAll('\\', '/')
  return normalized.split('/').at(-1) || path
}

const groupMessagesByMinute = (messages: SessionMessage[]): MessageGroup[] => {
  const groups: MessageGroup[] = []

  for (const message of messages) {
    const minuteKey = formatMinuteKeyIST(message.timestamp)
    const last = groups[groups.length - 1]
    const lastMinuteKey = last ? formatMinuteKeyIST(last.timestamp) : ''

    if (last && last.role === message.role && lastMinuteKey === minuteKey) {
      last.combinedContent = `${last.combinedContent}\n\n${message.content}`
      if (message.references) {
        for (const reference of message.references) {
          const key = `${reference.path}:${reference.startLine ?? ''}:${reference.endLine ?? ''}`
          const exists = last.references.some(
            (item) => `${item.path}:${item.startLine ?? ''}:${item.endLine ?? ''}` === key
          )
          if (!exists) {
            last.references.push(reference)
          }
        }
      }
      if (message.edits) {
        for (const edit of message.edits) {
          const existing = last.edits.find((item) => item.path === edit.path)
          if (existing) {
            existing.addedLines = (existing.addedLines ?? 0) + (edit.addedLines ?? 0)
            existing.removedLines = (existing.removedLines ?? 0) + (edit.removedLines ?? 0)
            if (edit.startLine !== undefined) {
              existing.startLine =
                existing.startLine !== undefined ? Math.min(existing.startLine, edit.startLine) : edit.startLine
            }
            if (edit.endLine !== undefined) {
              existing.endLine = existing.endLine !== undefined ? Math.max(existing.endLine, edit.endLine) : edit.endLine
            }
          } else {
            last.edits.push(edit)
          }
        }
      }
      continue
    }

    groups.push({
      id: message.id,
      role: message.role,
      combinedContent: message.content,
      timestamp: message.timestamp,
      references: message.references ? [...message.references] : [],
      edits: message.edits ? [...message.edits] : []
    })
  }

  return groups
}

export const SessionDetailView = ({ detail, onCopySessionId }: Props) => {
  if (!detail) {
    return (
      <section className="detail empty-state">
        <h2>Select a session</h2>
        <p>Pick a session from the left sidebar to see details.</p>
      </section>
    )
  }

  return (
    <section className="detail">
      <header className="detail-header">
        <div className="detail-title-wrap">
          <h2 title={detail.title}>{detail.title}</h2>
          <div className="detail-meta">
            <span>Origin: {formatSessionOrigin(detail.source)}</span>
            <span>Model: {detail.model ?? 'Unknown'}</span>
            <span>Updated: {formatTimestampIST(detail.updatedAt)}</span>
            <span>Messages: {detail.messageCount}</span>
          </div>
        </div>
        <button
          type="button"
          className="detail-copy-session-id"
          aria-label="Copy session ID"
          title={`Copy session ID: ${detail.id}`}
          onClick={() => {
            void onCopySessionId?.(detail.id)
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M9 9h10v12H9z" />
            <path d="M5 3h10v3H8v9H5z" />
          </svg>
        </button>
      </header>

      <div className="message-thread">
        {groupMessagesByMinute(detail.messages).map((message) => (
          <article
            key={message.id}
            className={`message ${message.role === 'user' ? 'message-user' : 'message-assistant'}`}
            aria-label={`${message.role} message`}
          >
            <div className="message-role">{message.role === 'user' ? 'You' : 'Copilot'}</div>
            {message.references.length > 0 && (
              <div className="message-artifacts">
                {message.references.map((reference) => {
                  const label =
                    reference.startLine && reference.endLine
                      ? `${toFileLabel(reference.path)}:${reference.startLine}-${reference.endLine}`
                      : toFileLabel(reference.path)
                  return (
                    <span key={`${reference.path}:${reference.startLine ?? ''}:${reference.endLine ?? ''}`} className="message-artifact-chip">
                      {label}
                    </span>
                  )
                })}
              </div>
            )}
            {message.edits.length > 0 && (
              <div className="message-artifacts">
                {message.edits.map((edit) => {
                  const lineRange =
                    edit.startLine && edit.endLine ? ` (${edit.startLine}-${edit.endLine})` : ''
                  const added = edit.addedLines ?? 0
                  const removed = edit.removedLines ?? 0
                  const delta = added > 0 || removed > 0 ? ` +${added} -${removed}` : ''
                  return (
                    <span key={`edit:${edit.path}`} className="message-artifact-chip">
                      Edited {toFileLabel(edit.path)}
                      {delta}
                      {lineRange}
                    </span>
                  )
                })}
              </div>
            )}
            <div className="message-content">
              {message.role === 'assistant' ? (
                <div dangerouslySetInnerHTML={{ __html: renderAssistantContent(message.combinedContent) }} />
              ) : (
                <pre>{message.combinedContent}</pre>
              )}
            </div>
            <time className="message-time">{formatTimestampIST(message.timestamp)}</time>
          </article>
        ))}
      </div>
    </section>
  )
}
