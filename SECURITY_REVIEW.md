# Security Review

## Executive Summary

В рамках этого ревью был проверен Telegram-бот для вакансий из текущего snapshot рабочего каталога. Основной фокус был на режиме `web`, дополнительный обзор проведён для dormant-кода MTProto. Использовались только недеструктивные методы: ручной code review, статический поиск, локальные тесты, проверки зависимостей и точечные security regression tests.

Итоговое состояние после внесённых исправлений можно считать приемлемым для персонального бота. Практически эксплуатируемого SQL injection в текущем слое SQLite не выявлено, нарушений owner-only access control в командах и callback-хендлерах тоже не найдено. Наиболее реалистичные риски были сосредоточены в обработке недоверенного Telegram web preview, ограничении ресурсов, небезопасной трактовке внешних URL как контактов и недостаточном контейнерном hardening. Эти проблемы были исправлены в коде и покрыты тестами.

Сводка по находкам:

- Critical: 0
- High: 0
- Medium: 2 fixed
- Low: 2 fixed, 2 open
- Info: 1

## Scope

В scope входило:

- `src/`
- `tests/`
- `Dockerfile`
- `docker-compose.yml`
- `.env.example`
- `.gitignore`
- `README.md`
- `MIGRATION.md`
- `package.json` и `package-lock.json`

Вне scope или проверено частично:

- реальные Telegram-аккаунты и production-трафик
- реальные токены и MTProto session
- история git и настройки репозитория, потому что текущий workspace не даёт нормального доступа к git-репозиторию
- фактическая проверка Docker runtime, потому что Docker не установлен в этом окружении

## Methodology

В качестве ориентиров использовались:

- OWASP ASVS
- OWASP Top 10
- OWASP Cheat Sheet Series
- OWASP SQL Injection Prevention Cheat Sheet
- OWASP SSRF Prevention Cheat Sheet
- OWASP Secrets Management Cheat Sheet
- OWASP Logging Cheat Sheet
- NIST SSDF
- SLSA / supply chain practices
- CIS Docker hardening baseline

Применённые методы:

- ручной анализ trust boundaries и attacker-controlled inputs
- поиск опасных API и рискованных data flows
- проверка того, как строятся SQLite-запросы и используется parameter binding
- проверка авторизации bot commands и callback queries
- review Docker и container defaults
- dependency inventory и vulnerability checks
- локальные security regression tests для SQL injection, channel validation, access control и fetch hardening

## Threat Model

### Assets

- `BOT_TOKEN`
- `OWNER_CHAT_ID`
- `OWNER_USER_ID`
- `TELEGRAM_API_ID`
- `TELEGRAM_API_HASH`
- `TELEGRAM_SESSION`
- содержимое SQLite базы в `data/`
- personal keywords и pause state
- контакты рекрутеров и тексты вакансий
- backup-архивы с `.env` и `data/`

### Entry Points

- Telegram web-preview HTML из `https://t.me/s/{channel}`
- `CHANNELS` и прочая runtime-конфигурация из `.env`
- Telegram Bot API updates: commands, callback queries, plain text messages
- локальные filesystem paths через `DATABASE_URL`
- будущий MTProto bootstrap через `npm run auth:telegram`

### Trust Boundaries

- внешний Telegram HTML является недоверенным
- пользователи Telegram, пишущие боту, недоверенные, пока `from.id !== OWNER_USER_ID`
- SQLite хранит недоверенные внешние данные
- файлы в `data/` содержат чувствительное локальное состояние
- `.env` и MTProto session являются секретами

### Attacker Personas

1. Автор поста в отслеживаемом Telegram-канале
2. Злой админ отслеживаемого канала
3. Случайный Telegram-пользователь, пишущий боту
4. Человек с доступом к VPS
5. Человек с доступом к исходникам или GitHub
6. Компрометированный maintainer npm-зависимости
7. Prompt-injection attacker, если позже будет добавлен LLM

### Основные сценарии злоупотребления

