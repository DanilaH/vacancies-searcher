# AGENTS.md

## Project overview

This project is a Telegram vacancy bot. It collects job posts from Telegram channels and other sources, deduplicates them, filters them by user preferences, extracts contacts, and sends relevant vacancies to users.

## Tech stack

- Runtime: Node.js
- Language: TypeScript
- Package manager: npm
- Bot framework: grammY
- Database: SQLite via better-sqlite3
- Main app source: `src/`
- Configuration: `.env`
- Tests: Node.js test runner with tsx

## Important directories

- `src/bot/` — Telegram bot logic
- `src/services/` — business logic, filtering, matching, deduplication, discovery, reminders, and backups
- `src/sources/` — Telegram, hh.ru, and company-career vacancy sources
- `src/db/` — SQLite schema, persistence facade, and row mappers
- `src/runtime/` — runtime-editable settings
- `src/analytics/` — local analytics and optional PostHog forwarding
- `src/utils/` — shared utilities
- `tests/` — automated tests
- `docs/` — product, architecture, task, and operations documentation

## Commands

Use these commands when relevant:

- Install dependencies: `npm ci`
- Start dev mode: `npm run dev`
- Test: `npm test`
- Build: `npm run build`
- Type check: `npx tsc -p tsconfig.json --pretty false`

## Working rules

- Do not rewrite the whole project unless explicitly asked.
- Prefer small, targeted changes.
- Before changing architecture, explain the reason.
- Do not add production dependencies without confirmation.
- Do not edit `.env` secrets.
- Do not inspect `node_modules`, `dist`, `build`, lockfiles, or huge logs unless directly relevant.
- Prefer targeted searches with `rg` instead of reading the entire repository.
- Keep Telegram/RF deployment constraints in mind.
- If context is missing, inspect the smallest relevant set of files first.

## Code style

- Use TypeScript strictly.
- Prefer explicit types at module boundaries.
- Keep business logic separate from Telegram transport code.
- Keep parsing, filtering, deduplication, and delivery as separate concerns.
- Avoid silent error swallowing.
- Add comments only when they explain non-obvious behavior.

## Verification

Before finishing a task, run the smallest relevant checks:

1. Type check.
2. Relevant tests.
3. Build if the change affects runtime behavior.

If checks cannot be run, explain why and what was checked manually.

## Done means

A task is done only when:

- the requested behavior is implemented;
- related types are valid;
- no unrelated files were changed;
- the final response summarizes changed files, checks run, and remaining risks.

## Token discipline

- Do not read the whole repository without a reason.
- Do not paste large file contents into the response.
- Summarize large logs instead of copying them.
- Ask for or create a separate handoff file for long-running project context.


## Project context workflow

Before starting any non-trivial task:

1. Read `.agent/HANDOFF.md`.
2. Read `.agent/NEXT_TASK.md`.
3. Inspect only the files that are directly relevant to the task.
4. Do not scan the entire repository unless the context files are missing or clearly outdated.

After completing a meaningful change:

1. Summarize changed files.
2. Run relevant checks from `package.json`.
3. Update `.agent/HANDOFF.md` if architecture, commands, decisions, or known problems changed.
