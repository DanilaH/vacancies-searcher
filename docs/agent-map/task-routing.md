# Task Routing

Use this file to narrow the edit area before opening large files.

## UI Copy Or Message Tone

Start with:

- [src/bot/formatters.ts](../../src/bot/formatters.ts)
- [src/bot/admin.ts](../../src/bot/admin.ts)

Usually avoid:

- [src/db/database.ts](../../src/db/database.ts)
- [src/sources](../../src/sources)

Verification:

- `npm run build`
- `npm test`

Useful note:

- if the task is wording-only, try to stay out of `database.ts` and `types.ts`

## Main Menu, Buttons, Callback Navigation

Start with:

- [src/bot/keyboards.ts](../../src/bot/keyboards.ts)
- [src/bot/admin.ts](../../src/bot/admin.ts)
- [src/bot/userPanels.ts](../../src/bot/userPanels.ts)

Likely follow-ups:

- [src/bot/formatters.ts](../../src/bot/formatters.ts)
- [src/bot/createBot.ts](../../src/bot/createBot.ts), only when callback routing changes

Only touch DB if:

- the menu action changes persisted state;
- the task introduces a new user or app setting.

Watch out for:

- callback identifiers are routed in [src/bot/createBot.ts](../../src/bot/createBot.ts)
- non-admin menu layout is centralized in [src/bot/keyboards.ts](../../src/bot/keyboards.ts)
- user-facing panel rendering is in [src/bot/userPanels.ts](../../src/bot/userPanels.ts)

## Onboarding

Start with:

- [src/bot/onboardingFlow.ts](../../src/bot/onboardingFlow.ts)
- [src/bot/inputFlows.ts](../../src/bot/inputFlows.ts)
- [src/bot/keyboards.ts](../../src/bot/keyboards.ts)
- [src/bot/formatters.ts](../../src/bot/formatters.ts)
- [src/bot/admin.ts](../../src/bot/admin.ts)

Likely follow-ups:

- [src/db/database.ts](../../src/db/database.ts)
- [src/types.ts](../../src/types.ts)
- [tests/onboardingState.test.ts](../../tests/onboardingState.test.ts)
- [tests/onboardingUx.test.ts](../../tests/onboardingUx.test.ts)
- [tests/botFlowHelpers.test.ts](../../tests/botFlowHelpers.test.ts)

Avoid:

- source modules;
- vacancy ingestion modules.

Use [src/bot/createBot.ts](../../src/bot/createBot.ts) only for new callback routes or command routing, not for ordinary onboarding copy/step changes.

## Personal Search Profile

Start with:

- [src/services/vacancyFilter.ts](../../src/services/vacancyFilter.ts)
- [src/db/database.ts](../../src/db/database.ts)
- [src/bot/userPanels.ts](../../src/bot/userPanels.ts)
- [src/bot/inputFlows.ts](../../src/bot/inputFlows.ts)

Likely follow-ups:

- [src/bot/admin.ts](../../src/bot/admin.ts)
- [src/bot/keyboards.ts](../../src/bot/keyboards.ts)
- [src/bot/createBot.ts](../../src/bot/createBot.ts), only if callback routing changes
- [src/services/searchProfileValidation.ts](../../src/services/searchProfileValidation.ts)
- [src/services/searchProfilePresets.ts](../../src/services/searchProfilePresets.ts)
- [tests/multiUserFiltering.test.ts](../../tests/multiUserFiltering.test.ts)
- [tests/searchProfile.test.ts](../../tests/searchProfile.test.ts)
- [tests/vacancyFilter.test.ts](../../tests/vacancyFilter.test.ts)

## Channels And Source Registry

Start with:

- [src/db/database.ts](../../src/db/database.ts)
- [src/bot/createBot.ts](../../src/bot/createBot.ts)
- [src/sources/telegramWebPreviewSource.ts](../../src/sources/telegramWebPreviewSource.ts)

Likely follow-ups:

- [src/services/channelValidation.ts](../../src/services/channelValidation.ts)
- [src/services/channelProbe.ts](../../src/services/channelProbe.ts)
- [tests/channelRegistry.test.ts](../../tests/channelRegistry.test.ts)
- [tests/sourceDynamicChannels.test.ts](../../tests/sourceDynamicChannels.test.ts)

## hh.ru Source

Start with:

- [src/sources/hhApiSource.ts](../../src/sources/hhApiSource.ts)
- [src/db/database.ts](../../src/db/database.ts)
- [src/bot/createBot.ts](../../src/bot/createBot.ts)
- [src/bot/admin.ts](../../src/bot/admin.ts)

Likely follow-ups:

- [src/services/hhSearchValidation.ts](../../src/services/hhSearchValidation.ts)
- [src/services/vacancyIngestor.ts](../../src/services/vacancyIngestor.ts)
- [src/services/userVacancyRematcher.ts](../../src/services/userVacancyRematcher.ts)
- [tests/hhApiSource.test.ts](../../tests/hhApiSource.test.ts)
- [tests/multiUserFiltering.test.ts](../../tests/multiUserFiltering.test.ts)

