# Module Map

## Runtime Flow

Main startup path:

1. [src/index.ts](../../src/index.ts)
2. [src/config.ts](../../src/config.ts)
3. [src/db/database.ts](../../src/db/database.ts)
4. [src/runtime/runtimeSettings.ts](../../src/runtime/runtimeSettings.ts)
5. [src/bot/createBot.ts](../../src/bot/createBot.ts)
6. [src/sources/index.ts](../../src/sources/index.ts)
7. [src/services/sourcePoller.ts](../../src/services/sourcePoller.ts)
8. [src/services/vacancyIngestor.ts](../../src/services/vacancyIngestor.ts)
9. [src/services/vacancyFilter.ts](../../src/services/vacancyFilter.ts)

Simplified flow:

```txt
config
  -> database init
  -> owner bootstrap / channel bootstrap
  -> runtime settings
  -> bot controller
  -> vacancy sources
  -> pollers
  -> ingestor
  -> database writes
  -> per-user matching
  -> Telegram notifications
```

## Source And Delivery Pipeline

Source side:

- [src/sources/telegramWebPreviewSource.ts](../../src/sources/telegramWebPreviewSource.ts)
  Default production source for public Telegram channels. It also preserves HTML link order and delegates high-confidence aggregate splitting before cursor filtering.

- [src/sources/telegramMtprotoSource.ts](../../src/sources/telegramMtprotoSource.ts)
  Optional future source mode. Keep isolated from `web` mode changes unless the task explicitly mentions MTProto.

- [src/sources/hhApiSource.ts](../../src/sources/hhApiSource.ts)
  Optional hh.ru API source. Reads enabled per-user hh filters, groups identical requests, and returns raw items with eligible user ids.

- [src/sources/companyCareersSource.ts](../../src/sources/companyCareersSource.ts)
  Optional company careers source. Reads owner-managed company sites and ATS boards, then returns normal raw vacancy items with canonical job URLs.

- [src/services/sourcePoller.ts](../../src/services/sourcePoller.ts)
  Repeats source fetch cycles, reacts to dynamic interval updates, emits empty-cycle notifications.

Processing side:

- [src/services/vacancyIngestor.ts](../../src/services/vacancyIngestor.ts)
  Optionally enriches trusted external vacancy links, saves raw messages once, then evaluates them per active user profile.

- [src/services/telegramMultiVacancySplitter.ts](../../src/services/telegramMultiVacancySplitter.ts)
  Pure high-confidence splitter for linked Telegram aggregator posts. Child items keep the parent numeric cursor and Telegram URL.

- [src/services/externalVacancyEnricher.ts](../../src/services/externalVacancyEnricher.ts)
  Safely fetches active exact-host trusted services and parses specialized, JobPosting JSON-LD, or conservative HTML vacancy details.

- [src/services/trustedVacancyServices.ts](../../src/services/trustedVacancyServices.ts)
  Trusted-service URL normalization, adapter detection, DNS/public-IP safety checks, and exact-host policy.

- [src/services/vacancyFilter.ts](../../src/services/vacancyFilter.ts)
  Matching logic for per-user search profiles.

- [src/services/multiProfileMatching.ts](../../src/services/multiProfileMatching.ts)
  Evaluates a vacancy against every active profile and builds one deduplicated user-level match.

- [src/services/contactExtractor.ts](../../src/services/contactExtractor.ts)
  Extracts Telegram usernames, emails, and external URLs from vacancy text.

- [src/services/vacancyDetailsExtractor.ts](../../src/services/vacancyDetailsExtractor.ts)
  Pure heuristic extractor for compact vacancy notification fields such as role, company, salary, format, geography, grade, and stack. It does not reject vacancies or persist extracted values.

- [src/services/actionCooldown.ts](../../src/services/actionCooldown.ts)
  In-memory cooldown primitive used by the bot router to protect explicit rematch and channel discovery actions.

- [src/services/vacancyReminderScheduler.ts](../../src/services/vacancyReminderScheduler.ts)
  Persistent vacancy reminder delivery loop. Due dates are calculated by `vacancyReminderSchedule.ts`; reminder state and retries live in SQLite.

- [src/services/automaticBackup.ts](../../src/services/automaticBackup.ts)
  Creates retained local SQLite snapshots at startup and on a configurable interval. It only cleans its own `auto-backup-*.db` files.

