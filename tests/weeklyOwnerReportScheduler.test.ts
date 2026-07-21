import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { VacancyDatabase } from "../src/db/database";
import { WeeklyOwnerReportScheduler } from "../src/services/weeklyOwnerReportScheduler";
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
  return { config, database, tempDir };
}

function makeDate(iso: string): Date {
  return new Date(iso);
}

test("getLocalTimeInfo returns Monday=true and weekKey for Monday 09:00 UTC", () => {
  const { config, database } = createDatabase({ ownerUserId: "owner1", timeZone: "UTC" });
  const scheduler = new WeeklyOwnerReportScheduler(database, config, async () => true);

  const info = scheduler.getLocalTimeInfo(makeDate("2026-07-20T09:00:00.000Z"));
  assert.equal(info.isMonday, true);
  assert.equal(info.minutes, 9 * 60);
  assert.equal(info.weekKey, "2026-07-20");

  database.close();
});

test("getLocalTimeInfo returns Monday=true and weekKey for Monday 09:00 non-UTC timezone", () => {
  const { config, database } = createDatabase({ ownerUserId: "owner1", timeZone: "Asia/Yekaterinburg" });
  const scheduler = new WeeklyOwnerReportScheduler(database, config, async () => true);

  const info = scheduler.getLocalTimeInfo(makeDate("2026-07-20T04:00:00.000Z"));
  assert.equal(info.isMonday, true);
  assert.equal(info.minutes, 9 * 60);
  assert.equal(info.weekKey, "2026-07-20");

  database.close();
});

test("getLocalTimeInfo returns isMonday=false for Tuesday", () => {
  const { config, database } = createDatabase({ ownerUserId: "owner1", timeZone: "UTC" });
  const scheduler = new WeeklyOwnerReportScheduler(database, config, async () => true);

  const info = scheduler.getLocalTimeInfo(makeDate("2026-07-21T09:00:00.000Z"));
  assert.equal(info.isMonday, false);

  database.close();
});

test("getLocalTimeInfo returns isMonday=false for Sunday", () => {
  const { config, database } = createDatabase({ ownerUserId: "owner1", timeZone: "UTC" });
  const scheduler = new WeeklyOwnerReportScheduler(database, config, async () => true);

  const info = scheduler.getLocalTimeInfo(makeDate("2026-07-26T09:00:00.000Z"));
  assert.equal(info.isMonday, false);

  database.close();
});

test("getLocalTimeInfo returns isMonday=false before 09:00 on Monday", () => {
  const { config, database } = createDatabase({ ownerUserId: "owner1", timeZone: "UTC" });
  const scheduler = new WeeklyOwnerReportScheduler(database, config, async () => true);

  const info = scheduler.getLocalTimeInfo(makeDate("2026-07-20T08:59:59.000Z"));
  assert.equal(info.isMonday, true);
  assert.equal(info.minutes, 8 * 60 + 59);

  database.close();
});

test("getLocalTimeInfo weekKey spans year boundary", () => {
  const { config, database } = createDatabase({ ownerUserId: "owner1", timeZone: "UTC" });
  const scheduler = new WeeklyOwnerReportScheduler(database, config, async () => true);

  const info = scheduler.getLocalTimeInfo(makeDate("2027-01-04T09:00:00.000Z"));
  assert.equal(info.isMonday, true);
  assert.equal(info.weekKey, "2027-01-04");

  database.close();
});

test("getLocalTimeInfo weekKey shows previous year Monday for early January Sunday", () => {
  const { config, database } = createDatabase({ ownerUserId: "owner1", timeZone: "UTC" });
  const scheduler = new WeeklyOwnerReportScheduler(database, config, async () => true);

  const info = scheduler.getLocalTimeInfo(makeDate("2027-01-03T09:00:00.000Z"));
  assert.equal(info.isMonday, false);
  assert.equal(info.weekKey, "2026-12-28");

  database.close();
});

test("sends report on Monday after 09:00", async () => {
  const { config, database } = createDatabase({ ownerUserId: "owner1", timeZone: "UTC" });
  const delivered: string[] = [];
  const scheduler = new WeeklyOwnerReportScheduler(database, config, async (_id, text) => {
    delivered.push(text);
    return true;
  }, () => makeDate("2026-07-20T09:00:00.000Z"));

  await scheduler.runDueCycle();

  assert.equal(delivered.length, 1);
  assert.ok(delivered[0].includes("📊 Отчёт за 7 дней"));

  database.close();
});

test("records delivery in DB after successful send", async () => {
  const { config, database } = createDatabase({ ownerUserId: "owner1", timeZone: "UTC" });
  const scheduler = new WeeklyOwnerReportScheduler(database, config, async () => true, () => makeDate("2026-07-20T09:00:00.000Z"));

  await scheduler.runDueCycle();

  const record = database.getOwnerReportDelivery("2026-07-20");
  assert.notEqual(record, null);
  assert.equal(record!.period, 7);
  assert.ok(record!.deliveredAt);

  database.close();
});

