import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import BetterSqlite3 from "better-sqlite3";

import { VacancyDatabase } from "../src/db/database";
import { getSchemaTableColumns } from "../src/db/schema";
import { createTestConfig } from "./helpers";

function createLegacyDatabasePath(): { tempDir: string; databasePath: string } {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-tg-bot-legacy-db-"));
  const databasePath = path.join(tempDir, "bot.db");
  const db = new BetterSqlite3(databasePath);

  db.exec(`
    CREATE TABLE raw_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_name TEXT NOT NULL,
      source_channel TEXT NOT NULL,
      source_message_id TEXT NOT NULL,
      message_date TEXT NOT NULL,
      text TEXT NOT NULL,
      normalized_text TEXT NOT NULL,
      url TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(source_name, source_channel, source_message_id)
    );

    CREATE TABLE vacancies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_name TEXT NOT NULL,
      source_channel TEXT NOT NULL,
      source_message_id TEXT NOT NULL,
      message_date TEXT NOT NULL,
      title TEXT NOT NULL,
      text TEXT NOT NULL,
      normalized_text TEXT NOT NULL,
      url TEXT NOT NULL,
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
  `);
  db.close();

  return {
    tempDir,
    databasePath
  };
}

test("database migration adds canonical_url columns before canonical indexes", () => {
  const { tempDir, databasePath } = createLegacyDatabasePath();
  const config = createTestConfig({
    databasePath,
    databaseUrl: `file:${databasePath}`,
    appDataDir: tempDir,
    runtimeDir: path.join(tempDir, "runtime")
  });
  const database = new VacancyDatabase(config);

  assert.doesNotThrow(() => database.initialize());
  const sqlite = new BetterSqlite3(databasePath, { readonly: true });

  assert.equal(getSchemaTableColumns(sqlite, "raw_messages").has("canonical_url"), true);
  assert.equal(getSchemaTableColumns(sqlite, "vacancies").has("canonical_url"), true);

  sqlite.close();
  database.close();
});

test("database migration converts rejected discovery candidates to blocked and adds evidence", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-tg-bot-legacy-discovery-"));
  const databasePath = path.join(tempDir, "bot.db");
  const sqlite = new BetterSqlite3(databasePath);
  sqlite.exec(`
    CREATE TABLE channel_discovery_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL,
      started_by_user_id TEXT,
      profile_id TEXT NOT NULL DEFAULT 'frontend',
      profile_label TEXT NOT NULL DEFAULT 'Frontend',
      custom_query TEXT,
      seed_queries_json TEXT NOT NULL,
      total_candidates_found INTEGER NOT NULL DEFAULT 0,
      candidates_checked INTEGER NOT NULL DEFAULT 0,
      candidates_recommended INTEGER NOT NULL DEFAULT 0,
      candidates_filtered INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT
    );
    CREATE TABLE channel_discovery_candidates (
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
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(run_id, username),
      CHECK(status IN ('pending', 'approved', 'rejected'))
    );
    INSERT INTO channel_discovery_runs (status, seed_queries_json) VALUES ('completed', '[]');
    INSERT INTO channel_discovery_candidates (
      run_id, username, status, score, sources_json, reasons_json
    ) VALUES (1, 'blocked_fixture', 'rejected', 10, '[]', '[]');
  `);
  sqlite.close();

  const database = new VacancyDatabase(
    createTestConfig({ databasePath, databaseUrl: `file:${databasePath}`, appDataDir: tempDir, runtimeDir: path.join(tempDir, "runtime") })
  );
  database.initialize();
  const candidate = database.getChannelDiscoveryCandidate(1);
  const migratedSqlite = new BetterSqlite3(databasePath, { readonly: true });
  const runColumns = getSchemaTableColumns(migratedSqlite, "channel_discovery_runs");
  const checkColumns = getSchemaTableColumns(migratedSqlite, "channel_discovery_checks");
  migratedSqlite.close();
  database.close();

  assert.equal(candidate?.status, "blocked");
  assert.deepEqual(candidate?.evidence, []);
  assert.equal(runColumns.has("candidates_to_check"), true);
  assert.equal(checkColumns.has("last_checked_at"), true);
});

test("database migration adds current trusted adapters while preserving trusted services", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-tg-bot-legacy-trusted-services-"));
  const databasePath = path.join(tempDir, "bot.db");
  const sqlite = new BetterSqlite3(databasePath);
  sqlite.exec(`
    CREATE TABLE trusted_vacancy_services (
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
      CHECK(adapter IN ('findmyremote', 'generic')),
      CHECK(status IN ('pending', 'active', 'disabled')),
      CHECK(parser_mode IN ('specialized', 'json_ld_or_html'))
    );
    INSERT INTO trusted_vacancy_services (
      hostname, display_name, adapter, status, parser_mode, example_url
    ) VALUES
      (
        'jobs.example.com', 'Example', 'generic', 'disabled',
        'json_ld_or_html', 'https://jobs.example.com/vacancy/1'
      ),
      (
        'telegra.ph', 'Old Telegraph', 'generic', 'disabled',
        'json_ld_or_html', 'https://telegra.ph/Old-Vacancy-01-01'
      );
  `);
  sqlite.close();

  const database = new VacancyDatabase(
    createTestConfig({ databasePath, databaseUrl: `file:${databasePath}`, appDataDir: tempDir, runtimeDir: path.join(tempDir, "runtime") })
  );
  assert.doesNotThrow(() => database.initialize());
  const services = database.listTrustedVacancyServicesPage(0, 10).items;
  const preserved = services.find((service) => service.hostname === "jobs.example.com");
  const disabledTelegraph = services.find((service) => service.hostname === "telegra.ph");
  const teletype = database.getActiveTrustedVacancyServiceByHostname("teletype.in");
  const finder = database.getActiveTrustedVacancyServiceByHostname("finder.work");
  database.close();

  assert.equal(preserved?.status, "disabled");
  assert.equal(preserved?.adapter, "generic");
  assert.equal(teletype?.adapter, "teletype");
  assert.equal(finder?.adapter, "finder_work");
  assert.equal(disabledTelegraph?.status, "disabled");
  assert.equal(disabledTelegraph?.adapter, "telegraph");
});

