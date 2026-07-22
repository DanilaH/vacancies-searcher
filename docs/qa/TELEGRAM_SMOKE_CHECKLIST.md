# Telegram Smoke Checklist

Date: 2026-07-22

## Structure

- `AGENT_AUTOMATED` — checks run by the executor against code/tests.
- `USER_MANUAL` — checks that require a live Telegram bot, real inline clicks, and visual evaluation.

Results are recorded in `TELEGRAM_SMOKE_RESULTS.md`.

---

# AGENT_AUTOMATED

## 1. Build & Static Analysis

### 1.1 TypeScript type check

| Field | Value |
|---|---|
| Command | `npx tsc -p tsconfig.json --pretty false` |
| Expectation | Exit code 0, no diagnostics emitted |
| Actual | |
| Status | |

### 1.2 Production build

| Field | Value |
|---|---|
| Command | `npm run build` |
| Expectation | Exit code 0, `dist/` produced |
| Actual | |
| Status | |

---

## 2. Full Test Suite

### 2.1 All unit tests

| Field | Value |
|---|---|
| Command | `npm test` |
| Expectation | Exit code 0, all tests pass |
| Actual | |
| Status | |

### 2.2 Focused trusted-service tests

| Field | Value |
|---|---|
| Command | `node --import tsx --test tests/trustedVacancyServices.test.ts tests/trustedVacancyIngestor.test.ts tests/databaseMigration.test.ts` |
| Expectation | Exit code 0, all pass |
| Actual | |
| Status | |

---

## 3. Core Business Logic

### 3.1 Keyword filtering

| Field | Value |
|---|---|
| Test file | `tests/vacancyFilter.test.ts` |
| What it covers | Keyword include/exclude, AI context, hybrid mode, stop words, etc. |
| Expectation | All tests pass |
| Actual | |
| Status | |

### 3.2 Fuzzy matching engine

| Field | Value |
|---|---|
| Test file | `tests/vacancyFuzzyMatcher.test.ts` |
| What it covers | Dice coefficient, feature extraction, confirmatory signals, company-only guard |
| Expectation | All tests pass |
| Actual | |
| Status | |

### 3.3 Deduplication

| Field | Value |
|---|---|
| Test file | `tests/deduplication.test.ts` |
| What it covers | Dedup by source/channel/messageId, canonical URL, fingerprint |
| Expectation | All tests pass |
| Actual | |
| Status | |

### 3.4 Multi-vacancy splitting

| Field | Value |
|---|---|
| Test file | `tests/telegramMultiVacancySplitter.test.ts` |
| What it covers | Splitting structured aggregator posts into child vacancies |
| Expectation | All tests pass |
| Actual | |
| Status | |

### 3.5 Search profile health & presets

| Field | Value |
|---|---|
| Test file | `tests/searchProfileHealth.test.ts`, `tests/searchProfilePresets.test.ts`, `tests/searchProfilePresetForecast.test.ts` |
| Expectation | All tests pass |
| Actual | |
| Status | |

---

## 4. Bot Callbacks & Keyboards

### 4.1 Keyboard construction

| Field | Value |
|---|---|
| Test file | `tests/botKeyboards.test.ts` |
| What it covers | All inline keyboard layouts: main menu, weekly feed, vacancy cards, status pages, settings, admin |
| Expectation | All tests pass |
| Actual | |
| Status | |

### 4.2 Vacancy card origin encoding

| Field | Value |
|---|---|
| Test file | `tests/vacancyCardOrigin.test.ts` |
| What it covers | Origin encoding/decoding for weekly feed return navigation |
| Expectation | All tests pass |
| Actual | |
| Status | |

### 4.3 Vacancy card dismissal (hide flow)

| Field | Value |
|---|---|
| Test file | `tests/vacancyCardDismissal.test.ts` |
| What it covers | Hide + reason prompt + weekly restore logic |
| Expectation | All tests pass |
| Actual | |
| Status | |

### 4.4 Formatters

| Field | Value |
|---|---|
| Test file | `tests/formatters.test.ts` |
| What it covers | Vacancy card formatting, match explanations, status messages |
| Expectation | All tests pass |
| Actual | |
| Status | |

### 4.5 Onboarding UX

| Field | Value |
|---|---|
| Test file | `tests/onboardingUx.test.ts`, `tests/onboardingState.test.ts`, `tests/onboardingCompletionFlow.test.ts` |
| What it covers | Intro → preset/manual → language → completion → weekly delivery |
| Expectation | All tests pass |
| Actual | |
| Status | |

