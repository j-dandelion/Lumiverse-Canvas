# Changelog

## v1.1.0 — 2026-06-02

### Added
- Slash-command runtime: type `/command args` in the main chat input to
  invoke registered commands. Built-in commands: `/help`, `/select`.
- Cross-extension registry: other extensions can register commands via
  `canvas:slash-register` CustomEvent. See
  `references/slash-command-extension-api.md`.

### /select scope (v1.1.0)
- `/select <range>` — select a range of messages (e.g., `/select 5-10`).
- `/select all` — select all currently loaded messages.
- `/select clear` — clear the current selection.
- `/select hide|unhide|delete <range>` — DEFERRED to v1.2.0.

### Migration from Chronicle v1.1.0
- The `/select <range>` feature that shipped in Chronicle v1.1.0 (released
  2026-06-01) is now in Canvas. Update Chronicle to v1.0.5 to drop the
  duplicate implementation. See `chronicle_ext/AGENTS.md` for the revert
  note.
