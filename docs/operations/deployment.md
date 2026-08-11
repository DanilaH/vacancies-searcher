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
2. The workflow validates the GitHub secrets (presence and format) and
   prepares SSH credentials on the runner.
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
`.env` or environment contents. Before SSH, the workflow runs
`scripts/validate-deploy-secrets.sh`, which requires every secret to be
present and checks the shapes: `VPS_PORT` must be an integer between 1
and 65535, `VPS_HOST` a hostname or IP without shell metacharacters,
`VPS_USER` a valid SSH username, and `VPS_DEPLOY_PATH` an absolute path
containing only safe characters.

## One-time VPS preparation

1. Create a dedicated deploy user and grant it Docker access:

   ```bash
   sudo useradd --create-home --shell /bin/bash deploy
   sudo usermod -aG docker deploy
   ```

   Group membership only takes effect for new login sessions, so either
   log out and back in, or start a fresh session (`su - deploy`) before
   running any `docker` commands as this user.

2. Prepare the project directory from root (`/opt` belongs to root, so
   `sudo -u deploy mkdir /opt/...` would fail) and clone the repository:

   ```bash
   sudo install -d -m 755 -o deploy -g deploy /opt/vacancies-searcher
   sudo -u deploy git clone https://github.com/<org>/<repo>.git /opt/vacancies-searcher
   ```

3. Create `.env` from `.env.example` and fill in real secrets:

   ```bash
   sudo -u deploy cp /opt/vacancies-searcher/.env.example /opt/vacancies-searcher/.env
   sudo -u deploy chmod 600 /opt/vacancies-searcher/.env
   ```

   The deploy script refuses to run without `.env` and `data/`.

4. Prepare the persistent data directory for the container user. The
   container runs as the `node` user (UID 1000, see the Dockerfile), so
   `data/` must be writable by UID 1000. The deploy script archives
   `data/` into backups, so the `deploy` user needs read access as well;
   a plain `700` directory owned by `1000:1000` would break the backup
   step. The group is `docker` because `deploy` is already a member:

   ```bash
   sudo install -d -m 750 -o 1000 -g docker /opt/vacancies-searcher/data
   ```

   Resulting permissions:

   - UID 1000 (container `node` user) — read/write;
   - group `docker` (the `deploy` user) — read/execute, enough for backups;
   - everyone else — no access.

5. The clone already created `origin`, so the remote is never re-added.
   All git commands must run as the `deploy` user, which owns the
   repository — running them from `root` makes modern Git abort with
   `detected dubious ownership`. Only fix the URL if the clone used a
   different one (optional), then fetch:

   ```bash
   sudo -u deploy git -C /opt/vacancies-searcher remote set-url origin <repository-url>
   sudo -u deploy git -C /opt/vacancies-searcher fetch origin develop
   ```

   (The deploy script fetches `origin/develop` on every run.)

6. Build once manually and verify the stack starts:

   ```bash
   sudo -u deploy docker compose build
   sudo -u deploy docker compose up -d
   sudo -u deploy docker compose exec vacancy-bot node dist/healthcheck.js
   ```

7. Generate the deploy key pair on the administrator's local machine
   (not on the VPS, so the steps do not depend on the current directory):

   ```bash
   ssh-keygen -t ed25519 -f github-actions-deploy -N '' -C 'github-actions-deploy'
   ```

   Add the **public** key to the VPS using explicit absolute paths:

   ```bash
   sudo install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
   printf '%s\n' '<PUBLIC_KEY>' | sudo tee -a /home/deploy/.ssh/authorized_keys >/dev/null
   sudo chown deploy:deploy /home/deploy/.ssh/authorized_keys
   sudo chmod 600 /home/deploy/.ssh/authorized_keys
   ```

   Put the **private** key into the `VPS_SSH_PRIVATE_KEY` GitHub secret.
   Never copy it into the repository and never print its contents.

8. Get the expected host key directly from the server's own key files and
   put it into the `VPS_SSH_HOST_KEY` GitHub secret:

   ```bash
   sudo cat /etc/ssh/ssh_host_ed25519_key.pub
   ```

   The file contains a line like `ssh-ed25519 AAAA...`. Build the secret
   value from the **real `VPS_HOST` value** (hostname or IP) plus that
   key. For the default SSH port the record is:

   ```text
   example.com ssh-ed25519 AAAA...
   ```

   For a non-standard port:

   ```text
   [example.com]:2222 ssh-ed25519 AAAA...
   ```

   The GitHub runner connects to `VPS_HOST` with `StrictHostKeyChecking=yes`
   and `UserKnownHostsFile` pointing at this record, so the name inside the
   record must match `VPS_HOST` exactly (an IP address works too).

   Verify the fingerprint of the key on the VPS before trusting it:

   ```bash
   sudo ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
   ```

   Do not obtain the trusted key via `ssh-keyscan` (from the runner or
   elsewhere): `ssh-keyscan` output could be a man-in-the-middle response,
   and the whole point of `StrictHostKeyChecking=yes` is to trust only the
   key published out-of-band by the VPS administrator.

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

## GitHub branch protection for `develop` (required)

The production workflow is triggered by **any** push to `develop` — not
only by merged PRs — so `develop` must be protected from direct pushes.
Configure this after the first successful deployment:

1. Go to Settings → Branches → Add rule for `develop`.
2. Enable "Require a pull request before merging": direct pushes are
   rejected and changes land on `develop` only through a PR.
3. Require the `Quality / check` status check to pass before merging.
   The Quality workflow runs on every pull request, including
   `master → develop`, and covers `npm test`, the build, TypeScript, the
   deployment script tests, compose validation, and the Docker build.
4. Enable "Do not allow bypassing the above settings".
5. Enable "Block force pushes".
6. Enable "Require branches to be up to date before merging" so stale
   `develop` cannot overwrite newer merged changes.
7. Protect the branch from deletion (Settings → Branches → protection
   for `develop`).
8. If tighter control is needed, restrict who may merge (e.g. to the
   repository owner) via the branch rule or repository permissions.

With this rule in place, production changes flow only through a reviewed,
tested `master → develop` PR: `Quality / check` runs on the PR itself,
and the production workflow runs only on the push produced by merging it.

## Recovery

- Deployment failed, rollback succeeded: the old version is running, the
  failed commit is in `deploy-backups/` on the VPS, and the workflow run
  is red.
- Deployment failed, rollback failed too: the server keeps the backup in
  `deploy-backups/`; recover manually with the runbook
  `docs/operations/vps-docker.md` (backup archives are not auto-restored).