### 4.6 User vacancy status mutations

| Field | Value |
|---|---|
| Test file | `tests/userVacancyStatus.test.ts` |
| What it covers | save, apply, hide, restore status transitions |
| Expectation | All tests pass |
| Actual | |
| Status | |

### 4.7 Rate limiting

| Field | Value |
|---|---|
| Test file | `tests/inputFlowsRateLimit.test.ts` |
| What it covers | Cooldown enforcement for text input flows |
| Expectation | All tests pass |
| Actual | |
| Status | |

---

## 5. Ingestion & Sources

### 5.1 Telegram web preview source

| Field | Value |
|---|---|
| Test file | `tests/telegramWebPreviewSource.test.ts` |
| What it covers | Polling, backfill, catch-up mode, no-text posts |
| Expectation | All tests pass |
| Actual | |
| Status | |

### 5.2 Trusted vacancy services

| Field | Value |
|---|---|
| Test file | `tests/trustedVacancyServices.test.ts` |
| What it covers | URL shape detection, host matching, path guards, adapter routing |
| Expectation | All tests pass |
| Actual | |
| Status | |

### 5.3 Trusted service ingestion

| Field | Value |
|---|---|
| Test file | `tests/trustedVacancyIngestor.test.ts` |
| What it covers | Enrichment flow, 404/410/archived/redirect/oversized handling |
| Expectation | All tests pass |
| Actual | |
| Status | |

### 5.4 hh.ru API source

| Field | Value |
|---|---|
| Test file | `tests/hhApiSource.test.ts`, `tests/hhSearchValidation.test.ts` |
| What it covers | hh.ru polling, search param validation, cycle through options |
| Expectation | All tests pass |
| Actual | |
| Status | |

### 5.5 Company careers source

| Field | Value |
|---|---|
| Test file | `tests/companyCareersSource.test.ts`, `tests/companyCareerUrls.test.ts` |
| What it covers | Company career page parsing, URL detection |
| Expectation | All tests pass |
| Actual | |
| Status | |

### 5.6 Source polling mechanics

| Field | Value |
|---|---|
| Test file | `tests/sourcePoller.test.ts`, `tests/sourceFactory.test.ts`, `tests/sourceDynamicChannels.test.ts` |
| Expectation | All tests pass |
| Actual | |
| Status | |

---

## 6. Schedulers & Notifications

### 6.1 Daily digest scheduler

| Field | Value |
|---|---|
| Test file | `tests/dailyDigestScheduler.test.ts` |
| What it covers | Scheduling, delivery, timezone handling, immediate-send on enable |
| Expectation | All tests pass |
| Actual | |
| Status | |

### 6.2 Vacancy reminders

| Field | Value |
|---|---|
| Test file | `tests/vacancyReminders.test.ts` |
| What it covers | Set/cancel reminders, delivery, backoff |
| Expectation | All tests pass |
| Actual | |
| Status | |

### 6.3 Application follow-up scheduler

| Field | Value |
|---|---|
| Test file | `tests/applicationFollowUpScheduler.test.ts` |
| What it covers | Follow-up scheduling, delivery keyboard, reschedule, close |
| Expectation | All tests pass |
| Actual | |
| Status | |

### 6.4 Pending notification queue (quiet hours)

| Field | Value |
|---|---|
| Test file | `tests/pendingNotificationQueue.test.ts` |
| What it covers | Quiet hours enqueue, delivery after quiet period, backoff, dead-letter |
| Expectation | All tests pass |
| Actual | |
| Status | |

### 6.5 Instant vacancy notifications

| Field | Value |
|---|---|
| Test file | `tests/instantVacancyNotifications.test.ts` |
| What it covers | Toggle, delivery, integration with quiet hours |
| Expectation | All tests pass |
| Actual | |
| Status | |

---

## 7. Database & Migration

### 7.1 Database migration

| Field | Value |
|---|---|
| Test file | `tests/databaseMigration.test.ts` |
| What it covers | Schema evolution, CHECK constraint changes, idempotent re-runs |
| Expectation | All tests pass |
| Actual | |
| Status | |

### 7.2 Backup & restore

| Field | Value |
|---|---|
| Test file | `tests/databaseBackup.test.ts`, `tests/automaticBackup.test.ts` |
| Expectation | All tests pass |
| Actual | |
| Status | |

### 7.3 Technical data cleanup

