# Current State

## Working Features

Implemented and working at code level:

- Public Telegram bot with auto-registration.
- RBAC for `member`, `admin`, `owner`.
- Onboarding with intro, preset/manual setup, language step, and immediate first results after full setup.
- Multiple search profiles per user, up to five.
- Search presets including frontend/backend/fullstack/design/product/3D print/no-experience remote.
- Language filter: ru+en, ru only, en only.
- Weekly feed, profile-specific weekly, zero-state diagnostics.
- Weekly feed now supports explicit 7/14/30-day windows. `week:0` and `week:profile:{id}:0` remain 7-day compatible callbacks, while `week:{days}:{offset}` and `week:profile:{id}:{days}:{offset}` open wider windows. Vacancy cards opened from a weekly window preserve that window when returning to the list.
- Weekly feed is compact by default: global `WEEKLY_PAGE_SIZE` defaults to 3, users can cycle their own weekly page size from 1 to 5 in Settings, and per-user overrides take priority over the global default.
- Weekly feed inline keyboards keep vacancy number buttons, pagination, refresh, and home menu only; filters/settings shortcuts are not shown inside the weekly list.
- Weekly drill-down is smoothed: vacancy cards opened from weekly/profile weekly keep a context-only `↩️ К выдаче` action, reminder/application prompts preserve that return path, and hiding a vacancy from weekly restores the same weekly page immediately instead of deleting the weekly message or requiring another return click.
- Main navigation now treats `Отклики` as a visible workflow. Applied vacancy cards and follow-up prompts link back to the applications list, profile-specific weekly pages link back to the originating search profile, and the search-profile detail keyboard is grouped by use/edit/advanced/navigation actions.
- Settings navigation is split by intent: `Мои вакансии` owns saved/applied/hidden/reminder lists, while `Настройки` only controls bot behavior such as morning digest, empty-check notifications, weekly page size, and diagnostics. Notification labels are explicit about `если новых вакансий нет` and `утренний дайджест`.
- Onboarding/start UX is lightly aligned with the new navigation: `/start` explains `Вакансии за неделю`, `Мои фильтры`, `Мои вакансии`, and `Настройки`, and completion copy points users to `Мои вакансии` for saved/applied/hidden/reminder follow-up.
- Compact vacancy cards, full-text toggle, duplicate source display.
- Vacancy action cards now contain only vacancy-scoped actions. Global navigation buttons (`Вакансии за неделю`, filters, settings, home menu) are kept out of per-vacancy inline keyboards.
- Pressing `Скрыть` on an inbox vacancy saves `hidden`, cancels active reminders as before, and removes the card message. If Telegram cannot delete it, the bot replaces the card with a short hidden-state fallback. Restoring from a hidden card updates the card without deleting it.
- Hidden Reason Feedback v1/v2 is implemented: after hiding a vacancy the bot asks for an optional reason in a separate compact prompt, stores one historical reason per user/vacancy, shows the reason only while the vacancy is currently hidden, surfaces top hidden reasons in daily digest and diagnostics, and offers conservative filter suggestions without changing filters automatically. Fresh hidden prompts offer `Вернуть` and `Меню`; weekly-origin prompts do not duplicate `К выдаче` because the weekly list is already restored.
- Vacancy cards extract decorated Telegram fields such as `Гео:`, separate salary amount lines, `рублей`, and agency company names like `Kodi-IT — digital-агентство`.
- Vacancy cards also handle common short external-source cards (`role / salary / company / link`), `от X до Y` salary ranges, company names after `О компании`, role lines after generic titles like `Всем привет!`, emoji-prefixed role lines, `МСК` time zones, and `Remote/Hybrid` work format.
- Vacancy cards infer conservative geography from short title/line segments and known location names, strip location-only `|` title segments from roles, handle negotiable/compact salaries (`зарплата после собеседования`, `40к ₽`, `12.000/мес`), and normalize noisy source prefixes such as `Лучшее на hh:` / `Вакансия:`.
- User-facing vacancy cards no longer append `(?)` to inferred fields. `confidence: "inferred"` is still kept internally for analytics/tests/future diagnostics, while missing critical fields are framed as `❓ Проверить: ...`.
- Vacancy cards now explain matches in user-facing language: compact/list cards show `Почему показал` instead of the old technical matcher summary, and full cards expand the reasons as `+` lines.
- Saved/applied/hidden statuses.
- Applied workflow MVP: pressing `applied` now creates/preserves an application record, cancels ordinary vacancy reminders, shows a follow-up prompt, supports optional notes up to 500 chars, and uses a separate application follow-up schedule instead of regular reminders.
- Application follow-ups have their own SQLite table, scheduler, delivery keyboard (`responded`, `remind again`, `close follow-up`, `open post`), retry/backoff state, and analytics events.
- Applied workflow v2: admins/owner can schedule a debug `one_minute` application follow-up, `status:applied:*` is now an application-aware "Otkлики" screen with summary counters and detail cards, and follow-up delivery messages offer direct 3-day/week reschedule actions instead of reopening only the generic prompt.
- Daily Action Digest is implemented and disabled by default. Users can enable it from Notifications; the scheduler checks due users every 5 minutes after the local 09:00 default, sends only non-empty actionable digests, retries failed deliveries with backoff, and records one delivery/skip state per local date.
- Enabling Daily Action Digest now immediately sends the current actionable digest. If it has actionable items, it is marked delivered for the current local date to avoid a duplicate scheduled digest; if it is empty, the bot sends a short empty-state note and does not mark the date skipped.
- Vacancy reminders.
- Resume/candidate-post detector.
- Dedup by raw source/channel/messageId, canonical URL, and fingerprint.
- Channel admin, batch channel add, channel discovery, candidate approve/skip/block.
- Source-level message cursor and inactivity backoff for Telegram web preview.
- Telegram web preview has a catch-up mode after stale channel success: if a channel succeeded more than 6 hours ago, it paginates backward until the previous `last_seen_message_id`, the configured backfill window, or source limits. Valid no-text preview posts now still advance observed message ids/cursors, avoiding repeated stalls on empty Telegram preview posts.
- Trusted vacancy services admin section.
- Multi-vacancy split for structured Telegram aggregator posts.
- External enrichment from active trusted services.
- Built-in specialized adapters for FindMyRemote, Teletype, Finder Work, and Telegraph.
- Repair script for old multi-vacancy posts.
- Local analytics in SQLite and optional PostHog forwarding.
- Automatic backup and technical data cleanup.

