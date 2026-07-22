import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import BetterSqlite3 from "better-sqlite3";

import { createAnalyticsService } from "../src/analytics/analyticsService";
import type { BotController } from "../src/bot/createBot";
import { VacancyDatabase } from "../src/db/database";
import { getSchemaTableColumns } from "../src/db/schema";
import { VacancyFilter } from "../src/services/vacancyFilter";
import { VacancyIngestor } from "../src/services/vacancyIngestor";
import type { MatchedVacancyRecord } from "../src/types";
import { createNotificationsKeyboard } from "../src/bot/keyboards";
import { createTestConfig } from "./helpers";

type InlineButton = {
  text: string;
  callback_data?: string;
  url?: string;
};

function rows(keyboard: unknown): InlineButton[][] {
  return (keyboard as { inline_keyboard?: InlineButton[][] }).inline_keyboard ?? [];
}

function callbacks(keyboard: unknown): string[] {
  return rows(keyboard)
    .flat()
    .map((button) => button.callback_data)
    .filter((value): value is string => typeof value === "string");
}

function labels(keyboard: unknown): string[] {
  return rows(keyboard).flat().map((button) => button.text);
}

function createFixture() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-tg-bot-instant-notif-"));
  const config = createTestConfig({
    ownerUserId: "777",
    ownerChatId: "777",
    databasePath: path.join(tempDir, "bot.db"),
    databaseUrl: `file:${path.join(tempDir, "bot.db")}`,
    appDataDir: tempDir,
    runtimeDir: path.join(tempDir, "runtime")
  });
  const database = new VacancyDatabase(config);
  database.initialize();
  const deliveries: number[] = [];
  const bot: BotController = {
    async start() {},
    async stop() {},
    async notifyVacancy(vacancy: MatchedVacancyRecord) {
      deliveries.push(vacancy.id);
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
  const ingestor = new VacancyIngestor(config, filter, database, bot, analytics);
  return { database, analytics, ingestor, deliveries, tempDir };
}

test("migration adds instant_vacancy_notifications_enabled to legacy user_settings", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-tg-bot-legacy-notif-"));
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
      weekly_page_size INTEGER,
      vacancy_language_mode TEXT NOT NULL DEFAULT 'ru_en',
      onboarding_completed INTEGER NOT NULL DEFAULT 1,
      onboarding_step TEXT,
      pending_input_action TEXT,
      pending_input_payload TEXT,
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

  assert.equal(columns.has("instant_vacancy_notifications_enabled"), true);
  assert.equal(settings.instantVacancyNotificationsEnabled, true);
  assert.equal(settings.notifyOnEmptyCycle, false);
  assert.equal(settings.dailyDigestEnabled, false);
});

test("fresh schema includes instant_vacancy_notifications_enabled column", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-tg-bot-fresh-notif-"));
  const databasePath = path.join(tempDir, "bot.db");
  const database = new VacancyDatabase(
    createTestConfig({ databasePath, databaseUrl: `file:${databasePath}`, appDataDir: tempDir, runtimeDir: path.join(tempDir, "runtime") })
  );
  database.initialize();
  const sqlite = new BetterSqlite3(databasePath, { readonly: true });
  const columns = getSchemaTableColumns(sqlite, "user_settings");
  sqlite.close();
  database.close();

  assert.equal(columns.has("instant_vacancy_notifications_enabled"), true);
});

test("default value is true for new user", () => {
  const config = createTempDatabaseConfig();
  const database = new VacancyDatabase(config);
  database.initialize();
  const settings = database.getUserSettings(config.ownerUserId!);
  database.close();

  assert.equal(settings.instantVacancyNotificationsEnabled, true);
});

test("setting persists true/false after toggle", () => {
  const config = createTempDatabaseConfig();

  const firstDatabase = new VacancyDatabase(config);
  firstDatabase.initialize();
  firstDatabase.setInstantVacancyNotificationsEnabled(config.ownerUserId!, false);
  firstDatabase.close();

  const secondDatabase = new VacancyDatabase(config);
  secondDatabase.initialize();
  const settings = secondDatabase.getUserSettings(config.ownerUserId!);
  secondDatabase.close();

  assert.equal(settings.instantVacancyNotificationsEnabled, false);
});

test("settings are isolated between users", () => {
  const config = createTempDatabaseConfig();
  const database = new VacancyDatabase(config);
  database.initialize();

  database.setInstantVacancyNotificationsEnabled(config.ownerUserId!, false);
  database.setInstantVacancyNotificationsEnabled("userB", true);

  const ownerSettings = database.getUserSettings(config.ownerUserId!);
  const userBSettings = database.getUserSettings("userB");

  database.close();

  assert.equal(ownerSettings.instantVacancyNotificationsEnabled, false);
  assert.equal(userBSettings.instantVacancyNotificationsEnabled, true);
});

test("notification keyboard includes instant vacancy toggle", () => {
  const keyboard = createNotificationsKeyboard(false, false, true);
  const data = callbacks(keyboard);
  const lbls = labels(keyboard);

  assert.ok(data.includes("notifications:toggle_instant_vacancy"));
  assert.ok(data.includes("notifications:toggle_empty_cycle_notice"));
  assert.ok(data.includes("notifications:toggle_daily_digest"));
  assert.ok(data.includes("menu:settings"));
  assert.ok(lbls.includes("🔔 Новые вакансии сразу: включены"));
});