| Field | Value |
|---|---|
| Test file | `tests/technicalDataCleanup.test.ts` |
| Expectation | All tests pass |
| Actual | |
| Status | |

---

## 8. Security

### 8.1 SQL injection guards

| Field | Value |
|---|---|
| Test file | `tests/sqlInjection.test.ts` |
| Expectation | All tests pass |
| Actual | |
| Status | |

### 8.2 Config security

| Field | Value |
|---|---|
| Test file | `tests/configSecurity.test.ts` |
| What it covers | Secret exposure prevention, env validation |
| Expectation | All tests pass |
| Actual | |
| Status | |

### 8.3 Owner access control

| Field | Value |
|---|---|
| Test file | `tests/ownerAccess.test.ts` |
| What it covers | Owner-only command gating, role enforcement, user management access |
| Expectation | All tests pass |
| Actual | |
| Status | |

---

## 9. Admin & Reports

### 9.1 Quality audit handler

| Field | Value |
|---|---|
| Test file | `tests/qualityAuditHandler.test.ts`, `tests/rejectedMatchAudit.test.ts` |
| Expectation | All tests pass |
| Actual | |
| Status | |

### 9.2 Fuzzy dedup report

| Field | Value |
|---|---|
| Test file | `tests/fuzzyDedupReport.test.ts` |
| Expectation | All tests pass |
| Actual | |
| Status | |

### 9.3 Matching quality report

| Field | Value |
|---|---|
| Test file | `tests/matchingQualityReport.test.ts` |
| Expectation | All tests pass |
| Actual | |
| Status | |

### 9.4 Weekly owner reports

| Field | Value |
|---|---|
| Test file | `tests/weeklyReport.test.ts`, `tests/weeklyRetentionReport.test.ts`, `tests/weeklyOwnerReportScheduler.test.ts` |
| Expectation | All tests pass |
| Actual | |
| Status | |

---

## 10. Utilities & Helpers

### 10.1 Contact extraction

| Field | Value |
|---|---|
| Test file | `tests/contactExtractor.test.ts` |
| Expectation | All tests pass |
| Actual | |
| Status | |

### 10.2 Language detection

| Field | Value |
|---|---|
| Test file | `tests/vacancyLanguageDetection.test.ts` |
| Expectation | All tests pass |
| Actual | |
| Status | |

### 10.3 Details extraction

| Field | Value |
|---|---|
| Test file | `tests/vacancyDetailsExtractor.test.ts` |
| Expectation | All tests pass |
| Actual | |
| Status | |

### 10.4 Runtime settings

| Field | Value |
|---|---|
| Test file | `tests/runtimeSettings.test.ts`, `tests/runtimeSettingValidation.test.ts` |
| Expectation | All tests pass |
| Actual | |
| Status | |

---

# Ручная проверка пользователем

> Для выполнения требуется: Telegram-клиент, тестовый бот, тестовый чат.
> Ожидаемое время: 20–30 минут.

## Подготовка

```text
Тестовый бот: @...
Тестовый чат: ...
Владелец: @...
Дата проверки: ...
```

## Сценарии

### M1. Полный цикл onboardига

| Шаг | Действие | Ожидание | Ошибка |
|---|---|---|---|
| 1 | Найти бота в Telegram, нажать `/start` | Появляется intro-сообщение с приветствием и кнопкой `Начать` | Нет ответа, ошибка API |
| 2 | Нажать `Начать` | Появляется экран welcome с описанием возможностей и выбором: `Выбрать пресет`, `Настроить вручную`, `Пропустить` | Кнопки не работают, текст нечитаем |
| 3 | Нажать `Выбрать пресет` | Открывается список пресетов с прогнозом совпадений | Список пуст, прогноз не загружается |
| 4 | Выбрать любой пресет | Появляется экран выбора языка: `Русский+Английский`, `Только русский`, `Только английский` | Нет реакции |
| 5 | Нажать `Русский+Английский` | Onboarding завершён, показано главное меню. Бот отправляет первую подборку вакансий (если есть совпадения) | Нет меню, нет подборки, ошибка |
| 6 | Нажать `/start` повторно | Показывается главное меню (без повторного onboardига) | Снова запускается onboarding |

**Результат:** `[ ] PASS` `[ ] FAIL`
**Комментарий:**
**Скриншот:** экран после шага 5

---

### M2. Еженедельная подборка