- подсунуть боту некорректный или oversized web preview
- использовать слабую валидацию конфигурации для unsafe local paths или нестабильного polling
- внедрить phishing URL, который будет выглядеть как доверенный контакт
- получить доступ к admin-функциям без owner-прав
- утянуть секреты через логи, backup или MTProto bootstrap
- вызвать лишнюю нагрузку или шум за счёт malformed metadata

### Impact

- потеря доступности бота
- утечка bot token или MTProto session
- неверная маршрутизация уведомлений
- phishing владельца бота
- неавторизованное выполнение команд
- утечка персональных данных, связанных с поиском работы

## Findings

### Finding SEC-001: В ingestion web preview не хватало строгой валидации и resource limits
Severity: Medium
Category: SSRF / DoS / Input Validation
Status: Fixed

#### Evidence
`src/config.ts:145-282`, `src/sources/telegramWebPreviewSource.ts:22-293`, `tests/configSecurity.test.ts`, `tests/telegramWebPreviewSource.test.ts`

#### Attack scenario
Некорректное значение `CHANNELS`, например `https://evil.com`, `job_react?before=1` или `../../etc/passwd`, раньше могло попасть в построение URL без строгой валидации username. Дополнительно источник раньше запрашивал HTML без timeout, запрета redirect и limit по размеру ответа, поэтому медленный или слишком большой ответ от недоверенного endpoint мог подвесить polling и съесть память.

#### Impact

- нестабильность polling
- избыточное потребление памяти на больших ответах
- нарушения outbound policy при redirect
- ingestion некорректных metadata из malformed `data-post`

#### Recommendation

- безопасно нормализовать `@channel` и enforce `^[a-zA-Z0-9_]{5,32}$`
- падать на invalid channel username и unsafe `DATABASE_URL`
- ограничить диапазоны polling-related чисел
- использовать timeout, `redirect: "error"`, max-response-byte limits и max-items-per-channel
- отклонять неожиданные `data-post` channels и нечисловые `messageId`

#### Verification

- `tests/configSecurity.test.ts`
- `tests/telegramWebPreviewSource.test.ts`
- `npm test`

### Finding SEC-002: Произвольные внешние URL показывались как доверенные контакты
Severity: Medium
Category: Phishing / Unsafe Output Handling
Status: Fixed

#### Evidence
`src/services/contactExtractor.ts:3-83`, `src/bot/formatters.ts:17-55`, `tests/contactExtractor.test.ts`

#### Attack scenario
Злой админ канала публикует вакансию с phishing или tracking URL. Раньше бот показывал произвольные внешние ссылки в поле `Контакты` наравне с Telegram username и email, из-за чего владелец с большей вероятностью воспринимал их как валидированные recruiter contacts.

#### Impact

- phishing-риск для владельца
- misleading extraction контактов рекрутера
- unsafe automation в будущем, если URL начнут переиспользоваться как доверенные данные

#### Recommendation

- продолжать извлекать URL как недоверенные данные только если это действительно нужно
- не показывать произвольные URL как trusted contacts
- ограничить размер входного текста и число контактов на пост
- в уведомлениях считать прямыми контактами только Telegram handle и email

#### Verification

- `tests/contactExtractor.test.ts`
- `npm test`

### Finding SEC-003: Runtime config позволял unsafe filesystem и polling values
Severity: Low
Category: Filesystem / Misconfiguration Hardening
Status: Fixed

#### Evidence
`src/config.ts:165-282`, `.env.example:14-28`, `.gitignore:1-19`

#### Attack scenario
Ранее unsafe `DATABASE_URL` или патологические integer values вроде нулевого polling interval могли пройти в конфиг. На практике это позволяло писать локальные файлы вне intended data directory или создавать tight loop с само-DOS.

#### Impact

- нестабильное поведение сервиса
- размещение локальных файлов вне intended data path
- более высокая вероятность операторской ошибки с SQLite sidecar файлами

#### Recommendation

