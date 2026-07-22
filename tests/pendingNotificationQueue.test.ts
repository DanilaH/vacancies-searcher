import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import BetterSqlite3 from "better-sqlite3";

import type * as grammy from "grammy";

import { createAnalyticsService } from "../src/analytics/analyticsService";
import type { BotController } from "../src/bot/createBot";
import { createNotificationsKeyboard } from "../src/bot/keyboards";
import { formatNotificationPreferences } from "../src/bot/formatters";
import { handleNotificationQuietHoursToggleCallback } from "../src/bot/notificationQuietHoursHandler";
import type { BotPanelMode } from "../src/bot/render";
import { VacancyDatabase } from "../src/db/database";
import { getSchemaTableColumns } from "../src/db/schema";
import { PendingNotificationScheduler } from "../src/services/pendingNotificationScheduler";
import { isInQuietHours, computeNextQuietHoursEnd } from "../src/services/quietHoursUtils";
import { VacancyFilter } from "../src/services/vacancyFilter";
import { VacancyIngestor } from "../src/services/vacancyIngestor";
import type { MatchedVacancyRecord } from "../src/types";
import { createTestConfig } from "./helpers";

interface DeliveryRecord { userId: string; vacancyId: number }

function createFixture(timeZone = "UTC") {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-tg-bot-quiet-"));
  const config = createTestConfig({
    ownerUserId: "777",
    ownerChatId: "777",
    databasePath: path.join(tempDir, "bot.db"),
    databaseUrl: `file:${path.join(tempDir, "bot.db")}`,
    appDataDir: tempDir,
    runtimeDir: path.join(tempDir, "runtime"),
    timeZone
  });
  const database = new VacancyDatabase(config);
  database.initialize();
  const deliveries: DeliveryRecord[] = [];
  const bot: BotController = {
    async start() {},
    async stop() {},
    async notifyVacancy(vacancy: MatchedVacancyRecord) {
      deliveries.push({ userId: vacancy.userId, vacancyId: vacancy.id });
      database.markUserVacancyDelivered(vacancy.userId, vacancy.id);
      return true;
    },
    async sendVacancyReminder() { return true; },
    async sendApplicationFollowUp() { return true; },
    async sendNoNewVacanciesNotification() { return true; },
    async sendStartupDiagnostic() {},
    async sendAdminAlert() { return true; },
    async sendOwnerReport() { return true; }
  };
  return { database, bot, deliveries, tempDir, config };
}

function createIngestorFixture(overrides: { timeZone?: string; now?: () => Date } = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-tg-bot-qi-"));
  const config = createTestConfig({
    ownerUserId: "777",
    ownerChatId: "777",
    databasePath: path.join(tempDir, "bot.db"),
    databaseUrl: `file:${path.join(tempDir, "bot.db")}`,
    appDataDir: tempDir,
    runtimeDir: path.join(tempDir, "runtime"),
    timeZone: overrides.timeZone ?? "UTC"
  });
  const database = new VacancyDatabase(config);
  database.initialize();
  const deliveries: DeliveryRecord[] = [];
  const bot: BotController = {
    async start() {},
    async stop() {},
    async notifyVacancy(vacancy: MatchedVacancyRecord) {
      deliveries.push({ userId: vacancy.userId, vacancyId: vacancy.id });
      database.markUserVacancyDelivered(vacancy.userId, vacancy.id);
      return true;
    },
    async sendVacancyReminder() { return true; },
    async sendApplicationFollowUp() { return true; },
    async sendNoNewVacanciesNotification() { return true; },
    async sendStartupDiagnostic() {},
    async sendAdminAlert() { return true; },
    async sendOwnerReport() { return true; }
  };
  const analytics = createAnalyticsService(config, database);
  const filter = new VacancyFilter(config);
  const nowFn = overrides.now ?? (() => new Date());
  const ingestor = new VacancyIngestor(config, filter, database, bot, analytics, undefined, nowFn);
  return { database, analytics, filter, ingestor, deliveries, tempDir, config, bot, now: nowFn };
}

function insertVacancy(sqlite: BetterSqlite3.Database, daysAgo = 0): { id: number } {
  const date = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
  const result = sqlite
    .prepare(
      `INSERT INTO vacancies (source_name, source_channel, source_message_id, message_date, title, text, normalized_text, url, fingerprint, score, match_summary, matched_keywords_json, contacts_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'test-fp', 0, '', '[]', '[]', ?, ?)`
    )
    .run("tg", "ch1", `msg-${Date.now()}-${Math.random()}`, date, "Test Title", "Some text", "some text", "https://example.com/vacancy", date, date);
  return { id: Number(result.lastInsertRowid) };
}

let globalMsgCounter = 0;

function createMatch(sqlite: BetterSqlite3.Database, userId: string, vacancyId: number, delivered = false): void {
  const now = new Date().toISOString();
  globalMsgCounter++;
  sqlite.prepare(
    `INSERT INTO user_vacancy_matches (user_id, vacancy_id, score, match_summary, matched_keywords_json, delivered_at, created_at, updated_at)
     VALUES (?, ?, 1, '', '[]', ?, ?, ?)`
  ).run(userId, vacancyId, delivered ? now : null, now, now);
}

function populateNewUser(sqlite: BetterSqlite3.Database, userId: string, active = true): void {
  sqlite.prepare("INSERT OR IGNORE INTO bot_users (user_id, is_active, role, created_at, updated_at) VALUES (?, ?, 'member', ?, ?)")
    .run(userId, active ? 1 : 0, new Date().toISOString(), new Date().toISOString());
  sqlite.prepare(`INSERT OR IGNORE INTO user_settings (user_id, ai_enabled, filter_mode, bot_paused, notify_on_empty_cycle, daily_digest_enabled, daily_digest_time_minutes, instant_vacancy_notifications_enabled, notification_quiet_hours_enabled, weekly_page_size, vacancy_language_mode, onboarding_completed, onboarding_step, pending_input_action, pending_input_payload, updated_at)
    VALUES (?, 0, 'keywords', 0, 0, 0, NULL, 1, 0, NULL, 'ru_en', 1, NULL, NULL, NULL, ?)`)
    .run(userId, new Date().toISOString());
}

// ─── Migration & defaults ─────────────────────────────────────

