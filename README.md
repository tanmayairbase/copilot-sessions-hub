# Copilot Sessions Hub

Desktop Electron app (TypeScript + Node 24) that aggregates Copilot sessions from multiple repositories, provides full-text search in a resizable left sidebar, and renders selected session details in a chat-style main pane.

<img width="1398" height="901" alt="image" src="https://github.com/user-attachments/assets/274fa0f2-f7e5-48ab-b15c-183f029b8f09" />


## Features

- Sync sessions from configurable repository roots.
- Supports Copilot CLI, VS Code Copilot Chat, and OpenCode session discovery.
- Retains synced sessions locally across future syncs (historical sessions remain searchable even if later removed upstream).
- Search sessions by metadata and message text.
- Sidebar filters for repository/model/origin (multi-select) and IST date windows.
- Sessions not found in the latest sync are marked with an **Archived** badge.
- Local-only session archiving from the sidebar context menu (does not modify Copilot/VS Code/OpenCode data).
- Archived sessions are hidden by default, can be shown via an Archived filter, and appear in a collapsed archived-search section when search matches exist.
- Manually archived sessions auto-unarchive if upstream session activity changes on a later sync.
- During sync, manually archived sessions older than four months are pruned from local storage.
- Message-level starring for local bookmarks (user or assistant messages) in read-only detail view.
- Collapsed **Starred** sidebar section with quick jump back to the parent session/message.
- If a starred message target disappears upstream, bookmark is retained as a stale local entry.
- Resizable sidebar list and detail pane chat UI.
- **Read-only** session detail transcript (no in-app chatting/editing).
- Session metadata with model + timestamp formatting as `MMM DD, YYYY HH:mm IST`.
- Settings UI plus editable JSON config file.

## Prerequisites

- Node.js 24+
- pnpm 10+
- VS Code CLI on PATH (`code`) if you want one-click VS Code open action
- `gh` CLI installed/authenticated if you want one-click CLI open action

## Development

```bash
pnpm install
pnpm dev
```

This starts Electron with HMR for the renderer.

### Troubleshooting: `Error: Electron uninstall` on `pnpm dev`

If you see this error, the Electron binary was not downloaded yet.

Run:

```bash
pnpm run postinstall
```

Then retry:

```bash
pnpm dev
```

## Testing

```bash
pnpm test
```

Includes parser, formatter, and UI component tests with coverage.

## Lint and type-check

```bash
pnpm lint
pnpm typecheck
```

This repo also includes a root `tsconfig.json` and workspace VS Code TypeScript settings so the editor uses the same project graph and local TypeScript version as the CLI checks.

## Production build/package

Build app bundles:

```bash
pnpm build
```

Create distributables for current platform:

```bash
pnpm package
```

Artifacts are generated in `release/`.

## Configuration

Settings are stored in user data `config.json`.

Default repo roots on first run:

- `~/projects/airbase-frontend`
- `~/projects/frontend2`
- `~/projects`
- `~/projects/Airbase.Playwright.Automation.Suite`

You can edit config from:

- In-app **Settings** modal
- In-app **Open Config JSON** button

Config shape:

```json
{
  "repoRoots": ["/absolute/path/to/repo"],
  "discoveryMode": "both",
  "syncMode": "manual",
  "backgroundSyncIntervalMinutes": 10,
  "explicitPatterns": [
    "**/.copilot/**/*.{json,jsonl}",
    "**/.vscode/**/*copilot*.{json,jsonl}",
    "**/.github/copilot/**/*.{json,jsonl}"
  ]
}
```

- `discoveryMode: "autodiscovery"` uses built-in patterns.
- `discoveryMode: "explicit"` uses only `explicitPatterns`.
- `discoveryMode: "both"` combines both.
- `syncMode: "manual"` keeps sync user-triggered only.
- `syncMode: "manual-plus-background"` enables periodic background sync.
- `backgroundSyncIntervalMinutes` controls periodic sync cadence (1-1440).

Saving settings immediately updates config and triggers a sync.

## Logging

Detailed logs are written to:

- `<userData>/logs/app.log` (main process)
- Browser devtools console (renderer/UI actions)