## Trusted Vacancy Services In Local DB

Latest known database state after trusted-service adapter/path-guard work:

- Active trusted services total after schema initialization: 18.
- Built-ins:
  - `findmyremote.ai`
  - `teletype.in`
  - `finder.work`
  - `telegra.ph`
- Newly activated by probe:
  - `career.avito.com`
  - `career.domclick.ru`
  - `career.habr.com`
  - `careers.kaspersky.ru`
  - `geekjob.ru`
  - `getmatch.ru`
  - `hirify.me`
  - `job-boards.eu.greenhouse.io`
  - `job-boards.greenhouse.io`
  - `jobs.ashbyhq.com`
  - `jobs.lever.co`
  - `laborx.com`
  - `talanto.work`
  - `www.remocate.app`

Pending because generic parser did not confidently parse the sample:

- `career.sonderads.com`
- `designer.ru`
- `ingamejob.com`
- `itcharm.com`
- `job.alfabank.ru`
- `job.megafon.ru`
- `job.mts.ru`
- `rabota.sber.ru`
- `youngjunior.ru`

- Rejected match audit table (`rejected_match_audit`) stores a limited sample (max 500 unverified per owner) of vacancies that the matcher checked for the owner but rejected. Recording happens in both `UserVacancyRematcher.rebuildForUser` and `VacancyIngestor.matchVacancyForEligibleUsers` (live ingestion) via the shared helper `trySaveRejectedAudit` in `src/services/rejectedMatchAuditService.ts`. The `/qualityaudit` owner command provides the review UI: shows unreviewed records one-by-one with inline verdict buttons (`✅ Подходит мне` / `❌ Не подходит`), atomically updates the verdict, disables buttons after review, and loads the next record or reports completion.

