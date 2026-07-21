import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { VacancyDatabase } from "../src/db/database";
import { buildWeeklyReport } from "../src/services/weeklyReport";
import { createTestConfig } from "./helpers";

function createDatabase() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-tg-bot-report-"));
  const config = createTestConfig({
    databasePath: path.join(tempDir, "bot.db"),
    databaseUrl: `file:${path.join(tempDir, "bot.db")}`,
    appDataDir: tempDir,
    runtimeDir: path.join(tempDir, "runtime")
  });
  const database = new VacancyDatabase(config);
  database.initialize();
  return { config, database };
}

function insertEvent(
  database: VacancyDatabase,
  eventName: string,
  distinctId: string,
  occurredAt: string,
  properties: Record<string, unknown> = {}
): void {
  const db = (database as unknown as { getDb(): ReturnType<typeof database["initialize"] extends () => void ? never : unknown> }).getDb
    ? (database as unknown as { getDb(): { prepare(sql: string): { run(...params: unknown[]): void } } }).getDb()
    : null;
  const event = {
    event_name: eventName,
    distinct_id: distinctId,
    user_id: distinctId,
    properties_json: JSON.stringify(properties),
    occurred_at: occurredAt,
    created_at: occurredAt
  };
}

function recordAnalyticsEventDirectly(
  database: VacancyDatabase,
  eventName: string,
  distinctId: string,
  userId: string | null,
  occurredAt: string,
  properties: Record<string, unknown> = {}
): void {
  const dbAccess = (database as unknown as { getDb(): { prepare(sql: string): { run(...params: unknown[]): { lastInsertRowid: number } }; exec(sql: string): void } });
  const db = dbAccess.getDb();
  db.prepare(
    `INSERT INTO analytics_events (event_name, distinct_id, user_id, properties_json, occurred_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(eventName, distinctId, userId ?? null, JSON.stringify(properties), occurredAt, occurredAt);
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function daysAhead(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

test("empty database produces zero report", () => {
  const { database } = createDatabase();
  const report = buildWeeklyReport(database);

  assert.match(report, /Новые пользователи: 0/);
  assert.match(report, /Завершили настройку: 0/);
  assert.match(report, /Активные пользователи: 0/);
  assert.match(report, /Совпадений: 0/);
  assert.match(report, /Уведомлений отправлено: 0/);
  assert.match(report, /Открытий подборки: 0/);
  assert.match(report, /Сохранено: 0/);
  assert.match(report, /Откликов: 0/);
  assert.match(report, /Не подошло: 0/);

  database.close();
});

test("counts events within the last 7 days only", () => {
  const { database } = createDatabase();

  recordAnalyticsEventDirectly(database, "user_started", "u1", "u1", daysAgo(1));
  recordAnalyticsEventDirectly(database, "user_started", "u2", "u2", daysAgo(3));
  recordAnalyticsEventDirectly(database, "user_started", "u3", "u3", daysAgo(10));
  recordAnalyticsEventDirectly(database, "user_started", "u4", "u4", daysAgo(20));

  const count = database.countAnalyticsEventsSince("user_started", daysAgo(7));
  assert.equal(count, 2);

  database.close();
});

test("old events beyond 7 days are excluded from report", () => {
  const { database } = createDatabase();

  recordAnalyticsEventDirectly(database, "user_started", "u1", "u1", daysAgo(1));
  recordAnalyticsEventDirectly(database, "user_started", "u2", "u2", daysAgo(8));
  recordAnalyticsEventDirectly(database, "onboarding_completed", "u1", "u1", daysAgo(2));
  recordAnalyticsEventDirectly(database, "vacancy_matched", "system:bot", null, daysAgo(9));
  recordAnalyticsEventDirectly(database, "vacancy_matched", "system:bot", null, daysAgo(1));

  const report = buildWeeklyReport(database);

  assert.match(report, /Новые пользователи: 1/);
  assert.match(report, /Завершили настройку: 1/);
  assert.match(report, /Совпадений: 1/);

  database.close();
});

test("unique active users are counted correctly", () => {
  const { database } = createDatabase();

  recordAnalyticsEventDirectly(database, "user_started", "u1", "u1", daysAgo(1));
  recordAnalyticsEventDirectly(database, "weekly_feed_opened", "u1", "u1", daysAgo(1));
  recordAnalyticsEventDirectly(database, "vacancy_matched", "u2", "u2", daysAgo(2));
  recordAnalyticsEventDirectly(database, "user_started", "u2", "u2", daysAgo(2));
  recordAnalyticsEventDirectly(database, "vacancy_matched", "u3", "u3", daysAgo(10));
  recordAnalyticsEventDirectly(database, "user_started", "u3", "u3", daysAgo(10));

  const activeUsers = database.countDistinctAnalyticsUsersSince(daysAgo(7));
  assert.equal(activeUsers, 2);

  database.close();
});

test("status changes are counted by next_status", () => {
  const { database } = createDatabase();

  recordAnalyticsEventDirectly(database, "vacancy_status_changed", "u1", "u1", daysAgo(1), { next_status: "saved" });
  recordAnalyticsEventDirectly(database, "vacancy_status_changed", "u1", "u1", daysAgo(1), { next_status: "saved" });
  recordAnalyticsEventDirectly(database, "vacancy_status_changed", "u1", "u1", daysAgo(1), { next_status: "hidden" });
  recordAnalyticsEventDirectly(database, "vacancy_status_changed", "u2", "u2", daysAgo(10), { next_status: "saved" });
  recordAnalyticsEventDirectly(database, "vacancy_status_changed", "u2", "u2", daysAgo(10), { next_status: "hidden" });

  const saved = database.countAnalyticsStatusChangesSince("saved", daysAgo(7));
  const hidden = database.countAnalyticsStatusChangesSince("hidden", daysAgo(7));

  assert.equal(saved, 2);
  assert.equal(hidden, 1);

  database.close();
});

test("buildWeeklyReport includes all metric lines", () => {
  const { database } = createDatabase();

  recordAnalyticsEventDirectly(database, "user_started", "u1", "u1", daysAgo(1));
  recordAnalyticsEventDirectly(database, "onboarding_completed", "u1", "u1", daysAgo(1));
  recordAnalyticsEventDirectly(database, "weekly_feed_opened", "u1", "u1", daysAgo(1));
  recordAnalyticsEventDirectly(database, "vacancy_matched", "u1", "u1", daysAgo(1));
  recordAnalyticsEventDirectly(database, "vacancy_notified", "u1", "u1", daysAgo(1));
  recordAnalyticsEventDirectly(database, "vacancy_application_created", "u1", "u1", daysAgo(1));
  recordAnalyticsEventDirectly(database, "vacancy_status_changed", "u1", "u1", daysAgo(1), { next_status: "saved" });
  recordAnalyticsEventDirectly(database, "vacancy_status_changed", "u1", "u1", daysAgo(1), { next_status: "hidden" });

  const report = buildWeeklyReport(database);

  assert.ok(report.includes("📊 Отчёт за 7 дней"));
  assert.ok(report.includes("Новые пользователи: 1"));
  assert.ok(report.includes("Завершили настройку: 1"));
  assert.ok(report.includes("Активные пользователи: 1"));
  assert.ok(report.includes("Совпадений: 1"));
  assert.ok(report.includes("Уведомлений отправлено: 1"));
  assert.ok(report.includes("Открытий подборки: 1"));
  assert.ok(report.includes("Сохранено: 1"));
  assert.ok(report.includes("Откликов: 1"));
  assert.ok(report.includes("Не подошло: 1"));

  database.close();
});

test("owner can access report command while admin and member cannot", async () => {
  const { config, database } = createDatabase();

  assert.equal(database.hasOwnerAccess("123456"), true);
  assert.equal(database.hasOwnerAccess("admin_user"), false);
  assert.equal(database.hasOwnerAccess("member_user"), false);

  database.close();
});

test("sql injection via event name is prevented", () => {
  const { database } = createDatabase();

  const maliciousName = "user_started'; DROP TABLE analytics_events; --";
  const count = database.countAnalyticsEventsSince(maliciousName as never, daysAgo(7));

  assert.equal(count, 0);

  const tableExists = (database as unknown as { getDb(): { prepare(sql: string): { get(): unknown } } }).getDb()
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='analytics_events'")
    .get();
  assert.ok(tableExists);

  database.close();
});

test("sql injection via status parameter is prevented", () => {
  const { database } = createDatabase();

  const maliciousStatus = "saved'; DROP TABLE analytics_events; --";
  const count = database.countAnalyticsStatusChangesSince(maliciousStatus, daysAgo(7));

  assert.equal(count, 0);

  const tableExists = (database as unknown as { getDb(): { prepare(sql: string): { get(): unknown } } }).getDb()
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='analytics_events'")
    .get();
  assert.ok(tableExists);

  database.close();
});
