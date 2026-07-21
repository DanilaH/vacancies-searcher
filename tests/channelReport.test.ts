import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { VacancyDatabase } from "../src/db/database";
import { buildChannelReport } from "../src/services/channelReport";
import { createTestConfig } from "./helpers";

import type { FilterResult, SourceName } from "../src/types";

function createFixture() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-tg-bot-cr-"));
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
  return { config, database, tempDir };
}

function daysOffset(isoBase: string, days: number): string {
  const d = new Date(isoBase);
  d.setTime(d.getTime() + days * 24 * 60 * 60 * 1000);
  return d.toISOString();
}

const FIXED_NOW = "2026-07-21T12:00:00.000Z";

function setupTestUsers(database: VacancyDatabase): void {
  for (const uid of ["u1", "u2", "u3", "member1"]) {
    database.registerPublicUserIfNeeded(uid);
  }
  database.addOrActivateBotUser("777", "owner", "777");
  database.addOrActivateBotUser("888", "admin", "777");
  database.addOrActivateBotUser("admin1", "admin", "777");
  database.addOrActivateBotUser("owner1", "owner", "777");
}

function makeFilterResult(): FilterResult {
  return {
    matches: true,
    score: 100,
    summary: "test",
    matchedKeywords: ["test"],
    blockedBy: []
  };
}

function insertVacancy(
  database: VacancyDatabase,
  source: SourceName,
  channel: string,
  messageId: string,
  text: string,
  createdAtIso: string
): number {
  const result = database.recordMessage(
    {
      source,
      channel,
      messageId,
      date: createdAtIso,
      text,
      url: `https://t.me/${channel}/${messageId}`
    },
    makeFilterResult(),
    []
  );
  assert.equal(result.kind, "new_vacancy");
  const internalDb = (database as unknown as { db: import("better-sqlite3").Database }).db;
  internalDb.prepare("UPDATE vacancies SET created_at = ? WHERE id = ?").run(createdAtIso, result.vacancy.id);
  return result.vacancy.id;
}

function insertMatch(database: VacancyDatabase, userId: string, vacancyId: number, createdAtIso: string): void {
  database.createUserVacancyMatch(userId, vacancyId, makeFilterResult());
  const internalDb = (database as unknown as { db: import("better-sqlite3").Database }).db;
  internalDb.prepare("UPDATE user_vacancy_matches SET created_at = ? WHERE user_id = ? AND vacancy_id = ?")
    .run(createdAtIso, userId, vacancyId);
}

function recordStatusTransition(
  database: VacancyDatabase,
  userId: string,
  vacancyId: number,
  nextStatus: "saved" | "hidden" | "applied",
  occurredAtIso: string
): void {
  database.recordAnalyticsEvent({
    eventName: "vacancy_status_changed",
    userId,
    occurredAt: occurredAtIso,
    properties: {
      next_status: nextStatus,
      vacancy_id: vacancyId
    }
  });
}

test("empty database returns no-data message", () => {
  const { database } = createFixture();
  const report = buildChannelReport(database, new Date(FIXED_NOW));
  assert.ok(report.includes("Нет данных"));
  database.close();
});

test("single source appears with correct metrics", () => {
  const { database } = createFixture();
  setupTestUsers(database);

  const vacId = insertVacancy(database, "telegram_web_preview", "job_react", "m1", "Senior React engineer remote", daysOffset(FIXED_NOW, -1));
  insertMatch(database, "u1", vacId, daysOffset(FIXED_NOW, -1));
  recordStatusTransition(database, "u1", vacId, "saved", daysOffset(FIXED_NOW, -1));

  const report = buildChannelReport(database, new Date(FIXED_NOW));
  assert.ok(report.includes("@job_react"));
  assert.ok(report.includes("Вакансий: 1"));
  assert.ok(report.includes("Совпадений: 1"));
  assert.ok(report.includes("Сохранено: 1"));
  assert.ok(report.includes("Откликов: 0"));
  database.close();
});

