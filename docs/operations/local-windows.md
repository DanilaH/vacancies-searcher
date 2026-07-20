# Local Windows Operation Without Docker

This setup runs the compiled bot through Windows Task Scheduler. A small PowerShell supervisor restarts the Node process after unexpected exits.

## Install

1. Stop any existing `npm run dev` or `npm start` process.
2. Check `.env`, especially `BOT_TOKEN`, `OWNER_CHAT_ID`, `OWNER_USER_ID`, `DATABASE_URL` and `TIME_ZONE`.
3. Install dependencies and register the task:

```powershell
npm install
npm run local:install
```

The task starts at the next Windows logon. To start it immediately:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/windows/install-task.ps1 -StartNow
```

## Daily Checks

```powershell
npm run local:status
```

Expected result:

- task state is `Running` or ready for the next logon;
- healthcheck prints `ok`;
- owner receives startup/failure alerts;
- automatic SQLite snapshots appear under `data/runtime/backups`.

Supervisor and bot output is written under `logs/`.

## Update

```powershell
Stop-ScheduledTask -TaskName JobTgBot
npm install
npm run build
Start-ScheduledTask -TaskName JobTgBot
npm run local:status
```

Do not run `npm run dev` while the scheduled task is active: two bot instances would compete for Telegram updates.

## Backup And Restore

Automatic snapshots are enabled by default:

```env
AUTOMATIC_BACKUP_ENABLED=true
AUTOMATIC_BACKUP_INTERVAL_HOURS=24
AUTOMATIC_BACKUP_RETENTION_DAYS=14
```

Snapshots are created immediately after a successful bot start and then on the configured interval. Retention removes only files named `auto-backup-*.db`; manual `/backup` snapshots are not deleted.

Restore:

```powershell
Stop-ScheduledTask -TaskName JobTgBot
Copy-Item data\bot.db data\bot.db.before-restore
Copy-Item data\runtime\backups\auto-backup-YYYY-MM-DDTHH-MM-SS-sssZ.db data\bot.db -Force
Start-ScheduledTask -TaskName JobTgBot
npm run local:status
```

Use the actual database path from `DATABASE_URL` if it differs from `data/bot.db`.

Automatic snapshots are stored on the same machine as the database. For protection from disk failure, periodically copy a recent snapshot and `.env` to a separate encrypted location.

## Remove Autostart

```powershell
npm run local:uninstall
```