## Verification Status

Known from recent work:

- Full suite passed with 592 tests (`npm test`), `tsc` clean, `build` clean after fuzzy vacancy dedup.
- PR #18 (`fix/relevance-feedback-integrity`) is merged.
- Focused relevance feedback check: `npx tsx --test tests/vacancyRelevanceFeedback.test.ts` (31 tests).
- `npm run build` and strict `npx tsc -p tsconfig.json --pretty false` passed after applied workflow MVP.
- Focused applied workflow checks passed: `node --import tsx --test tests/botKeyboards.test.ts tests/applicationFollowUpScheduler.test.ts tests/botUsers.test.ts tests/inputFlowsRateLimit.test.ts` and `node --import tsx --test tests/userVacancyStatus.test.ts tests/botKeyboards.test.ts tests/applicationFollowUpScheduler.test.ts`.
- Full suite passed with 299 tests after applied workflow v2 (`npm test`).
- `npm run build` and strict `npx tsc -p tsconfig.json --pretty false` passed after applied workflow v2.
- Focused applied workflow v2 checks passed: `node --import tsx --test tests/botKeyboards.test.ts tests/formatters.test.ts tests/applicationFollowUpScheduler.test.ts tests/userVacancyStatus.test.ts tests/inputFlowsRateLimit.test.ts`.
- Full suite passed with 307 tests after Daily Action Digest (`npm test`).
- `npm run build` and strict `npx tsc -p tsconfig.json --pretty false` passed after Daily Action Digest.
- Focused Daily Digest checks passed: `node --import tsx --test tests/dailyDigestScheduler.test.ts tests/botKeyboards.test.ts tests/runtimeSettings.test.ts tests/databaseMigration.test.ts`.
- Full suite passed with 307 tests after user-facing vacancy match explanations (`npm test`).
- `npm run build` and strict `npx tsc -p tsconfig.json --pretty false` passed after user-facing vacancy match explanations.
- Focused formatter check passed: `node --import tsx --test tests/formatters.test.ts`.
- Full suite passed with 313 tests after Hidden Reason Feedback v1/v2 (`npm test`).
- `npm run build` and strict `npx tsc -p tsconfig.json --pretty false` passed after Hidden Reason Feedback v1/v2.
- Focused hidden feedback check passed: `node --import tsx --test tests/botKeyboards.test.ts tests/databaseMigration.test.ts tests/dailyDigestScheduler.test.ts tests/formatters.test.ts tests/userVacancyStatus.test.ts tests/vacancyCardDismissal.test.ts`.
- Full suite passed with 316 tests after weekly drill-down/return UX smoothing (`npm test`).
- `npm run build` and strict `npx tsc -p tsconfig.json --pretty false` passed after weekly drill-down/return UX smoothing.
- Focused weekly drill-down check passed: `node --import tsx --test tests/botKeyboards.test.ts tests/vacancyCardOrigin.test.ts tests/vacancyCardDismissal.test.ts`.
- Full suite passed with 319 tests after navigation UX smoothing for filters, applications, and follow-up (`npm test`).
- `npm run build` and strict `npx tsc -p tsconfig.json --pretty false` passed after navigation UX smoothing.
- Focused navigation UX check passed: `node --import tsx --test tests/botKeyboards.test.ts tests/vacancyCardOrigin.test.ts tests/vacancyCardDismissal.test.ts`.
- Focused daily digest/settings check passed after immediate digest-on-enable: `node --import tsx --test tests/dailyDigestScheduler.test.ts tests/botKeyboards.test.ts tests/runtimeSettings.test.ts tests/botUsers.test.ts` (39 tests).
- Full suite passed with 319 tests after immediate digest-on-enable (`npm test`).
- `npm run build` and strict `npx tsc -p tsconfig.json --pretty false` passed after immediate digest-on-enable.
- Focused hidden/weekly UX check passed after unified hidden receipt flow: `node --import tsx --test tests/botKeyboards.test.ts tests/vacancyCardOrigin.test.ts tests/vacancyCardDismissal.test.ts` (28 tests).
- Full suite passed with 320 tests after unified hidden receipt flow (`npm test`).
- `npm run build` and strict `npx tsc -p tsconfig.json --pretty false` passed after unified hidden receipt flow. The first parallel build attempt hit a transient fatal process error without TypeScript diagnostics, and an immediate standalone rerun passed.
- Focused settings/My vacancies UX check passed: `node --import tsx --test tests/botKeyboards.test.ts tests/formatters.test.ts tests/runtimeSettings.test.ts tests/botUsers.test.ts` (60 tests).
- Full suite passed with 322 tests after settings/My vacancies UX split (`npm test`). An earlier full-suite run had a transient `sourcePoller.test.ts` worker failure; rerunning that file passed, and the next full suite passed.
- `npm run build` and strict `npx tsc -p tsconfig.json --pretty false` passed after settings/My vacancies UX split.
- Focused onboarding/start UX check passed: `node --import tsx --test tests/onboardingUx.test.ts tests/formatters.test.ts tests/botKeyboards.test.ts` (58 tests).
- Full suite passed with 323 tests after onboarding/start copy refresh (`npm test`).
- `npm run build` and strict `npx tsc -p tsconfig.json --pretty false` passed after onboarding/start copy refresh.
- Focused weekly catch-up/window check passed: `node --import tsx --test tests/telegramWebPreviewSource.test.ts tests/botKeyboards.test.ts tests/vacancyCardOrigin.test.ts` (41 tests).
- Full suite passed with 684 tests after quiet hours review fixes: ingestor `now` injection, retry limit + dead-letter, callback handler extraction, DST tests, integration tests (`npm test`).
- `npm run build` and strict `npx tsc -p tsconfig.json --pretty false` passed after weekly catch-up and window support.
- Full suite passed with 295 tests after compact weekly screen and user weekly page-size settings work.
- `npm run build` and strict `npx tsc -p tsconfig.json --pretty false` passed after the same work.
- Focused weekly/settings/schema check passed: `node --import tsx --test tests/botKeyboards.test.ts tests/runtimeSettings.test.ts tests/botUsers.test.ts tests/databaseMigration.test.ts`.
- Focused keyboard/dismissal check passed: `node --import tsx --test tests/botKeyboards.test.ts tests/vacancyCardDismissal.test.ts`.
- Live 7-day DB card analysis after extractor improvements: role 97.0%, company 41.3%, salary 29.0%, workFormat 58.9%, geography 26.6%, timeZone 3.4%; weekly fallback cards 26.6%, detail fallback cards 52.2%.
- Finder Work accepts only `https://finder.work/vacancies/{id}` and parses JSON-LD before conservative HTML fallback.
- Telegraph accepts only article-shaped `https://telegra.ph/{slug}` pages and uses conservative vacancy confidence.
- Broad-domain adapters/path guards exist for safe shapes on `www.aviasales.ru`, `cloud.ru`, `www.tbank.ru`, and `yandex.ru`, but they are not seeded as active built-ins.

