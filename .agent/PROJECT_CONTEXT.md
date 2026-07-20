# Project Context

## Product Goal

Job Telegram Bot collects vacancies from Telegram channels and optional external sources, stores them once in local SQLite, and matches them against each user's personal search profiles.

Primary value:

- Reduce noise from Telegram job channels, reposts, resumes, ads, and duplicates.
- Give users personalized real-time notifications and a 7-day weekly feed.
- Support several independent searches per user, for example main frontend work plus no-experience side work.
- Stay practical for local use by the owner and a small group, not a high-scale SaaS yet.

Core principle:

```text
fetch once -> store once -> match many
```

Sources are global. Matching, statuses, language mode, reminders, and filters are per-user.

## Architecture

Runtime:

- Node.js >= 20, TypeScript, grammy Telegram bot framework.
- SQLite via `better-sqlite3`.
- Main entrypoint: `src/index.ts`.
- Config/env parsing: `src/config.ts`.
- Default source mode: Telegram web preview, not MTProto.

Data flow:

```text
SourcePoller
-> source.fetch()
-> RawVacancyItem[]
-> Telegram multi-vacancy splitter
-> trusted external enrichment when allowed
-> VacancyIngestor
-> SQLite raw_messages / vacancies dedupe
-> per-user/per-profile VacancyFilter
-> Telegram notification and /week feed
```

Sources:

- `telegram_web_preview`: default, reads public `https://t.me/s/{channel}` pages.
- `telegram_mtproto`: optional polling mode, requires Telegram API credentials and session.
- Channel discovery can use MTProto if env is present, but also works without MTProto through mention graph and manual batches.
- `hh_api`: implemented but user-facing buttons are hidden for now.
- `companyCareersSource`: optional independent polling of manually added company careers pages.
- Trusted vacancy services: not independent sources. They only enrich links found inside Telegram vacancies.

Bot UI:

- `src/bot/createBot.ts` is the composition/root router.
- UI helpers are split into `keyboards.ts`, `formatters.ts`, `onboardingFlow.ts`, `userPanels.ts`, `inputFlows.ts`, `render.ts`, and `admin.ts`.
- Admin-specific UI remains mostly behind `src/bot/admin.ts`.

Database:

- `src/db/database.ts` is the public facade used by the app.
- `src/db/schema.ts` owns base schema and migrations.
- `src/db/rowMappers.ts` owns row-to-domain mappers.
- Do not bypass `VacancyDatabase` in app code unless writing a one-off diagnostic script.

## Important Files

Entrypoints and config:

- `src/index.ts`: process startup, services, pollers, bot launch.
- `src/config.ts`: env parsing and validation.
- `README.md`: operational docs and feature overview.
- `.env.example`: env reference.

Bot layer:

- `src/bot/createBot.ts`: command/callback registration and orchestration.
- `src/bot/access.ts`: public auto-registration and blocked-user guard.
- `src/bot/onboardingFlow.ts`: intro, setup, presets, language step, completion.
- `src/bot/userPanels.ts`: personal panels, weekly, filters, settings, reminders.
- `src/bot/inputFlows.ts`: pending text input flows.
- `src/bot/keyboards.ts`: inline keyboard builders.
- `src/bot/formatters.ts`: user-facing text formatters.

Services:

- `src/services/vacancyIngestor.ts`: raw ingest, dedupe, fan-out matching, notifications.
- `src/services/vacancyFilter.ts`: per-profile matching rules and rejection reasons.
- `src/services/candidatePostDetection.ts`: resume/candidate-post filtering.
- `src/services/vacancyDetailsExtractor.ts`: presentation-only vacancy card extraction.
- `src/services/telegramMultiVacancySplitter.ts`: split aggregator posts into child vacancies.
- `src/services/externalVacancyEnricher.ts`: trusted-service fetch and parse.
- `src/services/trustedVacancyServices.ts`: trusted URL normalization, host detection, URL-shape helpers.
- `src/services/userVacancyRematcher.ts`: rematch existing vacancies after profile changes.
- `src/services/channelDiscovery.ts`: owner-triggered channel discovery.
- `src/services/channelDiscoveryProviders.ts`: mention graph, manual seed, optional MTProto/DuckDuckGo providers.
- `src/services/companyCareerUrls.ts`: company career URL safety helpers.
- `src/services/actionCooldown.ts`: in-memory heavy-action cooldowns.

Sources:

- `src/sources/telegramWebPreviewSource.ts`: public Telegram web preview parsing and channel cursor/backoff.
- `src/sources/telegramMtprotoSource.ts`: optional MTProto source.
- `src/sources/hhApiSource.ts`: hidden/experimental hh.ru source.
- `src/sources/companyCareersSource.ts`: optional company/ATS source.

DB:

- `src/db/schema.ts`: schema, migrations, seeded trusted services.
- `src/db/database.ts`: facade and SQL methods.
- `src/db/rowMappers.ts`: mappers.

Docs:

- `docs/product/PROJECT_OVERVIEW.md`: product overview.
- `docs/product/ROADMAP.md`: roadmap.
- `docs/product/QUESTIONS_AND_IDEAS.md`: open ideas.
- `docs/agent-map/README.md`: task routing for future agents.
- `docs/agent-map/module-map.md`: module map.

Tests most relevant to trusted services/adapters:

- `tests/trustedVacancyServices.test.ts`
- `tests/trustedVacancyIngestor.test.ts`
- `tests/databaseMigration.test.ts`
- `tests/telegramMultiVacancySplitter.test.ts`
- `tests/multiVacancyRepair.test.ts`

## Commands

Install:

```powershell
npm install
```

Run locally:

```powershell
npm run dev
```

Build:

```powershell
npm run build
```

Tests:

```powershell
npm test
```

Strict typecheck:

```powershell
npx tsc -p tsconfig.json --pretty false
```

Generate Telegram MTProto session:

```powershell
$env:TELEGRAM_API_ID="123456"
$env:TELEGRAM_API_HASH="your_api_hash"
npm run auth:telegram
```

Analyze vacancy card extraction:

```powershell
npm run analyze:vacancy-cards
```

Repair old structured multi-vacancy aggregator posts:

```powershell
npm run repair:multi-vacancy-posts -- --days=30
npm run repair:multi-vacancy-posts -- --days=30 --apply
```

Local Windows helpers:

```powershell
npm run local:run
npm run local:install
npm run local:status
npm run local:uninstall
```

Healthcheck after build:

```powershell
npm run build
npm run healthcheck
```

## Constraints

- Do not rewrite the bot layer or DB layer for a focused task.
- Do not change callback data, command scopes, analytics event names, or DB semantics without explicit reason.
- Do not add dependencies without user approval.
- Do not introduce external AI/API calls for vacancy parsing unless explicitly approved.
- Do not relax trusted-service security.
- Do not store Telegram API secrets or sessions in SQLite.
- Do not expose backup/user-management actions to `admin`; they are owner-only.
- Do not make per-user filters influence source polling.
- Do not trust broad domains generically when only a path is safe.
- Do not auto-add channels from discovery; owner approval is required.
- Do not run `npm run dev` casually during tests if a real `.env` is present; it may poll live Telegram and send messages.
- Preserve existing tests and add focused tests for parser/security behavior.