| Шаг | Действие | Ожидание | Ошибка |
|---|---|---|---|
| 1 | В главном меню нажать `🗂️ Подборка вакансий` | Появляется список вакансий с номерами, кнопками пагинации | Пустой экран, ошибка «нет данных» без объяснения |
| 2 | Нажать номер вакансии | Открывается карточка vacancy с действиями: `Сохранить`, `Откликнуться`, `Скрыть`, `Напомнить` | Карточка не открывается, текст битый |
| 3 | Нажать `Развернуть текст` (если доступно) | Показывается полный текст вакансии | Текст не отличается от краткого, текст пуст |
| 4 | Нажать `↩️ К выдаче` | Возврат к списку подборки на том же месте | Возврат в начало списка, потеря позиции |
| 5 | Нажать кнопки пагинации (`←`, `→`) | Список переключается между страницами | Страница не меняется, дубликаты |

**Результат:** `[ ] PASS` `[ ] FAIL`
**Комментарий:**
**Скриншот:** карточка вакансии с действиями

---

### M3. Действия с вакансией: Сохранить / Откликнуться / Скрыть

| Шаг | Действие | Ожидание | Ошибка |
|---|---|---|---|
| 1 | В карточке вакансии нажать `💾 Сохранить` | Кнопка меняется на `💾 Сохранено`; вакансия появляется в `Мои вакансии → Сохранённые` | Кнопка не меняется, ошибка в консоли |
| 2 | Вернуться в меню, войти в `Мои вакансии → Сохранённые` | Сохранённая вакансия отображается в списке | Список пуст |
| 3 | Нажать `✖️ Очистить` на сохранённой | Вакансия удаляется из сохранённых | Ошибка удаления |
| 4 | В карточке нажать `✉️ Откликнуться` | Появляется запрос: напоминание через 3 дня / через неделю / пропустить + добавить заметку | Кнопка не работает |
| 5 | Выбрать `3 дня` | Вакансия в `Отклики`. Follow-up запланирован. | Нет в откликах |
| 6 | В карточке нажать `👁️ Скрыть` | Вакансия удаляется из выдачи. Появляется короткий опрос причины скрытия (6 кнопок + пропустить) | Вакансия не скрывается, опрос не появляется |
| 7 | Выбрать причину скрытия | Опрос закрывается. Вакансия в `Мои вакансии → Скрытые` с указанной причиной | Причина не сохраняется |
| 8 | В скрытых нажать `Вернуть` | Вакансия возвращается в выдачу | Ошибка возврата |

**Результат:** `[ ] PASS` `[ ] FAIL`
**Комментарий:**
**Скриншот:** после шага 6 (опрос причины)

---

### M4. Напоминания

| Шаг | Действие | Ожидание | Ошибка |
|---|---|---|---|
| 1 | В карточке нажать `⏰ Напомнить` | Появляются варианты: `Вечером`, `Завтра`, `Через 3 дня` | Нет вариантов |
| 2 | Выбрать `Завтра` | Кнопка меняется на `⏰ Напоминание`; напоминание запланировано | Не запланировано |
| 3 | Зайти в `Мои вакансии → Напоминания` | Видна вакансия с запланированным напоминанием | Список пуст |
| 4 | Нажать `Отменить напоминание` | Напоминание удалено | Ошибка отмены |

**Результат:** `[ ] PASS` `[ ] FAIL`
**Комментарий:**

---

### M5. Уведомления и настройки

| Шаг | Действие | Ожидание | Ошибка |
|---|---|---|---|
| 1 | Главное меню → `Настройки` | Открывается экран уведомлений: `Мгновенные уведомления`, `Ночная пауза`, `Утренний дайджест`, `Пустой цикл` — каждый с toggle | Нет экрана |
| 2 | Включить `Мгновенные уведомления` | Кнопка меняется на `✅ Мгновенные уведомления: включены` | Не переключается |
| 3 | Включить `Ночная пауза 23:00–08:00` | Кнопка меняется | Не переключается |
| 4 | Включить `Утренний дайджест` | Приходит дайджест немедленно (если есть actionable элементы) или сообщение «пока ничего нет» | Нет реакции |
| 5 | Вернуться в меню → `Мои фильтры` | Открывается список поисковых профилей | Нет профилей |

**Результат:** `[ ] PASS` `[ ] FAIL`
**Комментарий:**

---

### M6. Поисковые профили

