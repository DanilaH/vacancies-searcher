# Project Status

Last updated: 2026-07-07

## Current State

The bot is an existing TypeScript/Node.js Telegram vacancy bot with SQLite storage. It collects vacancies from Telegram web preview and optional sources, deduplicates them, matches them against per-user search profiles, and sends Telegram notifications plus weekly/status screens.

The detailed engineering handoff remains in `.agent/CURRENT_STATE.md`.

## Completed Recently

- Telegram web preview catch-up after channel polling is stale.
- Valid no-text Telegram preview posts now advance observed cursors.
- Weekly feed supports 7/14/30-day windows and preserves the selected window through vacancy-card return navigation.
- Settings, weekly, hidden reason, applied workflow, daily digest, and navigation UX improvements are implemented and verified.

## In Progress

- Planning workflow bootstrap.

## Next Task

`docs/tasks/TASK-001-trusted-service-coverage.md`

Continue trusted-service coverage for pending valid vacancy sites without broadening generic trust too far.

## Risks

- Git metadata is unavailable in the current workspace, so branch/diff enforcement must be handled by the user or a fresh git-enabled workspace.
- `.env` exists locally and must not be printed, committed, or copied into docs.
- Some task prompts assume feature branches; this workspace currently reports `fatal: not a git repository`.
- Broad trusted domains can create false positives if whole-host trust is added. Keep path-scoped guards.
- Telegram source behavior depends on public `t.me/s` HTML shape and may break if Telegram changes markup.

## Decisions Needed

- Whether `.agent/NEXT_TASK.md` remains a full task description or becomes a pointer to the active `docs/tasks/TASK-XXX` file.
- Whether Planner/Executor agents should be instructed to refuse production-code work when no task file exists.
- Whether manual Telegram QA uses the live local bot or a separate test bot.

## Parallelization Watch

- Do not run multiple tasks that edit bot callbacks/keyboards at the same time.
- Do not combine storage migrations with unrelated UI work.
- Trusted-service adapter work can run separately from documentation/audit work.
- Source polling changes should not run in parallel with ingestion/rematcher changes unless ownership is explicit.

## Verification Baseline

Use these checks for most implementation tasks:

```powershell
npm test
npm run build
npx tsc -p tsconfig.json --pretty false
```