test("does not send before 09:00 on Monday", async () => {
  const { config, database } = createDatabase({ ownerUserId: "owner1", timeZone: "UTC" });
  const delivered: string[] = [];
  const scheduler = new WeeklyOwnerReportScheduler(database, config, async (_id, text) => {
    delivered.push(text);
    return true;
  }, () => makeDate("2026-07-20T08:59:59.000Z"));

  await scheduler.runDueCycle();

  assert.equal(delivered.length, 0);

  database.close();
});

test("sends on Tuesday as catch-up if Monday was missed", async () => {
  const { config, database } = createDatabase({ ownerUserId: "owner1", timeZone: "UTC" });
  const delivered: string[] = [];
  const scheduler = new WeeklyOwnerReportScheduler(database, config, async (_id, text) => {
    delivered.push(text);
    return true;
  }, () => makeDate("2026-07-21T09:00:00.000Z"));

  await scheduler.runDueCycle();

  assert.equal(delivered.length, 1);
  assert.ok(delivered[0].includes("📊 Отчёт"));

  database.close();
});

test("sends on Sunday as catch-up if week was missed", async () => {
  const { config, database } = createDatabase({ ownerUserId: "owner1", timeZone: "UTC" });
  const delivered: string[] = [];
  const scheduler = new WeeklyOwnerReportScheduler(database, config, async (_id, text) => {
    delivered.push(text);
    return true;
  }, () => makeDate("2026-07-26T09:00:00.000Z"));

  await scheduler.runDueCycle();

  assert.equal(delivered.length, 1);

  database.close();
});

test("sends on Wednesday after restart catch-up", async () => {
  const { config, database } = createDatabase({ ownerUserId: "owner1", timeZone: "UTC" });
  const delivered: string[] = [];
  const scheduler = new WeeklyOwnerReportScheduler(database, config, async (_id, text) => {
    delivered.push(text);
    return true;
  }, () => makeDate("2026-07-22T10:00:00.000Z"));

  await scheduler.start();
  await scheduler.stop();

  assert.equal(delivered.length, 1);

  database.close();
});

test("delivery receives correct ownerUserId as recipientId", async () => {
  const { config, database } = createDatabase({ ownerUserId: "owner_x", timeZone: "UTC" });
  let capturedRecipient = "";
  const scheduler = new WeeklyOwnerReportScheduler(database, config, async (recipientId, _text) => {
    capturedRecipient = recipientId;
    return true;
  }, () => makeDate("2026-07-20T09:00:00.000Z"));

  await scheduler.runDueCycle();

  assert.equal(capturedRecipient, "owner_x");

  database.close();
});

test("does not send twice in the same week", async () => {
  const { config, database } = createDatabase({ ownerUserId: "owner1", timeZone: "UTC" });
  const delivered: string[] = [];
  const scheduler = new WeeklyOwnerReportScheduler(database, config, async (_id, text) => {
    delivered.push(text);
    return true;
  }, () => makeDate("2026-07-20T09:00:00.000Z"));

  await scheduler.runDueCycle();
  await scheduler.runDueCycle();

  assert.equal(delivered.length, 1);

  database.close();
});

test("does not send duplicate after restart", async () => {
  const { config, database } = createDatabase({ ownerUserId: "owner1", timeZone: "UTC" });
  const delivered: string[] = [];
  database.markOwnerReportDelivered("2026-07-20", 7, "2026-07-20T09:00:00.000Z");

  const scheduler = new WeeklyOwnerReportScheduler(database, config, async (_id, text) => {
    delivered.push(text);
    return true;
  }, () => makeDate("2026-07-20T10:00:00.000Z"));

  await scheduler.runDueCycle();

  assert.equal(delivered.length, 0);

  database.close();
});

test("does not mark delivered when delivery fails", async () => {
  const { config, database } = createDatabase({ ownerUserId: "owner1", timeZone: "UTC" });
  const scheduler = new WeeklyOwnerReportScheduler(database, config, async () => false, () => makeDate("2026-07-20T09:00:00.000Z"));

  await scheduler.runDueCycle();

  const record = database.getOwnerReportDelivery("2026-07-20");
  assert.equal(record, null);

  database.close();
});

test("does not mark delivered when delivery throws", async () => {
  const { config, database } = createDatabase({ ownerUserId: "owner1", timeZone: "UTC" });
  const scheduler = new WeeklyOwnerReportScheduler(database, config, async () => {
    throw new Error("Telegram API error");
  }, () => makeDate("2026-07-20T09:00:00.000Z"));

  await scheduler.runDueCycle();

  const record = database.getOwnerReportDelivery("2026-07-20");
  assert.equal(record, null);

  database.close();
});