- ограничить database files каталогом app data
- валидировать owner IDs и числовые параметры на старте
- использовать относительный default `DATABASE_URL=file:./data/bot.db`
- игнорировать WAL/SHM sidecar files и дополнительные `.env.*`

#### Verification

- `tests/configSecurity.test.ts`
- `npm run build`
- `npm test`

### Finding SEC-004: Контейнер работал от root и без базового runtime hardening
Severity: Low
Category: Docker / Container Hardening
Status: Fixed

#### Evidence
`Dockerfile:12-25`, `docker-compose.yml:1-22`

#### Attack scenario
Если application-layer issue или dependency compromise будет эксплуатирован, контейнер раньше давал более широкий пост-эксплуатационный blast radius, потому что работал от root без read-only root filesystem, capability drop и `no-new-privileges`.

#### Impact

- более простое закрепление или container-level abuse после компрометации
- более слабая baseline-изоляция контейнера

#### Recommendation

- запускать контейнер не от root
- использовать read-only root filesystem, оставляя запись только в `/app/data`
- добавить `tmpfs` для `/tmp`
- сбросить Linux capabilities
- включить `no-new-privileges`

#### Verification

- review `Dockerfile` и `docker-compose.yml`
- полноценная runtime-проверка Docker остаётся pending, потому что Docker недоступен в текущем окружении

### Finding SEC-005: MTProto bootstrap по дизайну всё ещё печатает `TELEGRAM_SESSION` в терминал
Severity: Low
Category: Secrets Management
Status: Open

#### Evidence
`src/scripts/auth-telegram.ts:32-45`, `README.md:174-181`

#### Attack scenario
При bootstrap MTProto helper печатает `TELEGRAM_SESSION` в stdout для ручного copy-paste. Если скрипт запускается в shared terminal, записываемой shell-сессии, CI job или под screen share, session secret может утечь.

#### Impact

- takeover личной Telegram session/account в MTProto mode

#### Recommendation

- запускать `npm run auth:telegram` только в локальном доверенном TTY
- не запускать его в CI и shared terminal sessions
- в будущем рассмотреть режим, где session пишется сразу в защищённый локальный файл, а не в stdout
- при любой утечке немедленно ротировать `TELEGRAM_SESSION`

#### Verification

- ручной operational review
- проверить предупреждение в `src/scripts/auth-telegram.ts:43`

### Finding SEC-006: Backup flow по-прежнему создаёт незашифрованный архив с секретами и персональными данными
Severity: Low
Category: Secrets / Backup Security
Status: Open

#### Evidence
`README.md:190-210`, `MIGRATION.md:3-10`, `MIGRATION.md:75-80`

#### Attack scenario
Документированный backup flow создаёт `vacancy-bot-backup.tar.gz`, содержащий `.env`, базу данных и потенциально `TELEGRAM_SESSION`. Если такой архив хранится в облаке, пересылается в чаты или лежит в открытом каталоге VPS, все секреты и данные уходят одним файлом.

#### Impact

- утечка `.env`, owner IDs, bot token, session material и stored vacancy/contact data

#### Recommendation

- считать backup-архивы секретными артефактами
- хранить их только в зашифрованных местах
- не пересылать их через Telegram и issue trackers
- использовать строгие file permissions в месте хранения backup
- добавить документированный runbook по ротации секретов после утечки backup

#### Verification

- обновление документации и operational runbook

### Finding SEC-007: Supply-chain review в этом окружении был только частичным
Severity: Info
Category: Supply Chain / Tooling
Status: Open

#### Evidence
`package.json`, `package-lock.json`, результаты команд в Commands Report

#### Attack scenario
Проект использует обычный lockfile и `npm ci`, а `npm audit` не показал известных moderate-or-higher уязвимостей. Но часть внешних сканеров была недоступна из текущего окружения, поэтому глубина supply-chain review ниже желаемой.

#### Impact

- пониженная уверенность в глубоком анализе transitive dependencies

#### Recommendation

- запускать `osv-scanner`, `semgrep` и `gitleaks` в CI или на подготовленной security workstation
- оставить `package-lock.json` обязательным
- периодически пересматривать transitive dependencies и license posture

