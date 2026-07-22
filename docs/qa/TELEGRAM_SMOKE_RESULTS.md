# Telegram Smoke Results

Date: 2026-07-22
Run by: executor (automated checks)
Bot version: commit `071879d` on `feat/trusted-sber-jobs`

---

# AGENT_AUTOMATED — Results

## 1. Build & Static Analysis

### 1.1 TypeScript type check

| Field | Value |
|---|---|
| Command | `npx tsc -p tsconfig.json --pretty false` |
| Expectation | Exit code 0, no diagnostics emitted |
| Actual | Exit code 0, no diagnostics |
| Status | **PASS** |

### 1.2 Production build

| Field | Value |
|---|---|
| Command | `npm run build` |
| Expectation | Exit code 0, `dist/` produced |
| Actual | Exit code 0, build successful |
| Status | **PASS** |

---

## 2. Full Test Suite

### 2.1 All unit tests

| Field | Value |
|---|---|
| Command | `npm test` |
| Expectation | Exit code 0, all tests pass |
| Actual | 722 tests, 0 failures, 0 skipped, duration 20031ms |
| Status | **PASS** |

### 2.2 Focused trusted-service tests

| Field | Value |
|---|---|
| Command | `node --import tsx --test tests/trustedVacancyServices.test.ts tests/trustedVacancyIngestor.test.ts tests/databaseMigration.test.ts` |
| Expectation | Exit code 0, all pass |
| Actual | 0 failures, duration 2032ms |
| Status | **PASS** |

---

## 3. Core Business Logic

### 3.1 Keyword filtering (`tests/vacancyFilter.test.ts`)

| Field | Value |
|---|---|
| Expectation | All tests pass |
| Actual | All tests pass (incorporated in full suite) |
| Status | **PASS** |

### 3.2 Fuzzy matching engine (`tests/vacancyFuzzyMatcher.test.ts`)

| Field | Value |
|---|---|
| Expectation | All tests pass |
| Actual | All tests pass |
| Status | **PASS** |

### 3.3 Deduplication (`tests/deduplication.test.ts`)

| Field | Value |
|---|---|
| Expectation | All tests pass |
| Actual | All tests pass |
| Status | **PASS** |

### 3.4 Multi-vacancy splitting (`tests/telegramMultiVacancySplitter.test.ts`)

| Field | Value |
|---|---|
| Expectation | All tests pass |
| Actual | All tests pass |
| Status | **PASS** |

### 3.5 Search profile health & presets (`tests/searchProfileHealth.test.ts`, `tests/searchProfilePresets.test.ts`, `tests/searchProfilePresetForecast.test.ts`)

| Field | Value |
|---|---|
| Expectation | All tests pass |
| Actual | All tests pass |
| Status | **PASS** |

---

## 4. Bot Callbacks & Keyboards

### 4.1 Keyboard construction (`tests/botKeyboards.test.ts`)

| Field | Value |
|---|---|
| Expectation | All tests pass |
| Actual | All tests pass |
| Status | **PASS** |

### 4.2 Vacancy card origin encoding (`tests/vacancyCardOrigin.test.ts`)

| Field | Value |
|---|---|
| Expectation | All tests pass |
| Actual | All tests pass |
| Status | **PASS** |

### 4.3 Vacancy card dismissal / hide flow (`tests/vacancyCardDismissal.test.ts`)

| Field | Value |
|---|---|
| Expectation | All tests pass |
| Actual | All tests pass |
| Status | **PASS** |

### 4.4 Formatters (`tests/formatters.test.ts`)

| Field | Value |
|---|---|
| Expectation | All tests pass |
| Actual | All tests pass |
| Status | **PASS** |

### 4.5 Onboarding UX (`tests/onboardingUx.test.ts`, `tests/onboardingState.test.ts`, `tests/onboardingCompletionFlow.test.ts`)

| Field | Value |
|---|---|
| Expectation | All tests pass |
| Actual | All tests pass |
| Status | **PASS** |

### 4.6 User vacancy status mutations (`tests/userVacancyStatus.test.ts`)

| Field | Value |
|---|---|
| Expectation | All tests pass |
| Actual | All tests pass |
| Status | **PASS** |

### 4.7 Rate limiting (`tests/inputFlowsRateLimit.test.ts`)

| Field | Value |
|---|---|
| Expectation | All tests pass |
| Actual | All tests pass |
| Status | **PASS** |

---

## 5. Ingestion & Sources

### 5.1 Telegram web preview source (`tests/telegramWebPreviewSource.test.ts`)

| Field | Value |
|---|---|
| Expectation | All tests pass |
| Actual | All tests pass |
| Status | **PASS** |

### 5.2 Trusted vacancy services (`tests/trustedVacancyServices.test.ts`)

| Field | Value |
|---|---|
| Expectation | All tests pass |
| Actual | All tests pass |
| Status | **PASS** |

### 5.3 Trusted service ingestion (`tests/trustedVacancyIngestor.test.ts`)

| Field | Value |
|---|---|
| Expectation | All tests pass |
| Actual | All tests pass |
| Status | **PASS** |

### 5.4 hh.ru API source (`tests/hhApiSource.test.ts`, `tests/hhSearchValidation.test.ts`)

| Field | Value |
|---|---|
| Expectation | All tests pass |
| Actual | All tests pass |
| Status | **PASS** |

### 5.5 Company careers source (`tests/companyCareersSource.test.ts`, `tests/companyCareerUrls.test.ts`)

| Field | Value |
|---|---|
| Expectation | All tests pass |
| Actual | All tests pass |
| Status | **PASS** |

