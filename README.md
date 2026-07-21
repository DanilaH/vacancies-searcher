# Job Telegram Bot

Telegram bot for tracking vacancies from public Telegram channels, optional hh.ru API search, and optional company careers pages with per-user search profiles, onboarding, and admin-managed sources.

## What it does

- Reads public Telegram web preview pages at `https://t.me/s/{channel}`.
- Discovers candidate Telegram channels from links/mentions in collected posts; optional MTProto adds search and recommendations.
- Optionally reads vacancies from hh.ru through the official `GET https://api.hh.ru/vacancies` endpoint.
- Optionally reads manually added company careers pages and public ATS job boards.
- Stores fetched posts once, then matches them separately for each active user.
- Supports up to five independent search profiles per user, each with its own keywords, stop-words, language, and pause state.
- Shows actual 7-day yield per search profile and local 7-day match forecasts before applying presets.
- Contains experimental per-user hh.ru filters; their user-facing buttons are currently hidden until API access and terms are finalized.
- Includes profile presets such as `Frontend`, `Backend`, `Fullstack`, `Design`, and `Product`.
- Onboards first-time users with preset selection or manual profile setup.
- Extracts contacts from vacancy text.
- Stores raw posts and matched vacancies in `SQLite`.
- Deduplicates by `source + channel + messageId`, canonical job URL, and content fingerprint.
- Sends new matching vacancies to each matched user through Telegram Bot API.
- Shows a per-user 7-day vacancy feed with `/week`.
- Sends compact structured vacancy cards with expandable full text, extracted salary/details, duplicate sources, and persistent reminders.
- Uses public member auto-registration with protected `owner` and `admin` roles.
- Exposes personal settings plus an admin panel for channels, users, and runtime settings.
- Stores product analytics events locally in `SQLite` and can optionally forward them to `PostHog`.

## Agent map

There is a dedicated task-oriented project map for future agents in:

- [docs/agent-map/README.md](docs/agent-map/README.md)
- [docs/agent-map/module-map.md](docs/agent-map/module-map.md)
- [docs/agent-map/task-routing.md](docs/agent-map/task-routing.md)

If you are touching code after a long pause or with a fresh agent, start there first. Those files are intentionally narrower than the full repo and explain task boundaries and dependency hotspots.

## Product planning docs

The canonical product description, backlog, roadmap, and open questions live in:

- [docs/product/PROJECT_OVERVIEW.md](docs/product/PROJECT_OVERVIEW.md)
- [docs/product/README.md](docs/product/README.md)
- [docs/product/ROADMAP.md](docs/product/ROADMAP.md)
- [docs/product/QUESTIONS_AND_IDEAS.md](docs/product/QUESTIONS_AND_IDEAS.md)

## Source modes

Default mode:

```env
TELEGRAM_SOURCE_MODE=web
```

In `web` mode the bot:

- does not require `my.telegram.org`
- does not require `TELEGRAM_API_ID`
- does not require `TELEGRAM_API_HASH`
- does not require `TELEGRAM_SESSION`
- only supports public channels that have a working `https://t.me/s/{channel}` page

Optional MTProto polling mode:

```env
TELEGRAM_SOURCE_MODE=mtproto
```

`mtproto` mode requires `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, and `TELEGRAM_SESSION`.

MTProto credentials can also be present while the main bot stays in `web` mode. In that setup:

- `TELEGRAM_SOURCE_MODE=web` keeps ordinary vacancy polling on public preview pages.
- `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, and `TELEGRAM_SESSION` are used only for owner-triggered channel discovery.
- Newly approved discovery candidates are added as `telegram_web_preview` channels, so they are picked up without switching the main source mode.

To generate a session locally:

```powershell
$env:TELEGRAM_API_ID="123456"
$env:TELEGRAM_API_HASH="your_api_hash"
npm run auth:telegram
```

