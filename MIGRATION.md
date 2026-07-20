# Migration to Another VPS

The migration target is simple: move `.env` and `data/`, then start the service with `docker compose up -d --build`.

## What to copy

- `.env`
- `data/bot.db`
- optional extra files from `data/` if you deliberately keep them there
- `TELEGRAM_SESSION` inside `.env` if `mtproto` is ever enabled later

## What lives in SQLite

The database stores:

- fetched and matched vacancies
- deduplication state
- user roles and access state
- monitored channels
- runtime setting overrides
- onboarding state and personal search profiles
- user vacancy states such as `saved`, `hidden`, and `applied`

After migration the bot should not resend old vacancies just because the host changed.

## Persistent paths

On the host:

```txt
./data
```

Inside the container:

```txt
/app/data
```

Required volume:

```yaml
volumes:
  - ./data:/app/data
```

## Restore flow

```bash
git clone <repo-url> vacancy-bot
cd vacancy-bot
tar -xzf vacancy-bot-backup.tar.gz
docker compose up -d --build
```

## Post-restore checks

```bash
docker compose ps
docker compose logs -f vacancy-bot
```

Expected behavior:

- the bot starts successfully
- owner/admin/member access survives the move
- owner-only actions remain owner-only
- old vacancies are not resent automatically
- personal filters, runtime overrides, and channel registry remain intact
- the startup diagnostic still reaches `OWNER_CHAT_ID` if configured

## Security notes

- `data/` and `runtime/` should be readable and writable only by the service account running the bot.
- Backup snapshots contain the full SQLite database and must be treated as sensitive artifacts.
- Telegram `owner` access is equivalent to data export capability.
- This version does not add encryption-at-rest, so host security and filesystem permissions still matter.
