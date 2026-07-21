import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { VacancyDatabase } from "../src/db/database";
import { buildWeeklyReport, buildReportKeyboard, REPORT_PERIOD_OPTIONS } from "../src/services/weeklyReport";
import { createTestConfig } from "./helpers";

function createDatabase(overrides: Partial<ReturnType<typeof createTestConfig>> = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-tg-bot-report-"));
  const config = createTestConfig({
    databasePath: path.join(tempDir, "bot.db"),
    databaseUrl: `file:${path.join(tempDir, "bot.db")}`,
    appDataDir: tempDir,
    runtimeDir: path.join(tempDir, "runtime"),
    ...overrides
  });
  const database = new VacancyDatabase(config);
  database.initialize();
  return { config, database };
}

function hoursOffset(isoBase: string, hours: number): string {
  const d = new Date(isoBase);
  d.setTime(d.getTime() + hours * 60 * 60 * 1000);
  return d.toISOString();
}

function daysOffset(isoBase: string, days: number): string {
  return hoursOffset(isoBase, days * 24);
}

const FIXED_NOW = "2026-07-21T12:00:00.000Z";

test("empty database produces zero report", () => {
  const { database } = createDatabase();
  const report = buildWeeklyReport(database, new Date(FIXED_NOW));

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

test("duplicate user_started counts as one new user", () => {
  const { database } = createDatabase();

  database.recordAnalyticsEvent({ eventName: "user_started", userId: "u1", occurredAt: daysOffset(FIXED_NOW, -1) });
  database.recordAnalyticsEvent({ eventName: "user_started", userId: "u1", occurredAt: daysOffset(FIXED_NOW, -2) });
  database.recordAnalyticsEvent({ eventName: "user_started", userId: "u2", occurredAt: daysOffset(FIXED_NOW, -3) });

  const report = buildWeeklyReport(database, new Date(FIXED_NOW));
  assert.match(report, /Новые пользователи: 2/);
  assert.match(report, /Активные пользователи: 2/);

  database.close();
});

test("duplicate onboarding_completed counts as one user", () => {
  const { database } = createDatabase();

  database.recordAnalyticsEvent({ eventName: "onboarding_completed", userId: "u1", occurredAt: daysOffset(FIXED_NOW, -1) });
  database.recordAnalyticsEvent({ eventName: "onboarding_completed", userId: "u1", occurredAt: daysOffset(FIXED_NOW, -2) });

  const report = buildWeeklyReport(database, new Date(FIXED_NOW));
  assert.match(report, /Завершили настройку: 1/);
  assert.match(report, /Активные пользователи: 1/);

  database.close();
});

test("system events with null userId are not counted as active users", () => {
  const { database } = createDatabase();

  database.recordAnalyticsEvent({ eventName: "vacancy_matched", userId: null, occurredAt: daysOffset(FIXED_NOW, -1) });
  database.recordAnalyticsEvent({ eventName: "poll_cycle_completed", userId: null, occurredAt: daysOffset(FIXED_NOW, -2) });

  const report = buildWeeklyReport(database, new Date(FIXED_NOW));
  assert.match(report, /Новые пользователи: 0/);
  assert.match(report, /Активные пользователи: 0/);
  assert.match(report, /Совпадений: 1/);

  database.close();
});

test("multiple events from same userId give one active user", () => {
  const { database } = createDatabase();

  database.recordAnalyticsEvent({ eventName: "user_started", userId: "u1", occurredAt: daysOffset(FIXED_NOW, -1) });
  database.recordAnalyticsEvent({ eventName: "weekly_feed_opened", userId: "u1", occurredAt: daysOffset(FIXED_NOW, -1) });
  database.recordAnalyticsEvent({ eventName: "vacancy_matched", userId: "u1", occurredAt: daysOffset(FIXED_NOW, -1) });
  database.recordAnalyticsEvent({ eventName: "vacancy_notified", userId: "u2", occurredAt: daysOffset(FIXED_NOW, -1) });

  const report = buildWeeklyReport(database, new Date(FIXED_NOW));
  assert.match(report, /Активные пользователи: 2/);

  database.close();
});

test("event older than 7 days is excluded", () => {
  const { database } = createDatabase();

  database.recordAnalyticsEvent({ eventName: "user_started", userId: "u1", occurredAt: daysOffset(FIXED_NOW, -1) });
  database.recordAnalyticsEvent({ eventName: "user_started", userId: "u2", occurredAt: daysOffset(FIXED_NOW, -8) });

  const report = buildWeeklyReport(database, new Date(FIXED_NOW));
  assert.match(report, /Новые пользователи: 1/);
  assert.match(report, /Активные пользователи: 1/);

  database.close();
});

test("event from the future is excluded", () => {
  const { database } = createDatabase();

  database.recordAnalyticsEvent({ eventName: "user_started", userId: "u1", occurredAt: daysOffset(FIXED_NOW, -1) });
  database.recordAnalyticsEvent({ eventName: "user_started", userId: "u_future", occurredAt: daysOffset(FIXED_NOW, 1) });

  const report = buildWeeklyReport(database, new Date(FIXED_NOW));
  assert.match(report, /Новые пользователи: 1/);
  assert.match(report, /Активные пользователи: 1/);

  database.close();
});

test("boundary events at exact since and until are included", () => {
  const { database } = createDatabase();
  const since = new Date(new Date(FIXED_NOW).getTime() - 7 * 24 * 60 * 60 * 1000);

  database.recordAnalyticsEvent({ eventName: "user_started", userId: "u1", occurredAt: since.toISOString() });
  database.recordAnalyticsEvent({ eventName: "user_started", userId: "u2", occurredAt: FIXED_NOW });

  const report = buildWeeklyReport(database, new Date(FIXED_NOW));
  assert.match(report, /Новые пользователи: 2/);
  assert.match(report, /Активные пользователи: 2/);

  database.close();
});

test("buildWeeklyReport includes all metric lines", () => {
  const { database } = createDatabase();

  database.recordAnalyticsEvent({ eventName: "user_started", userId: "u1", occurredAt: daysOffset(FIXED_NOW, -1) });
  database.recordAnalyticsEvent({ eventName: "onboarding_completed", userId: "u1", occurredAt: daysOffset(FIXED_NOW, -1) });
  database.recordAnalyticsEvent({ eventName: "weekly_feed_opened", userId: "u1", occurredAt: daysOffset(FIXED_NOW, -1) });
  database.recordAnalyticsEvent({ eventName: "vacancy_matched", userId: "u1", occurredAt: daysOffset(FIXED_NOW, -1) });
  database.recordAnalyticsEvent({ eventName: "vacancy_notified", userId: "u1", occurredAt: daysOffset(FIXED_NOW, -1) });
  database.recordAnalyticsEvent({ eventName: "vacancy_application_created", userId: "u1", occurredAt: daysOffset(FIXED_NOW, -1) });
  database.recordAnalyticsEvent({
    eventName: "vacancy_status_changed", userId: "u1", occurredAt: daysOffset(FIXED_NOW, -1),
    properties: { next_status: "saved" }
  });
  database.recordAnalyticsEvent({
    eventName: "vacancy_status_changed", userId: "u1", occurredAt: daysOffset(FIXED_NOW, -1),
    properties: { next_status: "hidden" }
  });

  const report = buildWeeklyReport(database, new Date(FIXED_NOW));

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

test("hasOwnerAccess returns true only for owner role", () => {
  const { database } = createDatabase({ ownerUserId: "owner1" });

  database.addOrActivateBotUser("admin1", "admin", "owner1");
  database.addOrActivateBotUser("member1", "member", "owner1");

  assert.equal(database.hasOwnerAccess("owner1"), true);
  assert.equal(database.hasOwnerAccess("admin1"), false);
  assert.equal(database.hasOwnerAccess("member1"), false);
  assert.equal(database.hasOwnerAccess("unknown_user"), false);

  database.close();
});

test("sql injection via event name is prevented", () => {
  const { database } = createDatabase();

  const maliciousName = "user_started'; DROP TABLE analytics_events; --";
  const count = database.countAnalyticsEventsSince(maliciousName as never, daysOffset(FIXED_NOW, -7), FIXED_NOW);

  assert.equal(count, 0);

  database.recordAnalyticsEvent({ eventName: "user_started", userId: "u1", occurredAt: daysOffset(FIXED_NOW, -1) });
  const realCount = database.countAnalyticsEventsSince("user_started", daysOffset(FIXED_NOW, -7), FIXED_NOW);
  assert.equal(realCount, 1);

  database.close();
});

test("sql injection via status parameter is prevented", () => {
  const { database } = createDatabase();

  const maliciousStatus = "saved'; DROP TABLE analytics_events; --";
  const count = database.countAnalyticsStatusChangesSince(maliciousStatus, daysOffset(FIXED_NOW, -7), FIXED_NOW);

  assert.equal(count, 0);

  database.recordAnalyticsEvent({
    eventName: "vacancy_status_changed", userId: "u1", occurredAt: daysOffset(FIXED_NOW, -1),
    properties: { next_status: "saved" }
  });
  const realCount = database.countAnalyticsStatusChangesSince("saved", daysOffset(FIXED_NOW, -7), FIXED_NOW);
  assert.equal(realCount, 1);

  database.close();
});

test("event count methods respect both since and until bounds", () => {
  const { database } = createDatabase();

  database.recordAnalyticsEvent({ eventName: "vacancy_matched", userId: "u1", occurredAt: daysOffset(FIXED_NOW, -8) });
  database.recordAnalyticsEvent({ eventName: "vacancy_matched", userId: "u2", occurredAt: daysOffset(FIXED_NOW, -3) });
  database.recordAnalyticsEvent({ eventName: "vacancy_matched", userId: "u3", occurredAt: daysOffset(FIXED_NOW, 1) });

  const count = database.countAnalyticsEventsSince("vacancy_matched", daysOffset(FIXED_NOW, -7), FIXED_NOW);
  assert.equal(count, 1);

  database.close();
});

test("REPORT_PERIOD_OPTIONS contains only 7, 14, 30", () => {
  assert.deepEqual([...REPORT_PERIOD_OPTIONS], [7, 14, 30]);
});

test("report for 14 days includes events 8 days ago while 7-day report excludes them", () => {
  const { database } = createDatabase();

  database.recordAnalyticsEvent({ eventName: "user_started", userId: "u1", occurredAt: daysOffset(FIXED_NOW, -3) });
  database.recordAnalyticsEvent({ eventName: "user_started", userId: "u2", occurredAt: daysOffset(FIXED_NOW, -10) });
  database.recordAnalyticsEvent({ eventName: "vacancy_matched", userId: "u1", occurredAt: daysOffset(FIXED_NOW, -10) });

  const report7 = buildWeeklyReport(database, new Date(FIXED_NOW), 7);
  const report14 = buildWeeklyReport(database, new Date(FIXED_NOW), 14);
  const report30 = buildWeeklyReport(database, new Date(FIXED_NOW), 30);

  assert.match(report7, /Новые пользователи: 1/);
  assert.match(report7, /Совпадений: 0/);

  assert.match(report14, /Новые пользователи: 2/);
  assert.match(report14, /Совпадений: 1/);

  assert.match(report30, /Новые пользователи: 2/);
  assert.match(report30, /Совпадений: 1/);

  database.close();
});

test("report header matches the selected period", () => {
  const { database } = createDatabase();

  const report7 = buildWeeklyReport(database, new Date(FIXED_NOW), 7);
  const report14 = buildWeeklyReport(database, new Date(FIXED_NOW), 14);
  const report30 = buildWeeklyReport(database, new Date(FIXED_NOW), 30);

  assert.ok(report7.includes("📊 Отчёт за 7 дней"));
  assert.ok(report14.includes("📊 Отчёт за 14 дней"));
  assert.ok(report30.includes("📊 Отчёт за 30 дней"));

  database.close();
});

test("report keyboard has three buttons with correct callback data", () => {
  for (const period of REPORT_PERIOD_OPTIONS) {
    const kb = buildReportKeyboard(period);
    const text = JSON.stringify(kb);
    assert.ok(text.includes("report:period:7"));
    assert.ok(text.includes("report:period:14"));
    assert.ok(text.includes("report:period:30"));
  }
});

test("selected period has ✅ on exactly one button", () => {
  for (const option of REPORT_PERIOD_OPTIONS) {
    const kb = buildReportKeyboard(option);
    const json = JSON.stringify(kb);
    const checkCount = (json.match(/✅/g) ?? []).length;
    assert.equal(checkCount, 1, `period ${option} should have exactly one ✅`);
  }
});

test("buildReportKeyboard button labels match expected period labels", () => {
  const keyboard7 = buildReportKeyboard(7);
  const text7 = JSON.stringify(keyboard7);
  assert.ok(text7.includes("✅ 7 дней"));
  assert.ok(text7.includes("14 дней"));
  assert.ok(text7.includes("30 дней"));

  const keyboard14 = buildReportKeyboard(14);
  const text14 = JSON.stringify(keyboard14);
  assert.ok(text14.includes("7 дней"));
  assert.ok(text14.includes("✅ 14 дней"));
  assert.ok(text14.includes("30 дней"));

  const keyboard30 = buildReportKeyboard(30);
  const text30 = JSON.stringify(keyboard30);
  assert.ok(text30.includes("7 дней"));
  assert.ok(text30.includes("14 дней"));
  assert.ok(text30.includes("✅ 30 дней"));
});

test("invalid period is safely rejected by REPORT_PERIOD_OPTIONS guard", () => {
  const invalidValues = [0, 1, 6, 8, 13, 15, 31, 365, -1];
  for (const value of invalidValues) {
    assert.equal(REPORT_PERIOD_OPTIONS.includes(value as never), false);
  }
});

test("all metrics are present in report regardless of period", () => {
  const { database } = createDatabase();

  database.recordAnalyticsEvent({ eventName: "user_started", userId: "u1", occurredAt: daysOffset(FIXED_NOW, -1) });
  database.recordAnalyticsEvent({ eventName: "onboarding_completed", userId: "u1", occurredAt: daysOffset(FIXED_NOW, -1) });
  database.recordAnalyticsEvent({ eventName: "weekly_feed_opened", userId: "u1", occurredAt: daysOffset(FIXED_NOW, -1) });
  database.recordAnalyticsEvent({ eventName: "vacancy_matched", userId: "u1", occurredAt: daysOffset(FIXED_NOW, -1) });
  database.recordAnalyticsEvent({ eventName: "vacancy_notified", userId: "u1", occurredAt: daysOffset(FIXED_NOW, -1) });
  database.recordAnalyticsEvent({ eventName: "vacancy_application_created", userId: "u1", occurredAt: daysOffset(FIXED_NOW, -1) });
  database.recordAnalyticsEvent({
    eventName: "vacancy_status_changed", userId: "u1", occurredAt: daysOffset(FIXED_NOW, -1),
    properties: { next_status: "saved" }
  });
  database.recordAnalyticsEvent({
    eventName: "vacancy_status_changed", userId: "u1", occurredAt: daysOffset(FIXED_NOW, -1),
    properties: { next_status: "hidden" }
  });

  for (const period of REPORT_PERIOD_OPTIONS) {
    const report = buildWeeklyReport(database, new Date(FIXED_NOW), period);
    assert.ok(report.includes("Новые пользователи: 1"), `period ${period}`);
    assert.ok(report.includes("Завершили настройку: 1"), `period ${period}`);
    assert.ok(report.includes("Активные пользователи: 1"), `period ${period}`);
    assert.ok(report.includes("Совпадений: 1"), `period ${period}`);
    assert.ok(report.includes("Уведомлений отправлено: 1"), `period ${period}`);
    assert.ok(report.includes("Открытий подборки: 1"), `period ${period}`);
    assert.ok(report.includes("Сохранено: 1"), `period ${period}`);
    assert.ok(report.includes("Откликов: 1"), `period ${period}`);
    assert.ok(report.includes("Не подошло: 1"), `period ${period}`);
  }

  database.close();
});

test("hasOwnerAccess still works correctly when other users exist", () => {
  const { database } = createDatabase({ ownerUserId: "owner_x" });

  database.addOrActivateBotUser("admin_x", "admin", "owner_x");
  database.addOrActivateBotUser("member_x", "member", "owner_x");

  assert.equal(database.hasOwnerAccess("owner_x"), true);
  assert.equal(database.hasOwnerAccess("admin_x"), false);
  assert.equal(database.hasOwnerAccess("member_x"), false);
  assert.equal(database.hasOwnerAccess("stranger"), false);

  database.close();
});