Put the printed `TELEGRAM_SESSION` into `.env` and restart `npm run dev`. Treat `TELEGRAM_SESSION` as a secret.

Channel discovery env defaults:

```env
CHANNEL_DISCOVERY_MAX_QUERIES=10
CHANNEL_DISCOVERY_QUERY_LIMIT=20
CHANNEL_DISCOVERY_MAX_CANDIDATES=50
CHANNEL_DISCOVERY_SAMPLE_POSTS=30
CHANNEL_DISCOVERY_RECENT_RAW_DAYS=30
CHANNEL_DISCOVERY_REQUEST_DELAY_MS=1000
CHANNEL_DISCOVERY_DUCKDUCKGO_ENABLED=false
CHANNEL_DISCOVERY_DUCKDUCKGO_TIMEOUT_MS=10000
CHANNEL_DISCOVERY_DUCKDUCKGO_MAX_RESPONSE_BYTES=500000
```

## hh.ru source

hh.ru is an optional second source. It does not replace Telegram polling; when enabled, both sources feed the same vacancy storage, matching, notifications, and `/week` view.

Runtime env:

```env
HH_SOURCE_ENABLED=false
HH_USER_AGENT=
HH_ACCESS_TOKEN=
HH_MAX_UNIQUE_QUERIES_PER_CYCLE=10
HH_MAX_ACTIVE_USERS_PER_CYCLE=10
HH_PER_PAGE=20
HH_MAX_PAGES_PER_QUERY=1
```

Notes:

- `HH_USER_AGENT` is required when `HH_SOURCE_ENABLED=true`.
- `HH_ACCESS_TOKEN` is optional and reserved for a later OAuth/application-registration step.
- The hh.ru user-facing buttons are currently hidden. The source and settings remain implemented for a later controlled rollout.
- hh.ru filters narrow only the hh API request. The common personal profile, language mode, resume detector, statuses, and deduplication still apply after fetch.
- Before wider public use, review hh.ru API terms and add any required user-facing consent/offerta copy. This version documents the risk but does not add a separate consent UX step.

## Company careers source

Company careers is an optional third source. It is off by default and is managed manually by the owner from `/admin -> Сайты компаний` or `/admin -> Каналы -> Сайты компаний`.

Runtime env:

```env
COMPANY_CAREERS_SOURCE_ENABLED=false
COMPANY_CAREERS_POLL_INTERVAL_SECONDS=21600
COMPANY_CAREERS_MAX_SOURCES_PER_CYCLE=20
COMPANY_CAREERS_REQUEST_TIMEOUT_MS=10000
COMPANY_CAREERS_MAX_RESPONSE_BYTES=1000000
COMPANY_CAREERS_REQUEST_DELAY_MS=1000
COMPANY_CAREERS_USER_AGENT=job-tg-bot/company-careers
```

Supported v1 adapters:

- `aviasales_html` for `https://www.aviasales.ru/about/vacancies`.
- `greenhouse_job_board` for public Greenhouse boards such as `https://boards.greenhouse.io/{company}`.
- `lever_postings` for public Lever boards such as `https://jobs.lever.co/{company}`.
- `ashby_posting` for public Ashby boards such as `https://jobs.ashbyhq.com/{company}`.
- `smartrecruiters_postings` for public SmartRecruiters boards such as `https://jobs.smartrecruiters.com/{company}`.
- `generic_html` only for pages that expose `schema.org/JobPosting` JSON-LD.

Safety and behavior:

- Only `https` public hostnames are accepted; localhost, private IPs, and local/internal hostnames are rejected.
- Responses are bounded by timeout and max response size.
- Redirects are not followed in v1.
- Company vacancies feed the same ingest, matching, status, language, resume-filter, notification, and `/week` pipeline as Telegram and hh.ru.
- Telegram reposts that contain a supported company job URL are linked through `canonical_url`, so duplicates can show both the Telegram post and the company page.

## Multi-vacancy posts and trusted vacancy services

