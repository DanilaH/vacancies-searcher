# Next Task

Active task file:

- `docs/tasks/TASK-001-trusted-service-coverage.md`

## Goal

Continue trusted-service coverage for pending valid vacancy sites without broadening generic trust too far.

## Workflow

Use the new PM/Architect workflow:

1. Read `.agent/HANDOFF.md`.
2. Read `docs/STATUS.md`.
3. Read `docs/ROADMAP.md`.
4. Read the active task file.
5. Execute only the scope in that task file.
6. Stop at the review gate when complete.

## Prompt For Executor

```text
You are continuing work on c:\1Projects\job-tg-bot.

First read:
- .agent/HANDOFF.md
- .agent/CURRENT_STATE.md
- .agent/DECISIONS.md
- docs/STATUS.md
- docs/ROADMAP.md
- docs/tasks/TASK-001-trusted-service-coverage.md

Implement only TASK-001. Preserve trusted-service security invariants: exact-host trust, safe URL shapes, no redirects, DNS/private-IP checks, timeouts, response-size limits, definitive non-vacancy rejection, and temporary-failure fallback to Telegram-only ingestion.

Do not change Telegram callbacks, weekly UI, source polling, .env, or unrelated workflows. Add focused tests and run the checks listed in the task file. Stop at the review gate.
```
