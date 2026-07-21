import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import BetterSqlite3 from "better-sqlite3";
import { VacancyDatabase } from "../src/db/database";
import { buildWeeklyRetentionReport, computeCohortMonday } from "../src/services/weeklyRetentionReport";
import { ACTIVITY_EVENT_NAMES } from "../src/services/activityWhitelist";
import { createTestConfig } from "./helpers";

// --- computeCohortMonday unit tests ---

test("computeCohortMonday: Monday stays same day", () => {
  const result = computeCohortMonday("2026-07-20T00:00:00.000Z");
  assert.equal(result, "2026-07-20T00:00:00.000Z");
});

test("computeCohortMonday: Tuesday goes back to Monday", () => {
  const result = computeCohortMonday("2026-07-21T12:00:00.000Z");
  assert.equal(result, "2026-07-20T00:00:00.000Z");
});

test("computeCohortMonday: Sunday goes back 6 days to previous Monday", () => {
  const result = computeCohortMonday("2026-07-26T08:00:00.000Z");
  assert.equal(result, "2026-07-20T00:00:00.000Z");
});

test("computeCohortMonday: Wednesday goes back 2 days", () => {
  const result = computeCohortMonday("2026-07-22T10:30:00.000Z");
  assert.equal(result, "2026-07-20T00:00:00.000Z");
});

test("computeCohortMonday: Saturday goes back 5 days", () => {
  const result = computeCohortMonday("2026-07-25T23:59:59.000Z");
  assert.equal(result, "2026-07-20T00:00:00.000Z");
});

test("computeCohortMonday: throws for invalid date", () => {
  assert.throws(() => computeCohortMonday("not-a-date"), /Invalid date/);
});

// --- Retention report builder tests ---

const FIXED_NOW = "2026-08-03T12:00:00.000Z";

function createDatabase() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-tg-bot-retention-"));
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

