import BetterSqlite3 from "better-sqlite3";

type SqliteDatabase = BetterSqlite3.Database;

const TRUSTED_VACANCY_SERVICE_ADAPTER_CHECK = [
  "'findmyremote'",
  "'teletype'",
  "'finder_work'",
  "'telegraph'",
  "'aviasales_careers'",
  "'cloud_careers'",
  "'tbank_careers'",
  "'yandex_jobs'",
  "'generic'"
].join(", ");

const TRUSTED_VACANCY_SERVICE_REQUIRED_ADAPTERS = [
  "'findmyremote'",
  "'teletype'",
  "'finder_work'",
  "'telegraph'",
  "'aviasales_careers'",
  "'cloud_careers'",
  "'tbank_careers'",
  "'yandex_jobs'",
  "'generic'"
];

const HIDDEN_VACANCY_REASON_CHECK = [
  "'not_rf'",
  "'stack_mismatch'",
  "'low_salary'",
  "'wrong_grade'",
  "'office_or_hybrid'",
  "'scam'",
  "'seen_before'",
  "'unwanted_niche'",
  "'unclear_company'"
].join(", ");

const FILTER_SUGGESTION_KEY_CHECK = [
  "'hidden_not_rf'",
  "'hidden_office_or_hybrid'",
  "'hidden_stack_mismatch'",
  "'hidden_wrong_grade'",
  "'hidden_low_salary'"
].join(", ");

export type SchemaTableName =
  | "user_settings"
  | "raw_messages"
  | "vacancies"
  | "monitored_channels"
  | "company_career_sources"
  | "trusted_vacancy_services"
  | "user_search_profiles"
  | "user_hh_search_settings"
  | "hh_user_vacancy_candidates"
  | "user_vacancy_applications"
  | "user_vacancy_hidden_reasons"
  | "user_filter_suggestions"
  | "user_daily_digest_deliveries"
  | "channel_discovery_runs"
  | "channel_discovery_candidates"
  | "channel_discovery_checks"
  | "owner_report_delivery"
  | "vacancy_relevance_feedback"
  | "rejected_match_audit";

