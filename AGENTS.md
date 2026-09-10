# Reader Project Instructions

## Required context

Before changing Reader V2 behavior, read:

1. `docs/plans/2026-08-19-reader-v2-refactor-plan.md`
2. `.pi/skills/reader-tdd/SKILL.md`
3. The rules relevant to the touched layer under `.claude/rules/`

## Pi-native TDD

This project uses the project-local Pi extension `.pi/extensions/reader-tdd.ts`, not the Claude Code `tdd-guardian` plugin.

For every feature, bug fix, parser, migration, adapter, security boundary, or Design System behavior:

1. Plan one small `WI-*` with observable acceptance criteria and non-goals.
2. Design behavior, boundary, failure, and adversarial tests before product implementation.
3. Add a focused failing test and invoke `tdd_red`; runner, dependency, compilation, and discovery failures are not valid red.
4. Implement the minimum green change, then refactor without weakening tests.
5. After the final file edit invoke `tdd_gate` or run `npm run test:tdd:gate`.
6. Do not call `goal_complete`, commit, push, open/merge a PR, or publish without a fresh gate receipt for the exact working tree.

Documentation, comments, CI, and TDD infrastructure may omit behavioral red, but executable helpers need tests and the final exact-tree gate still applies. Bypass requires explicit user approval.

Useful Pi commands: `/tdd-plan`, `/tdd-design`, `/tdd-implement`, `/tdd-review`, `/tdd-status`, `/tdd-gate`, and `/skill:reader-tdd`.

## Engineering defaults

- Prefer root-cause fixes and minimal focused diffs.
- Preserve local-first and offline core reading.
- For React + Tauri changes, verify both sides with contract/integration coverage.
- Do not initialize a repository above this project or modify source material outside it.
