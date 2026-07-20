# Project Roadmap

This is the working PM/Architect roadmap for agent execution. The product-level roadmap remains in `docs/product/ROADMAP.md`.

## Workflow

- One task file maps to one bounded diff.
- Executors work from `docs/tasks/TASK-XXX-*.md`.
- PM/Architect updates this file and `docs/STATUS.md` after a task is reviewed/accepted.
- Planner creates or updates task files before Executor work begins.
- Production code changes should not start without a task file unless the user explicitly requests a direct hotfix.

## Current Phase

Phase: source quality and vacancy relevance.

Goal: improve trusted vacancy enrichment, Telegram source catch-up, and user-facing diagnostics without broadening unsafe parsing or creating large mixed diffs.

## Completed Recently

- Compact vacancy cards and cleaner vacancy action keyboards.
- Weekly page size setting and compact weekly screen.
- Applied workflow with application follow-ups and notes.
- Daily Action Digest.
- Hidden reason feedback and conservative filter suggestions.
- Weekly drill-down/navigation smoothing.
- Telegram web preview catch-up after stale channel polling.
- Weekly feed 7/14/30-day windows.
- Trusted adapters for `finder.work` and `telegra.ph`.

## Active Backlog

1. `TASK-001`: Continue trusted-service coverage for pending safe vacancy sites.
2. Improve weekly/source diagnostics for "why no results" cases.
3. Improve multi-vacancy aggregate handling where one stop-word can block a whole post.
4. Add operational audit docs for local Telegram smoke testing.

## Dependency Map

- Trusted-service adapters depend on exact-host/path-shape decisions.
- Weekly/source diagnostics depend on current source health and rematch summaries.
- Multi-vacancy improvements should not run in parallel with source ingestion rewrites.
- Storage/schema changes require their own task file and migration tests.

## Parallelization Notes

Safe to parallelize:
- Documentation-only audit task with trusted-service adapter planning.
- Formatter-only diagnostics with non-overlapping source adapter work, if task files own separate files.

Do not parallelize:
- Two tasks touching `src/bot/createBot.ts`, `src/bot/keyboards.ts`, or callback flows.
- Storage/schema task with feature work depending on the same schema.
- Source polling changes with ingestion/rematcher changes unless one is read-only context.
