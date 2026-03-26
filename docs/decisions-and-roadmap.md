# Decisions and Roadmap

## Current decisions

| Decision | Why | Consequence |
| --- | --- | --- |
| Keep the app **read-only** | Stays focused on review/search, not authoring | Users jump back to source tools to continue work |
| Keep data **local-first** | Simpler setup and lower privacy/ops risk | No built-in cross-machine sync |
| Use a **JSON store** instead of an app DB | Easy packaging, backup, and inspection | Scalability depends on caching, indexing, and rendering limits |
| **Retain synced history** even when upstream disappears | Recovering older context is a core value prop | The app needs archive/missing/prune rules |
| Make **manual archive local-only** | Avoid mutating upstream tools | Users can organize safely inside the app |
| Keep search **broad and local** | Simple, predictable, good enough for current scale | It is not semantic or rank-heavy search |
| Show timestamps in **IST** | Matches current product expectation | Not user-configurable today |
| Show CLI plan/autopilot only at the **message level** | Useful context without extra chrome | Metadata exists in storage but has narrow UI treatment |
| Force transcript links to the **external browser** | Avoid accidental in-app navigation | Electron never becomes a general link browser |
| Avoid exposing hidden **chain-of-thought** | Safety/privacy/product-fit reasons | Future activity views should stay with safe summaries only |

## Performance direction

The north star is that 10 sessions and 1,500 sessions should feel similar during normal use.

Current tactics already in place:

- cache-aware incremental sync
- in-memory search indexes
- detail LRU cache
- sidebar virtualization
- chunked transcript rendering
- sync queueing and prioritization

Likely future areas:

- better row measurement heuristics
- richer indexing if the JSON store becomes the bottleneck
- more memoization around expensive filter derivations
- more derived summaries to reduce repeated detail work

## Likely next product directions

### Rich activity timeline

Current recommended direction:

- keep the main transcript simple and read-only
- add a separate expandable **Activity** area
- group activity by assistant turn
- show tool calls, hooks, subagent handoffs, notifications, and safe reasoning summaries
- persist sanitized derived activity locally
- keep activity out of sidebar full-text search in the first version

### Better session titles

CLI titles should keep preferring strong summary metadata over long first-message-derived titles.

### Source expansion

New sources should still normalize into the shared model and preserve current search/detail expectations.

## Open questions

- should timezone become user-configurable?
- should the local store eventually move to SQLite or another indexed format?
- should archived retention become configurable?
- should activity metadata ever contribute session-level counters or badges?
- should there be a stronger forensic/debug mode for rich event inspection?