Structured Telegram aggregator posts can contain several vacancies in one message. The web-preview parser keeps link order and splits a high-confidence post into separate child vacancies. Each child:

- keeps the original Telegram post as its main URL;
- gets a stable child message ID and the parent numeric message ID as its polling cursor;
- stores the linked job page as `canonical_url`;
- contains only its own title, employment, location, and other structured lines.

Links are never fetched merely because they appeared in Telegram. External enrichment is allowed only for exact hostnames in `/admin -> Доверенные сервисы`:

- a newly added service starts as `pending`;
- an admin must safely probe it before activation;
- only active exact hostnames are fetched;
- requests require public HTTPS DNS, reject redirects, and enforce timeout, response-size, and request-delay limits;
- parsing prefers a specialized adapter, then `schema.org/JobPosting`, then a conservative HTML fallback.

`findmyremote.ai` and `teletype.in` are seeded as active built-in trusted services with specialized adapters. Teletype accepts only article-shaped URLs (`teletype.in/@author/slug`) and rejects missing pages or pages without confident vacancy content. Trusted services enrich links found in vacancies; unlike company careers sources, they are not polled independently.

For a normal single-vacancy Telegram post, exactly one active trusted-service link becomes its `canonical_url`. A definitive external result such as HTTP `404/410`, a Teletype “page does not exist” message, or content that is confidently not a vacancy keeps only raw evidence and prevents the post from entering vacancy feeds. Temporary network, DNS, timeout, and `5xx` failures do not discard the Telegram vacancy.

Existing aggregate vacancies can be inspected and repaired without notifications:

```powershell
npm run repair:multi-vacancy-posts -- --days=30
npm run repair:multi-vacancy-posts -- --days=30 --apply
```

The default command is dry-run. Apply mode leaves the original raw Telegram message as evidence, silently rematches users, and skips aggregates with user statuses or active reminders.

## Access model

The bot is public for ordinary users:

- `OWNER_USER_ID` is the bootstrap owner and gets full admin access.
- Additional users are stored in `bot_users` with roles `owner`, `admin`, or `member`.
- Unknown users are automatically created as active `member` users on first contact.
- Manually disabled users stay blocked until the owner enables them again.
- `admin` users can work with channels, runtime settings, and bot status.
- `owner`-only actions include backup export and user management.
- `member` users can use personal features such as their own filters and weekly feed.
- Public access does not grant admin or backup access.

`OWNER_CHAT_ID` is the chat used for startup diagnostics and owner-directed notifications. In a private chat it is often the same value as `OWNER_USER_ID`.

## Channel management

`CHANNELS` in `.env` is now only a bootstrap list.

On the first start for the current source mode:

- channels from `.env` are inserted into SQLite

After that:

- the runtime channel list is read from SQLite
- channels are managed through `/admin`
- adding or removing a channel does not require a restart

Inside `/admin` you can:

- open `Channels`
- see which channels are active
- inspect a specific channel
- add a new public channel by username or `t.me` link
- run owner-only channel discovery by profession preset or custom query
- verify a batch of up to 50 usernames or `t.me` links as candidates
- approve, skip, block, and inspect evidence for candidates
- remove a channel from scanning with soft delete

Supported input examples:

- `job_react`
- `@job_react`
- `https://t.me/job_react`
- `https://t.me/s/job_react`

Unsupported:

- private invite links
- `joinchat`
- `t.me/+...`
- `t.me/c/...`

Channel discovery is manual and owner-only. It never stores MTProto secrets in SQLite and never adds channels automatically. Without MTProto it uses the mention graph from recent posts and manual candidate batches. `Admin -> Channels -> Find channels` shows available providers, live `checked / total` progress with a refresh button, a global pending-candidate list, per-candidate evidence, and `Add` / `Skip` / `Block` actions. Automatic searches rotate by profile: never-checked usernames are inspected first, then the least recently checked ones; explicit manual batches are always checked as submitted. Only one discovery run can execute at a time, and interrupted runs are marked failed after process restart. DuckDuckGo scraping is experimental, disabled by default, and reports CAPTCHA/blocking/unexpected HTML as a provider warning instead of failing the run.

