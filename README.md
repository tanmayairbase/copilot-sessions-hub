# Copilot Sessions Hub

Desktop Electron app (TypeScript + Node 24) that aggregates Copilot sessions from multiple repositories, provides full-text search in a resizable left sidebar, and renders selected session details in a chat-style main pane.

<img width="1398" height="901" alt="image" src="https://github.com/user-attachments/assets/274fa0f2-f7e5-48ab-b15c-183f029b8f09" />

## Pain points this app addresses

- Copilot session history is fragmented across tools and repositories, with no single place to browse it.
- Past prompts, responses, and decisions are hard to rediscover once a session is closed.
- There is no reliable full-text search across both user prompts and Copilot responses across all sessions.
- Session history can disappear after retention limits, making older conversations hard or impossible to revisit later.
- As session volume grows, history becomes noisy and harder to organize without filtering, starring, and archiving.

## Features

- Aggregates sessions from Copilot CLI, VS Code Copilot Chat, and OpenCode into one desktop view.
- Syncs from configurable repository roots and keeps synced history locally for later rediscovery.
- Provides full-text search plus repository, model, origin, date, archived, and starred filters.
- Renders a read-only chat-style session detail view with model metadata, IST timestamps, and external-link support.
- Supports local organization with starring, archiving, archived history handling, and quick jumps back to important messages.
- Includes a resizable sidebar, settings UI, editable JSON config, and optional background sync.

## Documentation

Contributor-focused architecture and implementation docs live in [`docs/`](docs/README.md).

Start with:

- [`docs/README.md`](docs/README.md)
- [`docs/runtime-architecture.md`](docs/runtime-architecture.md)
- [`docs/sync-and-storage.md`](docs/sync-and-storage.md)
- [`docs/ui-and-interactions.md`](docs/ui-and-interactions.md)

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
