# Next Task

PR #22 (`feat/notification-quiet-hours`) is under review — night quiet hours for instant notifications.

## Feature summary

- User can enable `🌙 Ночная пауза 23:00–08:00` in notification settings
- When active + instant notifications enabled + current local time in 23:00–08:00 (config timezone):
  - match is created with `deliveredAt = null`
  - notification enqueued to `pending_notification_queue` with `scheduled_at = 08:00 local`
- `PendingNotificationScheduler` runs every 60s, delivers due items at/after 08:00
- Queue survives process restart (SQLite)
- Dedup: `UNIQUE(user_id, vacancy_id)` prevents double enqueue + `status='pending'` filter
- Hidden/applied status cancels pending delivery; saved does not
- Retry with exponential backoff (5min–6h), max 10 attempts, dead-letter on exhaustion
- `VacancyIngestor` accepts `now: () => Date` for controlled time testing
- Extracted handler `notificationQuietHoursHandler.ts` with callback test coverage

## Key files

- `src/db/schema.ts` — `pending_notification_queue` table + `status` column migration
- `src/db/database.ts` — all queue methods + `markPendingNotificationDeadLetter`
- `src/db/rowMappers.ts` — `notification_quiet_hours_enabled` field
- `src/types.ts` — `notificationQuietHoursEnabled`, `PendingNotificationRecord` (with `status`)
- `src/services/quietHoursUtils.ts` — `isInQuietHours`, `computeNextQuietHoursEnd`
- `src/services/pendingNotificationScheduler.ts` — scheduler + MAX_RETRY_COUNT + dead-letter
- `src/services/vacancyIngestor.ts` — quiet hours gating with `now` injection
- `src/bot/notificationQuietHoursHandler.ts` — extracted callback handler
- `src/bot/createBot.ts` — `notifications:toggle_quiet_hours` callback
- `src/bot/keyboards.ts` — toggle button
- `src/bot/formatters.ts` — status line
- `tests/pendingNotificationQueue.test.ts` — 57 tests

## Verification

```powershell
npx tsc -p tsconfig.json --pretty false
npm test
npm run build
```