## Admin panel

`/admin` currently supports:

- bot status
- source mode and active channels count
- runtime numeric settings
- channel management
- trusted vacancy service management for admins and owners
- owner-only user management
- owner-only backup export from the admin panel or `/backup`
- pause and resume

Runtime settings, users, channels, and user state are stored in `SQLite`, so they survive restarts.

The bot also sends admin-only service alerts when:

- a monitored channel starts failing with a new error
- a monitored channel has not had a successful read for too long

## Personal settings and filters

Every active user has their own:

- search profiles, up to five
- profile presets
- weekly vacancy feed
- empty-cycle notification preference
- hh.ru search settings
- onboarding state
- rematch of the last 7 days after profile changes

The main menu exposes:

- `🎯 Мои поиски`
- `⚙️ Настройки`
- `🛠️ Настройки (админ)` for `owner/admin`

Vacancies are matched against every active search profile and delivered once even when several profiles match. The common `/week` feed shows all matches, while each profile also has its own weekly view. Changing, pausing, or deleting a profile automatically rebuilds personal matches for the last 7 days without removing saved/applied/hidden statuses.

## Runtime settings

Numeric runtime settings can be changed from `/admin -> Settings`.

Right now the panel supports:

- `CHECK_INTERVAL_SECONDS`
- `INITIAL_BACKFILL_DAYS`
- `WEEKLY_PAGE_SIZE`
- `WEB_PREVIEW_MAX_PAGES_PER_CHANNEL`
- `WEB_PREVIEW_CHANNEL_DELAY_MS`
- `WEB_PREVIEW_RETRY_COUNT`
- `WEB_PREVIEW_REQUEST_TIMEOUT_MS`
- `WEB_PREVIEW_MAX_ITEMS_PER_CHANNEL`

Behavior:

- values from `.env` are treated as defaults
- values saved from Telegram are stored in `SQLite` as overrides
- the bot validates empty input, negative numbers, floats, huge values, and out-of-range values
- most changes apply without restart on the next polling or source cycle

## Quick start

1. Copy `.env.example` to `.env`.
2. Fill `BOT_TOKEN`.
3. Run:

```bash
npm install
npm run build
npm run dev
```

4. Open the bot in Telegram and send:

```txt
/start
```

5. Get your Telegram user id from the owner UI after first contact or from Telegram client/dev tooling, then put it into `.env`:

```env
OWNER_CHAT_ID=123456789
OWNER_USER_ID=123456789
```

6. Restart the bot.

7. Open `/start`, finish onboarding, and if needed use `🛠️ Настройки (админ)` to add more users or channels.

## Local Windows operation without Docker

For a persistent local process with automatic restart:

```powershell
npm run local:install
npm run local:status
```

The scheduled task starts at Windows logon and runs a supervisor that restarts the bot after unexpected exits. Stop any existing `npm run dev` process before installing or starting the task.

Automatic SQLite snapshots are enabled by default, created under `data/runtime/backups`, and retained for 14 days. Configure them with:

```env
AUTOMATIC_BACKUP_ENABLED=true
AUTOMATIC_BACKUP_INTERVAL_HOURS=24
AUTOMATIC_BACKUP_RETENTION_DAYS=14
```

Full install, update, healthcheck and restore instructions: [docs/operations/local-windows.md](./docs/operations/local-windows.md).

## Main env variables