| Шаг | Действие | Ожидание | Ошибка |
|---|---|---|---|
| 1 | `Мои фильтры` → нажать существующий профиль | Открывается деталь профиля: ключевые слова, язык, здоровье профиля, кнопки: редактировать, пересобрать, сбросить, удалить, показать выдачу | Нет детали |
| 2 | Нажать `Редактировать` → изменить ключевые слова | Ключевые слова обновлены | Не сохраняются |
| 3 | Нажать `➕ Добавить профиль` → `Из пресета` | Выбор пресета с прогнозом | Нет пресетов |
| 4 | Выбрать пресет → сохранить | Новый профиль появляется в списке | Не появляется |

**Результат:** `[ ] PASS` `[ ] FAIL`
**Комментарий:**

---

### M7. Админ-панель (владелец)

| Шаг | Действие | Ожидание | Ошибка |
|---|---|---|---|
| 1 | Отправить `/admin` | Открывается админ-панель: статус бота, кнопки: `Пауза/Продолжить`, `Каналы`, `Источники`, `Trusted services`, `Настройки`, `Пользователи` | Нет ответа, доступ запрещён |
| 2 | Нажать `Trusted services` | Список сервисов с их статусом | Список пуст |
| 3 | Нажать `Настройки` | Показаны runtime-параметры с возможностью редактирования | Не открывается |
| 4 | Отправить `/backup` | Приходит файл БД | Нет файла, ошибка |

**Результат:** `[ ] PASS` `[ ] FAIL`
**Комментарий:**

---

### M8. Пустая выдача и диагностика

| Шаг | Действие | Ожидание | Ошибка |
|---|---|---|---|
| 1 | Создать профиль с заведомо узкими/невозможными ключевыми словами | При попытке открыть выдачу — диагностика: здоровье профиля, статус источников, что было отфильтровано | Нет диагностики, пустой экран без объяснения |
| 2 | Нажать `❓ Почему нет результатов` (если доступно) | Расшифровка: нет данных за период, слишком строг фильтр, источники неактивны | Кнопка отсутствует, информация бесполезна |

**Результат:** `[ ] PASS` `[ ] FAIL`
**Комментарий:**

---

### M9. Обработка ошибок и крайние случаи

| Шаг | Действие | Ожидание | Ошибка |
|---|---|---|---|
| 1 | Отправить произвольный текст боту | Бот игнорирует или отвечает «не понял команду» | Бот падает, ошибка в консоли |
| 2 | Отправить `/admin` от имени не-admin пользователя | Доступ запрещён, сообщение об ошибке | Молчаливый игнор, открытие админки |
| 3 | Отправить `/backup` от имени не-owner пользователя | Доступ запрещён | Бот отправляет БД |
| 4 | Отправить невалидный callback (вручную в URL или через клик на устаревшую кнопку) | Бот не падает, проигнорирует или покажет ошибку | Бот крашится |

**Результат:** `[ ] PASS` `[ ] FAIL`
**Комментарий:**

---

### M10. Недельная выдача в разных разрезах

| Шаг | Действие | Ожидание | Ошибка |
|---|---|---|---|
| 1 | В подборке нажать `3 дня` / `7 дней` / `14 дней` / `30 дней` | Количество вакансий меняется соответственно (если данные есть) | Количество не меняется, ошибка |
| 2 | Открыть карточку из подборки за `30 дней` | Карточка открывается; при возврате в выдачу — возвращается к тому же окну 30 дней | Сброс на 7 дней |
| 3 | В деталях профиля нажать `👁️ Выдача по профилю` | Открывается подборка только по этому профилю с информацией о профиле | Ошибка, не отличается от общей выдачи |

**Результат:** `[ ] PASS` `[ ] FAIL`
**Комментарий:**

---

## Сводка ручной проверки

| Сценарий | Статус |
|---|---|
| M1. Полный цикл onboardига | `[ ] PENDING USER` |
| M2. Еженедельная подборка | `[ ] PENDING USER` |
| M3. Действия с вакансией | `[ ] PENDING USER` |
| M4. Напоминания | `[ ] PENDING USER` |
| M5. Уведомления и настройки | `[ ] PENDING USER` |
| M6. Поисковые профили | `[ ] PENDING USER` |
| M7. Админ-панель | `[ ] PENDING USER` |
| M8. Пустая выдача | `[ ] PENDING USER` |
| M9. Обработка ошибок | `[ ] PENDING USER` |
| M10. Недельная выдача | `[ ] PENDING USER` |

```text
Всего ручных сценариев: 10
Пройдено: 0
Провалено: 0
Ожидают пользователя: 10
```