test("notification keyboard shows disabled state", () => {
  const keyboard = createNotificationsKeyboard(false, false, false);
  const lbls = labels(keyboard);

  assert.ok(lbls.includes("🔕 Новые вакансии сразу: выключены"));
});

test("enabled setting sends instant notification", async () => {
  const fixture = createFixture();
  fixture.database.setUserSearchProfileKeywords("777", "required_context", ["remote"]);
  fixture.database.setUserSearchProfileKeywords("777", "required_primary", ["python"]);
  fixture.database.setInstantVacancyNotificationsEnabled("777", true);

  const result = await fixture.ingestor.handle({
    source: "telegram_web_preview" as const,
    channel: "ch1",
    messageId: "m1",
    date: new Date("2026-07-20T10:00:00Z").toISOString(),
    text: "Python Developer\nRemote\nSalary: 5000 USD",
    url: "https://t.me/ch1/m1"
  });

  assert.deepEqual(result, ["777"], "User matched");
  assert.equal(fixture.deliveries.length, 1, "Notification sent");

  await fixture.analytics.shutdown();
  fixture.database.close();
});

test("disabled setting does not send instant notification but creates match", async () => {
  const fixture = createFixture();
  fixture.database.setUserSearchProfileKeywords("777", "required_context", ["remote"]);
  fixture.database.setUserSearchProfileKeywords("777", "required_primary", ["python"]);
  fixture.database.setInstantVacancyNotificationsEnabled("777", false);

  const result = await fixture.ingestor.handle({
    source: "telegram_web_preview" as const,
    channel: "ch2",
    messageId: "m2",
    date: new Date("2026-07-20T10:00:00Z").toISOString(),
    text: "Python Developer\nRemote\nSalary: 5000 USD",
    url: "https://t.me/ch2/m2"
  });

  assert.deepEqual(result, ["777"], "User matched even with notifications disabled");
  assert.equal(fixture.deliveries.length, 0, "No notification sent");

  const allV = fixture.database.listVacanciesSince(7);
  assert.equal(allV.length, 1, "Vacancy was created");
  assert.ok(fixture.database.getUserMatchedVacancy("777", allV[0]!.id), "Match record exists");

  await fixture.analytics.shutdown();
  fixture.database.close();
});

test("disabled setting does not affect other users", async () => {
  const fixture = createFixture();
  fixture.database.setUserSearchProfileKeywords("userA", "required_context", ["remote"]);
  fixture.database.setUserSearchProfileKeywords("userA", "required_primary", ["python"]);
  fixture.database.setUserSearchProfileKeywords("userB", "required_context", ["remote"]);
  fixture.database.setUserSearchProfileKeywords("userB", "required_primary", ["python"]);
  fixture.database.setInstantVacancyNotificationsEnabled("userA", false);
  fixture.database.setInstantVacancyNotificationsEnabled("userB", true);

  const result = await fixture.ingestor.handle({
    source: "telegram_web_preview" as const,
    channel: "ch3",
    messageId: "m3",
    date: new Date("2026-07-20T10:00:00Z").toISOString(),
    text: "Python Developer\nRemote\nSalary: 5000 USD",
    url: "https://t.me/ch3/m3"
  });

  assert.deepEqual(result.sort(), ["userA", "userB"], "Both users matched");
  assert.equal(fixture.deliveries.length, 1, "Only user B got notification");

  await fixture.analytics.shutdown();
  fixture.database.close();
});

test("disabled setting keeps vacancy accessible in weekly feed", async () => {
  const fixture = createFixture();
  fixture.database.setUserSearchProfileKeywords("777", "required_context", ["remote"]);
  fixture.database.setUserSearchProfileKeywords("777", "required_primary", ["python"]);
  fixture.database.setInstantVacancyNotificationsEnabled("777", false);

  await fixture.ingestor.handle({
    source: "telegram_web_preview" as const,
    channel: "ch4",
    messageId: "m4",
    date: new Date("2026-07-20T10:00:00Z").toISOString(),
    text: "Python Developer\nRemote\nSalary: 5000 USD",
    url: "https://t.me/ch4/m4"
  });

  const weekly = fixture.database.listUserWeeklyVacancies("777", 0, 20, 7);
  assert.ok(weekly.items.length > 0, "Vacancy appears in weekly feed");

  await fixture.analytics.shutdown();
  fixture.database.close();
});

test("existing digest and empty-cycle settings unchanged by instant toggle", () => {
  const config = createTempDatabaseConfig();
  const database = new VacancyDatabase(config);
  database.initialize();

  database.setNotifyOnEmptyCycle(config.ownerUserId!, true);
  database.setDailyDigestEnabled(config.ownerUserId!, true);
  database.setInstantVacancyNotificationsEnabled(config.ownerUserId!, false);

  const settings = database.getUserSettings(config.ownerUserId!);
  database.close();

  assert.equal(settings.instantVacancyNotificationsEnabled, false);
  assert.equal(settings.notifyOnEmptyCycle, true);
  assert.equal(settings.dailyDigestEnabled, true);
});

function createTempDatabaseConfig() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-tg-bot-instant-notif-"));
  return createTestConfig({
    ownerUserId: "777",
    ownerChatId: "777",
    databasePath: path.join(tempDir, "bot.db"),
    databaseUrl: `file:${path.join(tempDir, "bot.db")}`,
    appDataDir: tempDir,
    runtimeDir: path.join(tempDir, "runtime")
  });
}
