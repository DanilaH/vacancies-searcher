# Decisions

These decisions are already made. Do not accidentally reverse them during focused work.

## Product / Source Model

- Use `fetch once -> store once -> match many`.
- Sources are global; matching is per-user/per-profile.
- Do not disable or slow channels based on one user's filters.
- Telegram web preview is the default production mode.
- MTProto credentials are optional and env-only.
- MTProto session secrets are never entered through Telegram UI and are not stored in SQLite.
- Channel discovery never auto-adds active channels; owner approval is required.
- hh.ru implementation exists but user-facing buttons are hidden until API/compliance is resolved.

## Access / RBAC

- Public mode is enabled: unknown users auto-register as active `member`.
- Manually disabled users stay blocked until owner enables them again.
- `admin` can manage safe admin areas.
- Backup export and user management are owner-only.
- `/whoami` was removed.

## Trusted Vacancy Services

- Trusted vacancy services are not polling sources.
- They only enrich links already found inside vacancies.
- Trust is exact-host only and does not include subdomains.
- Do not trust broad domains generically when only a path is safe.
- Fetch only public HTTPS URLs.
- Reject redirects.
- Perform DNS/private-IP checks.
- Enforce timeout, response-size limit, and request delay.
- A definitive external non-vacancy result prevents posting the vacancy.
- Temporary network/DNS/timeout/5xx failures do not discard the Telegram vacancy.
- `findmyremote.ai` is active and uses a specialized adapter.
- `teletype.in` is active and uses a specialized adapter.
- Teletype accepts only article-shaped URLs: `teletype.in/@author/slug`.
- Teletype rejects missing pages or pages without confident vacancy content.

## Multi-Vacancy Posts

- Structured Telegram aggregator posts may split into child vacancies only with high confidence.
- Ambiguous posts stay as one vacancy.
- Each child keeps the original Telegram post as main URL.
- Child vacancy external link becomes `canonical_url`.
- Polling cursor must use the original Telegram numeric message ID, not child ID.
- Repair of old multi-vacancy posts is opt-in through script and is dry-run by default.

## Matching / Cards

- Vacancy extraction for cards is presentation-only.
- Extraction must not affect matching unless explicitly designed.
- Resume/candidate filtering is part of base candidate and rematch flow.
- Language mode affects matching, not source polling.
- Unknown card fields should usually be hidden or shown as "clarify"; absence is not a risk by itself.

## Engineering Constraints

- Do not rewrite the whole bot layer or DB layer for a focused task.
- Keep `VacancyDatabase` as the DB facade.
- Do not change callback data, command scopes, analytics event names, or public DB semantics without explicit reason.
- Do not add dependencies without user approval.
- Do not introduce AI/API parsing without explicit approval.
- Preserve tests and add focused tests for parser/security behavior.
- Use `apply_patch` for manual file edits.
- Do not print `.env` or secrets.
