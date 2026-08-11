# Deploying the vacancy bot on a shared VPS with Docker

This runbook targets an ordinary Linux VPS with Docker Engine and Docker Compose v2. The bot publishes no host ports and does not require Nginx, a domain, or TLS, so it can run next to existing services without a port conflict.

## What is persisted

The container filesystem is read-only. All persistent state is stored through the bind mount:

```text
host: ./data
container: /app/data
```

This includes the SQLite database, runtime heartbeat, automatic backups, and other runtime state. Running `docker compose down` does not remove this directory.

## 1. Prerequisites

Check the existing VPS installation:

```bash
docker --version
docker compose version
git --version
df -h
free -h
```

Use a normal deployment directory instead of mixing the bot with another service:

```bash
sudo install -d -m 755 /opt/vacancies-searcher
sudo chown "$USER":"$USER" /opt/vacancies-searcher
cd /opt/vacancies-searcher
git clone https://github.com/DanilaH/vacancies-searcher.git .
```

If the repository is private, use an SSH deploy key or another GitHub-supported credential configured on the VPS. Do not put a GitHub token into the repository or Compose file.

## 2. Configure secrets

Create the runtime environment from the committed template:

```bash
cp .env.example .env
chmod 600 .env
nano .env
```

Minimum required values:

```env
BOT_TOKEN=...
OWNER_CHAT_ID=...
OWNER_USER_ID=...
TELEGRAM_SOURCE_MODE=web
DATABASE_URL=file:./data/bot.db
```

Keep `TELEGRAM_SOURCE_MODE=web` unless a valid MTProto session has already been generated locally. Never commit or print `.env`.

## 3. Prepare persistent storage

The production image runs as the unprivileged Node user with UID/GID `1000`. Prepare the bind-mounted directory:

```bash
install -d -m 700 data
sudo chown -R 1000:1000 data
```

If an existing database is being migrated, stop the old bot first, copy its database and runtime data into `data/`, then apply the ownership command again. Do not run two bot instances with the same Telegram token or the same SQLite file.

## 4. Validate and start

Validate Compose and build the exact production image:

```bash
docker compose config --quiet
docker compose build --pull
docker compose up -d
```

The service does not expose a port. It communicates outbound with Telegram and configured vacancy sources.

Check startup:

```bash
docker compose ps
docker compose logs --tail=100 vacancy-bot
docker compose exec vacancy-bot node dist/healthcheck.js
```

Expected healthcheck output:

```text
ok
```

The owner should also receive the startup diagnostic in Telegram.

## 5. Routine operations

Follow logs:

```bash
docker compose logs -f --tail=100 vacancy-bot
```

Restart:

```bash
docker compose restart vacancy-bot
```

Check resource consumption alongside the other services:

```bash
docker stats --no-stream
docker system df
```

Docker JSON logs are limited to three files of 10 MB each by `docker-compose.yml`.

## 6. Safe update

Run updates from `/opt/vacancies-searcher`.

Record the currently deployed revision:

```bash
git rev-parse HEAD > .deploy-previous-sha
```

Create an offline backup before replacing the container:

```bash
docker compose stop vacancy-bot
backup_file="../vacancies-searcher-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
tar -czf "$backup_file" .env data
chmod 600 "$backup_file"
docker compose start vacancy-bot
```

Then update and rebuild:

```bash
git switch master
git pull --ff-only origin master
docker compose config --quiet
docker compose build --pull
docker compose up -d
docker compose ps
docker compose exec vacancy-bot node dist/healthcheck.js
```

Review the last startup messages:

```bash
docker compose logs --tail=100 vacancy-bot
```

## 7. Rollback

If the new revision fails, return to the recorded commit without deleting `data/`:

```bash
docker compose down
git switch --detach "$(cat .deploy-previous-sha)"
docker compose build
docker compose up -d
docker compose exec vacancy-bot node dist/healthcheck.js
```

After the incident is resolved, return to the tracked branch with `git switch master`.

If application data also needs to be restored, stop the service first and extract the selected backup. Restoring an old database discards changes created after that backup, so preserve the current `data/` directory separately before restoration.

## 8. Backup retention

The application creates SQLite snapshots under `data/runtime/backups` when automatic backup is enabled. These snapshots are still stored on the same VPS and do not protect against total disk or server loss.

Periodically copy an encrypted backup outside the VPS. Treat `.env`, SQLite files, and backup archives as sensitive.

## 9. Coexistence with other services

The Compose project has the explicit name `vacancies-searcher` and service name `vacancy-bot`. It creates its own default Docker network and publishes no ports.

Before deployment, confirm that no old copy of the same bot is running:

```bash
docker ps --format 'table {{.Names}}\t{{.Status}}'
ps aux | grep -E '[n]ode .*dist/index.js|[t]sx .*src/index.ts'
```

Only one instance may use a given Telegram bot token. A second instance can consume updates concurrently and produce duplicate or inconsistent behavior.

## 10. Troubleshooting

Container is unhealthy:

```bash
docker compose ps
docker compose logs --tail=200 vacancy-bot
docker compose exec vacancy-bot node dist/healthcheck.js
```

Permission error for SQLite or heartbeat:

```bash
sudo chown -R 1000:1000 data
chmod 700 data
docker compose restart vacancy-bot
```

Configuration error:

```bash
docker compose config --quiet
docker compose run --rm vacancy-bot node dist/healthcheck.js
```

The standalone healthcheck expects the runtime heartbeat and may fail before the main bot has started. Use `docker compose logs` to diagnose first-start configuration failures.

Disk pressure:

```bash
df -h
docker system df
du -sh data
```

Do not run `docker system prune --volumes` on a shared VPS without reviewing every affected service.