test("retries after delivery failure on next cycle", async () => {
  const { config, database } = createDatabase({ ownerUserId: "owner1", timeZone: "UTC" });
  let callCount = 0;
  const scheduler = new WeeklyOwnerReportScheduler(database, config, async () => {
    callCount += 1;
    return callCount >= 2;
  }, () => makeDate("2026-07-20T09:00:00.000Z"));

  await scheduler.runDueCycle();
  assert.equal(callCount, 1);
  assert.equal(database.getOwnerReportDelivery("2026-07-20"), null);

  await scheduler.runDueCycle();
  assert.equal(callCount, 2);

  const record = database.getOwnerReportDelivery("2026-07-20");
  assert.notEqual(record, null);

  database.close();
});

test("does nothing when ownerUserId is not configured", async () => {
  const { config, database } = createDatabase({ ownerUserId: undefined, timeZone: "UTC" });
  const delivered: string[] = [];
  const scheduler = new WeeklyOwnerReportScheduler(database, config, async (_id, text) => {
    delivered.push(text);
    return true;
  }, () => makeDate("2026-07-20T09:00:00.000Z"));

  await scheduler.runDueCycle();

  assert.equal(delivered.length, 0);

  database.close();
});

test("sends on Monday after 09:00 in non-UTC timezone", async () => {
  const { config, database } = createDatabase({ ownerUserId: "owner1", timeZone: "Asia/Yekaterinburg" });
  const delivered: string[] = [];
  const scheduler = new WeeklyOwnerReportScheduler(database, config, async (_id, text) => {
    delivered.push(text);
    return true;
  }, () => makeDate("2026-07-20T04:00:00.000Z"));

  await scheduler.runDueCycle();

  assert.equal(delivered.length, 1);

  database.close();
});

test("sends when local time (Asia/Yekaterinburg 14:00) is past 09:00 even if UTC is only 09:00", async () => {
  const { config, database } = createDatabase({ ownerUserId: "owner1", timeZone: "Asia/Yekaterinburg" });
  const delivered: string[] = [];
  const scheduler = new WeeklyOwnerReportScheduler(database, config, async (_id, text) => {
    delivered.push(text);
    return true;
  }, () => makeDate("2026-07-20T09:00:00.000Z"));

  await scheduler.runDueCycle();

  assert.equal(delivered.length, 1);

  database.close();
});

test("sends on next Monday after missing the previous week", async () => {
  const { config, database } = createDatabase({ ownerUserId: "owner1", timeZone: "UTC" });
  const delivered: string[] = [];

  database.markOwnerReportDelivered("2026-07-13", 7, "2026-07-13T09:00:00.000Z");

  const scheduler = new WeeklyOwnerReportScheduler(database, config, async (_id, text) => {
    delivered.push(text);
    return true;
  }, () => makeDate("2026-07-20T09:00:00.000Z"));

  await scheduler.runDueCycle();

  assert.equal(delivered.length, 1);
  assert.equal(database.getOwnerReportDelivery("2026-07-13")!.period, 7);
  assert.notEqual(database.getOwnerReportDelivery("2026-07-20"), null);

  database.close();
});

test("stop prevents repeated delivery after initial start cycle", async () => {
  const { config, database } = createDatabase({ ownerUserId: "owner1", timeZone: "UTC" });
  const delivered: string[] = [];
  const scheduler = new WeeklyOwnerReportScheduler(database, config, async (_id, text) => {
    delivered.push(text);
    return true;
  }, () => makeDate("2026-07-20T09:00:00.000Z"));

  await scheduler.start();
  await scheduler.stop();

  assert.equal(delivered.length, 1);

  await scheduler.runDueCycle();

  assert.equal(delivered.length, 1);

  database.close();
});

test("start sends immediately if Monday after 09:00 and not yet delivered", async () => {
  const { config, database } = createDatabase({ ownerUserId: "owner1", timeZone: "UTC" });
  const delivered: string[] = [];
  const scheduler = new WeeklyOwnerReportScheduler(database, config, async (_id, text) => {
    delivered.push(text);
    return true;
  }, () => makeDate("2026-07-20T09:00:00.000Z"));

  await scheduler.start();
  await scheduler.stop();

  assert.equal(delivered.length, 1);

  database.close();
});

test("start does not send if already delivered this week", async () => {
  const { config, database } = createDatabase({ ownerUserId: "owner1", timeZone: "UTC" });
  database.markOwnerReportDelivered("2026-07-20", 7, "2026-07-20T08:00:00.000Z");

  const delivered: string[] = [];
  const scheduler = new WeeklyOwnerReportScheduler(database, config, async (_id, text) => {
    delivered.push(text);
    return true;
  }, () => makeDate("2026-07-20T09:00:00.000Z"));

  await scheduler.start();
  await scheduler.stop();

  assert.equal(delivered.length, 0);

  database.close();
});