Important boundary:

- hh.ru filters are source fetch filters; the common personal profile still handles final matching.
- do not route hh.ru work through Telegram channel registry unless the task explicitly changes source scheduling globally.

## Company Careers Source

Start with:

- [src/sources/companyCareersSource.ts](../../src/sources/companyCareersSource.ts)
- [src/services/companyCareerUrls.ts](../../src/services/companyCareerUrls.ts)
- [src/db/database.ts](../../src/db/database.ts)
- [src/bot/createBot.ts](../../src/bot/createBot.ts)
- [src/bot/admin.ts](../../src/bot/admin.ts)

Likely follow-ups:

- [tests/companyCareersSource.test.ts](../../tests/companyCareersSource.test.ts)
- [tests/companyCareerUrls.test.ts](../../tests/companyCareerUrls.test.ts)
- [tests/deduplication.test.ts](../../tests/deduplication.test.ts)

Important boundary:

- company sources are not Telegram channels; do not store them in `monitored_channels`.
- canonical job URLs participate in dedup and duplicate-post rendering.
- generic HTML is intentionally conservative and should not become a broad crawler without SSRF and noise controls.

## Runtime Settings

Start with:

- [src/runtime/settingsCatalog.ts](../../src/runtime/settingsCatalog.ts)
- [src/runtime/runtimeSettings.ts](../../src/runtime/runtimeSettings.ts)
- [src/services/runtimeSettingValidation.ts](../../src/services/runtimeSettingValidation.ts)
- [src/bot/admin.ts](../../src/bot/admin.ts)
- [src/bot/inputFlows.ts](../../src/bot/inputFlows.ts)
- [src/bot/createBot.ts](../../src/bot/createBot.ts), only for callback routing

Likely follow-ups:

- [src/types.ts](../../src/types.ts)
- [src/db/database.ts](../../src/db/database.ts)
- [src/services/sourcePoller.ts](../../src/services/sourcePoller.ts)
- [src/sources/telegramWebPreviewSource.ts](../../src/sources/telegramWebPreviewSource.ts)

## User Access, Roles, Privacy

Start with:

- [src/bot/access.ts](../../src/bot/access.ts)
- [src/db/database.ts](../../src/db/database.ts)
- [src/bot/createBot.ts](../../src/bot/createBot.ts)

Likely follow-ups:

- [src/types.ts](../../src/types.ts)
- [tests/ownerAccess.test.ts](../../tests/ownerAccess.test.ts)
- [tests/botUsers.test.ts](../../tests/botUsers.test.ts)

## Vacancy Matching Or Delivery

Start with:

- [src/services/vacancyIngestor.ts](../../src/services/vacancyIngestor.ts)
- [src/services/vacancyFilter.ts](../../src/services/vacancyFilter.ts)
- [src/bot/userPanels.ts](../../src/bot/userPanels.ts)
- [src/bot/formatters.ts](../../src/bot/formatters.ts)

Likely follow-ups:

- [src/db/database.ts](../../src/db/database.ts)
- [src/bot/createBot.ts](../../src/bot/createBot.ts), only if command/callback delivery routing changes
- [tests/multiUserFiltering.test.ts](../../tests/multiUserFiltering.test.ts)

Important boundary:

- delivery state is per user, so notification changes often affect both `vacancyIngestor.ts` and DB match rows

## Web Preview Parsing

Start with:

- [src/sources/telegramWebPreviewSource.ts](../../src/sources/telegramWebPreviewSource.ts)
- [src/utils/htmlToText.ts](../../src/utils/htmlToText.ts)

Likely follow-ups:

- [src/services/channelProbe.ts](../../src/services/channelProbe.ts)
- [tests/telegramWebPreviewSource.test.ts](../../tests/telegramWebPreviewSource.test.ts)

Avoid:

- bot routing files unless the task also changes presentation.

## Schema Or Persistence Changes

Start with:

- [src/db/database.ts](../../src/db/database.ts)
- [src/db/schema.ts](../../src/db/schema.ts)
- [src/db/rowMappers.ts](../../src/db/rowMappers.ts)
- [src/types.ts](../../src/types.ts)

Then inspect:

- every caller of the changed database method;
- every test that names the changed table or method.

Use `schema.ts` for DDL/migrations, `rowMappers.ts` for row shape changes, and `database.ts` for public persistence operations. Do not duplicate schema SQL back into the facade.

Useful command:

```bash
rg -n "database\\.[A-Za-z0-9_]+" src tests
```

## Quick Safety Rules

- If the task is presentation-only, do not start from `database.ts`.
- If the task is source-only, do not start from `createBot.ts`.
- If the task adds a new persisted flag, expect changes in `types.ts`, `database.ts`, bot handlers, and tests.
- If the task adds a column or index, put the DDL/migration in `schema.ts` and keep any new row mapping in `rowMappers.ts`.
- If the task changes a shared type, search usages before editing implementation.
- Never patch `dist/`; it is build output.
- If the task is per-user behavior, check whether the real source of truth is `user_settings`, `user_search_profiles`, or `user_vacancy_matches` before editing UI text.
