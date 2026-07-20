# AGENTS.md

## Project overview

This project is a Telegram vacancy bot. It collects job posts from Telegram channels and other sources, deduplicates them, filters them by user preferences, extracts contacts, and sends relevant vacancies to users.

## Tech stack

- Runtime: Node.js
- Language: TypeScript
- Package manager: pnpm
- Main app source: `src/`
- Configuration: `.env`
- Tests: use the existing project test setup

## Important directories

- `src/bot/` — Telegram bot logic
- `src/parsers/` — source parsers and post extraction
- `src/filters/` — keyword filtering, matching, deduplication
- `src/storage/` — database/storage layer
- `src/config/` — env parsing and app config
- `docs/` — project notes and architecture docs

Update this section if the real structure differs.

## Commands

Use these commands when relevant:

- Install dependencies: `pnpm install`
- Start dev mode: `pnpm dev`
- Build: `pnpm build`
- Lint: `pnpm lint`
- Type check: `pnpm typecheck`
- Test: `pnpm test`

If a command does not exist in `package.json`, inspect `package.json` and use the actual available command instead.

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
2. Lint if available.
3. Tests if available.
4. Build if the change affects runtime behavior.

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