## Bot UI Layer

- [src/bot/createBot.ts](../../src/bot/createBot.ts)
  Main bot router and composition root. Commands/callback handlers live here, but panel rendering, onboarding flow, keyboards, and pending text input should stay in smaller bot modules when possible.

- [src/bot/keyboards.ts](../../src/bot/keyboards.ts)
  Non-admin Telegram inline keyboards and reply markup builders. Use this for menu/button layout changes before touching handlers.

- [src/bot/render.ts](../../src/bot/render.ts)
  Small `replyOrEdit` helper for panel modules that can either reply or edit an existing Telegram message.

- [src/bot/userPanels.ts](../../src/bot/userPanels.ts)
  User-facing panels and vacancy-list surfaces: start panel, settings, notification preferences, personal filters, hh settings, weekly/status pages, blocked weekly screen, and vacancy action helpers.

- [src/bot/onboardingFlow.ts](../../src/bot/onboardingFlow.ts)
  Onboarding state-to-screen orchestration and pure onboarding step helpers. Prefer this file for onboarding UX changes before touching `createBot.ts`.

- [src/bot/inputFlows.ts](../../src/bot/inputFlows.ts)
  Pending text input flows for profile blocks, hh filters, channel input, runtime settings, users, company career sources, trusted vacancy services, custom discovery, and manual discovery seed batches.
- `src/services/channelDiscovery.ts` and `channelDiscoveryProviders.ts`
  Candidate validation/scoring plus pluggable mention-graph, manual-seed, optional MTProto, and experimental DuckDuckGo discovery providers. Runs execute as a single background job with persisted progress, restart recovery, and per-profile least-recently-checked rotation. Automatic runs exclude manual seeds; batch verification checks only the submitted list.

- [src/bot/admin.ts](../../src/bot/admin.ts)
  Admin and settings panel text + keyboards. This is the safest first stop for panel copy and layout tasks.

- [src/bot/formatters.ts](../../src/bot/formatters.ts)
  User-facing messages such as start text, compact/full vacancy cards, weekly digest, empty-cycle notice, and startup diagnostic.

- [src/bot/access.ts](../../src/bot/access.ts)
  Access control middleware. Change here only when task is about allowlist, privacy, or access rules.

## Storage Layer

Core files:

- [src/db/database.ts](../../src/db/database.ts)
  Persistence facade. Keeps the SQLite connection lifecycle, public DAO methods, transactions, bootstrap/default records, and domain SQL queries.

- [src/db/schema.ts](../../src/db/schema.ts)
  Schema creation and lightweight migrations. This is the first file to inspect for DDL changes or migration ordering bugs.

- [src/db/rowMappers.ts](../../src/db/rowMappers.ts)
  Pure row-to-domain mapping helpers and SQLite row types. It should not access the database or read config.

The storage layer owns:

- user access records;
- multi-profile persistence and profile-level vacancy matches;
- runtime settings persistence;
- channel registry;
- vacancy storage and deduplication;
- per-user vacancy match storage.

Main tables:

- `bot_users`
  Access list and roles.

- `user_settings`
  Per-user runtime flags such as onboarding state and notification preferences.

- `user_search_profiles`
  Up to five named search profiles per user, including language and pause state.

- `user_vacancy_profile_matches`
  Profile-level evidence behind one deduplicated `user_vacancy_matches` record.

- `user_hh_search_settings`
  Per-user hh.ru source filters and enabled flag.

- `hh_user_vacancy_candidates`
  Eligibility bridge showing which hh vacancies were produced by which user's hh query.

- `user_keywords`
  Personal keyword storage still used for bootstrap/default profile building and keyword-specific UX.

- `monitored_channels`
  Runtime source registry.

- `raw_messages`
  One row per fetched source post.

- `vacancies`
  Deduplicated vacancy candidates stored globally.

- `trusted_vacancy_services`
  Exact-host allowlist and probe state for external pages linked from vacancies. It is separate from independently polled `company_career_sources`.

- `user_vacancy_matches`
  Per-user match rows and delivery state.

- `app_settings`
  Numeric runtime overrides over `.env`.

- `app_state`
  Small global runtime markers used by the application core.

## Hotspots And Dependency Chains

### 1. Search profile changes

If a task changes the meaning or shape of a user profile, expect to touch:

