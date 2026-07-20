# TASK-XXX: short name

## Context

Why this task exists, what already works, and which modules/files it touches.

## Goal

One concrete outcome.

## Scope

What the Executor may change.

## Out of Scope

What the Executor must not change.

## Files Likely Affected

- `path/to/file`

## Files Ownership

Writable ownership:
- `path/to/file`

Read-only context:
- `path/to/file`

No ownership:
- `path/to/file`

## Dependencies

What must be completed or decided before starting.

## Parallelization Risks

What this task must not run in parallel with.

## Implementation Notes

Practical guidance for the Executor without over-constraining the implementation.

## Acceptance Criteria

- [ ] Criteria are observable and testable.

## Checks

```powershell
npm test
npm run build
npx tsc -p tsconfig.json --pretty false
```

## Manual QA

Telegram/manual checks, if relevant. Use fake data only.

## Review Gate

After completion, the Executor must stop and report:

```text
Feature complete. I will not continue until review.

Branch: ...
Commit: ...
Pushed: yes/no

Changed files:
- ...

Checks:
- ...

Manual QA:
- ...

Notes:
- ...
```
