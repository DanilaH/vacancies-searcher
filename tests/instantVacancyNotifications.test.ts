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
import { handleInstantVacancyToggle } from "../src/bot/notificationToggleHandler";
import { VacancyDatabase } from "../src/db/database";
import { getSchemaTableColumns } from "../src/db/schema";
import { VacancyFilter } from "../src/services/vacancyFilter";
import { VacancyIngestor } from "../src/services/vacancyIngestor";
import type { MatchedVacancyRecord } from "../src/types";
import { createTestConfig } from "./helpers";

interface MockCtx extends grammy.Context {
  readonly answerText: string | undefined;
  readonly answerCount: number;
}

function makeMockContext(): MockCtx {
  let answerCount = 0;
  let answerText: string | undefined;
  const ctx = {
    callbackQuery: { id: "cb1" },
    answerCallbackQuery: async (params: string | { text?: string } | undefined) => {
      answerCount++;
      answerText = typeof params === "string" ? params : params?.text;
      return { ok: true, result: true } as never;
    },
    get answerText(): string | undefined { return answerText; },
    get answerCount(): number { return answerCount; }
  };
  return ctx as unknown as MockCtx;
}

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

interface DeliveryRecord {
  userId: string;
  vacancyId: number;
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

test("handler toggles from true to false on first press", async () => {
  const config = createTempDatabaseConfig();
  const database = new VacancyDatabase(config);
  database.initialize();
  database.setInstantVacancyNotificationsEnabled(config.ownerUserId!, true);
  const ctx = makeMockContext();
  type AnalyticsEvent = { eventName: string; userId: string; properties: Record<string, unknown> };
  const analytics: AnalyticsEvent[] = [];
  const analyticsService = {
    capture: async (event: AnalyticsEvent) => { analytics.push(event); },
    shutdown: async () => {}
  } as never;

  const result = await handleInstantVacancyToggle(ctx as never, database, analyticsService, config.ownerUserId!);

  assert.equal(result.previousValue, true);
  assert.equal(result.newValue, false);
  assert.equal(ctx.answerText, "🔕 Уведомления о новых вакансиях выключены.");
  assert.equal(ctx.answerCount, 1);
  assert.equal(analytics.length, 1);
  assert.equal(analytics[0]!.eventName, "instant_vacancy_notifications_toggled");
  assert.equal(analytics[0]!.properties.new_value, false);
  assert.equal(analytics[0]!.properties.source, "user_settings");
  const settings = database.getUserSettings(config.ownerUserId!);
  assert.equal(settings.instantVacancyNotificationsEnabled, false);

  database.close();
});

test("handler toggles from false to true on second press", async () => {
  const config = createTempDatabaseConfig();
  const database = new VacancyDatabase(config);
  database.initialize();
  database.setInstantVacancyNotificationsEnabled(config.ownerUserId!, false);
  const ctx = makeMockContext();
  type AnalyticsEvent = { eventName: string; userId: string; properties: Record<string, unknown> };
  const analytics: AnalyticsEvent[] = [];
  const analyticsService = {
    capture: async (event: AnalyticsEvent) => { analytics.push(event); },
    shutdown: async () => {}
  } as never;

  const result = await handleInstantVacancyToggle(ctx as never, database, analyticsService, config.ownerUserId!);

  assert.equal(result.previousValue, false);
  assert.equal(result.newValue, true);
  assert.equal(ctx.answerText, "🔔 Уведомления о новых вакансиях включены.");
  assert.equal(ctx.answerCount, 1);
  assert.equal(analytics.length, 1);
  assert.equal(analytics[0]!.eventName, "instant_vacancy_notifications_toggled");
  assert.equal(analytics[0]!.properties.new_value, true);
  const settings = database.getUserSettings(config.ownerUserId!);
  assert.equal(settings.instantVacancyNotificationsEnabled, true);

  database.close();
});

test("handler does not change digest or empty-cycle settings", async () => {
  const config = createTempDatabaseConfig();
  const database = new VacancyDatabase(config);
  database.initialize();
  database.setNotifyOnEmptyCycle(config.ownerUserId!, true);
  database.setDailyDigestEnabled(config.ownerUserId!, true);
  const ctx = makeMockContext();
  const analyticsService = {
    capture: async () => {},
    shutdown: async () => {}
  } as never;

  await handleInstantVacancyToggle(ctx as never, database, analyticsService, config.ownerUserId!);

  const settings = database.getUserSettings(config.ownerUserId!);
  assert.equal(settings.notifyOnEmptyCycle, true);
  assert.equal(settings.dailyDigestEnabled, true);

  database.close();
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

test("enabled setting sends instant notification and marks delivered", async () => {
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
  assert.equal(fixture.deliveries[0]!.userId, "777", "Notification sent to correct user");

  const allV = fixture.database.listVacanciesSince(7);
  const match = fixture.database.getUserMatchedVacancy("777", allV[0]!.id);
  assert.ok(match !== null, "Match record exists");
  assert.notEqual(match!.deliveredAt, null, "Match is marked as delivered");

  await fixture.analytics.shutdown();
  fixture.database.close();
});

test("disabled setting does not send instant notification, keeps deliveredAt null", async () => {
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
  const match = fixture.database.getUserMatchedVacancy("777", allV[0]!.id);
  assert.ok(match !== null, "Match record exists");
  assert.equal(match!.deliveredAt, null, "Match is not marked as delivered");

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
  assert.equal(fixture.deliveries.length, 1, "Only one notification sent");
  assert.equal(fixture.deliveries[0]!.userId, "userB", "Notification sent to user B (enabled), not user A (disabled)");

  const allV = fixture.database.listVacanciesSince(7);
  assert.equal(allV.length, 1, "One vacancy created");
  const matchA = fixture.database.getUserMatchedVacancy("userA", allV[0]!.id);
  const matchB = fixture.database.getUserMatchedVacancy("userB", allV[0]!.id);
  assert.ok(matchA !== null, "User A has match");
  assert.ok(matchB !== null, "User B has match");
  assert.equal(matchA!.deliveredAt, null, "User A match not marked delivered");
  assert.notEqual(matchB!.deliveredAt, null, "User B match marked as delivered");

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
