# Production deployment

This document describes how the production VPS gets a new version of the bot.

## Branch model

| Branch | Deploys to | Notes |
|---|---|---|
| `feature/*`, `fix/*`, `ops/*` | nowhere | work branches; merged via PR |
| `master` | nowhere | integration branch; changes reach production only after being merged into `develop` |
| `develop` | production VPS | push to this branch triggers the automated deploy |

Flow: `feature/* → master → develop → VPS`.

The deployment trigger is `.github/workflows/deploy-production.yml`.
It runs only for pushes to `develop` (or manual `workflow_dispatch`),
never for pushes to `master`. The workflow uses the GitHub Environment
`production` and a concurrency lock so only one deployment runs at a time.

## What happens on a push to develop

1. GitHub Actions starts the `Deploy Production` workflow with the exact
   commit SHA of the push (`github.sha`).
2. SSH credentials are prepared from GitHub secrets on the runner.
3. The runner connects to the VPS and executes
   `scripts/deploy-vps.sh <full-sha>` in the project directory.
4. The script:
   - validates the SHA (must be exactly 40 lowercase hex characters and
     reachable from `origin/develop`);
   - refuses to run if the working tree has unexpected tracked changes,
     or `docker-compose.yml` / `.env` / `data/` are missing;
   - stops the bot container and creates a backup archive
     `deploy-backups/vacancies-searcher-<UTC-timestamp>-<previous-sha>.tar.gz`
     containing `.env` and `data/`;
   - checks out the exact commit with `git checkout --detach <sha>`;
   - rebuilds the image, starts the container, and waits for the
     application healthcheck (`node dist/healthcheck.js`) to pass;
   - on failure, rolls back to the previous commit, rebuilds and restarts
     it, and exits non-zero (2 if rollback succeeded, 3 if it also failed).

SQLite data is never restored from backup automatically: the deployment
only stops and restarts the same container, and the `data/` directory is
mounted into it. The backup is a safety net for manual recovery only.

## GitHub secrets

| Secret | Purpose |
|---|---|
| `VPS_HOST` | SSH host of the VPS |
| `VPS_PORT` | SSH port of the VPS |
| `VPS_USER` | SSH user that owns the project directory |
| `VPS_SSH_PRIVATE_KEY` | private key used by the workflow to connect |
| `VPS_SSH_HOST_KEY` | expected host key line, used for `StrictHostKeyChecking=yes` |
| `VPS_DEPLOY_PATH` | absolute path of the project directory on the VPS |

Secrets are only read by the workflow; the deploy script never prints
`.env` or environment contents.

## One-time VPS preparation

1. Create a dedicated deploy user (or use a user that owns the project):
   ```bash
   sudo useradd --create-home --shell /bin/bash deploy
   sudo -u deploy mkdir -p /opt/vacancies-searcher
   ```
2. Clone the repository:
   ```bash
   sudo -u deploy git clone https://github.com/<org>/<repo>.git /opt/vacancies-searcher
   ```
3. Create `.env` from `.env.example` and fill in real secrets:
   ```bash
   sudo -u deploy cp /opt/vacancies-searcher/.env.example /opt/vacancies-searcher/.env
   sudo -u deploy chmod 600 /opt/vacancies-searcher/.env
   sudo -u deploy mkdir -p /opt/vacancies-searcher/data
   ```
   The deploy script refuses to run without `.env` and `data/`.
4. Add the remote as `origin` (the script fetches `origin/develop`):
   ```bash
   sudo -u deploy git -C /opt/vacancies-searcher remote add origin <ssh-or-https-url>
   sudo -u deploy git -C /opt/vacancies-searcher fetch origin
   ```
5. Build once manually and verify the stack starts:
   ```bash
   sudo -u deploy docker compose build
   sudo -u deploy docker compose up -d
   sudo -u deploy docker compose exec vacancy-bot node dist/healthcheck.js
   ```
6. Generate the deploy key pair and authorize it:
   ```bash
   ssh-keygen -t ed25519 -f deploy_key -N '' -C 'github-actions-deploy'
   sudo -u deploy bash -c 'mkdir -p ~/.ssh && chmod 700 ~/.ssh'
   sudo -u deploy bash -c 'cat deploy_key.pub >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys'
   ```
   Put the private key into the `VPS_SSH_PRIVATE_KEY` GitHub secret.
7. Get the expected host key line directly on the VPS and put it into the
   `VPS_SSH_HOST_KEY` GitHub secret:
   ```bash
   ssh-keyscan -H -p 22 localhost
   ```
   (the GitHub runner uses it with `StrictHostKeyChecking=yes`).

## Local master test stand

`master` is the integration branch and is not deployed anywhere, so the
existing manual runbook `docs/operations/vps-docker.md` still applies when
running a local stand from `master`. Use the same Docker Compose project
(`vacancies-searcher`), a separate `.env` and a separate `data/`
directory, so the local stand never points at production data.

## Manual deployment

A push to `develop` is enough; the workflow handles the rest. For an
out-of-band deploy (e.g. re-running a failed deploy), use
`workflow_dispatch` on the workflow page — the script skips the
deployment when the target commit is already deployed.

## Recovery

- Deployment failed, rollback succeeded: the old version is running, the
  failed commit is in `deploy-backups/` on the VPS, and the workflow run
  is red.
- Deployment failed, rollback failed too: the server keeps the backup in
  `deploy-backups/`; recover manually with the runbook
  `docs/operations/vps-docker.md` (backup archives are not auto-restored).