#### Verification

- успешный запуск этих сканеров в CI

## Security Test Plan

Добавлено и проверено:

- `tests/configSecurity.test.ts`
  - безопасная нормализация `@channel`
  - отклонение unsafe channel values
  - отклонение database path вне data directory
- `tests/sqlInjection.test.ts`
  - SQL payload сохраняется как текст
  - схема базы не ломается после вставки
- `tests/telegramWebPreviewSource.test.ts`
  - неожиданный channel metadata отклоняется
  - enforced timeout signal и redirect policy
  - oversized responses отбрасываются
- `tests/contactExtractor.test.ts`
  - число контактов ограничено для недоверенного текста

Уже существовавшие тесты, важные для security:

- `tests/ownerAccess.test.ts`
- `tests/deduplication.test.ts`
- `tests/sourceFactory.test.ts`

Рекомендуемые следующие тесты:

- retry/idempotency tests для случаев, когда `sendMessage` не доставляет уведомление владельцу
- тесты на malformed или negative owner IDs
- тесты на большие malformed HTML bodies около configured byte limit
- будущие LLM prompt-injection и schema-validation tests, если AI mode будет реализован

## Hardening Checklist

- Done: owner-only middleware применяется к commands и callbacks
- Done: SQLite writes используют parameter binding, а не string interpolation
- Done: `CHANNELS` нормализуются и валидируются
- Done: web-preview fetch использует timeout, redirect blocking и response-size caps
- Done: contact extraction имеет input и count caps
- Done: generic external URLs больше не показываются как trusted contacts
- Done: `.env` и SQLite sidecar files добавлены в ignore
- Done: контейнер запускается не от root и использует `read_only`, `tmpfs`, `cap_drop`, `no-new-privileges`
- Pending: Docker runtime verification на хосте с установленным Docker
- Pending: encrypted backup guidance и secret-rotation runbook вне review docs
- Pending: CI integration для более глубоких supply-chain tools
- Pending: отдельный LLM safety design, если AI mode будет добавлен

## Commands Report

Успешно выполнены:

```bash
npm run build
npm test
npm audit --audit-level=moderate
npm ls --depth=0
npm outdated
npx depcheck
npx license-checker --summary
npx license-checker | Select-String -Pattern "GPL-3.0-or-later|UNLICENSED" -Context 0,2
```

Не удалось выполнить:

```bash
npx osv-scanner --lockfile package-lock.json
```

Причина: пакет/исполняемый файл не был доступен через npm в текущем окружении.

```bash
npx semgrep --config auto src tests
npx @semgrep/cli semgrep --config auto src tests
```

Причина: из npm не удалось получить installable CLI для текущего окружения.

```bash
npx gitleaks detect --source . --no-git --redact --exit-code 0
```

Причина: `npx` не смог определить runnable executable в этом окружении.

```bash
docker build -t job-tg-bot-security-review .
docker compose config
```

Причина: Docker не установлен в текущем окружении.

Примечания:

- `npm audit --audit-level=moderate` вернул `0` vulnerabilities.
- `npm outdated` не показал outdated top-level packages.
- `npx depcheck` пометил `pino-pretty` как unused, но это похоже на false positive, потому что пакет используется динамически через `pino.transport(...)` в `src/logger.ts`.

## Residual Risks

- raw vacancy text всё ещё остаётся недоверенным и может содержать phishing content; бот теперь маркирует внешние URL безопаснее, но не может сделать посты рекрутеров trustworthy
- MTProto mode чувствительнее, чем `web`, потому что добавляет долговременный user session secret
- backup handling по-прежнему в основном operational process, а не полностью enforced кодом
- Docker runtime и host-level hardening не были проверены из этого окружения
- LLM-based vacancy analysis сейчас не реализован; если он появится, vacancy text нужно рассматривать строго как данные, model output валидировать по схеме, а самой модели нельзя давать возможность отправлять сообщения или менять конфиг
