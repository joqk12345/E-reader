---
description: Adversarially review Reader changes before the final gate
argument-hint: "[WI-id or scope]"
---
Load `/skill:reader-tdd`. Review the current diff for ${ARGUMENTS:-the active work item}. Check alignment with the Reader V2 plan, red receipt separation, assertion strength, missing boundaries, mock-only tests, security regressions, migration safety, and accidental scope expansion. Fix deficiencies through another red-green cycle. After the final edit, invoke `tdd_gate` and report the exact-tree result.
