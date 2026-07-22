# Next Task

Only one immediate implementation task belongs in this file.

## Active: trusted adapter research for `job.mts.ru`

Status: in progress in a separate executor branch.

Product phase: source quality and vacancy relevance.

Parent task: `docs/tasks/TASK-001-trusted-service-coverage.md`.

## Goal

Research real public `job.mts.ru` vacancy pages and add a safe trusted adapter only if the implementation can prove:

- an exact public hostname;
- a narrow vacancy URL shape;
- a stable JSON-LD or specialized vacancy signal;
- reliable rejection of lists, content pages, subdomains and malformed paths;
- preservation of Telegram-only ingestion on temporary failures.

If that safety case cannot be proven, deliver a research-only PR without a production adapter.

## Required delivery workflow

1. Work in a feature branch created from the current `master`.
2. Keep the PR limited to `job.mts.ru`.
3. Add focused URL, parser, ingestion and migration tests when code/schema changes.
4. Run the full verification baseline.
5. Push the branch and open a PR into `master`.
6. Stop for review; do not self-merge.

## Verification

```bash
node --import tsx --test \
  tests/trustedVacancyServices.test.ts \
  tests/trustedVacancyIngestor.test.ts \
  tests/databaseMigration.test.ts

npm test
npx tsc -p tsconfig.json --pretty false
npm run build
```

## After this task

Do not select the next product task from this file. After review and merge:

1. update `docs/STATUS.md`;
2. consult the fixed order in `docs/product/ROADMAP.md`;
3. write exactly one new immediate task here.