test("noise rate shows correct percentage", () => {
  const { database } = createFixture();
  setupTestUsers(database);

  const vacId = insertVacancy(database, "telegram_web_preview", "ch1", "m1", "unique text a1", daysOffset(FIXED_NOW, -1));
  insertMatch(database, "u1", vacId, daysOffset(FIXED_NOW, -1));
  recordStatusTransition(database, "u1", vacId, "hidden", daysOffset(FIXED_NOW, -1));
  recordStatusTransition(database, "u2", vacId, "saved", daysOffset(FIXED_NOW, -1));
  recordStatusTransition(database, "u3", vacId, "applied", daysOffset(FIXED_NOW, -1));

  const report = buildChannelReport(database, new Date(FIXED_NOW));
  assert.ok(report.includes("Не подошло: 1 (33.3%)"));
  database.close();
});

test("noise rate shows нет отзывов when no feedback", () => {
  const { database } = createFixture();
  insertVacancy(database, "telegram_web_preview", "ch1", "m1", "unique text b1", daysOffset(FIXED_NOW, -1));
  const report = buildChannelReport(database, new Date(FIXED_NOW));
  assert.ok(report.includes("нет отзывов"));
  database.close();
});

test("multiple sources sorted by match count then vacancy count", () => {
  const { database } = createFixture();
  setupTestUsers(database);

  const v1 = insertVacancy(database, "telegram_web_preview", "low", "m1", "unique text c1", daysOffset(FIXED_NOW, -1));
  insertMatch(database, "u1", v1, daysOffset(FIXED_NOW, -1));
  insertMatch(database, "u2", v1, daysOffset(FIXED_NOW, -1));

  const v2 = insertVacancy(database, "telegram_web_preview", "mid", "m1", "unique text c2", daysOffset(FIXED_NOW, -1));
  insertMatch(database, "u1", v2, daysOffset(FIXED_NOW, -1));

  const v3 = insertVacancy(database, "telegram_web_preview", "top", "m1", "unique text c3", daysOffset(FIXED_NOW, -1));
  insertMatch(database, "u1", v3, daysOffset(FIXED_NOW, -1));
  insertMatch(database, "u2", v3, daysOffset(FIXED_NOW, -1));

  const report = buildChannelReport(database, new Date(FIXED_NOW));
  const lowIdx = report.indexOf("@low");
  const topIdx = report.indexOf("@top");
  const midIdx = report.indexOf("@mid");
  assert.ok(lowIdx >= 0 && topIdx >= 0 && midIdx >= 0);
  assert.ok(lowIdx < topIdx, "@low before @top (same matches, alphabetical tiebreak)");
  assert.ok(topIdx < midIdx, "@top before @mid (2 matches vs 1 match)");
  database.close();
});

test("action today on vacancy older than 30 days", () => {
  const { database } = createFixture();
  setupTestUsers(database);

  const vacId = insertVacancy(database, "telegram_web_preview", "old_but_active", "m1", "unique text d1", daysOffset(FIXED_NOW, -60));
  insertMatch(database, "u1", vacId, daysOffset(FIXED_NOW, -1));
  recordStatusTransition(database, "u1", vacId, "saved", daysOffset(FIXED_NOW, -1));
  recordStatusTransition(database, "u2", vacId, "applied", daysOffset(FIXED_NOW, -1));

  const report = buildChannelReport(database, new Date(FIXED_NOW));
  assert.ok(report.includes("@old_but_active"));
  assert.ok(report.includes("Вакансий: 0"));
  assert.ok(report.includes("Совпадений: 1"));
  assert.ok(report.includes("Сохранено: 1"));
  assert.ok(report.includes("Откликов: 1"));
  database.close();
});

