# Next Task

## Active: review `ops/develop-vps-deployment` (PR #31) and set up the deploy pipeline

Status: PR open at https://github.com/DanilaH/vacancies-searcher/pull/31 — wait for review; do not self-merge.

After merge:

1. Create the GitHub Environment `production` with the 6 secrets (`VPS_HOST`, `VPS_PORT`, `VPS_USER`, `VPS_SSH_PRIVATE_KEY`, `VPS_SSH_HOST_KEY`, `VPS_DEPLOY_PATH`).
2. Prepare the VPS per `docs/operations/deployment.md` (clone, `.env`, `data/`, deploy key, host key via `ssh-keyscan -H localhost` on the VPS).
3. Create `develop` from `master`, push once, and verify the workflow end-to-end (backup → checkout → rebuild → healthcheck).
4. Then continue product research: `job.megafon.ru` trusted adapter.

## Queued: trusted adapter research for `job.megafon.ru`

Product phase: source quality and vacancy relevance.

Parent task: `docs/tasks/TASK-001-trusted-service-coverage.md`.

## Goal

Research real public `job.megafon.ru` vacancy pages and add a safe trusted adapter only if the implementation can prove:

- an exact public hostname;
- a narrow vacancy URL shape;
- a stable JSON-LD or specialized vacancy signal;
- reliable rejection of lists, content pages, subdomains and malformed paths;
- preservation of Telegram-only ingestion on temporary failures.

If that safety case cannot be proven, deliver a research-only PR without a production adapter.

## Required delivery workflow

1. Work in a feature branch created from the current `master`.
2. Keep the PR limited to `job.megafon.ru`.
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