- [src/types.ts](../../src/types.ts)
- [src/db/database.ts](../../src/db/database.ts)
- [src/services/vacancyFilter.ts](../../src/services/vacancyFilter.ts)
- [src/bot/createBot.ts](../../src/bot/createBot.ts)
- [src/bot/admin.ts](../../src/bot/admin.ts)
- search profile tests in [tests](../../tests)

### 2. Onboarding changes

Most onboarding tasks should stay within:

- [src/bot/onboardingFlow.ts](../../src/bot/onboardingFlow.ts)
- [src/bot/inputFlows.ts](../../src/bot/inputFlows.ts)
- [src/bot/keyboards.ts](../../src/bot/keyboards.ts)
- [src/bot/formatters.ts](../../src/bot/formatters.ts)
- [src/bot/admin.ts](../../src/bot/admin.ts)
- [src/db/database.ts](../../src/db/database.ts)
- [src/types.ts](../../src/types.ts)

Use [src/bot/createBot.ts](../../src/bot/createBot.ts) only when a new command/callback route is needed.

Avoid touching source modules for onboarding tasks.

### 2b. User and role changes

Role or allowlist tasks usually fan into:

- [src/bot/access.ts](../../src/bot/access.ts)
- [src/db/database.ts](../../src/db/database.ts)
- [src/bot/createBot.ts](../../src/bot/createBot.ts)
- [src/types.ts](../../src/types.ts)
- [tests/botUsers.test.ts](../../tests/botUsers.test.ts)

### 3. Runtime settings changes

A new editable numeric setting usually needs:

- [src/types.ts](../../src/types.ts)
- [src/runtime/settingsCatalog.ts](../../src/runtime/settingsCatalog.ts)
- [src/runtime/runtimeSettings.ts](../../src/runtime/runtimeSettings.ts)
- [src/services/runtimeSettingValidation.ts](../../src/services/runtimeSettingValidation.ts)
- [src/bot/admin.ts](../../src/bot/admin.ts)
- [src/bot/createBot.ts](../../src/bot/createBot.ts)
- maybe [src/services/sourcePoller.ts](../../src/services/sourcePoller.ts) or [src/sources/telegramWebPreviewSource.ts](../../src/sources/telegramWebPreviewSource.ts)

### 4. Delivery or digest changes

If task is about vacancy notifications, `/week`, empty-cycle notices, or startup message:

- first stop: [src/bot/formatters.ts](../../src/bot/formatters.ts)
- likely second stop: [src/bot/userPanels.ts](../../src/bot/userPanels.ts)
- then [src/bot/createBot.ts](../../src/bot/createBot.ts) only if routing or delivery side effects change
- only touch DB if delivery state or page shape must change

### 5. Source or scraping changes

Stay in:

- [src/sources/telegramWebPreviewSource.ts](../../src/sources/telegramWebPreviewSource.ts)
- [src/sources/hhApiSource.ts](../../src/sources/hhApiSource.ts) if the task mentions hh.ru
- [src/services/channelProbe.ts](../../src/services/channelProbe.ts)
- [src/utils/htmlToText.ts](../../src/utils/htmlToText.ts)
- source tests in [tests/telegramWebPreviewSource.test.ts](../../tests/telegramWebPreviewSource.test.ts)

Do not start from bot UI for source-only tasks.

## Safe First Reads By Task Type

- UI copy task: `src/bot/formatters.ts`, `src/bot/admin.ts`
- menu/button task: `src/bot/keyboards.ts`, `src/bot/admin.ts`, then `src/bot/createBot.ts` if routing changes are needed
- user panel task: `src/bot/userPanels.ts`, `src/bot/formatters.ts`, `src/bot/keyboards.ts`
- onboarding task: `src/bot/onboardingFlow.ts`, `src/bot/inputFlows.ts`, `src/bot/keyboards.ts`
- pending text input task: `src/bot/inputFlows.ts`, validators in `src/services/*Validation.ts`
- DB/task state task: `src/db/database.ts`, `src/types.ts`
- filtering logic task: `src/services/vacancyFilter.ts`, `src/services/vacancyIngestor.ts`
- source task: `src/sources/*`, `src/services/sourcePoller.ts`
- user/role task: `src/bot/access.ts`, `src/db/database.ts`, `src/bot/createBot.ts`
