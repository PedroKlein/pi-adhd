# AGENTS.md

## What this is

Attention management extension for Pi. Sticky notes (session-scoped, pinnable), side-chat (btw replacement), and turn-count reminders. Standalone npm package, no hard deps on other Pi extensions.

## Repo structure

```
src/
├── index.ts              # Extension factory, commands, event hooks
├── config.ts             # Settings parser
├── notes/
│   ├── model.ts          # Note type, categories, icons
│   ├── store.ts          # In-memory CRUD + reminder counter
│   ├── capture.ts        # AI classification (BAML/LLM/heuristic)
│   ├── persistence.ts    # Pin save/load (~/.pi/adhd/)
│   ├── tui.ts            # Two-column viewer overlay
│   └── form.ts           # Preview/edit form overlay
├── chat/
│   ├── engine.ts         # LLM conversation (stream/complete)
│   ├── actions.ts        # 5 exit actions
│   └── tui.ts            # Chat overlay UI
└── reminders/
    ├── tracker.ts        # Turn-count logic
    └── shutdown.ts       # Session-end orphan overlay
```

## Design decisions

- Notes never enter LLM context. Purely user-facing.
- Session-scoped by default. Pin to persist.
- Separate TUIs for notes and chat (no tabs).
- Side-chat is a simple LLM conversation, no tools.
- BAML integration is optional (discovered at runtime via EventBus).
- btw extension is fully replaced by this package.

## Commands

| Command | Action |
|---------|--------|
| `/note` | Open notes TUI |
| `/note <text>` | Add a note |
| `/btw` | Blank side-chat |
| `/btw compact` | Side-chat with conversation context |
| `/btw explain` | Context + explain template |
| `/btw why` | Context + why template |
| `Ctrl+Shift+N` | Notes TUI |
| `Ctrl+Alt+B` | Side-chat |

## Config

`settings.json` under `"pi-adhd"` key. Only setting: `reminderTurns` (default 8).

## Conventions

- ESM only, strict TypeScript
- Pure functions where possible, side effects in index.ts
- Pi TUI primitives: Text, Key, matchesKey, Editor, BorderedLoader
- Overlays via ctx.ui.custom() with overlay: true
- IDs: crypto.randomUUID()
- File naming: kebab-case
