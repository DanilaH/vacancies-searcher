# Next Task

Branch `feat/vacancy-relevance-feedback` is ready for PR.

## What's Done

- Story A (DB): `vacancy_relevance_feedback` table, migration, `upsert/get/clear` methods.
- Story B (Keyboard): `createVacancyKeyboardWithActions` accepts optional `relevanceValue`, shows "👍 Релевантна" button with `✅` checkmark when value is `relevant`.
- Story C (Handler): hide handler records `not_relevance` + analytics; new callback `vacancy:relevance:{id}:relevant:{view}:{origin}` stores positive feedback, edits keyboard with checkmark.
- Story D (Tests): 11 new tests (9 DB-level + handler test via real `handleUpdate`), existing keyboard tests updated → 423 total.

## Verification (all passed)

- `npx tsc -p tsconfig.json --pretty false`
- `npm test` (423/423)
- `npm run build`

## Next Action

Open a PR against `master` — don't merge. Recommended PR title: `feat: add vacancy relevance feedback (👍/👎 buttons)`.

## Prompt For Executor

```text
You are on branch feat/vacancy-relevance-feedback. The feature is fully implemented and verified:
- Vacancy action cards now have 👍 Релевантна / 👎 Не подходит buttons
- "👎 Не подходит" doubles as hide + negative relevance feedback
- Positive feedback does NOT change vacancy status
- DB, API, keyboard, handler, analytics, and 11 new tests are complete

All checks pass (tsc, build, npm test). Open a PR against master with title "feat: add vacancy relevance feedback (👍/👎 buttons)". Do NOT merge.
```
