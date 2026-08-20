---
description: Execute one Reader work item using red-green-refactor
argument-hint: "<WI-id>"
---
Load `/skill:reader-tdd` and execute only $ARGUMENTS.

Confirm its acceptance criteria and matrix. Add a focused failing behavioral test, obtain a valid `tdd_red` receipt, write the minimum product implementation, make focused tests green, then refactor without weakening tests. Do not start another work item. Run `tdd_gate` only after all final edits.
