# Agent Project Map

This folder is a narrow entry point for future agents working on the bot.

Goal:
- help an agent understand where a task belongs before touching code;
- reduce accidental changes in unrelated layers;
- highlight dependency hotspots and safe starting points.

When this folder and an older broad project doc disagree, prefer this folder plus current `src/` and `tests/`. It is maintained as the narrow handoff surface for fresh agents.

Recommended reading order:
1. [../product/PROJECT_OVERVIEW.md](../product/PROJECT_OVERVIEW.md) when product context matters
2. [module-map.md](./module-map.md)
3. [task-routing.md](./task-routing.md)

## Current Product Shape

The project is a Telegram vacancy bot with these active capabilities:

- default source mode: public Telegram web preview pages `https://t.me/s/{channel}`;
- optional future source mode: MTProto;
- multi-user access model with `owner`, `admin`, `member`;
- up to five independent search profiles per user, plus combined and profile-specific weekly feeds;
- profile presets and first-run onboarding;
- onboarding flow for first-time users;
- runtime numeric settings stored in SQLite as overrides over `.env`;
- admin panel for channels, users, and runtime settings.

## Where To Start

Use this path first instead of opening the whole repo blindly:

- product entry point: [src/index.ts](../../src/index.ts)
- Telegram UI and routing: [src/bot/createBot.ts](../../src/bot/createBot.ts)
- Telegram reply markup/keyboards: [src/bot/keyboards.ts](../../src/bot/keyboards.ts)
- admin and panel formatting: [src/bot/admin.ts](../../src/bot/admin.ts)
- user-facing message formatting: [src/bot/formatters.ts](../../src/bot/formatters.ts)
- main storage facade: [src/db/database.ts](../../src/db/database.ts)
- DB schema/migrations: [src/db/schema.ts](../../src/db/schema.ts)
- DB row mapping: [src/db/rowMappers.ts](../../src/db/rowMappers.ts)
- ingestion pipeline: [src/services/vacancyIngestor.ts](../../src/services/vacancyIngestor.ts)
- matching logic: [src/services/vacancyFilter.ts](../../src/services/vacancyFilter.ts)
- sources: [src/sources](../../src/sources)

## High-Risk Files

These files have the biggest change blast radius:

- [src/db/database.ts](../../src/db/database.ts)
  Central persistence facade. A small change here can affect bot UI, sources, runtime settings, and tests.

- [src/db/schema.ts](../../src/db/schema.ts)
  SQLite schema and lightweight migrations. Keep migration ordering explicit, especially when adding indexes for new columns.

- [src/bot/createBot.ts](../../src/bot/createBot.ts)
  Main Telegram command and callback router. Menu, onboarding, notifications, and admin flows all meet here.

- [src/types.ts](../../src/types.ts)
  Shared contracts. Type changes usually cascade into services, DB mapping, and tests.

## Validation Commands

After any non-trivial change, run:

```bash
npm run build
npm test
npx tsc -p tsconfig.json
```

## Important Boundaries

- `src/index.ts` wires the app together but should stay thin.
- `src/db/database.ts` owns persistence operations; avoid putting business rules there unless they must be transactional.
- `src/db/schema.ts` owns DDL and migrations; do not duplicate schema SQL in `database.ts`.
- `src/db/rowMappers.ts` owns pure row-to-domain mapping; keep it free of DB access and config reads.
- `src/services/*` should hold business logic and source behavior.
- `src/bot/*` should focus on Telegram interaction and presentation.
- `src/bot/keyboards.ts` owns non-admin Telegram inline keyboards; keep routing and handler logic in `createBot.ts`.
- `dist/` is build output, not the place to patch source logic.
- If a task is only about text or layout, start in `src/bot/*` before opening `database.ts`.
