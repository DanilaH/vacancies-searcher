import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import BetterSqlite3 from "better-sqlite3";

import type { BotController } from "../src/bot/createBot";
import { createNotificationsKeyboard } from "../src/bot/keyboards";
import { formatNotificationPreferences } from "../src/bot/formatters";
import { VacancyDatabase } from "../src/db/database";
import { getSchemaTableColumns } from "../src/db/schema";
import { PendingNotificationScheduler } from "../src/services/pendingNotificationScheduler";
import { isInQuietHours, computeNextQuietHoursEnd } from "../src/services/quietHoursUtils";
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

test("fuzzy duplicate does not create duplicate pending notification", () => {
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