```env
BOT_TOKEN=
OWNER_CHAT_ID=
OWNER_USER_ID=
TELEGRAM_SOURCE_MODE=web
CHANNELS=job_react,rabotafrontend,findmyremote_frontend
CHECK_INTERVAL_SECONDS=300
WEB_PREVIEW_MAX_PAGES_PER_CHANNEL=5
WEB_PREVIEW_CHANNEL_DELAY_MS=1500
WEB_PREVIEW_RETRY_COUNT=2
HH_SOURCE_ENABLED=false
HH_USER_AGENT=
HH_ACCESS_TOKEN=
POSTHOG_API_KEY=
POSTHOG_HOST=https://us.i.posthog.com
```

New users start with one empty search profile and are expected to:

- choose a preset
- or configure their own filters during onboarding

## Analytics baseline

The bot now records a minimal product analytics baseline in `analytics_events` inside SQLite.

Examples of captured events:

- `bot_started`
- `user_started`
- `onboarding_started`
- `preset_selected`
- `profile_block_updated`
- `profile_ready`
- `profile_created`
- `profile_renamed`
- `profile_paused`
- `profile_deleted`
- `vacancy_matched`
- `vacancy_notified`
- `weekly_feed_opened`

If `POSTHOG_API_KEY` is configured, the same safe event payloads are also forwarded to PostHog Cloud. Vacancy text, extracted contacts, secrets, and other sensitive data are not sent there.

To inspect heuristic vacancy-card field coverage without printing vacancy texts, contacts, or user data:

```bash
npm run analyze:vacancy-cards -- --days=7
```

## Technical data retention

The bot runs a conservative technical cleanup at startup and then once every 24 hours.

Defaults:

- analytics events older than `90` days are removed;
- completed or failed discovery runs older than `30` days are removed only when they contain no pending or blocked candidates;
- discovery rotation checks older than `180` days are removed.

Cleanup never removes vacancies, raw messages, user profiles, user vacancy statuses, monitored channels, pending discovery candidates, blocked discovery candidates, or the current running discovery task. SQLite may keep the same file size after cleanup, but freed pages are reused for future writes.

Retention can be configured with:

```env
TECHNICAL_CLEANUP_ENABLED=true
ANALYTICS_RETENTION_DAYS=90
CHANNEL_DISCOVERY_RUN_RETENTION_DAYS=30
CHANNEL_DISCOVERY_CHECK_RETENTION_DAYS=180
AUTOMATIC_BACKUP_ENABLED=true
AUTOMATIC_BACKUP_INTERVAL_HOURS=24
AUTOMATIC_BACKUP_RETENTION_DAYS=14
```

## Commands

- `/start` opens the main menu
- `/week` shows vacancies from the last 7 days
- `/admin` opens the admin panel for `owner/admin`
- `/backup` is visible only to `owner` and sends a fresh SQLite backup snapshot
- `/qualityreport` is visible only to `owner` and shows match quality stats (last 30 days)

## Data safety notes

- `data/`, its nested `runtime/`, and `logs/` should be readable and writable only by the account running the bot.
- Backup snapshots contain the full SQLite database and should be treated as sensitive data.
- Telegram `owner` access is equivalent to data export capability.
- hh.ru vacancy data and user hh filters are stored in the same SQLite database.
- The bot does not add encryption-at-rest in this version; host and filesystem access still matter.

## Web preview limitations

- Only public channels are supported.
- Telegram can change the HTML layout at any time.
- Full archive coverage is not guaranteed.
- Initial backfill is limited by both the time window and the page limit.

## Docker

Start:

```bash
docker compose up -d --build
```

Logs:

```bash
docker compose logs -f vacancy-bot
```

Stop:

```bash
docker compose down
```

## Migration to another VPS

Backup:

- `.env`
- `data/bot.db`
- optional logs in `data/`

Restore:

```bash
git clone <repo-url> vacancy-bot
cd vacancy-bot
tar -xzf vacancy-bot-backup.tar.gz
docker compose up -d --build
```

Expected result:

- the bot starts without resending old vacancies
- the channel registry is restored from SQLite
- the owner receives the startup diagnostic message if owner ids are configured