test("database migration adds weekly page size to legacy user settings", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-tg-bot-legacy-user-settings-"));
  const databasePath = path.join(tempDir, "bot.db");
  const sqlite = new BetterSqlite3(databasePath);
  sqlite.exec(`
    CREATE TABLE user_settings (
      user_id TEXT PRIMARY KEY,
      ai_enabled INTEGER NOT NULL DEFAULT 0,
      filter_mode TEXT NOT NULL DEFAULT 'keywords',
      bot_paused INTEGER NOT NULL DEFAULT 0,
      notify_on_empty_cycle INTEGER NOT NULL DEFAULT 0,
      vacancy_language_mode TEXT NOT NULL DEFAULT 'ru_en',
      onboarding_completed INTEGER NOT NULL DEFAULT 1,
      onboarding_step TEXT,
      pending_input_action TEXT,
      pending_input_payload TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO user_settings (
      user_id,
      ai_enabled,
      filter_mode,
      bot_paused,
      notify_on_empty_cycle,
      vacancy_language_mode,
      onboarding_completed,
      updated_at
    ) VALUES ('123456', 0, 'keywords', 0, 1, 'ru_only', 1, CURRENT_TIMESTAMP);
  `);
  sqlite.close();

  const database = new VacancyDatabase(
    createTestConfig({ databasePath, databaseUrl: `file:${databasePath}`, appDataDir: tempDir, runtimeDir: path.join(tempDir, "runtime") })
  );
  assert.doesNotThrow(() => database.initialize());
  const settings = database.getUserSettings("123456");
  const migratedSqlite = new BetterSqlite3(databasePath, { readonly: true });
  const columns = getSchemaTableColumns(migratedSqlite, "user_settings");
  migratedSqlite.close();
  database.close();

  assert.equal(columns.has("weekly_page_size"), true);
  assert.equal(settings.notifyOnEmptyCycle, true);
  assert.equal(settings.vacancyLanguageMode, "ru_only");
  assert.equal(settings.weeklyPageSize, null);
  assert.equal(settings.dailyDigestEnabled, false);
  assert.equal(settings.dailyDigestTimeMinutes, null);
  assert.equal(columns.has("daily_digest_enabled"), true);
  assert.equal(columns.has("daily_digest_time_minutes"), true);
});

test("fresh schema includes daily digest delivery state table", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-tg-bot-digest-schema-"));
  const databasePath = path.join(tempDir, "bot.db");
  const database = new VacancyDatabase(
    createTestConfig({ databasePath, databaseUrl: `file:${databasePath}`, appDataDir: tempDir, runtimeDir: path.join(tempDir, "runtime") })
  );
  database.initialize();
  const sqlite = new BetterSqlite3(databasePath, { readonly: true });
  const userSettingsColumns = getSchemaTableColumns(sqlite, "user_settings");
  const deliveryColumns = getSchemaTableColumns(sqlite, "user_daily_digest_deliveries");
  const hiddenReasonColumns = getSchemaTableColumns(sqlite, "user_vacancy_hidden_reasons");
  const filterSuggestionColumns = getSchemaTableColumns(sqlite, "user_filter_suggestions");
  sqlite.close();
  database.close();

  assert.equal(userSettingsColumns.has("daily_digest_enabled"), true);
  assert.equal(userSettingsColumns.has("daily_digest_time_minutes"), true);
  assert.equal(deliveryColumns.has("user_id"), true);
  assert.equal(deliveryColumns.has("digest_date"), true);
  assert.equal(deliveryColumns.has("scheduled_for"), true);
  assert.equal(deliveryColumns.has("next_attempt_at"), true);
  assert.equal(deliveryColumns.has("delivered_at"), true);
  assert.equal(deliveryColumns.has("skipped_at"), true);
  assert.equal(hiddenReasonColumns.has("user_id"), true);
  assert.equal(hiddenReasonColumns.has("vacancy_id"), true);
  assert.equal(hiddenReasonColumns.has("reason"), true);
  assert.equal(filterSuggestionColumns.has("suggestion_key"), true);
  assert.equal(filterSuggestionColumns.has("status"), true);
  assert.equal(filterSuggestionColumns.has("dismissed_at"), true);
});
