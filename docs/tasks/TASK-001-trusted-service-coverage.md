# TASK-001: Trusted Service Coverage

## Context

Trusted vacancy services enrich links already found inside Telegram vacancy posts. They are not independent polling sources.

Recent completed work added active guarded adapters for:

- `finder.work`
- `telegra.ph`

Path-scoped guards also exist for broad domains:

- `www.aviasales.ru/about/vacancies/...`
- `cloud.ru/career/vacancies/...`
- `www.tbank.ru/career/.../vacancy/...`
- `yandex.ru/jobs/vacancies/...`

Several valid vacancy sites remain pending because generic parsing is too conservative or unsafe to enable broadly.

## Goal

Add small, safe trusted-service coverage for the next pending valid vacancy sites without broadening generic whole-host trust.

## Scope

The Executor may:

- Probe pending trusted-service samples.
- Add adapter-specific URL shape guards.
- Add specialized parsing only where generic parsing is insufficient.
- Activate a service only when the accepted URL shape is narrow and defensible.
- Improve admin diagnostics for invalid known-host URL shapes if needed.
- Add focused tests for URL shape, parser behavior, ingestion behavior, and migrations.

## Out of Scope

Do not:

- Add generic whole-host trust for broad domains.
- Trust subdomains accidentally.
- Allow redirects.
- Remove DNS/private-IP checks, timeout checks, or response-size limits.
- Turn trusted services into independent polling sources.
- Change Telegram callbacks, public user flows, analytics names, or `.env`.
- Add production dependencies.
- Mix this with source polling, weekly UI, or card formatter work.

## Files Likely Affected

- `src/types.ts`
- `src/services/trustedVacancyServices.ts`
- `src/services/externalVacancyEnricher.ts`
- `src/db/schema.ts`
- `src/db/database.ts`
- `tests/trustedVacancyServices.test.ts`
- `tests/trustedVacancyIngestor.test.ts`
- `tests/databaseMigration.test.ts`

## Files Ownership

Writable ownership:
- `src/types.ts`
- `src/services/trustedVacancyServices.ts`
- `src/services/externalVacancyEnricher.ts`
- `src/db/schema.ts`
- `src/db/database.ts`
- `tests/trustedVacancyServices.test.ts`
- `tests/trustedVacancyIngestor.test.ts`
- `tests/databaseMigration.test.ts`

Read-only context:
- `.agent/CURRENT_STATE.md`
- `.agent/DECISIONS.md`
- `docs/STATUS.md`
- `docs/ROADMAP.md`
- `docs/product/PROJECT_OVERVIEW.md`

No ownership:
- `.env`
- Telegram bot callback/keyboards unless a diagnostic callback is explicitly required
- source polling modules
- weekly UI modules
- application/digest/hidden reason workflows

## Dependencies

- Existing trusted-service security model must stay intact.
- Existing `findmyremote.ai`, `teletype.in`, `finder.work`, and `telegra.ph` tests must continue to pass.
- Any new adapter enum value requires schema CHECK migration coverage.

## Parallelization Risks

Do not run in parallel with:

- another task editing trusted-service enums/schema;
- another task editing `ExternalVacancyEnricher`;
- storage migration work;
- ingestion behavior changes that affect definitive rejection or temporary-failure fallback.

Can run in parallel with:

- documentation-only audit work;
- UI-only planning work that does not edit trusted-service files.

## Implementation Notes

Recommended order:

 1. Probe and add small adapters for remaining pending sites that generic parsing missed:
     - ~~`ingamejob.com`~~ (dedicated adapter added as built-in, seeded pending)
     - ~~`designer.ru`~~ (dedicated JSON-LD adapter added as built-in, PR #25)
     - ~~`job.mts.ru`~~ (Product JSON-LD adapter with archive detection, PR #27)
     - ~~`rabota.sber.ru`~~ (research-only, no production adapter — see `docs/research/rabota-sber-ru.md`)
     - `job.megafon.ru`
     - `job.alfabank.ru`
2. Prefer adapter-specific URL shape plus existing JSON-LD/HTML extraction over loosening the generic fallback.
3. Decide whether any already guarded broad-domain service should become active only after real sample checks.
4. If admin diagnostics are confusing, report "known host, unsupported URL shape" separately from unknown/pending services.

Current behavior to preserve:

- Definitive external non-vacancy result prevents posting a vacancy.
- Invalid URL shape for an active trusted host is definitive and should not fetch.
- Temporary network/DNS/timeout/5xx failure does not discard the Telegram vacancy.
- Trusted services enrich links from vacancies only.
- Exact-host policy remains intact.
- Redirects remain rejected.

## Acceptance Criteria

- [ ] New adapter accepts only safe vacancy URL shapes.
- [ ] New adapter rejects resume/profile/non-vacancy pages definitively.
- [ ] Missing/404 trusted-service pages do not create vacancies.
- [ ] Temporary network failures still allow Telegram-only vacancy ingestion.
- [ ] Existing `findmyremote.ai`, `teletype.in`, `finder.work`, and `telegra.ph` behavior remains unchanged.
- [ ] Broad domains are not trusted unless URL path matches a safe shape.
- [ ] Redirect, private DNS/IP, timeout, and oversized-response tests still pass.
- [ ] Ingestor stores definitive non-vacancy trusted links only as raw evidence and does not notify users.

## Checks

Run focused checks first:

```powershell
node --import tsx --test tests/trustedVacancyServices.test.ts tests/trustedVacancyIngestor.test.ts tests/databaseMigration.test.ts
```

Then run:

```powershell
npm test
npm run build
npx tsc -p tsconfig.json --pretty false
```

## Manual QA

No live Telegram QA is required unless a trusted-service result changes user-visible notification behavior.

If manual QA is needed:

- Use a test bot/test chat.
- Use fake vacancy data only.
- Send a Telegram post containing a supported trusted-service URL.
- Verify that a confident vacancy is enriched and a non-vacancy/missing page is not sent to users.

## Review Gate

After completion, the Executor must stop and report:

```text
Feature complete. I will not continue until review.

Branch: ...
Commit: ...
Pushed: yes/no

Changed files:
- ...

Checks:
- ...

Manual QA:
- ...

Notes:
- ...
```