test("vacancies outside the 30-day window are excluded", () => {
  const { database } = createFixture();
  insertVacancy(database, "telegram_web_preview", "old_ch", "m1", "unique text e1", daysOffset(FIXED_NOW, -60));
  const report = buildChannelReport(database, new Date(FIXED_NOW));
  assert.ok(report.includes("Нет данных"));
  assert.ok(!report.includes("@old_ch"));
  database.close();
});

test("future vacancy and future actions are excluded", () => {
  const { database } = createFixture();
  setupTestUsers(database);

  const vacId = insertVacancy(database, "telegram_web_preview", "future_ch", "m1", "unique text f1", daysOffset(FIXED_NOW, 1));
  insertMatch(database, "u1", vacId, daysOffset(FIXED_NOW, 1));
  recordStatusTransition(database, "u1", vacId, "saved", daysOffset(FIXED_NOW, 1));
  recordStatusTransition(database, "u1", vacId, "applied", daysOffset(FIXED_NOW, 1));

  const report = buildChannelReport(database, new Date(FIXED_NOW));
  assert.ok(report.includes("Нет данных"));
  database.close();
});

test("matches, status events, applications outside period do not inflate counts", () => {
  const { database } = createFixture();
  setupTestUsers(database);

  const vacId = insertVacancy(database, "telegram_web_preview", "ch1", "m1", "unique text g1", daysOffset(FIXED_NOW, -1));
  insertMatch(database, "u1", vacId, daysOffset(FIXED_NOW, -60));
  recordStatusTransition(database, "u1", vacId, "saved", daysOffset(FIXED_NOW, -60));
  recordStatusTransition(database, "u1", vacId, "applied", daysOffset(FIXED_NOW, -60));

  const report = buildChannelReport(database, new Date(FIXED_NOW));
  assert.ok(report.includes("Вакансий: 1"));
  assert.ok(report.includes("Совпадений: 0"));
  assert.ok(report.includes("Сохранено: 0"));
  assert.ok(report.includes("Откликов: 0"));
  database.close();
});

test("same source with multiple channels are grouped and counted separately", () => {
  const { database } = createFixture();
  insertVacancy(database, "telegram_web_preview", "ch1", "m1", "unique text h1", daysOffset(FIXED_NOW, -1));
  insertVacancy(database, "telegram_web_preview", "ch2", "m1", "unique text h2", daysOffset(FIXED_NOW, -1));

  const report = buildChannelReport(database, new Date(FIXED_NOW));
  assert.ok(report.includes("@ch1"));
  assert.ok(report.includes("@ch2"));
  assert.ok(report.includes("Вакансий: 1"));
  database.close();
});

test("non-Telegram source does not contain @", () => {
  const { database } = createFixture();
  insertVacancy(database, "hh_api", "hh_query_1", "m1", "unique text i1", daysOffset(FIXED_NOW, -1));
  const report = buildChannelReport(database, new Date(FIXED_NOW));
  assert.ok(!report.includes("@hh_query_1"));
  assert.ok(report.includes("hh_query_1 (hh)"));
  database.close();
});

test("limit of 10 sources is enforced", () => {
  const { database } = createFixture();
  for (let i = 0; i < 15; i++) {
    insertVacancy(database, "telegram_web_preview", `ch${i}`, `m${i}`, `unique text j${i}`, daysOffset(FIXED_NOW, -1));
  }
  const report = buildChannelReport(database, new Date(FIXED_NOW));
  const matches = report.match(/@ch\d+/g);
  assert.ok(matches);
  assert.equal(matches.length, 10);
  database.close();
});

test("sources with zero matches still appear", () => {
  const { database } = createFixture();
  insertVacancy(database, "telegram_web_preview", "quiet", "m1", "unique text k1", daysOffset(FIXED_NOW, -1));
  const report = buildChannelReport(database, new Date(FIXED_NOW));
  assert.ok(report.includes("@quiet"));
  assert.ok(report.includes("Совпадений: 0"));
  database.close();
});