### 5.6 Source polling mechanics (`tests/sourcePoller.test.ts`, `tests/sourceFactory.test.ts`, `tests/sourceDynamicChannels.test.ts`)

| Field | Value |
|---|---|
| Expectation | All tests pass |
| Actual | All tests pass |
| Status | **PASS** |

---

## 6. Schedulers & Notifications

### 6.1 Daily digest scheduler (`tests/dailyDigestScheduler.test.ts`)

| Field | Value |
|---|---|
| Expectation | All tests pass |
| Actual | All tests pass |
| Status | **PASS** |

### 6.2 Vacancy reminders (`tests/vacancyReminders.test.ts`)

| Field | Value |
|---|---|
| Expectation | All tests pass |
| Actual | All tests pass |
| Status | **PASS** |

### 6.3 Application follow-up scheduler (`tests/applicationFollowUpScheduler.test.ts`)

| Field | Value |
|---|---|
| Expectation | All tests pass |
| Actual | All tests pass |
| Status | **PASS** |

### 6.4 Pending notification queue / quiet hours (`tests/pendingNotificationQueue.test.ts`)

| Field | Value |
|---|---|
| Expectation | All tests pass |
| Actual | All tests pass |
| Status | **PASS** |

### 6.5 Instant vacancy notifications (`tests/instantVacancyNotifications.test.ts`)

| Field | Value |
|---|---|
| Expectation | All tests pass |
| Actual | All tests pass |
| Status | **PASS** |

---

## 7. Database & Migration

### 7.1 Database migration (`tests/databaseMigration.test.ts`)

| Field | Value |
|---|---|
| Expectation | All tests pass |
| Actual | All tests pass |
| Status | **PASS** |

### 7.2 Backup & restore (`tests/databaseBackup.test.ts`, `tests/automaticBackup.test.ts`)

| Field | Value |
|---|---|
| Expectation | All tests pass |
| Actual | All tests pass |
| Status | **PASS** |

### 7.3 Technical data cleanup (`tests/technicalDataCleanup.test.ts`)

| Field | Value |
|---|---|
| Expectation | All tests pass |
| Actual | All tests pass |
| Status | **PASS** |

---

## 8. Security

### 8.1 SQL injection guards (`tests/sqlInjection.test.ts`)

| Field | Value |
|---|---|
| Expectation | All tests pass |
| Actual | All tests pass |
| Status | **PASS** |

### 8.2 Config security (`tests/configSecurity.test.ts`)

| Field | Value |
|---|---|
| Expectation | All tests pass |
| Actual | All tests pass |
| Status | **PASS** |

### 8.3 Owner access control (`tests/ownerAccess.test.ts`)

| Field | Value |
|---|---|
| Expectation | All tests pass |
| Actual | All tests pass |
| Status | **PASS** |

---

## 9. Admin & Reports

### 9.1 Quality audit handler (`tests/qualityAuditHandler.test.ts`, `tests/rejectedMatchAudit.test.ts`)

| Field | Value |
|---|---|
| Expectation | All tests pass |
| Actual | All tests pass |
| Status | **PASS** |

### 9.2 Fuzzy dedup report (`tests/fuzzyDedupReport.test.ts`)

| Field | Value |
|---|---|
| Expectation | All tests pass |
| Actual | All tests pass |
| Status | **PASS** |

### 9.3 Matching quality report (`tests/matchingQualityReport.test.ts`)

| Field | Value |
|---|---|
| Expectation | All tests pass |
| Actual | All tests pass |
| Status | **PASS** |

### 9.4 Weekly owner reports (`tests/weeklyReport.test.ts`, `tests/weeklyRetentionReport.test.ts`, `tests/weeklyOwnerReportScheduler.test.ts`)

| Field | Value |
|---|---|
| Expectation | All tests pass |
| Actual | All tests pass |
| Status | **PASS** |

---

## 10. Utilities & Helpers

### 10.1 Contact extraction (`tests/contactExtractor.test.ts`)

| Field | Value |
|---|---|
| Expectation | All tests pass |
| Actual | All tests pass |
| Status | **PASS** |

### 10.2 Language detection (`tests/vacancyLanguageDetection.test.ts`)

| Field | Value |
|---|---|
| Expectation | All tests pass |
| Actual | All tests pass |
| Status | **PASS** |

### 10.3 Details extraction (`tests/vacancyDetailsExtractor.test.ts`)

| Field | Value |
|---|---|
| Expectation | All tests pass |
| Actual | All tests pass |
| Status | **PASS** |

### 10.4 Runtime settings (`tests/runtimeSettings.test.ts`, `tests/runtimeSettingValidation.test.ts`)

| Field | Value |
|---|---|
| Expectation | All tests pass |
| Actual | All tests pass |
| Status | **PASS** |

---

## Automated Summary

```text
Total automated checks:         38
Pass:                           38
Fail:                           0
Blocked:                        0

Type check:                     PASS
Build:                          PASS
Full test suite (722 tests):    PASS
Focused trusted tests:          PASS
```

---

# USER_MANUAL — Pending

See `TELEGRAM_SMOKE_CHECKLIST.md#Ручная проверка пользователем` for the full manual checklist.

All 10 manual scenarios are marked `PENDING USER`.

---

## Overall Audit Status

**Blocked on user.** Automated baseline is complete. Manual Telegram smoke requires a live test bot and a real Telegram client.

| Section | Status |
|---|---|
| AGENT_AUTOMATED (38 checks) | ✅ 38 PASS |
| USER_MANUAL (10 scenarios) | ⏳ PENDING USER |
| Overall Telegram smoke | ❌ NOT COMPLETED |