function daysOffset(isoBase: string, days: number): string {
  const d = new Date(isoBase);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

function hoursOffset(isoBase: string, hours: number): string {
  const d = new Date(isoBase);
  d.setTime(d.getTime() + hours * 60 * 60 * 1000);
  return d.toISOString();
}

function insertUserSql(dbPath: string, userId: string, createdAt: string): void {
  const conn = new BetterSqlite3(dbPath);
  conn.prepare("INSERT INTO bot_users (user_id, role, is_active, created_at, updated_at) VALUES (?, 'member', 1, ?, ?)").run(userId, createdAt, createdAt);
  conn.close();
}

function addActivity(database: VacancyDatabase, userId: string, occurredAt: string): void {
  database.recordAnalyticsEvent({ eventName: "weekly_feed_opened", userId, occurredAt });
}

function addNonActivity(database: VacancyDatabase, userId: string, occurredAt: string): void {
  database.recordAnalyticsEvent({ eventName: "vacancy_matched", userId, occurredAt });
}

test("empty database produces no-cohorts report", () => {
  const { database } = createDatabase();
  const report = buildWeeklyRetentionReport(database, new Date(FIXED_NOW));
  assert.ok(report.includes("Нет данных"));
  database.close();
});

test("user without any events still appears in cohort with zero retention", () => {
  const { config, database } = createDatabase();
  insertUserSql(config.databasePath, "u1", daysOffset(FIXED_NOW, -60));
  const report = buildWeeklyRetentionReport(database, new Date(FIXED_NOW));
  assert.ok(!report.includes("u1"));
  assert.ok(report.includes("%"));
  database.close();
});

test("user is placed into correct weekly cohort based on created_at", () => {
  const { config, database } = createDatabase();
  const monday = daysOffset(FIXED_NOW, -70);
  insertUserSql(config.databasePath, "u1", hoursOffset(monday, 12));

  const report = buildWeeklyRetentionReport(database, new Date(FIXED_NOW));
  const expectedDate = new Date(monday);
  const day = String(expectedDate.getUTCDate()).padStart(2, "0");
  const month = String(expectedDate.getUTCMonth() + 1).padStart(2, "0");
  assert.ok(report.includes(`${day}.${month}`));
  database.close();
});

test("one user with multiple events in same week counts once", () => {
  const { config, database } = createDatabase();
  insertUserSql(config.databasePath, "u1", daysOffset(FIXED_NOW, -70));
  const week1 = daysOffset(FIXED_NOW, -63);
  addActivity(database, "u1", week1);
  addActivity(database, "u1", hoursOffset(week1, 6));
  addActivity(database, "u1", hoursOffset(week1, 12));

  const report = buildWeeklyRetentionReport(database, new Date(FIXED_NOW));
  assert.ok(report.includes("100%"));
  database.close();
});

test("W1-W4 are counted independently for the same user", () => {
  const { config, database } = createDatabase();
  insertUserSql(config.databasePath, "u1", daysOffset(FIXED_NOW, -100));
  const cs = new Date(computeCohortMonday(daysOffset(FIXED_NOW, -100)));
  addActivity(database, "u1", daysOffset(cs.toISOString(), 7));
  addActivity(database, "u1", daysOffset(cs.toISOString(), 21));

  const report = buildWeeklyRetentionReport(database, new Date(FIXED_NOW));
  const lines = report.split("\n");
  const dataLine = lines.find((l) => l.includes("%") && l.includes("|") && !l.includes("Формула") && !l.includes("Неделя"));
  const parts = dataLine?.split("|").map((s) => s.trim()) ?? [];
  assert.ok(parts.length >= 6);
  assert.equal(parts[2].trim().replace("%", ""), "100");
  assert.equal(parts[3].trim().replace("%", ""), "0");
  assert.equal(parts[4].trim().replace("%", ""), "100");
  assert.equal(parts[5].trim().replace("%", ""), "0");
  database.close();
});

test("non-activity events do not create retention", () => {
  const { config, database } = createDatabase();
  insertUserSql(config.databasePath, "u1", daysOffset(FIXED_NOW, -70));
  addNonActivity(database, "u1", daysOffset(FIXED_NOW, -63));

  const report = buildWeeklyRetentionReport(database, new Date(FIXED_NOW));
  const lines = report.split("\n");
  const dataLine = lines.find((l) => l.includes("|") && l.includes("%"));
  assert.ok(dataLine, "Report should have a data line");
  const parts = dataLine!.split("|").map((s) => s.trim());
  for (let i = 2; i <= 5; i++) {
    assert.equal(parts[i].trim(), "0%");
  }
  database.close();
});

test("events on exact week boundaries are counted correctly", () => {
  const { config, database } = createDatabase();
  insertUserSql(config.databasePath, "u1", daysOffset(FIXED_NOW, -70));
  const cs = new Date(computeCohortMonday(daysOffset(FIXED_NOW, -70)));

  addActivity(database, "u1", daysOffset(cs.toISOString(), 7));
  addActivity(database, "u1", hoursOffset(daysOffset(cs.toISOString(), 14), -1));

  const report = buildWeeklyRetentionReport(database, new Date(FIXED_NOW));
  assert.ok(report.includes("100%"));
  database.close();
});

test("future events are excluded", () => {
  const { config, database } = createDatabase();
  insertUserSql(config.databasePath, "u1", daysOffset(FIXED_NOW, -70));
  addActivity(database, "u1", daysOffset(FIXED_NOW, 7));

  const report = buildWeeklyRetentionReport(database, new Date(FIXED_NOW));
  const lines = report.split("\n");
  const dataLine = lines.find((l) => l.includes("|") && l.includes("%"));
  assert.ok(dataLine);
  const parts = dataLine!.split("|").map((s) => s.trim());
  for (let i = 2; i <= 5; i++) {
    assert.equal(parts[i].trim(), "0%");
  }
  database.close();
});

test("future weeks show dash instead of 0%", () => {
  const { config, database } = createDatabase();
  insertUserSql(config.databasePath, "u1", hoursOffset(FIXED_NOW, -6));

  const report = buildWeeklyRetentionReport(database, new Date(FIXED_NOW));
  const lines = report.split("\n");
  const dataLine = lines.find((l) => l.includes("|") && l.includes("—"));
  if (dataLine) {
    const parts = dataLine!.split("|").map((s) => s.trim());
    assert.equal(parts[2].trim(), "—");
  }
  database.close();
});

test("two different cohorts do not mix users", () => {
  const { config, database } = createDatabase();
  insertUserSql(config.databasePath, "u1", daysOffset(FIXED_NOW, -70));
  insertUserSql(config.databasePath, "u2", daysOffset(FIXED_NOW, -14));

  addActivity(database, "u1", daysOffset(FIXED_NOW, -63));
  addActivity(database, "u2", daysOffset(FIXED_NOW, -7));

  const report = buildWeeklyRetentionReport(database, new Date(FIXED_NOW));
  const lines = report.split("\n");
  const dataLines = lines.filter((l) => l.includes("|") && l.includes("%"));
  assert.ok(dataLines.length >= 2);
  database.close();
});

test("at most 8 cohorts are shown", () => {
  const { config, database } = createDatabase();
  for (let i = 0; i < 20; i++) {
    insertUserSql(config.databasePath, `u_week_${i}`, daysOffset(FIXED_NOW, -(i * 7 + 3)));
  }

  const report = buildWeeklyRetentionReport(database, new Date(FIXED_NOW));
  const lines = report.split("\n");
  const dataLines = lines.filter((l) => l.includes("|") && l.includes("%"));
  assert.equal(dataLines.length, 8);
  database.close();
});

test("report includes timezone note, formula, and header", () => {
  const { config, database } = createDatabase();
  insertUserSql(config.databasePath, "u1", daysOffset(FIXED_NOW, -70));

  const report = buildWeeklyRetentionReport(database, new Date(FIXED_NOW));
  assert.ok(report.includes("Часовой пояс: UTC"));
  assert.ok(report.includes("Формула"));
  assert.ok(report.includes("Неделя начала"));
  database.close();
});

test("countCohortActivityUsers with activity event returns correct count", () => {
  const { config, database } = createDatabase();
  insertUserSql(config.databasePath, "u_active", daysOffset(FIXED_NOW, -70));
  insertUserSql(config.databasePath, "u_idle", daysOffset(FIXED_NOW, -70));

  addActivity(database, "u_active", daysOffset(FIXED_NOW, -63));
  addActivity(database, "u_idle", daysOffset(FIXED_NOW, -63));

  const w1Start = computeCohortMonday(daysOffset(FIXED_NOW, -63));
  const w1End = daysOffset(w1Start, 7);

  const count = database.countCohortActivityUsers(
    ["u_active", "u_idle"],
    ACTIVITY_EVENT_NAMES as unknown as string[],
    w1Start,
    w1End
  );
  assert.equal(count, 2);
  database.close();
});

test("countCohortActivityUsers with non-activity events returns zero", () => {
  const { config, database } = createDatabase();
  insertUserSql(config.databasePath, "u1", daysOffset(FIXED_NOW, -70));
  addNonActivity(database, "u1", daysOffset(FIXED_NOW, -63));

  const w1Start = computeCohortMonday(daysOffset(FIXED_NOW, -63));
  const w1End = daysOffset(w1Start, 7);

  const count = database.countCohortActivityUsers(
    ["u1"],
    ACTIVITY_EVENT_NAMES as unknown as string[],
    w1Start,
    w1End
  );
  assert.equal(count, 0);
  database.close();
});

test("countCohortActivityUsers with empty userIds returns 0", () => {
  const { database } = createDatabase();
  const count = database.countCohortActivityUsers([], ["weekly_feed_opened"], "2026-01-01T00:00:00.000Z", "2026-01-08T00:00:00.000Z");
  assert.equal(count, 0);
  database.close();
});

test("countCohortActivityUsers with empty eventNames returns 0", () => {
  const { config, database } = createDatabase();
  insertUserSql(config.databasePath, "u1", daysOffset(FIXED_NOW, -70));
  const count = database.countCohortActivityUsers(["u1"], [], "2026-01-01T00:00:00.000Z", "2026-01-08T00:00:00.000Z");
  assert.equal(count, 0);
  database.close();
});

// --- Handler-level access control test ---

test("production handler: owner gets report, admin/member denied", async () => {
  const { config, database } = createDatabase();
  database.addOrActivateBotUser("777", "owner", "777");
  database.addOrActivateBotUser("888", "admin", "777");
  database.addOrActivateBotUser("999", "member", "777");

  const handlerPath = "../src/bot/retentionHandler";
  const { handleRetentionCommand } = await import(handlerPath);

  const grammy = await import("grammy");
  const bot = new grammy.Bot("test-token", {
    botInfo: {
      id: 123456,
      is_bot: true,
      first_name: "TestRetentionBot",
      username: "test_retention_bot",
      can_join_groups: false,
      can_read_all_group_messages: false,
      can_manage_bots: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
      has_topics_enabled: false,
      allows_users_to_create_topics: false
    }
  });

  let lastReplyText: string | undefined;
  let reportBuilderCalled = false;

  bot.api.config.use((prev, method, payload) => {
    if (method === "sendMessage") {
      lastReplyText = (payload as Record<string, unknown>).text as string | undefined;
      return Promise.resolve({ ok: true, result: { message_id: 1 } }) as never;
    }
    return prev(method, payload);
  });

  bot.command("retention", async (ctx) => {
    await handleRetentionCommand(ctx, database);
  });

  async function makeUpdate(fromId: number) {
    return {
      update_id: fromId,
      message: {
        message_id: 1,
        date: Math.floor(Date.now() / 1000),
        text: "/retention",
        chat: { id: fromId, type: "private" as const, first_name: "Test" },
        from: { id: fromId, is_bot: false, first_name: "Test", language_code: "en" },
        entities: [{ offset: 0, length: 10, type: "bot_command" as const }]
      }
    };
  }

  // Owner gets report
  lastReplyText = undefined;
  await bot.handleUpdate(await makeUpdate(777));
  const ownerText: string = lastReplyText ?? "";
  assert.ok(ownerText.includes("Ретенция"), "owner must see retention report");
  assert.ok(!ownerText.includes("🔒"), "owner must not see lock emoji");

  // Admin denied
  lastReplyText = undefined;
  await bot.handleUpdate(await makeUpdate(888));
  const adminText: string = lastReplyText ?? "";
  assert.ok(adminText.includes("🔒"), "admin must be denied");

  // Member denied
  lastReplyText = undefined;
  await bot.handleUpdate(await makeUpdate(999));
  const memberText: string = lastReplyText ?? "";
  assert.ok(memberText.includes("🔒"), "member must be denied");

  database.close();
});
