# Execution Roadmap

The canonical product priorities live in `docs/product/ROADMAP.md`. This file only translates that order into bounded agent work. It must not invent or reorder product priorities.

## Workflow

- One bounded task maps to one branch and one pull request.
- Executors work from `docs/tasks/TASK-XXX-*.md` or an equally explicit user-approved task.
- Every branch starts from the current `master`.
- Executors stop after opening a PR; review and merge are separate.
- A task moves to completed only after merge into `master`.
- After every accepted task, update `docs/STATUS.md` and `.agent/NEXT_TASK.md`.
- Keep exactly one active implementation task unless the user explicitly authorizes parallel non-overlapping work.

## Current phase

Phase: source quality and vacancy relevance.

Goal: finish a short, conservative trusted-service cycle, then switch from adding sources to validating the complete Telegram experience and diagnosing source/matching quality.

## Active task

### Trusted adapter for `job.mts.ru`

Status: in progress in a separate executor branch.

Scope:

- confirm real vacancy URLs and page structure;
- add a narrow adapter only if the safety case is defensible;
- keep the service `pending` until admin review;
- cover URL guard, parser, ingestion, migration and temporary failures;
- produce a research-only result if a safe adapter cannot be justified.

Parent task: `docs/tasks/TASK-001-trusted-service-coverage.md`.

## Queued tasks

Execute in this order after the active task is reviewed and merged:

1. Finish or deliberately stop the short trusted-adapter cycle. Evaluate the next domain one at a time; do not commit to every pending domain in advance.
2. Create and run a manual Telegram smoke checklist using a test bot/chat.
3. Improve weekly/source diagnostics for “why no results”.
4. Fix remaining multi-vacancy aggregate isolation problems.
5. Add channel quality analytics for owner.
6. Consolidate relevance feedback into a measurable quality loop.
7. Observe real usage before opening hh.ru UI, localization or monetization work.

Each queued item needs its own bounded task file before production work begins.

## Completed recently

- Fuzzy near-duplicate grouping with per-user suppression and owner report.
- Toggleable instant notifications.
- Night quiet hours with persistent queue, retry/backoff and dead-letter.
- Trusted adapter for `ingamejob.com`.
- JSON-LD-only trusted adapter for `designer.ru`.
- Compact vacancy cards, weekly navigation and per-user page size.
- Applied workflow, notes and follow-ups.
- Daily Action Digest.
- Hidden reason feedback and conservative filter suggestions.
- Telegram catch-up and weekly 7/14/30-day windows.

## Parallelization rules

Safe:

- documentation-only roadmap/audit work alongside a trusted-adapter branch;
- read-only research that does not mutate the same task files.

Do not parallelize:

- two adapters that both modify trusted-service enums, schema and migrations;
- two tasks touching the same Telegram callbacks/keyboards;
- schema work with another branch that depends on the same schema;
- source polling changes with ingestion rewrites.

## Verification baseline

For production changes:

```bash
npm test
npx tsc -p tsconfig.json --pretty false
npm run build
```

Documentation-only changes require link, consistency and diff review; they do not require runtime tests.