test("migration adds notification_quiet_hours_enabled to legacy user_settings", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-tg-bot-legacy-qh-"));
  const databasePath = path.join(tempDir, "bot.db");
  const sqlite = new BetterSqlite3(databasePath);
  sqlite.exec(`
    CREATE TABLE user_settings (
      user_id TEXT PRIMARY KEY,
      ai_enabled INTEGER NOT NULL DEFAULT 0,
      filter_mode TEXT NOT NULL DEFAULT 'keywords',
      bot_paused INTEGER NOT NULL DEFAULT 0,
      notify_on_empty_cycle INTEGER NOT NULL DEFAULT 0,
      daily_digest_enabled INTEGER NOT NULL DEFAULT 0,
      daily_digest_time_minutes INTEGER,
      instant_vacancy_notifications_enabled INTEGER NOT NULL DEFAULT 1,
      weekly_page_size INTEGER,
      vacancy_language_mode TEXT NOT NULL DEFAULT 'ru_en',
      onboarding_completed INTEGER NOT NULL DEFAULT 1,
      onboarding_step TEXT,
      pending_input_action TEXT,
      pending_input_payload TEXT,
      pending_keyword_kind TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO user_settings (user_id, updated_at) VALUES ('123456', CURRENT_TIMESTAMP);
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

  assert.equal(columns.has("notification_quiet_hours_enabled"), true);
  assert.equal(settings.notificationQuietHoursEnabled, false);
});

test("fresh schema includes notification_quiet_hours_enabled column", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-tg-bot-fresh-qh-"));
  const databasePath = path.join(tempDir, "bot.db");
  const database = new VacancyDatabase(
    createTestConfig({ databasePath, databaseUrl: `file:${databasePath}`, appDataDir: tempDir, runtimeDir: path.join(tempDir, "runtime") })
  );
  database.initialize();
  const sqlite = new BetterSqlite3(databasePath, { readonly: true });
  const columns = getSchemaTableColumns(sqlite, "user_settings");
  sqlite.close();
  database.close();

  assert.equal(columns.has("notification_quiet_hours_enabled"), true);
});

test("default value is false for new user", () => {
  const config = createTempDatabaseConfig();
  const database = new VacancyDatabase(config);
  database.initialize();
  const settings = database.getUserSettings(config.ownerUserId!);
  database.close();
  assert.equal(settings.notificationQuietHoursEnabled, false);
});

function createTempDatabaseConfig() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-tg-bot-quiet-"));
  return createTestConfig({
    ownerUserId: "777",
    ownerChatId: "777",
    databasePath: path.join(tempDir, "bot.db"),
    databaseUrl: `file:${path.join(tempDir, "bot.db")}`,
    appDataDir: tempDir,
    runtimeDir: path.join(tempDir, "runtime")
  });
}

test("setting persists true/false after toggle", () => {
  const config = createTempDatabaseConfig();
  const firstDatabase = new VacancyDatabase(config);
  firstDatabase.initialize();
  firstDatabase.setNotificationQuietHoursEnabled(config.ownerUserId!, true);
  firstDatabase.close();

  const secondDatabase = new VacancyDatabase(config);
  secondDatabase.initialize();
  const settings = secondDatabase.getUserSettings(config.ownerUserId!);
  secondDatabase.close();
  assert.equal(settings.notificationQuietHoursEnabled, true);
});

test("settings are isolated between users", () => {
  const config = createTempDatabaseConfig();
  const database = new VacancyDatabase(config);
  database.initialize();
  database.setNotificationQuietHoursEnabled(config.ownerUserId!, true);
  database.setNotificationQuietHoursEnabled("userB", false);
  const ownerSettings = database.getUserSettings(config.ownerUserId!);
  const userBSettings = database.getUserSettings("userB");
  database.close();
  assert.equal(ownerSettings.notificationQuietHoursEnabled, true);
  assert.equal(userBSettings.notificationQuietHoursEnabled, false);
});

// ─── Keyboard & formatter ─────────────────────────────────────

test("notifications keyboard includes quiet hours toggle", () => {
  const keyboard = createNotificationsKeyboard(false, false, true, true);
  const data = (keyboard as { inline_keyboard?: Array<Array<{ text: string; callback_data?: string }>> }).inline_keyboard ?? [];
  const callbacks = data.flat().map((b) => b.callback_data).filter(Boolean);
  const lbls = data.flat().map((b) => b.text);
  assert.ok(callbacks.includes("notifications:toggle_quiet_hours"));
  assert.ok(lbls.includes("🌙 Ночная пауза 23:00–08:00: включена"));
});

test("keyboard shows disabled quiet hours state", () => {
  const keyboard = createNotificationsKeyboard(false, false, true, false);
  const lbls = ((keyboard as { inline_keyboard?: Array<Array<{ text: string }>> }).inline_keyboard ?? []).flat().map((b) => b.text);
  assert.ok(lbls.includes("🌙 Ночная пауза 23:00–08:00: выключена"));
});

test("formatNotificationPreferences includes quiet hours line", () => {
  const text = formatNotificationPreferences(false, false, true, true);
  assert.ok(text.includes("Ночная пауза"));
  assert.ok(text.includes("включена"));
  const text2 = formatNotificationPreferences(false, false, true, false);
  assert.ok(text2.includes("выключена"));
});

// ─── isInQuietHours / computeNextQuietHoursEnd ────────────────

test("isInQuietHours returns true at 23:00 UTC", () => {
  const now = new Date("2026-07-22T23:00:00Z");
  assert.equal(isInQuietHours(now, "UTC"), true);
});

test("isInQuietHours returns true at 03:00 UTC", () => {
  const now = new Date("2026-07-22T03:00:00Z");
  assert.equal(isInQuietHours(now, "UTC"), true);
});

test("isInQuietHours returns false at 08:00 UTC", () => {
  const now = new Date("2026-07-22T08:00:00Z");
  assert.equal(isInQuietHours(now, "UTC"), false);
});

test("isInQuietHours returns false at 15:00 UTC", () => {
  const now = new Date("2026-07-22T15:00:00Z");
  assert.equal(isInQuietHours(now, "UTC"), false);
});

test("isInQuietHours works with non-UTC timezone", () => {
  // UTC+3, 21:00 UTC = 00:00 local next day → in quiet hours
  const now = new Date("2026-07-22T21:00:00Z");
  assert.equal(isInQuietHours(now, "Europe/Moscow"), true);
  // UTC+3, 20:00 UTC = 23:00 local → in quiet hours
  const now2 = new Date("2026-07-22T20:00:00Z");
  assert.equal(isInQuietHours(now2, "Europe/Moscow"), true);
  // UTC+3, 04:00 UTC = 07:00 local → in quiet hours (before 08:00)
  const now3 = new Date("2026-07-23T04:00:00Z");
  assert.equal(isInQuietHours(now3, "Europe/Moscow"), true);
  // UTC+3, 05:00 UTC = 08:00 local → edge of quiet hours (08:00 = not quiet)
  const now4 = new Date("2026-07-23T05:00:00Z");
  assert.equal(isInQuietHours(now4, "Europe/Moscow"), false);
});

test("computeNextQuietHoursEnd returns today 08:00 if before 08:00", () => {
  const now = new Date("2026-07-22T05:00:00Z");
  const result = computeNextQuietHoursEnd(now, "UTC");
  const d = new Date(result);
  assert.equal(d.getUTCHours(), 8);
  assert.equal(d.getUTCMinutes(), 0);
  assert.equal(d.getUTCDate(), 22);
  assert.equal(d.getUTCMonth(), 6);
  assert.equal(d.getUTCFullYear(), 2026);
});

test("computeNextQuietHoursEnd returns tomorrow 08:00 if after 23:00", () => {
  const now = new Date("2026-07-22T23:30:00Z");
  const result = computeNextQuietHoursEnd(now, "UTC");
  const d = new Date(result);
  assert.equal(d.getUTCHours(), 8);
  assert.equal(d.getUTCMinutes(), 0);
  assert.equal(d.getUTCDate(), 23);
  assert.equal(d.getUTCMonth(), 6);
  assert.equal(d.getUTCFullYear(), 2026);
});

test("computeNextQuietHoursEnd respects timezone offset", () => {
  // At UTC+3 (Moscow), 2026-07-22T22:00:00Z = 2026-07-23T01:00:00 MSK (in quiet hours, before 08:00)
  const now = new Date("2026-07-22T22:00:00Z");
  const result = computeNextQuietHoursEnd(now, "Europe/Moscow");
  const d = new Date(result);
  // Next 08:00 MSK = 2026-07-23T05:00:00Z (since MSK is UTC+3, 08:00 MSK = 05:00 UTC)
  assert.equal(d.getUTCHours(), 5);
  assert.equal(d.getUTCDate(), 23);
  assert.equal(d.getUTCMinutes(), 0);
});

test("computeNextQuietHoursEnd handles DST spring-forward in Europe/Stockholm", () => {
  // 2026-03-29 is the DST spring-forward in Europe/Stockholm (CEST starts)
  // At 01:00 UTC on Mar 29, Stockholm is at 03:00 CEST (already spring-forward)
  // 2026-03-28 22:00 UTC = 2026-03-28 23:00 CET (before spring-forward)
  const now = new Date("2026-03-28T22:00:00Z");
  const result = computeNextQuietHoursEnd(now, "Europe/Stockholm");
  const d = new Date(result);
  // Next 08:00 CET = 2026-03-29T07:00:00Z (CET = UTC+1)
  // But wait - 2026-03-29 is the switch date. At 02:00 CET clocks spring to 03:00 CEST.
  // 08:00 on Mar 29 in Stockholm = 06:00 UTC (CEST = UTC+2)
  assert.equal(d.getUTCHours(), 6);
  assert.equal(d.getUTCMinutes(), 0);
});

test("computeNextQuietHoursEnd handles DST fall-back in Europe/Stockholm", () => {
  // 2026-10-25 is the DST fall-back in Europe/Stockholm (CEST → CET)
  // 2026-10-24 21:00 UTC = 2026-10-24 23:00 CEST (before fall-back)
  const now = new Date("2026-10-24T21:00:00Z");
  const result = computeNextQuietHoursEnd(now, "Europe/Stockholm");
  const d = new Date(result);
  // Next 08:00 on Oct 25 Stockholm = 07:00 UTC (CET = UTC+1 after fall-back)
  assert.equal(d.getUTCHours(), 7);
  assert.equal(d.getUTCMinutes(), 0);
});

test("computeNextQuietHoursEnd returns correct 08:00 local in DST zone summer", () => {
  // Mid-summer in Europe/Stockholm (CEST, UTC+2)
  const now = new Date("2026-07-15T01:00:00Z"); // 03:00 CEST, in quiet hours
  const result = computeNextQuietHoursEnd(now, "Europe/Stockholm");
  const d = new Date(result);
  // Next 08:00 CEST = 06:00 UTC
  assert.equal(d.getUTCHours(), 6);
  assert.equal(d.getUTCMinutes(), 0);
  assert.equal(d.getUTCDate(), 15);
});

// ─── Database operations ──────────────────────────────────────

test("enqueuePendingNotification creates a row", () => {
  const fixture = createFixture();
  const { database } = fixture;
  const sqlite = new BetterSqlite3(fixture.config.databasePath!);
  const v = insertVacancy(sqlite);
  database.enqueuePendingNotification("777", v.id, "2026-07-23T08:00:00.000Z");
  const rows = sqlite.prepare("SELECT id FROM pending_notification_queue").all() as Array<{ id: number }>;
  assert.equal(rows.length, 1);
  sqlite.close();
  database.close();
});

test("enqueuePendingNotification dedup by user+vacancy (INSERT OR IGNORE)", () => {
  const fixture = createFixture();
  const { database } = fixture;
  const sqlite = new BetterSqlite3(fixture.config.databasePath!);
  const v = insertVacancy(sqlite);
  database.enqueuePendingNotification("777", v.id, "2026-07-23T08:00:00.000Z");
  database.enqueuePendingNotification("777", v.id, "2026-07-23T08:00:00.000Z");
  const rows = sqlite.prepare("SELECT id FROM pending_notification_queue").all() as Array<{ id: number }>;
  assert.equal(rows.length, 1);
  sqlite.close();
  database.close();
});

test("hasPendingNotification returns true for undelivered row", () => {
  const fixture = createFixture();
  const { database } = fixture;
  const sqlite = new BetterSqlite3(fixture.config.databasePath!);
  const v = insertVacancy(sqlite);
  assert.equal(database.hasPendingNotification("777", v.id), false);
  database.enqueuePendingNotification("777", v.id, "2026-07-23T08:00:00.000Z");
  assert.equal(database.hasPendingNotification("777", v.id), true);
  sqlite.close();
  database.close();
});

test("listDuePendingNotifications returns only undelivered and due items", () => {
  const fixture = createFixture();
  const { database } = fixture;
  const sqlite = new BetterSqlite3(fixture.config.databasePath!);
  const v1 = insertVacancy(sqlite);
  const v2 = insertVacancy(sqlite);
  const v3 = insertVacancy(sqlite);
  database.enqueuePendingNotification("777", v1.id, "2026-07-23T06:00:00.000Z"); // due
  database.enqueuePendingNotification("777", v2.id, "3026-07-23T08:00:00.000Z"); // future
  database.enqueuePendingNotification("777", v3.id, "2026-07-23T06:00:00.000Z"); // will be delivered
  const due1 = database.listDuePendingNotifications("2026-07-23T07:00:00.000Z");
  assert.equal(due1.length, 2);
  database.markPendingNotificationDelivered(due1[0]!.id);
  const due2 = database.listDuePendingNotifications("2026-07-23T07:00:00.000Z");
  assert.equal(due2.length, 1);
  sqlite.close();
  database.close();
});

test("markPendingNotificationFailed increments retry_count and stores error", () => {
  const fixture = createFixture();
  const { database } = fixture;
  const sqlite = new BetterSqlite3(fixture.config.databasePath!);
  const v = insertVacancy(sqlite);
  database.enqueuePendingNotification("777", v.id, "2026-07-23T08:00:00.000Z");
  const due = database.listDuePendingNotifications("3026-07-23T08:00:00.000Z");
  database.markPendingNotificationFailed(due[0]!.id, "test error", "2026-07-23T09:00:00.000Z");
  const row = sqlite.prepare("SELECT retry_count, last_error, scheduled_at FROM pending_notification_queue WHERE id = ?").get(due[0]!.id) as { retry_count: number; last_error: string; scheduled_at: string };
  assert.equal(row.retry_count, 1);
  assert.equal(row.last_error, "test error");
  assert.equal(row.scheduled_at, "2026-07-23T09:00:00.000Z");
  sqlite.close();
  database.close();
});

test("cancelPendingNotificationsForVacancy marks cancelled", () => {
  const fixture = createFixture();
  const { database } = fixture;
  const sqlite = new BetterSqlite3(fixture.config.databasePath!);
  const v = insertVacancy(sqlite);
  database.enqueuePendingNotification("777", v.id, "2026-07-23T08:00:00.000Z");
  database.cancelPendingNotificationsForVacancy("777", v.id);
  const due = database.listDuePendingNotifications("3026-07-23T08:00:00.000Z");
  assert.equal(due.length, 0);
  sqlite.close();
  database.close();
});

test("listInstantWithQuietHoursEnabledUsers returns correct users", () => {
  const fixture = createFixture();
  const { database } = fixture;
  const sqlite = new BetterSqlite3(fixture.config.databasePath!);
  populateNewUser(sqlite, "userA");
  populateNewUser(sqlite, "userB");
  populateNewUser(sqlite, "userC");
  database.setInstantVacancyNotificationsEnabled("userA", true);
  database.setNotificationQuietHoursEnabled("userA", true);
  database.setInstantVacancyNotificationsEnabled("userB", true);
  database.setNotificationQuietHoursEnabled("userB", false);
  database.setInstantVacancyNotificationsEnabled("userC", false);
  database.setNotificationQuietHoursEnabled("userC", true);
  const users = database.listInstantWithQuietHoursEnabledUsers();
  assert.deepEqual(users, ["userA"]);
  sqlite.close();
  database.close();
});

// ─── Scheduler ────────────────────────────────────────────────

test("scheduler delivers due pending notification", async () => {
  const fixture = createFixture();
  const { database } = fixture;
  const sqlite = new BetterSqlite3(fixture.config.databasePath!);
  populateNewUser(sqlite, "777");
  const v = insertVacancy(sqlite);
  createMatch(sqlite, "777", v.id);
  database.enqueuePendingNotification("777", v.id, "2020-01-01T08:00:00.000Z");

  const scheduler = new PendingNotificationScheduler(database, async (userId, vacancyId) => {
    const match = database.getUserVacancyMatch(userId, vacancyId);
    if (!match) return false;
    return fixture.bot.notifyVacancy(match);
  });

  const now = new Date("2026-07-22T12:00:00Z");
  await scheduler.runDueCycle(now);

  assert.equal(fixture.deliveries.length, 1, "Notification delivered");
  const due = database.listDuePendingNotifications("3026-07-22T12:00:00.000Z");
  assert.equal(due.length, 0, "Queue is empty after delivery");
  sqlite.close();
  database.close();
});

test("scheduler does not deliver before 08:00 (scheduled_at check)", async () => {
  const fixture = createFixture();
  const { database } = fixture;
  const sqlite = new BetterSqlite3(fixture.config.databasePath!);
  populateNewUser(sqlite, "777");
  const v = insertVacancy(sqlite);
  createMatch(sqlite, "777", v.id);
  // Schedule for future
  database.enqueuePendingNotification("777", v.id, "3026-07-23T08:00:00.000Z");

  const scheduler = new PendingNotificationScheduler(database, async (userId, vacancyId) => {
    const match = database.getUserVacancyMatch(userId, vacancyId);
    if (!match) return false;
    return fixture.bot.notifyVacancy(match);
  });

  await scheduler.runDueCycle(new Date("2026-07-22T12:00:00Z"));
  assert.equal(fixture.deliveries.length, 0, "No delivery for future scheduled_at");
  sqlite.close();
  database.close();
});

test("scheduler delivers only once", async () => {
  const fixture = createFixture();
  const { database } = fixture;
  const sqlite = new BetterSqlite3(fixture.config.databasePath!);
  populateNewUser(sqlite, "777");
  const v = insertVacancy(sqlite);
  createMatch(sqlite, "777", v.id);
  database.enqueuePendingNotification("777", v.id, "2020-01-01T08:00:00.000Z");

  const scheduler = new PendingNotificationScheduler(database, async (userId, vacancyId) => {
    const match = database.getUserVacancyMatch(userId, vacancyId);
    if (!match) return false;
    return fixture.bot.notifyVacancy(match);
  });

  await scheduler.runDueCycle(new Date("2026-07-22T12:00:00Z"));
  assert.equal(fixture.deliveries.length, 1, "First delivery");
  await scheduler.runDueCycle(new Date("2026-07-22T12:01:00Z"));
  assert.equal(fixture.deliveries.length, 1, "Not delivered again");
  sqlite.close();
  database.close();
});

test("delivery error creates retry and reschedules", async () => {
  const fixture = createFixture();
  const { database } = fixture;
  const sqlite = new BetterSqlite3(fixture.config.databasePath!);
  populateNewUser(sqlite, "777");
  const v = insertVacancy(sqlite);
  createMatch(sqlite, "777", v.id);
  database.enqueuePendingNotification("777", v.id, "2020-01-01T08:00:00.000Z");

  let callCount = 0;
  const scheduler = new PendingNotificationScheduler(database, async () => {
    callCount++;
    return false;
  });

  await scheduler.runDueCycle(new Date("2026-07-22T12:00:00Z"));
  assert.equal(callCount, 1, "Delivery was attempted");
  const due = database.listDuePendingNotifications("2026-07-22T12:00:00.000Z");
  assert.equal(due.length, 0, "Not due immediately after retry (rescheduled)");

  const row = sqlite.prepare("SELECT retry_count, last_error, scheduled_at FROM pending_notification_queue").all() as Array<{ retry_count: number; last_error: string; scheduled_at: string }>;
  assert.equal(row.length, 1);
  assert.equal(row[0]!.retry_count, 1);
  assert.ok(row[0]!.scheduled_at > "2026-07-22T12:00:00Z", "Rescheduled to future");
  sqlite.close();
  database.close();
});

test("hidden status cancels pending notification during scheduler cycle", async () => {
  const fixture = createFixture();
  const { database } = fixture;
  const sqlite = new BetterSqlite3(fixture.config.databasePath!);
  populateNewUser(sqlite, "777");
  const v = insertVacancy(sqlite);
  createMatch(sqlite, "777", v.id);
  database.enqueuePendingNotification("777", v.id, "2020-01-01T08:00:00.000Z");

  // Mark hidden
  sqlite.prepare("INSERT INTO user_vacancy_states (user_id, vacancy_id, status, created_at, updated_at) VALUES (?, ?, 'hidden', ?, ?)")
    .run("777", v.id, new Date().toISOString(), new Date().toISOString());

  const scheduler = new PendingNotificationScheduler(database, async () => {
    return true;
  });

  await scheduler.runDueCycle(new Date("2026-07-22T12:00:00Z"));
  assert.equal(fixture.deliveries.length, 0, "No delivery for hidden vacancy");
  const due = database.listDuePendingNotifications("3026-07-22T12:00:00.000Z");
  assert.equal(due.length, 0, "Pending notification cancelled");
  sqlite.close();
  database.close();
});

test("applied status cancels pending notification during scheduler cycle", async () => {
  const fixture = createFixture();
  const { database } = fixture;
  const sqlite = new BetterSqlite3(fixture.config.databasePath!);
  populateNewUser(sqlite, "777");
  const v = insertVacancy(sqlite);
  createMatch(sqlite, "777", v.id);
  database.enqueuePendingNotification("777", v.id, "2020-01-01T08:00:00.000Z");

  sqlite.prepare("INSERT INTO user_vacancy_states (user_id, vacancy_id, status, created_at, updated_at) VALUES (?, ?, 'applied', ?, ?)")
    .run("777", v.id, new Date().toISOString(), new Date().toISOString());

  const scheduler = new PendingNotificationScheduler(database, async () => {
    return true;
  });

  await scheduler.runDueCycle(new Date("2026-07-22T12:00:00Z"));
  assert.equal(fixture.deliveries.length, 0);
  const due = database.listDuePendingNotifications("3026-07-22T12:00:00.000Z");
  assert.equal(due.length, 0);
  sqlite.close();
  database.close();
});

test("saved status does NOT cancel pending notification", async () => {
  const fixture = createFixture();
  const { database } = fixture;
  const sqlite = new BetterSqlite3(fixture.config.databasePath!);
  populateNewUser(sqlite, "777");
  const v = insertVacancy(sqlite);
  createMatch(sqlite, "777", v.id);
  database.enqueuePendingNotification("777", v.id, "2020-01-01T08:00:00.000Z");

  sqlite.prepare("INSERT INTO user_vacancy_states (user_id, vacancy_id, status, created_at, updated_at) VALUES (?, ?, 'saved', ?, ?)")
    .run("777", v.id, new Date().toISOString(), new Date().toISOString());

  const scheduler = new PendingNotificationScheduler(database, async (userId, vacancyId) => {
    const match = database.getUserVacancyMatch(userId, vacancyId);
    if (!match) return false;
    return fixture.bot.notifyVacancy(match);
  });

  await scheduler.runDueCycle(new Date("2026-07-22T12:00:00Z"));
  assert.equal(fixture.deliveries.length, 1, "Delivery proceeds for saved vacancy");
  sqlite.close();
  database.close();
});

test("queue survives database reopen", () => {
  const fixture = createFixture();
  const sqlite = new BetterSqlite3(fixture.config.databasePath!);
  const v = insertVacancy(sqlite);
  fixture.database.enqueuePendingNotification("777", v.id, "2026-07-23T08:00:00.000Z");
  fixture.database.close();
  sqlite.close();

  const reopened = new VacancyDatabase(fixture.config);
  reopened.initialize();
  const due = reopened.listDuePendingNotifications("3026-07-23T08:00:00.000Z");
  assert.equal(due.length, 1);
  assert.equal(due[0]!.userId, "777");
  assert.equal(due[0]!.vacancyId, v.id);
  reopened.close();
});

test("enqueuePendingNotification is idempotent", () => {
  // INSERT OR IGNORE enforces that user+vacancy is unique implicitly.
  // This test explicitly verifies that two enqueues for the same user+vacancy collapse.
  const fixture = createFixture();
  const { database } = fixture;
  const sqlite = new BetterSqlite3(fixture.config.databasePath!);
  const v = insertVacancy(sqlite);
  database.enqueuePendingNotification("777", v.id, "2026-07-23T08:00:00.000Z");
  database.enqueuePendingNotification("777", v.id, "2026-07-23T08:00:00.000Z");
  const rows = sqlite.prepare("SELECT COUNT(*) AS cnt FROM pending_notification_queue").get() as { cnt: number };
  assert.equal(rows.cnt, 1);
  sqlite.close();
  database.close();
});

// ─── Retry limit ──────────────────────────────────────────────

test("retry delay increases after each failure", () => {
  const fixture = createFixture();
  const { database } = fixture;
  const sqlite = new BetterSqlite3(fixture.config.databasePath!);
  populateNewUser(sqlite, "777");
  const v = insertVacancy(sqlite);
  createMatch(sqlite, "777", v.id);
  database.enqueuePendingNotification("777", v.id, "2026-07-23T08:00:00.000Z");

  const due1 = database.listDuePendingNotifications("3026-07-23T08:00:00.000Z");
  const initialScheduledAt = due1[0]!.scheduledAt;
  database.markPendingNotificationFailed(due1[0]!.id, "err1", "2026-07-23T08:05:00.000Z");

  const row1 = sqlite.prepare("SELECT retry_count, scheduled_at FROM pending_notification_queue WHERE id = ?").get(due1[0]!.id) as { retry_count: number; scheduled_at: string };
  assert.equal(row1.retry_count, 1);
  assert.equal(row1.scheduled_at, "2026-07-23T08:05:00.000Z");

  database.markPendingNotificationFailed(due1[0]!.id, "err2", "2026-07-23T08:15:00.000Z");
  const row2 = sqlite.prepare("SELECT retry_count, scheduled_at FROM pending_notification_queue WHERE id = ?").get(due1[0]!.id) as { retry_count: number; scheduled_at: string };
  assert.equal(row2.retry_count, 2);
  assert.equal(row2.scheduled_at, "2026-07-23T08:15:00.000Z");

  sqlite.close();
  database.close();
});

test("backoff delay grows via scheduler and does not exceed 6h max", async () => {
  const fixture = createFixture();
  const { database } = fixture;
  const sqlite = new BetterSqlite3(fixture.config.databasePath!);
  populateNewUser(sqlite, "777");
  const v = insertVacancy(sqlite);
  createMatch(sqlite, "777", v.id);
  const baseTime = Date.parse("2026-07-23T08:00:00Z");
  database.enqueuePendingNotification("777", v.id, new Date(baseTime).toISOString());

  let callCount = 0;
  const scheduler = new PendingNotificationScheduler(database, async () => {
    callCount++;
    return false;
  });

  // Run 9 cycles. Each cycle advances by (6h + 1s) to guarantee the item is always due.
  // This lets us observe exponential growth up to the 6h cap.
  const sixHoursMs = 6 * 60 * 60_000;
  for (let i = 0; i < 9; i++) {
    const now = new Date(baseTime + i * (sixHoursMs + 1000));
    await scheduler.runDueCycle(now);
  }
  assert.equal(callCount, 9, "9 delivery attempts made");

  const row = sqlite.prepare("SELECT retry_count, scheduled_at FROM pending_notification_queue").get() as { retry_count: number; scheduled_at: string };
  assert.equal(row.retry_count, 9);

  // After 9 failures, total expected delay before cap: sum of min(5min*2^i, 6h) for i=0..8
  // i=0:5min, i=1:10min, i=2:20min, i=3:40min, i=4:80min, i=5:160min, i=6:320min→capped at 360min, i=7:360min, i=8:360min
  // Total: 5+10+20+40+80+160+360+360+360 = 1395 min = 23.25h
  // scheduled_at should be >= base + 23.25h
  const totalCappedDelayMs = (5 + 10 + 20 + 40 + 80 + 160 + 360 + 360 + 360) * 60_000;
  const actualScheduledAt = Date.parse(row.scheduled_at);
  assert.ok(actualScheduledAt >= baseTime + totalCappedDelayMs - 5000,
    `scheduled_at ${new Date(actualScheduledAt).toISOString()} should be near base + 23.25h`);

  sqlite.close();
  database.close();
});

test("delivery stops after MAX_DELIVERY_ATTEMPTS (dead-letter)", async () => {
  const fixture = createFixture();
  const { database } = fixture;
  const sqlite = new BetterSqlite3(fixture.config.databasePath!);
  populateNewUser(sqlite, "777");
  const v = insertVacancy(sqlite);
  createMatch(sqlite, "777", v.id);
  database.enqueuePendingNotification("777", v.id, "2020-01-01T08:00:00.000Z");

  let callCount = 0;
  const scheduler = new PendingNotificationScheduler(database, async () => {
    callCount++;
    return false;
  });

  // Advance by 6h+1s each cycle to guarantee the rescheduled item is always due
  // (max retry delay is 6h). 10 cycles = max 10 delivery attempts.
  for (let i = 0; i < 10; i++) {
    const now = new Date(Date.UTC(2026, 6, 22, 12, 0, 0) + i * 21_601_000);
    await scheduler.runDueCycle(now);
  }

  assert.equal(callCount, 10, "Delivery was attempted 10 times (MAX_DELIVERY_ATTEMPTS)");

  const row = sqlite.prepare("SELECT status, delivered_at, retry_count FROM pending_notification_queue").get() as { status: string; delivered_at: string | null; retry_count: number };
  assert.equal(row.status, "failed", "Dead-lettered after max delivery attempts");
  assert.notEqual(row.delivered_at, null, "delivered_at set after dead-letter");
  assert.equal(row.retry_count, 9, "retry_count reaches MAX_DELIVERY_ATTEMPTS - 1");

  // Subsequent cycles do not attempt delivery
  const later = new Date(Date.UTC(2026, 6, 23, 12, 0, 0));
  await scheduler.runDueCycle(later);
  assert.equal(callCount, 10, "No further delivery attempts");

  sqlite.close();
  database.close();
});

test("retry count and last error persist after DB reopen", () => {
  const config = createTempDatabaseConfig();
  const database = new VacancyDatabase(config);
  database.initialize();
  const sqlite = new BetterSqlite3(config.databasePath!);
  populateNewUser(sqlite, "777");
  const v = insertVacancy(sqlite);
  createMatch(sqlite, "777", v.id);
  database.enqueuePendingNotification("777", v.id, "2026-07-23T08:00:00.000Z");
  const due = database.listDuePendingNotifications("3026-07-23T08:00:00.000Z");
  database.markPendingNotificationFailed(due[0]!.id, "persist error", "2026-07-23T09:00:00.000Z");
  database.close();
  sqlite.close();

  const reopened = new VacancyDatabase(config);
  reopened.initialize();
  const dueAgain = reopened.listDuePendingNotifications("3026-07-23T09:00:00.000Z");
  assert.equal(dueAgain.length, 1);
  assert.equal(dueAgain[0]!.retryCount, 1);
  assert.equal(dueAgain[0]!.lastError, "persist error");
  reopened.close();
});

// ─── Ingestor integration tests ───────────────────────────────

test("daytime: VacancyIngestor sends notification immediately, not queued", async () => {
  const fixture = createIngestorFixture({
    now: () => new Date("2026-07-22T14:00:00Z") // 14:00 UTC, not quiet hours
  });
  fixture.database.setUserSearchProfileKeywords("777", "required_context", ["remote"]);
  fixture.database.setUserSearchProfileKeywords("777", "required_primary", ["python"]);
  fixture.database.setNotificationQuietHoursEnabled("777", true);
  fixture.database.setInstantVacancyNotificationsEnabled("777", true);

  const result = await fixture.ingestor.handle({
    source: "telegram_web_preview",
    channel: "ch1",
    messageId: "m1",
    date: new Date("2026-07-22T14:00:00Z").toISOString(),
    text: "Python Developer\nRemote\nSalary: 5000 USD",
    url: "https://t.me/ch1/m1"
  });

  assert.deepEqual(result, ["777"], "User matched");
  assert.equal(fixture.deliveries.length, 1, "Notification sent immediately");
  const queueCount = fixture.database.listDuePendingNotifications("3026-07-22T14:00:00.000Z");
  assert.equal(queueCount.length, 0, "Queue is empty");

  await fixture.analytics.shutdown();
  fixture.database.close();
});

test("23:xx: VacancyIngestor enqueues notification to 08:00 next day", async () => {
  const fixture = createIngestorFixture({
    now: () => new Date("2026-07-22T23:30:00Z") // 23:30 UTC, in quiet hours
  });
  fixture.database.setUserSearchProfileKeywords("777", "required_context", ["remote"]);
  fixture.database.setUserSearchProfileKeywords("777", "required_primary", ["python"]);
  fixture.database.setNotificationQuietHoursEnabled("777", true);
  fixture.database.setInstantVacancyNotificationsEnabled("777", true);

  const result = await fixture.ingestor.handle({
    source: "telegram_web_preview",
    channel: "ch2",
    messageId: "m2",
    date: new Date("2026-07-22T23:30:00Z").toISOString(),
    text: "Python Developer\nRemote\nSalary: 6000 USD",
    url: "https://t.me/ch2/m2"
  });

  assert.deepEqual(result, ["777"], "User matched");
  assert.equal(fixture.deliveries.length, 0, "No immediate delivery");
  const queueItems = fixture.database.listDuePendingNotifications("3026-07-23T08:00:00.000Z");
  assert.equal(queueItems.length, 1, "One item enqueued");
  const d = new Date(queueItems[0]!.scheduledAt);
  assert.equal(d.getUTCHours(), 8, "Scheduled for 08:00 UTC");
  assert.equal(d.getUTCDate(), 23, "Scheduled for next day");

  await fixture.analytics.shutdown();
  fixture.database.close();
});

test("03:xx: VacancyIngestor schedules delivery to 08:00 same day", async () => {
  const fixture = createIngestorFixture({
    now: () => new Date("2026-07-22T03:00:00Z") // 03:00 UTC, in quiet hours
  });
  fixture.database.setUserSearchProfileKeywords("777", "required_context", ["remote"]);
  fixture.database.setUserSearchProfileKeywords("777", "required_primary", ["python"]);
  fixture.database.setNotificationQuietHoursEnabled("777", true);
  fixture.database.setInstantVacancyNotificationsEnabled("777", true);

  const result = await fixture.ingestor.handle({
    source: "telegram_web_preview",
    channel: "ch3",
    messageId: "m3",
    date: new Date("2026-07-22T03:00:00Z").toISOString(),
    text: "Python Developer\nRemote\nSalary: 5500 USD",
    url: "https://t.me/ch3/m3"
  });

  assert.deepEqual(result, ["777"], "User matched");
  assert.equal(fixture.deliveries.length, 0, "No immediate delivery");
  const queueItems = fixture.database.listDuePendingNotifications("3026-07-22T08:00:00.000Z");
  assert.equal(queueItems.length, 1, "One item enqueued");
  const d = new Date(queueItems[0]!.scheduledAt);
  assert.equal(d.getUTCHours(), 8, "Scheduled for 08:00 UTC");
  assert.equal(d.getUTCDate(), 22, "Scheduled for same day");

  await fixture.analytics.shutdown();
  fixture.database.close();
});

test("instant disabled: VacancyIngestor saves match, no enqueue", async () => {
  const fixture = createIngestorFixture({
    now: () => new Date("2026-07-22T23:00:00Z") // in quiet hours
  });
  fixture.database.setUserSearchProfileKeywords("777", "required_context", ["remote"]);
  fixture.database.setUserSearchProfileKeywords("777", "required_primary", ["python"]);
  fixture.database.setNotificationQuietHoursEnabled("777", true);
  fixture.database.setInstantVacancyNotificationsEnabled("777", false);

  const result = await fixture.ingestor.handle({
    source: "telegram_web_preview",
    channel: "ch4",
    messageId: "m4",
    date: new Date("2026-07-22T23:00:00Z").toISOString(),
    text: "Python Developer\nRemote\nSalary: 7000 USD",
    url: "https://t.me/ch4/m4"
  });

  assert.deepEqual(result, ["777"], "User matched despite notifications disabled");
  assert.equal(fixture.deliveries.length, 0, "No delivery");
  const queueItems = fixture.database.listDuePendingNotifications("3026-07-23T08:00:00.000Z");
  assert.equal(queueItems.length, 0, "Queue is empty");
  const allV = fixture.database.listVacanciesSince(7);
  const match = fixture.database.getUserMatchedVacancy("777", allV[0]!.id);
  assert.ok(match !== null, "Match record exists");
  assert.equal(match!.deliveredAt, null, "Match not marked delivered");

  await fixture.analytics.shutdown();
  fixture.database.close();
});

test("reopened DB: queued notification delivered exactly once", async () => {
  const config = createTempDatabaseConfig();
  config.timeZone = "UTC";
  const database = new VacancyDatabase(config);
  database.initialize();
  const sqlite = new BetterSqlite3(config.databasePath!);
  populateNewUser(sqlite, "777");
  const v = insertVacancy(sqlite);
  createMatch(sqlite, "777", v.id);

  // Simulate quiet hours enqueue
  database.setNotificationQuietHoursEnabled("777", true);
  database.setInstantVacancyNotificationsEnabled("777", true);
  database.enqueuePendingNotification("777", v.id, "2020-01-01T08:00:00.000Z");
  database.close();
  sqlite.close();

  // Reopen and run scheduler
  const reopenedDb = new VacancyDatabase(config);
  reopenedDb.initialize();
  const deliveries: DeliveryRecord[] = [];
  const scheduler = new PendingNotificationScheduler(reopenedDb, async (userId, vacancyId) => {
    const match = reopenedDb.getUserVacancyMatch(userId, vacancyId);
    if (!match) return false;
    deliveries.push({ userId, vacancyId });
    reopenedDb.markUserVacancyDelivered(userId, vacancyId);
    return true;
  });

  await scheduler.runDueCycle(new Date("2026-07-22T12:00:00Z"));
  assert.equal(deliveries.length, 1, "Delivered once");
  await scheduler.runDueCycle(new Date("2026-07-22T12:01:00Z"));
  assert.equal(deliveries.length, 1, "No duplicate delivery");
  reopenedDb.close();
});

test("single now value used for both quiet hours check and scheduledAt computation", async () => {
  let callCount = 0;
  // Clock returns advancing values: first call 23:00, subsequent calls shift forward
  const clock = () => {
    callCount++;
    if (callCount === 1) return new Date("2026-07-22T23:00:00Z");
    // If called again, return 23:05 (would change scheduledAt)
    return new Date("2026-07-22T23:05:00Z");
  };

  const fixture = createIngestorFixture({ now: clock });
  fixture.database.setUserSearchProfileKeywords("777", "required_context", ["remote"]);
  fixture.database.setUserSearchProfileKeywords("777", "required_primary", ["python"]);
  fixture.database.setNotificationQuietHoursEnabled("777", true);
  fixture.database.setInstantVacancyNotificationsEnabled("777", true);

  const result = await fixture.ingestor.handle({
    source: "telegram_web_preview",
    channel: "ch-clock",
    messageId: "m-clock",
    date: new Date("2026-07-22T23:00:00Z").toISOString(),
    text: "Python Developer\nRemote\nSalary: 5000 USD",
    url: "https://t.me/ch-clock/m-clock"
  });

  assert.deepEqual(result, ["777"], "User matched");
  const queueItems = fixture.database.listDuePendingNotifications("3026-07-23T08:00:00.000Z");
  assert.equal(queueItems.length, 1, "One item enqueued");
  const d = new Date(queueItems[0]!.scheduledAt);
  // Should be 08:00 on July 23 (based on first clock call = 23:00 → next day 08:00)
  assert.equal(d.getUTCHours(), 8, "Scheduled for 08:00 UTC");
  assert.equal(d.getUTCDate(), 23, "Scheduled for next day based on single now() call");

  await fixture.analytics.shutdown();
  fixture.database.close();
});

test("fuzzy group during quiet hours creates single pending notification through VacancyIngestor", async () => {
  const clock = () => new Date("2026-07-20T23:30:00Z"); // quiet hours, fixed

  const fixture = createIngestorFixture({ now: clock });
  fixture.database.setUserSearchProfileKeywords("777", "required_context", ["remote"]);
  fixture.database.setUserSearchProfileKeywords("777", "required_primary", ["python", "developer"]);
  fixture.database.setNotificationQuietHoursEnabled("777", true);
  fixture.database.setInstantVacancyNotificationsEnabled("777", true);

  // First vacancy
  const firstResult = await fixture.ingestor.handle({
    source: "telegram_web_preview",
    channel: "ch-fuzzy1",
    messageId: "fuzzy-a",
    date: new Date("2026-07-20T10:00:00Z").toISOString(),
    text: "Senior Python Developer (Django)\nRemote\nSalary: 5000 USD\nОпыт от 3 лет",
    url: "https://t.me/ch-fuzzy1/1"
  });
  assert.deepEqual(firstResult, ["777"], "First vacancy matched");

  // Second vacancy with different source/messageId but high enough similarity for fuzzy group
  const secondResult = await fixture.ingestor.handle({
    source: "telegram_web_preview",
    channel: "ch-fuzzy2",
    messageId: "fuzzy-b",
    date: new Date("2026-07-20T14:00:00Z").toISOString(),
    text: "Senior Python Developer (Django) — релокация\nRemote\nSalary: 5000 USD\nОпыт от 3 лет\nПодробнее: https://example.com",
    url: "https://t.me/ch-fuzzy2/1"
  });
  // Second should not match because user already has a match in fuzzy group
  assert.deepEqual(secondResult, [], "Second fuzzy duplicate not matched");

  // Verify fuzzy duplicates table has a link
  const allVacancies = fixture.database.listVacanciesSince(7);
  assert.equal(allVacancies.length, 2, "Both vacancies stored");
  const firstId = allVacancies.find((v) => v.sourceMessageId === "fuzzy-a")!.id;
  const duplicatePosts = fixture.database.listVacancyDuplicatePosts(firstId, 5);
  assert.ok(duplicatePosts.items.length >= 1, "Fuzzy duplicate link exists");
  assert.ok(duplicatePosts.items.some((p) => p.sourceMessageId === "fuzzy-b"), "Second vacancy linked as duplicate");

  // Only one pending notification in queue
  const queueItems = fixture.database.listDuePendingNotifications("3026-07-23T08:00:00.000Z");
  assert.equal(queueItems.length, 1, "Only one pending notification queued");

  // Verify no delivery yet (quiet hours)
  assert.equal(fixture.deliveries.length, 0, "No immediate delivery");

  // Run scheduler after 08:00 — only one delivery
  const scheduler = new PendingNotificationScheduler(fixture.database, async (userId, vacancyId) => {
    const match = fixture.database.getUserVacancyMatch(userId, vacancyId);
    if (!match) return false;
    return fixture.bot.notifyVacancy(match);
  });
  await scheduler.runDueCycle(new Date("2026-07-21T08:30:00Z"));
  assert.equal(fixture.deliveries.length, 1, "Exactly one delivery after quiet hours end");

  await fixture.analytics.shutdown();
  fixture.database.close();
});

test("exception from deliver() increments retry_count and applies backoff", async () => {
  const fixture = createFixture();
  const { database } = fixture;
  const sqlite = new BetterSqlite3(fixture.config.databasePath!);
  populateNewUser(sqlite, "777");
  const v = insertVacancy(sqlite);
  createMatch(sqlite, "777", v.id);
  database.enqueuePendingNotification("777", v.id, "2020-01-01T08:00:00.000Z");

  let callCount = 0;
  const scheduler = new PendingNotificationScheduler(database, async () => {
    callCount++;
    throw new Error("delivery failure");
  });

  // First attempt
  const t0 = new Date("2026-07-22T12:00:00Z");
  await scheduler.runDueCycle(t0);

  let row = sqlite.prepare("SELECT retry_count, last_error, scheduled_at, status FROM pending_notification_queue").get() as { retry_count: number; last_error: string; scheduled_at: string; status: string };
  assert.equal(row.retry_count, 1, "retry_count incremented after exception");
  assert.equal(row.last_error, "delivery failure", "Error message stored");
  assert.equal(row.status, "pending", "Still pending with retry scheduled");
  const delay1 = Date.parse(row.scheduled_at) - t0.getTime();
  // Base delay = 5min = 300000ms
  assert.ok(delay1 >= 300_000 - 1000, `Delay ${delay1}ms should be at least 5min`);

  // Second attempt after rescheduled time
  const t1 = new Date(Date.parse(row.scheduled_at) + 1000);
  await scheduler.runDueCycle(t1);

  const row2 = sqlite.prepare("SELECT retry_count, last_error, scheduled_at, status FROM pending_notification_queue").get() as { retry_count: number; last_error: string; scheduled_at: string; status: string };
  assert.equal(row2.retry_count, 2, "retry_count incremented again");
  assert.equal(row2.last_error, "delivery failure", "Error message preserved");
  const delay2 = Date.parse(row2.scheduled_at) - t1.getTime();
  // Second retry: exponential 10min
  assert.ok(delay2 >= 600_000 - 1000, `Delay ${delay2}ms should be at least 10min`);

  sqlite.close();
  database.close();
});

test("exception from deliver() dead-letters after MAX_DELIVERY_ATTEMPTS", async () => {
  const fixture = createFixture();
  const { database } = fixture;
  const sqlite = new BetterSqlite3(fixture.config.databasePath!);
  populateNewUser(sqlite, "777");
  const v = insertVacancy(sqlite);
  createMatch(sqlite, "777", v.id);
  database.enqueuePendingNotification("777", v.id, "2020-01-01T08:00:00.000Z");

  let callCount = 0;
  const scheduler = new PendingNotificationScheduler(database, async () => {
    callCount++;
    throw new Error("persistent failure");
  });

  // Run 10 cycles with 6h+1s gaps (exceeds max backoff each time)
  for (let i = 0; i < 10; i++) {
    const now = new Date(Date.UTC(2026, 6, 22, 12, 0, 0) + i * 21_601_000);
    await scheduler.runDueCycle(now);
  }

  assert.equal(callCount, 10, "Delivery attempted 10 times (MAX_DELIVERY_ATTEMPTS)");

  const row = sqlite.prepare("SELECT status, delivered_at, retry_count FROM pending_notification_queue").get() as { status: string; delivered_at: string | null; retry_count: number };
  assert.equal(row.status, "failed", "Dead-lettered after max delivery attempts from exceptions");
  assert.notEqual(row.delivered_at, null, "delivered_at set");
  assert.equal(row.retry_count, 9, "retry_count=9 after 10 failures");

  // No more attempts after dead-letter
  const later = new Date(Date.UTC(2026, 6, 23, 12, 0, 0));
  await scheduler.runDueCycle(later);
  assert.equal(callCount, 10, "No more delivery attempts after dead-letter");

  sqlite.close();
  database.close();
});

test("exception from deliver() does not double-update the pending record", async () => {
  const fixture = createFixture();
  const { database } = fixture;
  const sqlite = new BetterSqlite3(fixture.config.databasePath!);
  populateNewUser(sqlite, "777");
  const v = insertVacancy(sqlite);
  createMatch(sqlite, "777", v.id);
  database.enqueuePendingNotification("777", v.id, "2020-01-01T08:00:00.000Z");

  const scheduler = new PendingNotificationScheduler(database, async () => {
    throw new Error("boom");
  });

  await scheduler.runDueCycle(new Date("2026-07-22T12:00:00Z"));

  const row = sqlite.prepare("SELECT retry_count, last_error, scheduled_at FROM pending_notification_queue").get() as { retry_count: number; last_error: string; scheduled_at: string };
  // retry_count should be exactly 1 (not 2), scheduled_at should be the backoff-based time
  assert.equal(row.retry_count, 1, "retry_count incremented exactly once");
  const expectedDelay = 5 * 60_000; // 5 min
  const actualDelay = Date.parse(row.scheduled_at) - Date.parse("2026-07-22T12:00:00Z");
  // Allow tolerance for test execution time
  assert.ok(Math.abs(actualDelay - expectedDelay) < 5000, `Delay ${actualDelay}ms should be ~5min (${expectedDelay}ms)`);

  sqlite.close();
  database.close();
});

// ─── Callback handler tests ───────────────────────────────────

function makeMockCtx(fromId?: number) {
  let answerCount = 0;
  let answerText: string | undefined;
  return {
    callbackQuery: { id: "cb1" },
    from: fromId !== undefined ? { id: fromId, is_bot: false, first_name: "Test" } : undefined,
    answerCallbackQuery: async (params: string | { text?: string } | undefined) => {
      answerCount++;
      answerText = typeof params === "string" ? params : params?.text;
      return { ok: true, result: true } as never;
    },
    get answerText(): string | undefined { return answerText; },
    get answerCount(): number { return answerCount; }
  } as unknown as grammy.Context & { answerText: string | undefined; answerCount: number };
}

test("callback: first press enables quiet hours", async () => {
  const config = createTempDatabaseConfig();
  const database = new VacancyDatabase(config);
  database.initialize();
  database.setNotificationQuietHoursEnabled(config.ownerUserId!, false);
  const ctx = makeMockCtx(Number(config.ownerUserId));
  const analytics: Array<{ eventName: string; userId: string; properties: Record<string, unknown> }> = [];
  const analyticsService = {
    capture: async (event: typeof analytics[0]) => { analytics.push(event); },
    shutdown: async () => {}
  } as never;
  let panelCallCount = 0;
  const showNotificationsPanel = async () => { panelCallCount++; };

  await handleNotificationQuietHoursToggleCallback(ctx as never, database, analyticsService, showNotificationsPanel);

  const settings = database.getUserSettings(config.ownerUserId!);
  assert.equal(settings.notificationQuietHoursEnabled, true, "Quiet hours enabled");
  assert.equal(ctx.answerCount, 1, "One answerCallbackQuery");
  assert.equal(ctx.answerText, "🌙 Ночная пауза 23:00–08:00 включена.", "Correct answer text");
  assert.equal(panelCallCount, 1, "Panel updated");
  assert.equal(analytics.length, 1, "One analytics event");
  assert.equal(analytics[0]!.eventName, "notification_quiet_hours_toggled");
  assert.equal(analytics[0]!.properties.new_value, true);

  database.close();
});

test("callback: second press disables quiet hours", async () => {
  const config = createTempDatabaseConfig();
  const database = new VacancyDatabase(config);
  database.initialize();
  database.setNotificationQuietHoursEnabled(config.ownerUserId!, true);
  const ctx = makeMockCtx(Number(config.ownerUserId));
  const analytics: Array<{ eventName: string; userId: string; properties: Record<string, unknown> }> = [];
  const analyticsService = {
    capture: async (event: typeof analytics[0]) => { analytics.push(event); },
    shutdown: async () => {}
  } as never;
  let panelCallCount = 0;
  const showNotificationsPanel = async () => { panelCallCount++; };

  await handleNotificationQuietHoursToggleCallback(ctx as never, database, analyticsService, showNotificationsPanel);

  const settings = database.getUserSettings(config.ownerUserId!);
  assert.equal(settings.notificationQuietHoursEnabled, false, "Quiet hours disabled");
  assert.equal(ctx.answerText, "🌙 Ночная пауза 23:00–08:00 выключена.", "Correct answer text");

  database.close();
});

test("callback: value persisted in DB after toggle", async () => {
  const config = createTempDatabaseConfig();
  const database = new VacancyDatabase(config);
  database.initialize();
  const ctx = makeMockCtx(Number(config.ownerUserId));
  const analyticsService = {
    capture: async () => {},
    shutdown: async () => {}
  } as never;
  const showNotificationsPanel = async () => {};

  await handleNotificationQuietHoursToggleCallback(ctx as never, database, analyticsService, showNotificationsPanel);
  database.close();

  const reopened = new VacancyDatabase(config);
  reopened.initialize();
  const settings = reopened.getUserSettings(config.ownerUserId!);
  assert.equal(settings.notificationQuietHoursEnabled, true, "Persisted across reopen");
  reopened.close();
});

test("callback: exactly one answerCallbackQuery per press", async () => {
  const config = createTempDatabaseConfig();
  const database = new VacancyDatabase(config);
  database.initialize();
  const ctx = makeMockCtx(Number(config.ownerUserId));
  const analyticsService = {
    capture: async () => {},
    shutdown: async () => {}
  } as never;
  const showNotificationsPanel = async () => {};

  await handleNotificationQuietHoursToggleCallback(ctx as never, database, analyticsService, showNotificationsPanel);
  assert.equal(ctx.answerCount, 1, "One answer on first press");

  await handleNotificationQuietHoursToggleCallback(ctx as never, database, analyticsService, showNotificationsPanel);
  assert.equal(ctx.answerCount, 2, "One answer on second press");

  database.close();
});

test("callback: missing userId handled gracefully", async () => {
  const config = createTempDatabaseConfig();
  const database = new VacancyDatabase(config);
  database.initialize();
  const ctx = makeMockCtx(undefined); // no from
  const analyticsService = {
    capture: async () => { throw new Error("should not be called"); },
    shutdown: async () => {}
  } as never;
  let panelCallCount = 0;
  const showNotificationsPanel = async () => { panelCallCount++; };

  await handleNotificationQuietHoursToggleCallback(ctx as never, database, analyticsService, showNotificationsPanel);

  assert.equal(ctx.answerText, "⚠️ Не удалось определить пользователя.", "Error message shown");
  assert.equal(ctx.answerCount, 1, "One answerCallbackQuery");
  assert.equal(panelCallCount, 0, "Panel not updated");
  const settings = database.getUserSettings(config.ownerUserId!);
  assert.equal(settings.notificationQuietHoursEnabled, false, "Setting unchanged");

  database.close();
});

test("callback: analytics receives correct new_value", async () => {
  const config = createTempDatabaseConfig();
  const database = new VacancyDatabase(config);
  database.initialize();
  const ctx = makeMockCtx(Number(config.ownerUserId));
  const analytics: Array<{ eventName: string; userId: string; properties: Record<string, unknown> }> = [];
  const analyticsService = {
    capture: async (event: typeof analytics[0]) => { analytics.push(event); },
    shutdown: async () => {}
  } as never;
  const showNotificationsPanel = async () => {};

  // First press: false → true
  await handleNotificationQuietHoursToggleCallback(ctx as never, database, analyticsService, showNotificationsPanel);
  assert.equal(analytics.length, 1);
  assert.equal(analytics[0]!.eventName, "notification_quiet_hours_toggled");
  assert.equal(analytics[0]!.properties.new_value, true);
  assert.equal(analytics[0]!.properties.source, "user_settings");

  // Second press: true → false
  await handleNotificationQuietHoursToggleCallback(ctx as never, database, analyticsService, showNotificationsPanel);
  assert.equal(analytics.length, 2);
  assert.equal(analytics[1]!.properties.new_value, false);

  database.close();
});

test("user settings isolation: toggling quiet hours for one user does not affect another", () => {
  const config = createTempDatabaseConfig();
  const database = new VacancyDatabase(config);
  database.initialize();
  database.setNotificationQuietHoursEnabled(config.ownerUserId!, true);
  const userBSettingsBefore = database.getUserSettings("userB");
  assert.equal(userBSettingsBefore.notificationQuietHoursEnabled, false, "Other user unaffected");
  database.setNotificationQuietHoursEnabled(config.ownerUserId!, false);
  const userBSettingsAfter = database.getUserSettings("userB");
  assert.equal(userBSettingsAfter.notificationQuietHoursEnabled, false);
  database.close();
});

test("listInstantWithQuietHoursEnabledUsers excludes inactive users", () => {
  const fixture = createFixture();
  const { database } = fixture;
  const sqlite = new BetterSqlite3(fixture.config.databasePath!);
  populateNewUser(sqlite, "activeUser", true);
  populateNewUser(sqlite, "inactiveUser", false);
  database.setInstantVacancyNotificationsEnabled("activeUser", true);
  database.setNotificationQuietHoursEnabled("activeUser", true);
  database.setInstantVacancyNotificationsEnabled("inactiveUser", true);
  database.setNotificationQuietHoursEnabled("inactiveUser", true);
  const users = database.listInstantWithQuietHoursEnabledUsers();
  assert.deepEqual(users, ["activeUser"]);
  sqlite.close();
  database.close();
});

test("markPendingNotificationFailed without nextScheduledAt keeps original scheduled_at", () => {
  const fixture = createFixture();
  const { database } = fixture;
  const sqlite = new BetterSqlite3(fixture.config.databasePath!);
  const v = insertVacancy(sqlite);
  database.enqueuePendingNotification("777", v.id, "2026-07-23T08:00:00.000Z");
  const due = database.listDuePendingNotifications("3026-07-23T08:00:00.000Z");
  database.markPendingNotificationFailed(due[0]!.id, "error without reschedule");
  const row = sqlite.prepare("SELECT retry_count, scheduled_at FROM pending_notification_queue WHERE id = ?").get(due[0]!.id) as { retry_count: number; scheduled_at: string };
  assert.equal(row.retry_count, 1);
  assert.equal(row.scheduled_at, "2026-07-23T08:00:00.000Z");
  sqlite.close();
  database.close();
});
