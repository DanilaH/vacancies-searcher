# Project Status

Last updated: 2026-07-22

## Source of truth

- Product priorities: `docs/product/ROADMAP.md`.
- Agent execution queue: `docs/ROADMAP.md`.
- Detailed implemented state: `.agent/CURRENT_STATE.md`.
- Exactly one immediate task: `.agent/NEXT_TASK.md`.

If these files conflict, current code and merged tests win for implementation facts, while `docs/product/ROADMAP.md` wins for product order.

## Current state

The bot is a production-oriented TypeScript/Node.js Telegram vacancy assistant with SQLite storage. It collects from Telegram and optional sources, matches vacancies against per-user profiles, manages vacancy/application workflows, and provides owner/admin operations.

Recent merged capabilities include:

- fuzzy near-duplicate grouping and owner report;
- instant-notification toggle;
- quiet hours with persistent delivery queue and bounded retry;
- trusted adapter for `ingamejob.com`;
- JSON-LD-only trusted adapter for `designer.ru`.

Latest accepted master checkpoint:

- PR #25 merged;
- merge commit: `08ae6b37c51fb6177eb9d3342e2f4ff4b9c05562`.

## In progress

Trusted-service research and adapter work for `job.mts.ru` is running in a separate feature branch.

This documentation sync intentionally does not modify trusted-service source, schema, tests, `.agent/CURRENT_STATE.md`, or `docs/tasks/TASK-001-trusted-service-coverage.md`, so it can proceed without conflicting with the adapter implementation.

## Next after the active adapter

1. Decide whether the short trusted-adapter cycle needs one more proven domain or should stop.
2. Run a manual Telegram UX smoke using a test bot/chat.
3. Improve “why no results” diagnostics.
4. Improve multi-vacancy aggregate isolation.
5. Add owner-facing channel quality analytics.

The fixed product order is maintained in `docs/product/ROADMAP.md`.

## Current risks

- Some candidate vacancy sites cannot be safely activated because their URL shape or parser confidence is not proven.
- Broad or subdomain trust can create false positives and SSRF-like exposure; keep exact-host and path guards.
- Telegram web preview depends on public `t.me/s` HTML and cannot read private/invite-only sources.
- Vacancy extraction still has uneven coverage for geography, company and free-form fields.
- Multi-vacancy aggregate posts can still suffer cross-vacancy stop-word or content contamination.
- A live end-to-end Telegram smoke is still required after the accumulated UX and notification changes.
- `.env` contains secrets and must never be printed or committed.

## Planning decisions

Resolved:

- `docs/product/ROADMAP.md` is the canonical product roadmap.
- `docs/ROADMAP.md` is an execution queue, not a second product roadmap.
- `.agent/NEXT_TASK.md` contains only one immediate task.
- Production work should use a bounded task, branch from current `master`, open a PR and stop for review.
- Documentation-only work may run alongside implementation when files do not overlap.

Still to decide:

- whether manual Telegram QA uses the live bot or a dedicated test bot;
- whether another trusted domain is worth implementing after `job.mts.ru`.

## Verification baseline

Production changes:

```bash
npm test
npx tsc -p tsconfig.json --pretty false
npm run build
```

Documentation-only roadmap sync:

- verify all referenced files exist;
- verify the same active task and ordering appear in roadmap, status and next-task documents;
- inspect the PR diff for accidental implementation changes.