- Owner-only `/fuzzyreport` command: aggregates fuzzy duplicate stats for the last 30 days via `getFuzzyDedupStats(sinceIso)` in database layer. Reports total links, unique groups (connected components via union-find, iteratively expanded to full transitivity), average/min/max score, score buckets (zero-filled), top source/channel pairs (UNION ALL both sides), group size distribution, and last match date. `buildFuzzyDedupReport` formats the output. `handleFuzzyDedupReportCommand` enforces owner-only access. 24 tests cover aggregation, groups, buckets, time filtering, source ranking, deep transitive chains, independent groups, access control, and privacy (no vacancy text, contacts, or user IDs).
- Fuzzy vacancy dedup via `vacancyFuzzyMatcher.ts`: Dice coefficient + feature extraction scoring with confirmatory signals. Runs in ingestor before user matching. Requires ≥1 strong confirmatory signal beyond title+time (company, seniority, salary, location). Company-only matches with titleSim < 0.70 are rejected. 18 unit tests, 2 ingestion integration tests, and 11 regression tests pass.
- Ingestor (`vacancyIngestor.ts`): `findAndRecordFuzzyDuplicate` returns `FuzzyDuplicateGroup | null` with `groupVacancyIds`. On fuzzy hit, the new vacancy is linked to the root of the group. Matching runs normally but skips users who already matched any vacancy in the group. This prevents both matching loss (users who didn't match the first variant can still match the second) and duplicate notifications.
- Root linking: new fuzzy duplicates are always linked to the root (min ID) of the candidate's fuzzy group via `getFuzzyGroupRootId`. Transitive group queries via `getFuzzyGroupVacancyIds` (BFS closure). `listVacancyDuplicatePosts` UNIONs fuzzy sources → root card shows all group members.
- DB methods: `listFuzzyMatchCandidates(vacancyId, days, limit, titleTokens?)` — indexed query with optional LIKE pre-filter by title tokens; `recordVacancyFuzzyDuplicate` — ordered INSERT OR IGNORE; `getFuzzyGroupVacancyIds`, `getFuzzyGroupRootId`, `hasUserMatchedAnyVacancy`.
- `vacancy_fuzzy_duplicates` table stores `vacancy_id`, `duplicate_vacancy_id`, `score`, `reasons_json`, ordered so `vacancy_id < duplicate_vacancy_id`.
- `idx_vacancies_message_date` index added for efficient time-window queries.
- Notification quiet hours feature: user-toggleable `notification_quiet_hours_enabled` setting (default false). When enabled with instant notifications on, vacancies matched during 23:00–08:00 (config timezone) are enqueued to `pending_notification_queue` and delivered at 08:00 local time via `PendingNotificationScheduler`. Delivery respects hidden/applied cancellation, retries with backoff (max 10, exponential 5min–6h, dead-letter on exhaustion), and survives process restart via SQLite persistence. `VacancyIngestor` accepts `now: () => Date` for controlled time testing. 57 tests cover migration, DB operations, scheduler, timezone utils, DST, keyboard, formatter, dedup, isolation, retry limits, ingestor integration, and callback handler.

Before starting new code work, rerun:

```powershell
npm test
npm run build
npx tsc -p tsconfig.json --pretty false
```

## Git / Workspace Notes

- Git metadata is available.
- Current branch: `feat/notification-quiet-hours` (PR #22).
- PR #19 (`feature/fuzzy-vacancy-dedup` → `master`) merged.
- PR #20 (`feat/instant-vacancy-notifications-toggle` → `master`) merged.
- PR #21 (`feat/fuzzy-dedup-report` → `master`) merged.
- PR #22 (`feat/notification-quiet-hours`) is open — night quiet hours for instant notifications.

## Known Problems

- Some valid vacancy sites remain `pending` because generic HTML parser is too conservative.
- Vacancy-card extraction still has low coverage for explicit geography/Russia access and engagement because many posts provide these as free text, hashtags, or not at all. Avoid broad city guessing unless backed by tests.
- Some bad cards are not extractor problems but ingestion/classification problems: resume/self-promo posts, non-vacancy news/surveys, and multi-vacancy aggregates can still enter the vacancy table.
- `finder.work` has both vacancy and resume URLs. It is active only through the `finder_work` adapter and path guard, not generic trust.
- `telegra.ph` is active only through the `telegraph` article adapter and conservative content checks.
- `hh.ru`, `devkg.com`, and `ozon.tech` use redirects in many sampled URLs. Current trusted-service fetch rejects redirects by design.
- `yandex.ru`, `www.tbank.ru`, `cloud.ru`, and `www.aviasales.ru` are broad domains. Path guards exist, but do not trust non-matching paths or whole hosts generically.
- Telegram web preview cannot read private channels, invite-only channels, or forum topics under `t.me/c/...`.
- Old single-link trusted-service posts are not retroactively enriched. Multi-vacancy repair exists, but there is no general single-link reprocess command yet.
- Teletype and generic trusted-service parsing should remain conservative: false positives are worse than missing enrichment.
- `.env` exists locally and contains secrets. Do not print it in full.