export function createBaseSchema(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_by_user_id TEXT
    );

    CREATE TABLE IF NOT EXISTS bot_users (
      user_id TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      username TEXT,
      display_name TEXT,
      added_by_user_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK(role IN ('owner', 'admin', 'member'))
    );

    CREATE TABLE IF NOT EXISTS monitored_channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      source_name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      initial_backfill_completed INTEGER NOT NULL DEFAULT 0,
      last_seen_message_id TEXT,
      idle_poll_streak INTEGER NOT NULL DEFAULT 0,
      next_poll_after TEXT,
      last_checked_at TEXT,
      last_success_at TEXT,
      last_error TEXT,
      added_by_user_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(source_name, username)
    );

    CREATE TABLE IF NOT EXISTS raw_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_name TEXT NOT NULL,
      source_channel TEXT NOT NULL,
      source_message_id TEXT NOT NULL,
      message_date TEXT NOT NULL,
      text TEXT NOT NULL,
      normalized_text TEXT NOT NULL,
      url TEXT NOT NULL,
      canonical_url TEXT,
      fingerprint TEXT NOT NULL,
      imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(source_name, source_channel, source_message_id)
    );

    CREATE TABLE IF NOT EXISTS vacancies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_name TEXT NOT NULL,
      source_channel TEXT NOT NULL,
      source_message_id TEXT NOT NULL,
      message_date TEXT NOT NULL,
      title TEXT NOT NULL,
      text TEXT NOT NULL,
      normalized_text TEXT NOT NULL,
      url TEXT NOT NULL,
      canonical_url TEXT,
      fingerprint TEXT NOT NULL,
      score INTEGER NOT NULL,
      match_summary TEXT NOT NULL,
      matched_keywords_json TEXT NOT NULL,
      contacts_json TEXT NOT NULL,
      sent_to_owner_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(source_name, source_channel, source_message_id)
    );

    CREATE TABLE IF NOT EXISTS company_career_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_name TEXT NOT NULL,
      adapter TEXT NOT NULL,
      start_url TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      poll_interval_seconds INTEGER NOT NULL DEFAULT 21600,
      next_poll_after TEXT,
      last_checked_at TEXT,
      last_success_at TEXT,
      last_error TEXT,
      added_by_user_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(start_url),
      CHECK(adapter IN (
        'aviasales_html',
        'greenhouse_job_board',
        'lever_postings',
        'ashby_posting',
        'smartrecruiters_postings',
        'generic_html'
      )),
      CHECK(is_active IN (0, 1)),
      CHECK(poll_interval_seconds BETWEEN 300 AND 86400)
    );

    CREATE TABLE IF NOT EXISTS trusted_vacancy_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hostname TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      adapter TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      parser_mode TEXT NOT NULL,
      example_url TEXT NOT NULL,
      last_checked_at TEXT,
      last_success_at TEXT,
      last_error TEXT,
      added_by_user_id TEXT,
      approved_by_user_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK(adapter IN (${TRUSTED_VACANCY_SERVICE_ADAPTER_CHECK})),
      CHECK(status IN ('pending', 'active', 'disabled')),
      CHECK(parser_mode IN ('specialized', 'json_ld_or_html'))
    );

    CREATE TABLE IF NOT EXISTS user_settings (
      user_id TEXT PRIMARY KEY,
      ai_enabled INTEGER NOT NULL DEFAULT 0,
      filter_mode TEXT NOT NULL DEFAULT 'keywords',
      bot_paused INTEGER NOT NULL DEFAULT 0,
      notify_on_empty_cycle INTEGER NOT NULL DEFAULT 0,
      daily_digest_enabled INTEGER NOT NULL DEFAULT 0,
      daily_digest_time_minutes INTEGER,
      weekly_page_size INTEGER,
      vacancy_language_mode TEXT NOT NULL DEFAULT 'ru_en',
      onboarding_completed INTEGER NOT NULL DEFAULT 0,
      onboarding_step TEXT,
      pending_input_action TEXT,
      pending_input_payload TEXT,
      pending_keyword_kind TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK(filter_mode IN ('keywords', 'hybrid', 'ai')),
      CHECK(daily_digest_time_minutes BETWEEN 0 AND 1439 OR daily_digest_time_minutes IS NULL),
      CHECK(weekly_page_size BETWEEN 1 AND 5 OR weekly_page_size IS NULL),
      CHECK(vacancy_language_mode IN ('ru_en', 'ru_only', 'en_only')),
          CHECK(
            onboarding_step IN (
              'intro',
              'welcome',
              'preset',
              'language',
              'manual_required_context',
          'manual_required_primary',
          'manual_preferred',
          'manual_exclude'
        )
        OR onboarding_step IS NULL
      ),
      CHECK(
        pending_input_action IN (
          'add_include_keyword',
          'add_exclude_keyword',
          'add_channel',
          'add_company_career_source',
          'add_trusted_vacancy_service',
          'add_user',
          'set_profile_required_context',
          'set_profile_required_primary',
          'set_profile_preferred',
          'set_profile_exclude',
          'rename_search_profile',
          'set_hh_text',
          'set_hh_area',
          'set_hh_salary',
          'set_hh_period',
          'run_channel_discovery_custom',
          'run_channel_discovery_seeds',
          'set_application_note',
          'set_runtime_setting'
        )
        OR pending_input_action IS NULL
      ),
      CHECK(pending_keyword_kind IN ('include', 'exclude') OR pending_keyword_kind IS NULL)
    );

    CREATE TABLE IF NOT EXISTS user_keywords (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      keyword TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, kind, keyword),
      CHECK(kind IN ('include', 'exclude'))
    );

    CREATE TABLE IF NOT EXISTS user_search_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      vacancy_language_mode TEXT NOT NULL DEFAULT 'ru_en',
      required_context_keywords_json TEXT NOT NULL,
      required_primary_keywords_json TEXT NOT NULL,
      preferred_keywords_json TEXT NOT NULL,
      exclude_keywords_json TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, normalized_name),
      CHECK(is_active IN (0, 1)),
      CHECK(vacancy_language_mode IN ('ru_en', 'ru_only', 'en_only')),
      FOREIGN KEY(user_id) REFERENCES bot_users(user_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_hh_search_settings (
      user_id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 0,
      text TEXT NOT NULL DEFAULT '',
      area_id TEXT NOT NULL DEFAULT '113',
      experience TEXT NOT NULL DEFAULT 'any',
      schedule TEXT NOT NULL DEFAULT 'remote',
      employment TEXT NOT NULL DEFAULT 'full',
      salary_from INTEGER,
      period_days INTEGER NOT NULL DEFAULT 7,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK(enabled IN (0, 1)),
      CHECK(experience IN ('any', 'noExperience', 'between1And3', 'between3And6', 'moreThan6')),
      CHECK(schedule IN ('any', 'remote', 'fullDay', 'flexible', 'shift')),
      CHECK(employment IN ('any', 'full', 'part', 'project', 'probation')),
      CHECK(salary_from IS NULL OR salary_from >= 0),
      CHECK(period_days BETWEEN 1 AND 30),
      FOREIGN KEY(user_id) REFERENCES bot_users(user_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_vacancy_matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      vacancy_id INTEGER NOT NULL,
      score INTEGER NOT NULL,
      match_summary TEXT NOT NULL,
      matched_keywords_json TEXT NOT NULL,
      delivered_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, vacancy_id),
      FOREIGN KEY(vacancy_id) REFERENCES vacancies(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES bot_users(user_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS hh_user_vacancy_candidates (
      user_id TEXT NOT NULL,
      vacancy_id INTEGER NOT NULL,
      query_key TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_id, vacancy_id),
      FOREIGN KEY(vacancy_id) REFERENCES vacancies(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES bot_users(user_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_vacancy_states (
      user_id TEXT NOT NULL,
      vacancy_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_id, vacancy_id),
      CHECK(status IN ('saved', 'hidden', 'applied')),
      FOREIGN KEY(vacancy_id) REFERENCES vacancies(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES bot_users(user_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_vacancy_reminders (
      user_id TEXT NOT NULL,
      vacancy_id INTEGER NOT NULL,
      remind_at TEXT NOT NULL,
      next_attempt_at TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      delivered_at TEXT,
      cancelled_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_id, vacancy_id),
      CHECK(attempt_count >= 0),
      FOREIGN KEY(vacancy_id) REFERENCES vacancies(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES bot_users(user_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_user_vacancy_reminders_due
      ON user_vacancy_reminders(next_attempt_at)
      WHERE delivered_at IS NULL AND cancelled_at IS NULL;

    CREATE TABLE IF NOT EXISTS user_vacancy_applications (
      user_id TEXT NOT NULL,
      vacancy_id INTEGER NOT NULL,
      applied_at TEXT NOT NULL,
      note TEXT,
      follow_up_at TEXT,
      next_attempt_at TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      delivered_at TEXT,
      cancelled_at TEXT,
      last_error TEXT,
      responded_at TEXT,
      closed_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_id, vacancy_id),
      CHECK(attempt_count >= 0),
      CHECK(note IS NULL OR length(note) <= 500),
      FOREIGN KEY(vacancy_id) REFERENCES vacancies(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES bot_users(user_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_user_vacancy_applications_due
      ON user_vacancy_applications(next_attempt_at)
      WHERE follow_up_at IS NOT NULL
        AND next_attempt_at IS NOT NULL
        AND delivered_at IS NULL
        AND cancelled_at IS NULL
        AND responded_at IS NULL
        AND closed_at IS NULL;

    CREATE TABLE IF NOT EXISTS analytics_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_name TEXT NOT NULL,
      distinct_id TEXT NOT NULL,
      user_id TEXT,
      properties_json TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS channel_alert_state (
      channel_id INTEGER PRIMARY KEY,
      failure_signature TEXT,
      failure_alerted_at TEXT,
      stale_reference TEXT,
      stale_alerted_at TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(channel_id) REFERENCES monitored_channels(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS channel_discovery_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL,
      started_by_user_id TEXT,
      profile_id TEXT NOT NULL DEFAULT 'frontend',
      profile_label TEXT NOT NULL DEFAULT 'Frontend',
      custom_query TEXT,
      seed_queries_json TEXT NOT NULL,
      providers_json TEXT NOT NULL DEFAULT '[]',
      provider_warnings_json TEXT NOT NULL DEFAULT '[]',
      total_candidates_found INTEGER NOT NULL DEFAULT 0,
      candidates_to_check INTEGER NOT NULL DEFAULT 0,
      candidates_checked INTEGER NOT NULL DEFAULT 0,
      candidates_recommended INTEGER NOT NULL DEFAULT 0,
      candidates_filtered INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT,
      CHECK(status IN ('running', 'completed', 'failed'))
    );

    CREATE TABLE IF NOT EXISTS channel_discovery_candidates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      username TEXT NOT NULL,
      title TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      score INTEGER NOT NULL,
      sources_json TEXT NOT NULL,
      probe_url TEXT,
      sample_posts_count INTEGER NOT NULL DEFAULT 0,
      primary_signal_posts_count INTEGER NOT NULL DEFAULT 0,
      format_signal_posts_count INTEGER NOT NULL DEFAULT 0,
      hiring_posts_count INTEGER NOT NULL DEFAULT 0,
      vacancy_like_posts_count INTEGER NOT NULL DEFAULT 0,
      resume_posts_count INTEGER NOT NULL DEFAULT 0,
      resume_rate REAL NOT NULL DEFAULT 0,
      reasons_json TEXT NOT NULL,
      evidence_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(run_id, username),
      CHECK(status IN ('pending', 'approved', 'skipped', 'blocked')),
      FOREIGN KEY(run_id) REFERENCES channel_discovery_runs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS channel_discovery_checks (
      search_key TEXT NOT NULL,
      username TEXT NOT NULL,
      check_count INTEGER NOT NULL DEFAULT 1,
      last_checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(search_key, username)
    );

    CREATE INDEX IF NOT EXISTS idx_analytics_events_event_name_occurred_at
      ON analytics_events(event_name, occurred_at DESC);

    CREATE INDEX IF NOT EXISTS idx_analytics_events_user_id_occurred_at
      ON analytics_events(user_id, occurred_at DESC);

    CREATE INDEX IF NOT EXISTS idx_channel_discovery_candidates_username_status
      ON channel_discovery_candidates(username, status);

    CREATE INDEX IF NOT EXISTS idx_channel_discovery_checks_search_time
      ON channel_discovery_checks(search_key, last_checked_at);

    CREATE INDEX IF NOT EXISTS idx_company_career_sources_due
      ON company_career_sources(is_active, next_poll_after, updated_at);
  `);
}

function ensureOwnerReportDeliveryTable(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS owner_report_delivery (
      report_week TEXT PRIMARY KEY,
      delivered_at TEXT NOT NULL,
      period INTEGER NOT NULL DEFAULT 7
    );
  `);
}

export function runMigrations(db: SqliteDatabase): void {
  ensureUserSettingsColumns(db);
  ensureRawMessagesColumns(db);
  ensureVacanciesColumns(db);
  ensureMonitoredChannelsColumns(db);
  ensureCompanyCareerSourcesTable(db);
  ensureTrustedVacancyServicesTable(db);
  ensureUserSearchProfilesTable(db);
  ensureUserVacancyProfileMatchesTable(db);
  ensureUserHhSearchSettingsTable(db);
  ensureHhUserVacancyCandidatesTable(db);
  ensureUserVacancyStatesTable(db);
  ensureUserVacancyHiddenReasonsTable(db);
  ensureUserFilterSuggestionsTable(db);
  ensureUserVacancyRemindersTable(db);
  ensureUserVacancyApplicationsTable(db);
  ensureUserDailyDigestDeliveriesTable(db);
  ensureChannelAlertStateTable(db);
  ensureChannelDiscoveryTables(db);
  ensureOwnerReportDeliveryTable(db);
  ensureVacancyRelevanceFeedbackTable(db);
  ensureRejectedMatchAuditTable(db);
}

function ensureUserSettingsColumns(db: SqliteDatabase): void {
  const columns = getSchemaTableColumns(db, "user_settings");
  const tableSql = getTableSql(db, "user_settings");

  if (
    !columns.has("vacancy_language_mode") ||
    !tableSql.includes("'language'") ||
    !tableSql.includes("'intro'") ||
    !tableSql.includes("'set_hh_text'") ||
    !tableSql.includes("'add_company_career_source'") ||
    !tableSql.includes("'add_trusted_vacancy_service'") ||
    !tableSql.includes("'run_channel_discovery_custom'") ||
    !tableSql.includes("'run_channel_discovery_seeds'") ||
    !tableSql.includes("'rename_search_profile'") ||
    !tableSql.includes("'set_application_note'")
  ) {
    rebuildUserSettingsTable(db, columns);
    return;
  }

  if (!columns.has("notify_on_empty_cycle")) {
    db.prepare("ALTER TABLE user_settings ADD COLUMN notify_on_empty_cycle INTEGER NOT NULL DEFAULT 0").run();
  }

  if (!columns.has("daily_digest_enabled")) {
    db.prepare("ALTER TABLE user_settings ADD COLUMN daily_digest_enabled INTEGER NOT NULL DEFAULT 0").run();
  }

  if (!columns.has("daily_digest_time_minutes")) {
    db.prepare(
      "ALTER TABLE user_settings ADD COLUMN daily_digest_time_minutes INTEGER CHECK(daily_digest_time_minutes BETWEEN 0 AND 1439 OR daily_digest_time_minutes IS NULL)"
    ).run();
  }

  if (!columns.has("weekly_page_size")) {
    db.prepare(
      "ALTER TABLE user_settings ADD COLUMN weekly_page_size INTEGER CHECK(weekly_page_size BETWEEN 1 AND 5 OR weekly_page_size IS NULL)"
    ).run();
  }

  if (!columns.has("onboarding_completed")) {
    db.prepare("ALTER TABLE user_settings ADD COLUMN onboarding_completed INTEGER NOT NULL DEFAULT 0").run();
    db.prepare("UPDATE user_settings SET onboarding_completed = 1 WHERE onboarding_completed IS NULL OR onboarding_completed = 0").run();
  }

  if (!columns.has("onboarding_step")) {
    db.prepare("ALTER TABLE user_settings ADD COLUMN onboarding_step TEXT").run();
  }

  if (!columns.has("pending_input_action")) {
    db.prepare("ALTER TABLE user_settings ADD COLUMN pending_input_action TEXT").run();
  }

  if (!columns.has("pending_input_payload")) {
    db.prepare("ALTER TABLE user_settings ADD COLUMN pending_input_payload TEXT").run();
  }
}

function ensureRawMessagesColumns(db: SqliteDatabase): void {
  const columns = getSchemaTableColumns(db, "raw_messages");

  if (!columns.has("canonical_url")) {
    db.prepare("ALTER TABLE raw_messages ADD COLUMN canonical_url TEXT").run();
  }

  db.prepare("CREATE INDEX IF NOT EXISTS idx_raw_messages_canonical_url ON raw_messages(canonical_url)").run();
}

function ensureVacanciesColumns(db: SqliteDatabase): void {
  const columns = getSchemaTableColumns(db, "vacancies");

  if (!columns.has("source_name")) {
    throw new Error("Existing vacancies table is too old to migrate automatically.");
  }

  if (!columns.has("updated_at")) {
    db.prepare("ALTER TABLE vacancies ADD COLUMN updated_at TEXT").run();
    db.prepare("UPDATE vacancies SET updated_at = created_at WHERE updated_at IS NULL").run();
  }

  if (!columns.has("canonical_url")) {
    db.prepare("ALTER TABLE vacancies ADD COLUMN canonical_url TEXT").run();
  }

  db.prepare("CREATE INDEX IF NOT EXISTS idx_vacancies_canonical_url ON vacancies(canonical_url)").run();
}

function ensureMonitoredChannelsColumns(db: SqliteDatabase): void {
  const columns = getSchemaTableColumns(db, "monitored_channels");

  if (!columns.has("last_seen_message_id")) {
    db.prepare("ALTER TABLE monitored_channels ADD COLUMN last_seen_message_id TEXT").run();
  }

  if (!columns.has("idle_poll_streak")) {
    db.prepare("ALTER TABLE monitored_channels ADD COLUMN idle_poll_streak INTEGER NOT NULL DEFAULT 0").run();
    db.prepare("UPDATE monitored_channels SET idle_poll_streak = 0 WHERE idle_poll_streak IS NULL").run();
  }

  if (!columns.has("next_poll_after")) {
    db.prepare("ALTER TABLE monitored_channels ADD COLUMN next_poll_after TEXT").run();
  }
}

function ensureCompanyCareerSourcesTable(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS company_career_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_name TEXT NOT NULL,
      adapter TEXT NOT NULL,
      start_url TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      poll_interval_seconds INTEGER NOT NULL DEFAULT 21600,
      next_poll_after TEXT,
      last_checked_at TEXT,
      last_success_at TEXT,
      last_error TEXT,
      added_by_user_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(start_url),
      CHECK(adapter IN (
        'aviasales_html',
        'greenhouse_job_board',
        'lever_postings',
        'ashby_posting',
        'smartrecruiters_postings',
        'generic_html'
      )),
      CHECK(is_active IN (0, 1)),
      CHECK(poll_interval_seconds BETWEEN 300 AND 86400)
    );

    CREATE INDEX IF NOT EXISTS idx_company_career_sources_due
      ON company_career_sources(is_active, next_poll_after, updated_at);
  `);
}

function ensureTrustedVacancyServicesTable(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS trusted_vacancy_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hostname TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      adapter TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      parser_mode TEXT NOT NULL,
      example_url TEXT NOT NULL,
      last_checked_at TEXT,
      last_success_at TEXT,
      last_error TEXT,
      added_by_user_id TEXT,
      approved_by_user_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK(adapter IN (${TRUSTED_VACANCY_SERVICE_ADAPTER_CHECK})),
      CHECK(status IN ('pending', 'active', 'disabled')),
      CHECK(parser_mode IN ('specialized', 'json_ld_or_html'))
    );
  `);

  const tableSql = getTableSql(db, "trusted_vacancy_services");
  if (TRUSTED_VACANCY_SERVICE_REQUIRED_ADAPTERS.some((adapter) => !tableSql.includes(adapter))) {
    rebuildTrustedVacancyServicesTable(db);
  }

  db.prepare(
    `
      INSERT OR IGNORE INTO trusted_vacancy_services (
        hostname, display_name, adapter, status, parser_mode, example_url,
        added_by_user_id, approved_by_user_id, created_at, updated_at
      ) VALUES (
        'findmyremote.ai', 'Find My Remote', 'findmyremote', 'active',
        'specialized', 'https://findmyremote.ai/', NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `
  ).run();

  db.prepare(
    `
      INSERT OR IGNORE INTO trusted_vacancy_services (
        hostname, display_name, adapter, status, parser_mode, example_url,
        added_by_user_id, approved_by_user_id, created_at, updated_at
      ) VALUES (
        'teletype.in', 'Teletype', 'teletype', 'active',
        'specialized', 'https://teletype.in/', NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `
  ).run();

  db.prepare(
    `
      INSERT OR IGNORE INTO trusted_vacancy_services (
        hostname, display_name, adapter, status, parser_mode, example_url,
        added_by_user_id, approved_by_user_id, created_at, updated_at
      ) VALUES (
        'finder.work', 'Finder Work', 'finder_work', 'active',
        'specialized', 'https://finder.work/vacancies/example', NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `
  ).run();

  db.prepare(
    `
      INSERT OR IGNORE INTO trusted_vacancy_services (
        hostname, display_name, adapter, status, parser_mode, example_url,
        added_by_user_id, approved_by_user_id, created_at, updated_at
      ) VALUES (
        'telegra.ph', 'Telegraph', 'telegraph', 'active',
        'specialized', 'https://telegra.ph/example', NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `
  ).run();
  db.prepare(
    `UPDATE trusted_vacancy_services
     SET display_name = 'Teletype', adapter = 'teletype', parser_mode = 'specialized'
     WHERE hostname = 'teletype.in'`
  ).run();
  db.prepare(
    `UPDATE trusted_vacancy_services
     SET display_name = 'Finder Work', adapter = 'finder_work', parser_mode = 'specialized'
     WHERE hostname = 'finder.work'`
  ).run();
  db.prepare(
    `UPDATE trusted_vacancy_services
     SET display_name = 'Telegraph', adapter = 'telegraph', parser_mode = 'specialized'
     WHERE hostname = 'telegra.ph'`
  ).run();
}

function rebuildTrustedVacancyServicesTable(db: SqliteDatabase): void {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE trusted_vacancy_services_next (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        hostname TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        adapter TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        parser_mode TEXT NOT NULL,
        example_url TEXT NOT NULL,
        last_checked_at TEXT,
        last_success_at TEXT,
        last_error TEXT,
        added_by_user_id TEXT,
        approved_by_user_id TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CHECK(adapter IN (${TRUSTED_VACANCY_SERVICE_ADAPTER_CHECK})),
        CHECK(status IN ('pending', 'active', 'disabled')),
        CHECK(parser_mode IN ('specialized', 'json_ld_or_html'))
      );

      INSERT INTO trusted_vacancy_services_next (
        id, hostname, display_name, adapter, status, parser_mode, example_url,
        last_checked_at, last_success_at, last_error, added_by_user_id,
        approved_by_user_id, created_at, updated_at
      )
      SELECT
        id, hostname, display_name, adapter, status, parser_mode, example_url,
        last_checked_at, last_success_at, last_error, added_by_user_id,
        approved_by_user_id, created_at, updated_at
      FROM trusted_vacancy_services;

      DROP TABLE trusted_vacancy_services;
      ALTER TABLE trusted_vacancy_services_next RENAME TO trusted_vacancy_services;
    `);
  })();
}

function ensureUserSearchProfilesTable(db: SqliteDatabase): void {
  const columns = getSchemaTableColumns(db, "user_search_profiles");
  if (!columns.has("id")) {
    db.transaction(() => {
      db.prepare("ALTER TABLE user_search_profiles RENAME TO user_search_profiles_legacy").run();
      createPluralUserSearchProfilesTable(db);
      db.prepare(
        `
          INSERT INTO user_search_profiles (
            user_id,
            name,
            normalized_name,
            is_active,
            vacancy_language_mode,
            required_context_keywords_json,
            required_primary_keywords_json,
            preferred_keywords_json,
            exclude_keywords_json,
            sort_order,
            created_at,
            updated_at
          )
          SELECT
            legacy.user_id,
            'Основной поиск',
            'основной поиск',
            1,
            COALESCE(settings.vacancy_language_mode, 'ru_en'),
            legacy.required_context_keywords_json,
            legacy.required_primary_keywords_json,
            legacy.preferred_keywords_json,
            legacy.exclude_keywords_json,
            0,
            legacy.updated_at,
            legacy.updated_at
          FROM user_search_profiles_legacy legacy
          LEFT JOIN user_settings settings ON settings.user_id = legacy.user_id
        `
      ).run();
      db.prepare("DROP TABLE user_search_profiles_legacy").run();
    })();
    return;
  }

  createPluralUserSearchProfilesTable(db);
}

function createPluralUserSearchProfilesTable(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_search_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      vacancy_language_mode TEXT NOT NULL DEFAULT 'ru_en',
      required_context_keywords_json TEXT NOT NULL,
      required_primary_keywords_json TEXT NOT NULL,
      preferred_keywords_json TEXT NOT NULL,
      exclude_keywords_json TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, normalized_name),
      CHECK(is_active IN (0, 1)),
      CHECK(vacancy_language_mode IN ('ru_en', 'ru_only', 'en_only')),
      FOREIGN KEY(user_id) REFERENCES bot_users(user_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_user_search_profiles_user_active
      ON user_search_profiles(user_id, is_active, sort_order, id);
  `);
}

function ensureUserVacancyProfileMatchesTable(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_vacancy_profile_matches (
      user_id TEXT NOT NULL,
      vacancy_id INTEGER NOT NULL,
      profile_id INTEGER NOT NULL,
      score INTEGER NOT NULL,
      match_summary TEXT NOT NULL,
      matched_keywords_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_id, vacancy_id, profile_id),
      FOREIGN KEY(user_id) REFERENCES bot_users(user_id) ON DELETE CASCADE,
      FOREIGN KEY(vacancy_id) REFERENCES vacancies(id) ON DELETE CASCADE,
      FOREIGN KEY(profile_id) REFERENCES user_search_profiles(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_user_vacancy_profile_matches_profile
      ON user_vacancy_profile_matches(user_id, profile_id, vacancy_id);
  `);

  db.prepare(
    `
      INSERT OR IGNORE INTO user_vacancy_profile_matches (
        user_id,
        vacancy_id,
        profile_id,
        score,
        match_summary,
        matched_keywords_json,
        created_at,
        updated_at
      )
      SELECT
        matches.user_id,
        matches.vacancy_id,
        profiles.id,
        matches.score,
        matches.match_summary,
        matches.matched_keywords_json,
        matches.created_at,
        matches.updated_at
      FROM user_vacancy_matches matches
      INNER JOIN user_search_profiles profiles
        ON profiles.id = (
          SELECT first_profile.id
          FROM user_search_profiles first_profile
          WHERE first_profile.user_id = matches.user_id
          ORDER BY first_profile.sort_order ASC, first_profile.id ASC
          LIMIT 1
        )
    `
  ).run();
}

function ensureUserHhSearchSettingsTable(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_hh_search_settings (
      user_id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 0,
      text TEXT NOT NULL DEFAULT '',
      area_id TEXT NOT NULL DEFAULT '113',
      experience TEXT NOT NULL DEFAULT 'any',
      schedule TEXT NOT NULL DEFAULT 'remote',
      employment TEXT NOT NULL DEFAULT 'full',
      salary_from INTEGER,
      period_days INTEGER NOT NULL DEFAULT 7,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK(enabled IN (0, 1)),
      CHECK(experience IN ('any', 'noExperience', 'between1And3', 'between3And6', 'moreThan6')),
      CHECK(schedule IN ('any', 'remote', 'fullDay', 'flexible', 'shift')),
      CHECK(employment IN ('any', 'full', 'part', 'project', 'probation')),
      CHECK(salary_from IS NULL OR salary_from >= 0),
      CHECK(period_days BETWEEN 1 AND 30),
      FOREIGN KEY(user_id) REFERENCES bot_users(user_id) ON DELETE CASCADE
    );
  `);
}

function ensureHhUserVacancyCandidatesTable(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS hh_user_vacancy_candidates (
      user_id TEXT NOT NULL,
      vacancy_id INTEGER NOT NULL,
      query_key TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_id, vacancy_id),
      FOREIGN KEY(vacancy_id) REFERENCES vacancies(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES bot_users(user_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_hh_user_vacancy_candidates_vacancy_id
      ON hh_user_vacancy_candidates(vacancy_id);
  `);
}

function ensureUserVacancyStatesTable(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_vacancy_states (
      user_id TEXT NOT NULL,
      vacancy_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_id, vacancy_id),
      CHECK(status IN ('saved', 'hidden', 'applied')),
      FOREIGN KEY(vacancy_id) REFERENCES vacancies(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES bot_users(user_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_vacancy_hidden_reasons (
      user_id TEXT NOT NULL,
      vacancy_id INTEGER NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_id, vacancy_id),
      CHECK(reason IN (${HIDDEN_VACANCY_REASON_CHECK})),
      FOREIGN KEY(vacancy_id) REFERENCES vacancies(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES bot_users(user_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_user_vacancy_hidden_reasons_user_reason
      ON user_vacancy_hidden_reasons(user_id, reason, updated_at);

    CREATE TABLE IF NOT EXISTS user_filter_suggestions (
      user_id TEXT NOT NULL,
      suggestion_key TEXT NOT NULL,
      status TEXT NOT NULL,
      shown_at TEXT NOT NULL,
      acted_at TEXT,
      dismissed_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_id, suggestion_key),
      CHECK(suggestion_key IN (${FILTER_SUGGESTION_KEY_CHECK})),
      CHECK(status IN ('shown', 'applied', 'dismissed')),
      FOREIGN KEY(user_id) REFERENCES bot_users(user_id) ON DELETE CASCADE
    );
  `);
}

function ensureRejectedMatchAuditTable(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS rejected_match_audit (
      user_id TEXT NOT NULL,
      vacancy_id INTEGER NOT NULL,
      resolution TEXT NOT NULL DEFAULT 'rejected',
      score INTEGER,
      reason TEXT,
      decided_at TEXT NOT NULL,
      reviewed_at TEXT,
      verdict TEXT,
      PRIMARY KEY(user_id, vacancy_id),
      FOREIGN KEY(vacancy_id) REFERENCES vacancies(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES bot_users(user_id) ON DELETE CASCADE
    );
  `);
}

function ensureVacancyRelevanceFeedbackTable(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS vacancy_relevance_feedback (
      user_id TEXT NOT NULL,
      vacancy_id INTEGER NOT NULL,
      value TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_id, vacancy_id),
      CHECK(value IN ('relevant', 'not_relevant')),
      FOREIGN KEY(vacancy_id) REFERENCES vacancies(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES bot_users(user_id) ON DELETE CASCADE
    );
  `);
}

function ensureUserVacancyHiddenReasonsTable(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_vacancy_hidden_reasons (
      user_id TEXT NOT NULL,
      vacancy_id INTEGER NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_id, vacancy_id),
      CHECK(reason IN (${HIDDEN_VACANCY_REASON_CHECK})),
      FOREIGN KEY(vacancy_id) REFERENCES vacancies(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES bot_users(user_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_user_vacancy_hidden_reasons_user_reason
      ON user_vacancy_hidden_reasons(user_id, reason, updated_at);
  `);
}

function ensureUserFilterSuggestionsTable(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_filter_suggestions (
      user_id TEXT NOT NULL,
      suggestion_key TEXT NOT NULL,
      status TEXT NOT NULL,
      shown_at TEXT NOT NULL,
      acted_at TEXT,
      dismissed_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_id, suggestion_key),
      CHECK(suggestion_key IN (${FILTER_SUGGESTION_KEY_CHECK})),
      CHECK(status IN ('shown', 'applied', 'dismissed')),
      FOREIGN KEY(user_id) REFERENCES bot_users(user_id) ON DELETE CASCADE
    );
  `);
}

function ensureUserVacancyRemindersTable(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_vacancy_reminders (
      user_id TEXT NOT NULL,
      vacancy_id INTEGER NOT NULL,
      remind_at TEXT NOT NULL,
      next_attempt_at TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      delivered_at TEXT,
      cancelled_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_id, vacancy_id),
      CHECK(attempt_count >= 0),
      FOREIGN KEY(vacancy_id) REFERENCES vacancies(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES bot_users(user_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_user_vacancy_reminders_due
      ON user_vacancy_reminders(next_attempt_at)
      WHERE delivered_at IS NULL AND cancelled_at IS NULL;
  `);
}

function ensureUserVacancyApplicationsTable(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_vacancy_applications (
      user_id TEXT NOT NULL,
      vacancy_id INTEGER NOT NULL,
      applied_at TEXT NOT NULL,
      note TEXT,
      follow_up_at TEXT,
      next_attempt_at TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      delivered_at TEXT,
      cancelled_at TEXT,
      last_error TEXT,
      responded_at TEXT,
      closed_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_id, vacancy_id),
      CHECK(attempt_count >= 0),
      CHECK(note IS NULL OR length(note) <= 500),
      FOREIGN KEY(vacancy_id) REFERENCES vacancies(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES bot_users(user_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_user_vacancy_applications_due
      ON user_vacancy_applications(next_attempt_at)
      WHERE follow_up_at IS NOT NULL
        AND next_attempt_at IS NOT NULL
        AND delivered_at IS NULL
        AND cancelled_at IS NULL
        AND responded_at IS NULL
        AND closed_at IS NULL;
  `);
}

function ensureUserDailyDigestDeliveriesTable(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_daily_digest_deliveries (
      user_id TEXT NOT NULL,
      digest_date TEXT NOT NULL,
      scheduled_for TEXT NOT NULL,
      next_attempt_at TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      delivered_at TEXT,
      skipped_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_id, digest_date),
      CHECK(attempt_count >= 0),
      FOREIGN KEY(user_id) REFERENCES bot_users(user_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_user_daily_digest_deliveries_due
      ON user_daily_digest_deliveries(next_attempt_at)
      WHERE delivered_at IS NULL AND skipped_at IS NULL AND next_attempt_at IS NOT NULL;
  `);
}

function ensureChannelAlertStateTable(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS channel_alert_state (
      channel_id INTEGER PRIMARY KEY,
      failure_signature TEXT,
      failure_alerted_at TEXT,
      stale_reference TEXT,
      stale_alerted_at TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(channel_id) REFERENCES monitored_channels(id) ON DELETE CASCADE
    );
  `);
}

function ensureChannelDiscoveryTables(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS channel_discovery_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL,
      started_by_user_id TEXT,
      profile_id TEXT NOT NULL DEFAULT 'frontend',
      profile_label TEXT NOT NULL DEFAULT 'Frontend',
      custom_query TEXT,
      seed_queries_json TEXT NOT NULL,
      providers_json TEXT NOT NULL DEFAULT '[]',
      provider_warnings_json TEXT NOT NULL DEFAULT '[]',
      total_candidates_found INTEGER NOT NULL DEFAULT 0,
      candidates_to_check INTEGER NOT NULL DEFAULT 0,
      candidates_checked INTEGER NOT NULL DEFAULT 0,
      candidates_recommended INTEGER NOT NULL DEFAULT 0,
      candidates_filtered INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT,
      CHECK(status IN ('running', 'completed', 'failed'))
    );

    CREATE TABLE IF NOT EXISTS channel_discovery_candidates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      username TEXT NOT NULL,
      title TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      score INTEGER NOT NULL,
      sources_json TEXT NOT NULL,
      probe_url TEXT,
      sample_posts_count INTEGER NOT NULL DEFAULT 0,
      primary_signal_posts_count INTEGER NOT NULL DEFAULT 0,
      format_signal_posts_count INTEGER NOT NULL DEFAULT 0,
      hiring_posts_count INTEGER NOT NULL DEFAULT 0,
      vacancy_like_posts_count INTEGER NOT NULL DEFAULT 0,
      resume_posts_count INTEGER NOT NULL DEFAULT 0,
      resume_rate REAL NOT NULL DEFAULT 0,
      reasons_json TEXT NOT NULL,
      evidence_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(run_id, username),
      CHECK(status IN ('pending', 'approved', 'skipped', 'blocked')),
      FOREIGN KEY(run_id) REFERENCES channel_discovery_runs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS channel_discovery_checks (
      search_key TEXT NOT NULL,
      username TEXT NOT NULL,
      check_count INTEGER NOT NULL DEFAULT 1,
      last_checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(search_key, username)
    );

    CREATE INDEX IF NOT EXISTS idx_channel_discovery_candidates_username_status
      ON channel_discovery_candidates(username, status);

    CREATE INDEX IF NOT EXISTS idx_channel_discovery_candidates_run_score
      ON channel_discovery_candidates(run_id, score DESC);

    CREATE INDEX IF NOT EXISTS idx_channel_discovery_checks_search_time
      ON channel_discovery_checks(search_key, last_checked_at);
  `);

  const runColumns = getSchemaTableColumns(db, "channel_discovery_runs");
  if (!runColumns.has("profile_id")) {
    db.prepare("ALTER TABLE channel_discovery_runs ADD COLUMN profile_id TEXT NOT NULL DEFAULT 'frontend'").run();
  }
  if (!runColumns.has("profile_label")) {
    db.prepare("ALTER TABLE channel_discovery_runs ADD COLUMN profile_label TEXT NOT NULL DEFAULT 'Frontend'").run();
  }
  if (!runColumns.has("custom_query")) {
    db.prepare("ALTER TABLE channel_discovery_runs ADD COLUMN custom_query TEXT").run();
  }
  if (!runColumns.has("providers_json")) {
    db.prepare("ALTER TABLE channel_discovery_runs ADD COLUMN providers_json TEXT NOT NULL DEFAULT '[]'").run();
  }
  if (!runColumns.has("provider_warnings_json")) {
    db.prepare("ALTER TABLE channel_discovery_runs ADD COLUMN provider_warnings_json TEXT NOT NULL DEFAULT '[]'").run();
  }
  if (!runColumns.has("candidates_to_check")) {
    db.prepare("ALTER TABLE channel_discovery_runs ADD COLUMN candidates_to_check INTEGER NOT NULL DEFAULT 0").run();
  }

  const candidateColumns = getSchemaTableColumns(db, "channel_discovery_candidates");
  if (!candidateColumns.has("primary_signal_posts_count")) {
    db.prepare("ALTER TABLE channel_discovery_candidates ADD COLUMN primary_signal_posts_count INTEGER NOT NULL DEFAULT 0").run();
    if (candidateColumns.has("frontend_posts_count")) {
      db.prepare("UPDATE channel_discovery_candidates SET primary_signal_posts_count = frontend_posts_count").run();
    }
  }
  if (!candidateColumns.has("format_signal_posts_count")) {
    db.prepare("ALTER TABLE channel_discovery_candidates ADD COLUMN format_signal_posts_count INTEGER NOT NULL DEFAULT 0").run();
    if (candidateColumns.has("remote_posts_count")) {
      db.prepare("UPDATE channel_discovery_candidates SET format_signal_posts_count = remote_posts_count").run();
    }
  }
  const candidateTableSql = getTableSql(db, "channel_discovery_candidates");
  if (!candidateColumns.has("evidence_json") || candidateTableSql.includes("'rejected'")) {
    rebuildChannelDiscoveryCandidatesTable(db, candidateColumns);
  }
}

function rebuildChannelDiscoveryCandidatesTable(db: SqliteDatabase, columns: Set<string>): void {
  const evidenceSelect = columns.has("evidence_json") ? "COALESCE(evidence_json, '[]')" : "'[]'";
  db.transaction(() => {
    db.exec(`
      CREATE TABLE channel_discovery_candidates_next (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id INTEGER NOT NULL,
        username TEXT NOT NULL,
        title TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        score INTEGER NOT NULL,
        sources_json TEXT NOT NULL,
        probe_url TEXT,
        sample_posts_count INTEGER NOT NULL DEFAULT 0,
        primary_signal_posts_count INTEGER NOT NULL DEFAULT 0,
        format_signal_posts_count INTEGER NOT NULL DEFAULT 0,
        hiring_posts_count INTEGER NOT NULL DEFAULT 0,
        vacancy_like_posts_count INTEGER NOT NULL DEFAULT 0,
        resume_posts_count INTEGER NOT NULL DEFAULT 0,
        resume_rate REAL NOT NULL DEFAULT 0,
        reasons_json TEXT NOT NULL,
        evidence_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(run_id, username),
        CHECK(status IN ('pending', 'approved', 'skipped', 'blocked')),
        FOREIGN KEY(run_id) REFERENCES channel_discovery_runs(id) ON DELETE CASCADE
      );

      INSERT INTO channel_discovery_candidates_next (
        id, run_id, username, title, status, score, sources_json, probe_url,
        sample_posts_count, primary_signal_posts_count, format_signal_posts_count,
        hiring_posts_count, vacancy_like_posts_count, resume_posts_count, resume_rate,
        reasons_json, evidence_json, created_at, updated_at
      )
      SELECT
        id, run_id, username, title,
        CASE
          WHEN status = 'rejected' THEN 'blocked'
          WHEN status IN ('pending', 'approved', 'skipped', 'blocked') THEN status
          ELSE 'blocked'
        END,
        score, sources_json, probe_url, sample_posts_count, primary_signal_posts_count,
        format_signal_posts_count, hiring_posts_count, vacancy_like_posts_count,
        resume_posts_count, resume_rate, reasons_json, ${evidenceSelect}, created_at, updated_at
      FROM channel_discovery_candidates;

      DROP TABLE channel_discovery_candidates;
      ALTER TABLE channel_discovery_candidates_next RENAME TO channel_discovery_candidates;
      CREATE INDEX idx_channel_discovery_candidates_username_status
        ON channel_discovery_candidates(username, status);
      CREATE INDEX idx_channel_discovery_candidates_run_score
        ON channel_discovery_candidates(run_id, score DESC);
    `);
  })();
}

export function getSchemaTableColumns(db: SqliteDatabase, tableName: SchemaTableName): Set<string> {
  const pragmaByTable: Record<SchemaTableName, string> = {
    user_settings: "PRAGMA table_info(user_settings)",
    raw_messages: "PRAGMA table_info(raw_messages)",
    vacancies: "PRAGMA table_info(vacancies)",
    monitored_channels: "PRAGMA table_info(monitored_channels)",
    company_career_sources: "PRAGMA table_info(company_career_sources)",
    trusted_vacancy_services: "PRAGMA table_info(trusted_vacancy_services)",
    user_search_profiles: "PRAGMA table_info(user_search_profiles)",
    user_hh_search_settings: "PRAGMA table_info(user_hh_search_settings)",
    hh_user_vacancy_candidates: "PRAGMA table_info(hh_user_vacancy_candidates)",
    user_vacancy_applications: "PRAGMA table_info(user_vacancy_applications)",
    user_vacancy_hidden_reasons: "PRAGMA table_info(user_vacancy_hidden_reasons)",
    user_filter_suggestions: "PRAGMA table_info(user_filter_suggestions)",
    user_daily_digest_deliveries: "PRAGMA table_info(user_daily_digest_deliveries)",
    channel_discovery_runs: "PRAGMA table_info(channel_discovery_runs)",
    channel_discovery_candidates: "PRAGMA table_info(channel_discovery_candidates)"
    ,
    channel_discovery_checks: "PRAGMA table_info(channel_discovery_checks)",
    owner_report_delivery: "PRAGMA table_info(owner_report_delivery)",
    vacancy_relevance_feedback: "PRAGMA table_info(vacancy_relevance_feedback)",
    rejected_match_audit: "PRAGMA table_info(rejected_match_audit)"
  };
  const statement = pragmaByTable[tableName];
  if (!statement) {
    throw new Error(`Unsupported table lookup: ${tableName}`);
  }

  const rows = db.prepare(statement).all() as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

function getTableSql(db: SqliteDatabase, tableName: SchemaTableName): string {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
    .get(tableName) as { sql: string | null } | undefined;

  return row?.sql ?? "";
}

function rebuildUserSettingsTable(db: SqliteDatabase, columns: Set<string>): void {
  const vacancyLanguageModeSelect = columns.has("vacancy_language_mode")
    ? `CASE
         WHEN vacancy_language_mode IN ('ru_en', 'ru_only', 'en_only') THEN vacancy_language_mode
         ELSE 'ru_en'
       END`
    : "'ru_en'";
  const notifyOnEmptyCycleSelect = columns.has("notify_on_empty_cycle") ? "COALESCE(notify_on_empty_cycle, 0)" : "0";
  const dailyDigestEnabledSelect = columns.has("daily_digest_enabled") ? "COALESCE(daily_digest_enabled, 0)" : "0";
  const dailyDigestTimeMinutesSelect = columns.has("daily_digest_time_minutes")
    ? "CASE WHEN daily_digest_time_minutes BETWEEN 0 AND 1439 THEN daily_digest_time_minutes ELSE NULL END"
    : "NULL";
  const onboardingCompletedSelect = columns.has("onboarding_completed") ? "COALESCE(onboarding_completed, 0)" : "0";
    const onboardingStepSelect = columns.has("onboarding_step")
      ? `CASE
           WHEN onboarding_step IN (
             'intro',
             'welcome',
             'preset',
             'language',
             'manual_required_context',
           'manual_required_primary',
           'manual_preferred',
           'manual_exclude'
         ) THEN onboarding_step
         ELSE NULL
       END`
    : "NULL";
  const pendingInputActionSelect = columns.has("pending_input_action") ? "pending_input_action" : "NULL";
  const pendingInputPayloadSelect = columns.has("pending_input_payload") ? "pending_input_payload" : "NULL";
  const pendingKeywordKindSelect = columns.has("pending_keyword_kind") ? "pending_keyword_kind" : "NULL";
  const weeklyPageSizeSelect = columns.has("weekly_page_size")
    ? "CASE WHEN weekly_page_size BETWEEN 1 AND 5 THEN weekly_page_size ELSE NULL END"
    : "NULL";

  db.transaction(() => {
    db.exec(`
      CREATE TABLE user_settings_next (
        user_id TEXT PRIMARY KEY,
        ai_enabled INTEGER NOT NULL DEFAULT 0,
        filter_mode TEXT NOT NULL DEFAULT 'keywords',
        bot_paused INTEGER NOT NULL DEFAULT 0,
        notify_on_empty_cycle INTEGER NOT NULL DEFAULT 0,
        daily_digest_enabled INTEGER NOT NULL DEFAULT 0,
        daily_digest_time_minutes INTEGER,
        weekly_page_size INTEGER,
        vacancy_language_mode TEXT NOT NULL DEFAULT 'ru_en',
        onboarding_completed INTEGER NOT NULL DEFAULT 0,
        onboarding_step TEXT,
        pending_input_action TEXT,
        pending_input_payload TEXT,
        pending_keyword_kind TEXT,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CHECK(filter_mode IN ('keywords', 'hybrid', 'ai')),
        CHECK(daily_digest_time_minutes BETWEEN 0 AND 1439 OR daily_digest_time_minutes IS NULL),
        CHECK(weekly_page_size BETWEEN 1 AND 5 OR weekly_page_size IS NULL),
        CHECK(vacancy_language_mode IN ('ru_en', 'ru_only', 'en_only')),
          CHECK(
            onboarding_step IN (
              'intro',
              'welcome',
              'preset',
              'language',
              'manual_required_context',
            'manual_required_primary',
            'manual_preferred',
            'manual_exclude'
          )
          OR onboarding_step IS NULL
        ),
        CHECK(
          pending_input_action IN (
            'add_include_keyword',
            'add_exclude_keyword',
            'add_channel',
            'add_company_career_source',
            'add_trusted_vacancy_service',
            'add_user',
            'set_profile_required_context',
            'set_profile_required_primary',
            'set_profile_preferred',
            'set_profile_exclude',
            'rename_search_profile',
            'set_hh_text',
            'set_hh_area',
            'set_hh_salary',
            'set_hh_period',
            'run_channel_discovery_custom',
            'run_channel_discovery_seeds',
            'set_application_note',
            'set_runtime_setting'
          )
          OR pending_input_action IS NULL
        ),
        CHECK(pending_keyword_kind IN ('include', 'exclude') OR pending_keyword_kind IS NULL)
      );
    `);

    db.exec(`
      INSERT INTO user_settings_next (
        user_id,
        ai_enabled,
        filter_mode,
        bot_paused,
        notify_on_empty_cycle,
        daily_digest_enabled,
        daily_digest_time_minutes,
        weekly_page_size,
        vacancy_language_mode,
        onboarding_completed,
        onboarding_step,
        pending_input_action,
        pending_input_payload,
        pending_keyword_kind,
        updated_at
      )
      SELECT
        user_id,
        COALESCE(ai_enabled, 0),
        CASE
          WHEN filter_mode IN ('keywords', 'hybrid', 'ai') THEN filter_mode
          ELSE 'keywords'
        END,
        COALESCE(bot_paused, 0),
        ${notifyOnEmptyCycleSelect},
        ${dailyDigestEnabledSelect},
        ${dailyDigestTimeMinutesSelect},
        ${weeklyPageSizeSelect},
        ${vacancyLanguageModeSelect},
        ${onboardingCompletedSelect},
        ${onboardingStepSelect},
        ${pendingInputActionSelect},
        ${pendingInputPayloadSelect},
        ${pendingKeywordKindSelect},
        COALESCE(updated_at, CURRENT_TIMESTAMP)
      FROM user_settings;
    `);

    db.exec("DROP TABLE user_settings");
    db.exec("ALTER TABLE user_settings_next RENAME TO user_settings");
  })();
}
