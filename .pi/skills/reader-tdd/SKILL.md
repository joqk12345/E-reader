---
name: reader-tdd
description: Pi-native test-driven workflow and quality gates for Reader V2. Use for every feature, bug fix, parser, publication, locator, database migration, reader adapter, security boundary, or Design System behavior change.
compatibility: Requires the Reader repository scripts, Node.js, npm, Cargo, and the project-local reader-tdd Pi extension.
---

# Reader V2 TDD

Use the project-local Pi tools `tdd_red` and `tdd_gate`; do not invoke Claude Code plugin commands.

## Cycle

1. Read `docs/plans/2026-08-19-reader-v2-refactor-plan.md` and identify the exact milestone and invariant affected.
2. Create one 15–60 minute `WI-*` with observable acceptance criteria, layers, risks, and explicit non-goals.
3. Design a test matrix covering happy path, boundaries, malformed input/failure, and applicable round-trip/idempotency/order/security invariants.
4. Add the smallest focused test. Run `tdd_red` with the focused command. Compilation, missing dependency, discovery failure, and zero tests are not valid red.
5. Only after a valid receipt, edit product implementation until the focused test is green.
6. Refactor without weakening specification lines or changing behavior.
7. Run focused tests, then `tdd_gate` after the final file edit. Do not call `goal_complete`, commit, push, create/merge a PR, or publish unless the exact-tree gate receipt is valid.

Bug fixes always begin with a test that reproduces the bug.

## Reader invariants

- Preserve publication resources and nested navigation; never flatten EPUB structure as a shortcut.
- Locator behavior must support CFI plus href/quote fallback and survive layout/theme changes.
- Publication loading must reject traversal, oversized archives, scripts, disallowed resources, and remote fetches.
- Migrations must be idempotent, transactional, and retain old data on failure.
- Mocked Tauri, SQLite, filesystem, foliate-js, or WebView boundaries require a named future or present integration counterpart.
- Design System behavior includes keyboard, ARIA, focus, disabled/loading/error, contrast, and reduced motion.

## Lanes

- Guardian: `npm run test:tdd:guardian`
- EPUB fixture registry: `npm run test:fixtures`
- Frontend: `npm run test:unit:coverage`
- Rust: `npm run test:rust`
- Exact-tree full gate: `npm run test:tdd:gate` or the `tdd_gate` tool

Coverage is a no-decrease ratchet from the honest legacy baseline. Never improve it by shrinking discovery, excluding touched files, deleting tests, or weakening assertions.

## Exceptions

Documentation, comments, CI, and TDD infrastructure may omit behavioral red. State the exemption, test any executable helper itself, and still run `tdd_gate`. `TDD_GUARD_BYPASS=1` requires explicit user confirmation through the Pi extension.
