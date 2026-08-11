# Next Task

## Active: Telegram smoke audit — automated baseline

Status: automated checks completed, manual checklist awaits user.

Product phase: source quality and vacancy relevance (пункт 2: ручной Telegram smoke).

Parent task: `docs/qa/TELEGRAM_SMOKE_CHECKLIST.md`.

## Goal

Prepare and execute a Telegram smoke audit covering:

- Onboarding flow
- Weekly feed and vacancy cards
- Vacancy actions (save, apply, hide, remind)
- Settings and notifications
- Admin/owner panel (pause, channels, trusted services, backup)
- Diagnostics and empty-state flows

Automated checks are run by the executor. Manual checks require a live Telegram bot and are executed by the user.

## Results

- Automated results: `docs/qa/TELEGRAM_SMOKE_RESULTS.md`
- Manual checklist: `docs/qa/TELEGRAM_SMOKE_CHECKLIST.md` (section `# Ручная проверка пользователем`)

## After this task

1. User executes manual checklist (20–30 min).
2. Create a follow-up PR with bug fixes or a confirmation of stability.
3. Resume next product phase from `docs/product/ROADMAP.md`.