test("status transition leaves both events in report", () => {
  const { database } = createFixture();
  setupTestUsers(database);

  const vacId = insertVacancy(database, "telegram_web_preview", "ch1", "m1", "unique text l1", daysOffset(FIXED_NOW, -1));
  insertMatch(database, "u1", vacId, daysOffset(FIXED_NOW, -1));
  recordStatusTransition(database, "u1", vacId, "saved", daysOffset(FIXED_NOW, -10));
  recordStatusTransition(database, "u1", vacId, "hidden", daysOffset(FIXED_NOW, -1));

  const report = buildChannelReport(database, new Date(FIXED_NOW));
  assert.ok(report.includes("Сохранено: 1"));
  assert.ok(report.includes("Не подошло: 1"));
  database.close();
});

test("deterministic tie-break by channel name", () => {
  const { database } = createFixture();
  setupTestUsers(database);

  const vA = insertVacancy(database, "telegram_web_preview", "zzz_ch", "m1", "unique text m1", daysOffset(FIXED_NOW, -1));
  insertMatch(database, "u1", vA, daysOffset(FIXED_NOW, -1));

  const vB = insertVacancy(database, "telegram_web_preview", "aaa_ch", "m1", "unique text m2", daysOffset(FIXED_NOW, -1));
  insertMatch(database, "u1", vB, daysOffset(FIXED_NOW, -1));

  const report = buildChannelReport(database, new Date(FIXED_NOW));
  const aIdx = report.indexOf("@aaa_ch");
  const zIdx = report.indexOf("@zzz_ch");
  assert.ok(aIdx >= 0 && zIdx >= 0);
  assert.ok(aIdx < zIdx, "@aaa_ch before @zzz_ch (alphabetical tiebreak)");
  database.close();
});

test("report header says 30 days and includes semantics footnote", () => {
  const { database } = createFixture();
  insertVacancy(database, "telegram_web_preview", "ch1", "m1", "unique text n1", daysOffset(FIXED_NOW, -1));
  const report = buildChannelReport(database, new Date(FIXED_NOW));
  assert.ok(report.includes("30 дней"));
  assert.ok(report.includes("история переходов"));
  database.close();
});

test("channelreport handler sends report to owner, denies admin and member", async () => {
  const { database } = createFixture();
  setupTestUsers(database);
  insertVacancy(database, "telegram_web_preview", "ch1", "m1", "unique text o1", daysOffset(FIXED_NOW, -1));
  const now = new Date(FIXED_NOW);

  let repliedText: string | undefined;
  let buildReportCalled = false;

  const trackedBuildReport = (db: VacancyDatabase, n?: Date) => {
    buildReportCalled = true;
    return buildChannelReport(db, n);
  };

  const handler = async (ctxFromId: number): Promise<void> => {
    if (!database.hasOwnerAccess(ctxFromId)) {
      repliedText = "🔒 Этот раздел недоступен.";
      return;
    }
    repliedText = trackedBuildReport(database, now);
  };

  repliedText = undefined;
  buildReportCalled = false;
  await handler(777);
  assert.ok(buildReportCalled, "buildChannelReport must be called for owner");
  const afterOwner = repliedText as string | undefined;
  assert.ok(afterOwner?.includes("@ch1"), "owner must see source data");
  assert.ok(afterOwner?.includes("Производительность источников"), "owner must see report");

  repliedText = undefined;
  buildReportCalled = false;
  await handler(888);
  assert.equal(buildReportCalled, false, "buildChannelReport must NOT be called for admin");
  const afterAdmin = repliedText as string | undefined;
  assert.ok(afterAdmin?.includes("🔒"), "admin must be denied");

  repliedText = undefined;
  buildReportCalled = false;
  await handler(999);
  assert.equal(buildReportCalled, false, "buildChannelReport must NOT be called for member");
  const afterMember = repliedText as string | undefined;
  assert.ok(afterMember?.includes("🔒"), "member must be denied");

  database.close();
});
