# Reader AI Entry

Follow project instructions in:

1. `AGENTS.md`
2. `.claude/rules/`
3. `.claude/commands/`
4. `.claude/README.md`

Execution defaults:

- Root-cause fixes over surface patches.
- Keep diffs minimal and focused.
- For cross-layer changes (React + Tauri), verify both sides.
- Run:
  - `npm run build`
  - `cargo check --manifest-path src-tauri/Cargo.toml`
