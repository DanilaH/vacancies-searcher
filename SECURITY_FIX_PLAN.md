# Security Fix Plan

## P0 - Исправить до деплоя

- Сохранить текущий hardening `CHANNELS` и web-preview fetch и не ослаблять его без эквивалентных тестов.
- Запускать бота только с валидными `OWNER_USER_ID` и `OWNER_CHAT_ID`.
- Проверить, что production `.env` использует `DATABASE_URL` внутри mounted data directory.
- Использовать обновлённые hardened-настройки из `Dockerfile` и `docker-compose.yml`.

## P1 - Исправить в ближайшее время

- Добавить operational runbook по ротации секретов:
  - `BOT_TOKEN`
  - `.env`
  - `TELEGRAM_SESSION`
- Обновить backup process так, чтобы архивы были зашифрованы и никогда не передавались через Telegram или issue tracker.
- Запустить более глубокие supply-chain scans в CI:
  - `osv-scanner`
  - `semgrep`
  - `gitleaks`

## P2 - Hardening

- Добавить retry/recovery logic для случаев, когда вакансия уже сохранена в SQLite, но не доставлена владельцу из-за временной ошибки Telegram API.
- Рассмотреть pin base image по digest после фиксации production image strategy.
- Добавить явные максимумы на размер vacancy text, который сохраняется в SQLite, если начнётся неконтролируемый рост storage.
- Добавить мониторинг для repeated fetch failures, oversized responses и неавторизованных попыток доступа к боту.

## P3 - Nice to have

- Сделать более безопасный MTProto bootstrap, который пишет `TELEGRAM_SESSION` в защищённый локальный файл вместо stdout.
- Добавить CI-checks, гарантирующие, что `.env`, `data/`, backup-архивы и SQLite files не попадают в commits.
- До включения AI mode добавить LLM controls:
  - защита от prompt injection
  - schema validation
  - token и cost limits
  - явная policy “no action”
