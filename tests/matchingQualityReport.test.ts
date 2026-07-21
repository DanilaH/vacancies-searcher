import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import BetterSqlite3 from "better-sqlite3";
import { VacancyDatabase } from "../src/db/database";
import { buildMatchingQualityReport, pluralizeFeedback } from "../src/services/matchingQualityReport";
import { handleQualityReportCommand } from "../src/bot/matchingQualityReportHandler";
import { createTestConfig } from "./helpers";

import type { FilterResult, SourceName } from "../src/types";

function createFixture() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-tg-bot-mqr-"));
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

function setupOwner(database: VacancyDatabase): void {
  database.addOrActivateBotUser("777", "owner", "777");
}

function setupMember(database: VacancyDatabase, userId: string): void {
  database.registerPublicUserIfNeeded(userId);
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

let _msgSeq = 0;

const NOW_REF = new Date("2026-07-22T00:00:00.000Z");

function nowRef(): Date {
  return new Date(NOW_REF.getTime());
}

function daysAgo(n: number): string {
  return new Date(NOW_REF.getTime() - n * 24 * 60 * 60 * 1000).toISOString();
}

function refIso(): string {
  return NOW_REF.toISOString();
}

function insertVacancy(
  database: VacancyDatabase,
  source: SourceName,
  channel: string,
  text: string
): number {
  const messageId = `mqr-${process.pid}-${++_msgSeq}`;
  const result = database.recordMessage(
    {
      source,
      channel,
      messageId,
      date: refIso(),
      text,
      url: `https://t.me/${channel}/${messageId}`
    },
    makeFilterResult(),
    []
  );
  assert.equal(result.kind, "new_vacancy");
  return result.vacancy.id;
}

function createMatch(
  database: VacancyDatabase,
  config: { databasePath: string },
  userId: string,
  vacancyId: number,
  createdAt?: string
): void {
  const ts = createdAt ?? daysAgo(1);
  const conn = new BetterSqlite3(config.databasePath);
  conn.prepare(
    `INSERT INTO user_vacancy_matches (user_id, vacancy_id, score, match_summary, matched_keywords_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(userId, vacancyId, 100, "test", '["test"]', ts, ts);
  conn.close();
}

function getDb(database: VacancyDatabase): ReturnType<typeof database["getDb"]> {
  return (database as unknown as { getDb(): ReturnType<typeof database["getDb"]> }).getDb();
}

// ─── Audit helpers ────────────────────────────────────────────────────────────

function insertAuditCandidate(
  database: VacancyDatabase,
  userId: string,
  vacancyId: number,
  decidedAt: string,
  score: number | null = 0,
  reason: string | null = "test",
  verdict: string | null = null
): void {
  const db = getDb(database);
  db.prepare(
    `INSERT INTO rejected_match_audit (user_id, vacancy_id, resolution, score, reason, decided_at, reviewed_at, verdict)
     VALUES (?, ?, 'rejected', ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, vacancy_id) DO UPDATE SET score = excluded.score, reason = excluded.reason, verdict = excluded.verdict, reviewed_at = excluded.reviewed_at`
  ).run(userId, vacancyId, score, reason, decidedAt, verdict ? nowRef().toISOString() : null, verdict);
}

// ─── Service tests ───────────────────────────────────────────────────────────

test("no matches returns zero report", () => {
  const { config, database } = createFixture();
  setupOwner(database);

  const report = buildMatchingQualityReport(database, "777", 30, nowRef());
  assert.ok(report.includes("Всего подобрано вакансий: 0"));
  assert.ok(report.includes("Вакансий с обратной связью: 0"));
  assert.ok(report.includes("Недостаточно данных для расчёта процентов"));
  assert.ok(report.includes("Сохранено кандидатов: 0"));
  assert.ok(report.includes("Проверено владельцем: 0"));
  assert.ok(report.includes("Метрика рассчитана только по вручную проверенной audit-выборке"));
  database.close();
});

test("data isolation: only the requesting user's data is counted", () => {
  const { config, database } = createFixture();
  setupOwner(database);
  setupMember(database, "u1");
  setupMember(database, "u2");

  const v1 = insertVacancy(database, "telegram_web_preview", "ch1", "text for u1");
  const v2 = insertVacancy(database, "telegram_web_preview", "ch1", "different text for u2");

  createMatch(database, config, "u1", v1);
  createMatch(database, config, "u2", v2);
  database.upsertVacancyRelevanceFeedback("u1", v1, "relevant");
  database.upsertVacancyRelevanceFeedback("u2", v2, "not_relevant");

  const report = buildMatchingQualityReport(database, "u1", 30, nowRef());
  assert.ok(report.includes("Всего подобрано вакансий: 1"));
  assert.ok(report.includes("Вакансий с обратной связью: 1"));
  assert.ok(report.includes("Из них релевантных: 1"));
  assert.ok(report.includes("Из них нерелевантных: 0"));
  database.close();
});

test("counts matches and feedback correctly", () => {
  const { config, database } = createFixture();
  setupOwner(database);
  setupMember(database, "u1");

  const v1 = insertVacancy(database, "telegram_web_preview", "ch1", "a");
  const v2 = insertVacancy(database, "telegram_web_preview", "ch1", "b");
  const v3 = insertVacancy(database, "telegram_web_preview", "ch1", "c");
  const v4 = insertVacancy(database, "telegram_web_preview", "ch1", "d");

  createMatch(database, config, "u1", v1);
  createMatch(database, config, "u1", v2);
  createMatch(database, config, "u1", v3);
  createMatch(database, config, "u1", v4);

  database.upsertVacancyRelevanceFeedback("u1", v1, "relevant");
  database.upsertVacancyRelevanceFeedback("u1", v2, "not_relevant");
  database.upsertVacancyRelevanceFeedback("u1", v3, "relevant");

  const report = buildMatchingQualityReport(database, "u1", 30, nowRef());
  assert.ok(report.includes("Всего подобрано вакансий: 4"));
  assert.ok(report.includes("Вакансий с обратной связью: 3"));
  assert.ok(report.includes("Из них релевантных: 2"));
  assert.ok(report.includes("Из них нерелевантных: 1"));
  database.close();
});

test("uses current feedback value after change", () => {
  const { config, database } = createFixture();
  setupOwner(database);
  setupMember(database, "u1");

  const v1 = insertVacancy(database, "telegram_web_preview", "ch1", "a");
  createMatch(database, config, "u1", v1);
  database.upsertVacancyRelevanceFeedback("u1", v1, "not_relevant");
  database.upsertVacancyRelevanceFeedback("u1", v1, "relevant");

  const report = buildMatchingQualityReport(database, "u1", 30, nowRef());
  assert.ok(report.includes("Из них релевантных: 1"));
  assert.ok(report.includes("Из них нерелевантных: 0"));
  database.close();
});

test("feedback without matching is not counted", () => {
  const { config, database } = createFixture();
  setupOwner(database);
  setupMember(database, "u1");

  const v1 = insertVacancy(database, "telegram_web_preview", "ch1", "orphan");
  database.upsertVacancyRelevanceFeedback("u1", v1, "relevant");

  const report = buildMatchingQualityReport(database, "u1", 30, nowRef());
  assert.ok(report.includes("Всего подобрано вакансий: 0"));
  assert.ok(report.includes("Вакансий с обратной связью: 0"));
  database.close();
});

test("lower boundary: matches at exactly 30 days ago are included", () => {
  const { config, database } = createFixture();
  setupOwner(database);

  const v1 = insertVacancy(database, "telegram_web_preview", "ch1", "boundary");
  const boundaryDate = new Date(nowRef().getTime() - 30 * 24 * 60 * 60 * 1000 + 60_000);
  const db = getDb(database);
  db.prepare(
    `INSERT INTO user_vacancy_matches (user_id, vacancy_id, score, match_summary, matched_keywords_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run("777", v1, 100, "test", '["test"]', boundaryDate.toISOString(), boundaryDate.toISOString());

  const report = buildMatchingQualityReport(database, "777", 30, nowRef());
  assert.ok(report.includes("Всего подобрано вакансий: 1"));
  database.close();
});

test("old matches before the window are excluded", () => {
  const { config, database } = createFixture();
  setupOwner(database);

  const v1 = insertVacancy(database, "telegram_web_preview", "ch1", "old");
  const oldDate = new Date(nowRef().getTime() - 31 * 24 * 60 * 60 * 1000);
  const db = getDb(database);
  db.prepare(
    `INSERT INTO user_vacancy_matches (user_id, vacancy_id, score, match_summary, matched_keywords_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run("777", v1, 100, "test", '["test"]', oldDate.toISOString(), oldDate.toISOString());

  const report = buildMatchingQualityReport(database, "777", 30, nowRef());
  assert.ok(report.includes("Всего подобрано вакансий: 0"));
  database.close();
});

test("future matches are excluded", () => {
  const { config, database } = createFixture();
  setupOwner(database);

  const v1 = insertVacancy(database, "telegram_web_preview", "ch1", "future");
  const futureDate = new Date(nowRef().getTime() + 7 * 24 * 60 * 60 * 1000);
  const db = getDb(database);
  db.prepare(
    `INSERT INTO user_vacancy_matches (user_id, vacancy_id, score, match_summary, matched_keywords_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run("777", v1, 100, "test", '["test"]', futureDate.toISOString(), futureDate.toISOString());

  const report = buildMatchingQualityReport(database, "777", 30, nowRef());
  assert.ok(report.includes("Всего подобрано вакансий: 0"));
  database.close();
});

test("coverage percentage is calculated correctly", () => {
  const { config, database } = createFixture();
  setupOwner(database);

  const v1 = insertVacancy(database, "telegram_web_preview", "ch1", "a");
  const v2 = insertVacancy(database, "telegram_web_preview", "ch1", "b");

  createMatch(database, config, "777", v1);
  createMatch(database, config, "777", v2);
  database.upsertVacancyRelevanceFeedback("777", v1, "relevant");

  const report = buildMatchingQualityReport(database, "777", 30, nowRef());
  assert.ok(report.includes("Покрытие оценками: 50%"), "1/2 = 50% coverage");
  database.close();
});

test("not-relevant share is calculated correctly", () => {
  const { config, database } = createFixture();
  setupOwner(database);

  const v1 = insertVacancy(database, "telegram_web_preview", "ch1", "a");
  const v2 = insertVacancy(database, "telegram_web_preview", "ch1", "b");
  const v3 = insertVacancy(database, "telegram_web_preview", "ch1", "c");

  createMatch(database, config, "777", v1);
  createMatch(database, config, "777", v2);
  createMatch(database, config, "777", v3);
  database.upsertVacancyRelevanceFeedback("777", v1, "not_relevant");
  database.upsertVacancyRelevanceFeedback("777", v2, "not_relevant");
  database.upsertVacancyRelevanceFeedback("777", v3, "relevant");

  const report = buildMatchingQualityReport(database, "777", 30, nowRef());
  assert.ok(report.includes("Доля нерелевантных: 67%"), "2/3 = 67% not-relevant");
  database.close();
});

test("warning shown when feedback count is less than 10", () => {
  const { config, database } = createFixture();
  setupOwner(database);

  const v1 = insertVacancy(database, "telegram_web_preview", "ch1", "a");
  createMatch(database, config, "777", v1);
  database.upsertVacancyRelevanceFeedback("777", v1, "relevant");

  const report = buildMatchingQualityReport(database, "777", 30, nowRef());
  assert.ok(report.includes("⚠️ Мало данных"));
  assert.ok(report.includes("только 1 оценка"));
  database.close();
});

test("no division by zero when there are matches but no feedback", () => {
  const { config, database } = createFixture();
  setupOwner(database);

  const v1 = insertVacancy(database, "telegram_web_preview", "ch1", "a");
  createMatch(database, config, "777", v1);

  const report = buildMatchingQualityReport(database, "777", 30, nowRef());
  assert.ok(report.includes("Всего подобрано вакансий: 1"));
  assert.ok(report.includes("Вакансий с обратной связью: 0"));
  assert.ok(report.includes("Недостаточно данных для расчёта процентов"));
  database.close();
});

test("audit disclaimer is always present", () => {
  const { config, database } = createFixture();
  setupOwner(database);

  const report = buildMatchingQualityReport(database, "777", 30, nowRef());
  assert.ok(report.includes("Метрика рассчитана только по вручную проверенной audit-выборке"));
  database.close();
});

test("coverage is 100% when all matches have feedback", () => {
  const { config, database } = createFixture();
  setupOwner(database);

  const v1 = insertVacancy(database, "telegram_web_preview", "ch1", "a");
  createMatch(database, config, "777", v1);
  database.upsertVacancyRelevanceFeedback("777", v1, "relevant");

  const report = buildMatchingQualityReport(database, "777", 30, nowRef());
  assert.ok(report.includes("Покрытие оценками: 100%"));
  database.close();
});

test("handles only not-relevant feedback", () => {
  const { config, database } = createFixture();
  setupOwner(database);

  const v1 = insertVacancy(database, "telegram_web_preview", "ch1", "a");
  const v2 = insertVacancy(database, "telegram_web_preview", "ch1", "b");

  createMatch(database, config, "777", v1);
  createMatch(database, config, "777", v2);
  database.upsertVacancyRelevanceFeedback("777", v1, "not_relevant");
  database.upsertVacancyRelevanceFeedback("777", v2, "not_relevant");

  const report = buildMatchingQualityReport(database, "777", 30, nowRef());
  assert.ok(report.includes("Из них релевантных: 0"));
  assert.ok(report.includes("Из них нерелевантных: 2"));
  assert.ok(report.includes("Доля нерелевантных: 100%"));
  database.close();
});

test("no warning shown when feedback count is 10 or more", () => {
  const { config, database } = createFixture();
  setupOwner(database);

  for (let i = 0; i < 10; i++) {
    const v = insertVacancy(database, "telegram_web_preview", "ch1", `text ${i}`);
    createMatch(database, config, "777", v);
    database.upsertVacancyRelevanceFeedback("777", v, "relevant");
  }

  const report = buildMatchingQualityReport(database, "777", 30, nowRef());
  assert.ok(!report.includes("⚠️ Мало данных"));
  database.close();
});

// ─── Audit metrics tests ─────────────────────────────────────────────────────

test("audit: all values calculated correctly", () => {
  const { config, database } = createFixture();
  setupOwner(database);

  const v1 = insertVacancy(database, "telegram_web_preview", "ch1", "a");
  const v2 = insertVacancy(database, "telegram_web_preview", "ch1", "b");
  const v3 = insertVacancy(database, "telegram_web_preview", "ch1", "c");

  // Add a match so the first block doesn't show "Недостаточно данных для расчёта процентов"
  createMatch(database, config, "777", v1);
  database.upsertVacancyRelevanceFeedback("777", v1, "relevant");

  insertAuditCandidate(database, "777", v1, daysAgo(2), 10, "reason1", "missed_relevant");
  insertAuditCandidate(database, "777", v2, daysAgo(1), 20, "reason2", "correct_rejection");
  insertAuditCandidate(database, "777", v3, daysAgo(3), null, "reason3", null);

  const report = buildMatchingQualityReport(database, "777", 30, nowRef());
  assert.ok(report.includes("Сохранено кандидатов: 3"));
  assert.ok(report.includes("Проверено владельцем: 2"));
  assert.ok(report.includes("Пропущено релевантных: 1"));
  assert.ok(report.includes("Корректно отклонено: 1"));
  assert.ok(report.includes("Доля пропусков среди проверенных: 50%"));
  assert.ok(!report.includes("Недостаточно данных"));
  database.close();
});

test("audit: no audit records at all", () => {
  const { config, database } = createFixture();
  setupOwner(database);

  const report = buildMatchingQualityReport(database, "777", 30, nowRef());
  assert.ok(report.includes("Сохранено кандидатов: 0"));
  assert.ok(report.includes("Проверено владельцем: 0"));
  assert.ok(report.includes("Недостаточно данных"));
  database.close();
});

test("audit: records without verdict are not counted as reviewed", () => {
  const { config, database } = createFixture();
  setupOwner(database);

  const v1 = insertVacancy(database, "telegram_web_preview", "ch1", "a");
  const v2 = insertVacancy(database, "telegram_web_preview", "ch1", "b");

  insertAuditCandidate(database, "777", v1, daysAgo(2), 10, "reason1", null);
  insertAuditCandidate(database, "777", v2, daysAgo(1), 20, "reason2", "missed_relevant");

  const report = buildMatchingQualityReport(database, "777", 30, nowRef());
  assert.ok(report.includes("Сохранено кандидатов: 2"));
  assert.ok(report.includes("Проверено владельцем: 1"));
  assert.ok(report.includes("Пропущено релевантных: 1"));
  assert.ok(report.includes("Корректно отклонено: 0"));
  database.close();
});

test("audit: both verdicts are counted correctly", () => {
  const { config, database } = createFixture();
  setupOwner(database);

  const v1 = insertVacancy(database, "telegram_web_preview", "ch1", "a");
  const v2 = insertVacancy(database, "telegram_web_preview", "ch1", "b");

  insertAuditCandidate(database, "777", v1, daysAgo(2), 10, "r1", "missed_relevant");
  insertAuditCandidate(database, "777", v2, daysAgo(1), 20, "r2", "correct_rejection");

  const report = buildMatchingQualityReport(database, "777", 30, nowRef());
  assert.ok(report.includes("Пропущено релевантных: 1"));
  assert.ok(report.includes("Корректно отклонено: 1"));
  database.close();
});

test("audit: unknown verdict is not counted as reviewed", () => {
  const { config, database } = createFixture();
  setupOwner(database);

  const v1 = insertVacancy(database, "telegram_web_preview", "ch1", "a");
  const v2 = insertVacancy(database, "telegram_web_preview", "ch1", "b");

  // verdict with unknown value should not be counted
  insertAuditCandidate(database, "777", v1, daysAgo(2), 10, "r1", "missed_relevant");
  insertAuditCandidate(database, "777", v2, daysAgo(1), 20, "r2", "some_unknown_verdict");

  const metrics = database.getAuditQualityMetrics("777", daysAgo(30), nowRef().toISOString());
  assert.equal(metrics.reviewedCount, 1);
  assert.equal(metrics.missedRelevantCount, 1);
  assert.equal(metrics.correctRejectionCount, 0);

  database.close();
});

test("audit: isolation from other users", () => {
  const { config, database } = createFixture();
  setupOwner(database);
  setupMember(database, "u1");

  const v1 = insertVacancy(database, "telegram_web_preview", "ch1", "a");
  const v2 = insertVacancy(database, "telegram_web_preview", "ch1", "b");

  insertAuditCandidate(database, "777", v1, daysAgo(2), 10, "r1", "missed_relevant");
  insertAuditCandidate(database, "u1", v2, daysAgo(1), 20, "r2", "missed_relevant");

  const report = buildMatchingQualityReport(database, "777", 30, nowRef());
  assert.ok(report.includes("Сохранено кандидатов: 1"));
  assert.ok(report.includes("Проверено владельцем: 1"));
  assert.ok(report.includes("Пропущено релевантных: 1"));

  database.close();
});

test("audit: lower boundary — records at exactly 30 days ago are included", () => {
  const { config, database: db } = createFixture();
  setupOwner(db);

  const dbRaw = getDb(db);
  const v1 = insertVacancy(db, "telegram_web_preview", "ch1", "a");
  const boundaryDate = new Date(nowRef().getTime() - 30 * 24 * 60 * 60 * 1000 + 60_000).toISOString();
  dbRaw.prepare(
    `INSERT INTO rejected_match_audit (user_id, vacancy_id, resolution, score, reason, decided_at, reviewed_at, verdict)
     VALUES (?, ?, 'rejected', ?, ?, ?, ?, ?)`
  ).run("777", v1, 0, "test", boundaryDate, nowRef().toISOString(), "missed_relevant");

  const report = buildMatchingQualityReport(db, "777", 30, nowRef());
  assert.ok(report.includes("Сохранено кандидатов: 1"));
  assert.ok(report.includes("Пропущено релевантных: 1"));

  db.close();
});

test("audit: old records before the window are excluded", () => {
  const { config, database: db } = createFixture();
  setupOwner(db);

  const dbRaw = getDb(db);
  const v1 = insertVacancy(db, "telegram_web_preview", "ch1", "a");
  const oldDate = new Date(nowRef().getTime() - 31 * 24 * 60 * 60 * 1000).toISOString();
  dbRaw.prepare(
    `INSERT INTO rejected_match_audit (user_id, vacancy_id, resolution, score, reason, decided_at, reviewed_at, verdict)
     VALUES (?, ?, 'rejected', ?, ?, ?, ?, ?)`
  ).run("777", v1, 0, "test", oldDate, nowRef().toISOString(), "missed_relevant");

  const report = buildMatchingQualityReport(db, "777", 30, nowRef());
  assert.ok(report.includes("Сохранено кандидатов: 0"));

  db.close();
});

test("audit: future records are excluded", () => {
  const { config, database: db } = createFixture();
  setupOwner(db);

  const dbRaw = getDb(db);
  const v1 = insertVacancy(db, "telegram_web_preview", "ch1", "a");
  const futureDate = new Date(nowRef().getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  dbRaw.prepare(
    `INSERT INTO rejected_match_audit (user_id, vacancy_id, resolution, score, reason, decided_at, reviewed_at, verdict)
     VALUES (?, ?, 'rejected', ?, ?, ?, ?, ?)`
  ).run("777", v1, 0, "test", futureDate, nowRef().toISOString(), "missed_relevant");

  const report = buildMatchingQualityReport(db, "777", 30, nowRef());
  assert.ok(report.includes("Сохранено кандидатов: 0"));

  db.close();
});

test("audit: no division by zero when reviewed count is 0", () => {
  const { config, database } = createFixture();
  setupOwner(database);

  const v1 = insertVacancy(database, "telegram_web_preview", "ch1", "a");
  insertAuditCandidate(database, "777", v1, daysAgo(2), 10, "reason", null);

  const report = buildMatchingQualityReport(database, "777", 30, nowRef());
  assert.ok(report.includes("Сохранено кандидатов: 1"));
  assert.ok(report.includes("Проверено владельцем: 0"));
  assert.ok(report.includes("Недостаточно данных"));
  assert.ok(!report.includes("Доля пропусков"));
  database.close();
});

test("audit: warning when reviewed count is less than 10", () => {
  const { config, database } = createFixture();
  setupOwner(database);

  const v1 = insertVacancy(database, "telegram_web_preview", "ch1", "a");
  insertAuditCandidate(database, "777", v1, daysAgo(2), 10, "r1", "missed_relevant");

  const report = buildMatchingQualityReport(database, "777", 30, nowRef());
  assert.ok(report.includes("⚠️ Мало данных"));
  database.close();
});

test("audit: no warning when reviewed count is 10 or more", () => {
  const { config, database } = createFixture();
  setupOwner(database);

  for (let i = 0; i < 10; i++) {
    const v = insertVacancy(database, "telegram_web_preview", "ch1", `audit ${i}`);
    insertAuditCandidate(database, "777", v, daysAgo(2), 10 + i, `reason ${i}`, "missed_relevant");
  }

  const report = buildMatchingQualityReport(database, "777", 30, nowRef());
  assert.ok(!report.includes("⚠️ Мало данных"));
  database.close();
});

test("audit: exact disclaimer text", () => {
  const { config, database } = createFixture();
  setupOwner(database);

  const report = buildMatchingQualityReport(database, "777", 30, nowRef());
  assert.ok(report.includes("Метрика рассчитана только по вручную проверенной audit-выборке и не является полным false-negative rate."));
  database.close();
});

test("regression: report is deterministic regardless of real system clock", () => {
  const { config, database } = createFixture();
  setupOwner(database);

  // Use a now far in the past to prove the test doesn't depend on Date.now()
  const farPast = new Date("2020-01-15T12:00:00.000Z");

  // All data relative to that farPast now
  function pastDaysAgo(n: number): string {
    return new Date(farPast.getTime() - n * 24 * 60 * 60 * 1000).toISOString();
  }

  const v1 = insertVacancy(database, "telegram_web_preview", "ch1", "past a");
  const v2 = insertVacancy(database, "telegram_web_preview", "ch1", "past b");
  const v3 = insertVacancy(database, "telegram_web_preview", "ch1", "past c");

  createMatch(database, config, "777", v1, pastDaysAgo(5));
  createMatch(database, config, "777", v2, pastDaysAgo(4));
  createMatch(database, config, "777", v3, pastDaysAgo(3));
  database.upsertVacancyRelevanceFeedback("777", v1, "relevant");
  database.upsertVacancyRelevanceFeedback("777", v2, "not_relevant");

  insertAuditCandidate(database, "777", v1, pastDaysAgo(2), 10, "reason1", "missed_relevant");
  insertAuditCandidate(database, "777", v2, pastDaysAgo(1), 20, "reason2", "correct_rejection");

  const report = buildMatchingQualityReport(database, "777", 30, farPast);

  // Matching block
  assert.ok(report.includes("Всего подобрано вакансий: 3"));
  assert.ok(report.includes("Вакансий с обратной связью: 2"));
  assert.ok(report.includes("Из них релевантных: 1"));
  assert.ok(report.includes("Из них нерелевантных: 1"));

  // Audit block
  assert.ok(report.includes("Сохранено кандидатов: 2"));
  assert.ok(report.includes("Проверено владельцем: 2"));
  assert.ok(report.includes("Пропущено релевантных: 1"));
  assert.ok(report.includes("Корректно отклонено: 1"));
  assert.ok(report.includes("Доля пропусков среди проверенных: 50%"));
  database.close();
});

// ─── Pluralize feedback tests ────────────────────────────────────────────────

test("pluralizeFeedback: 1 -> оценка", () => {
  assert.equal(pluralizeFeedback(1), "оценка");
});

test("pluralizeFeedback: 2 -> оценки", () => {
  assert.equal(pluralizeFeedback(2), "оценки");
});

test("pluralizeFeedback: 5 -> оценок", () => {
  assert.equal(pluralizeFeedback(5), "оценок");
});

test("pluralizeFeedback: 11 -> оценок", () => {
  assert.equal(pluralizeFeedback(11), "оценок");
});

test("pluralizeFeedback: 21 -> оценка", () => {
  assert.equal(pluralizeFeedback(21), "оценка");
});

// ─── Handler-level tests ─────────────────────────────────────────────────────

test("handler: owner gets report, member is denied", async () => {
  const { config, database } = createFixture();
  database.addOrActivateBotUser("777", "owner", "777");
  database.addOrActivateBotUser("999", "member", "777");

  const grammy = await import("grammy");
  const bot = new grammy.Bot("test-token", {
    botInfo: {
      id: 123456, is_bot: true, first_name: "TestBot", username: "test_bot",
      can_join_groups: false, can_read_all_group_messages: false,
      can_manage_bots: false, supports_inline_queries: false,
      can_connect_to_business: false, has_main_web_app: false,
      has_topics_enabled: false, allows_users_to_create_topics: false
    }
  });

  let lastReplyText: string | undefined;

  bot.api.config.use((prev, method, payload) => {
    if (method === "sendMessage") {
      lastReplyText = (payload as Record<string, unknown>).text as string | undefined;
      return Promise.resolve({ ok: true, result: { message_id: 1 } }) as never;
    }
    return prev(method, payload);
  });

  bot.command("qualityreport", async (ctx) => {
    await handleQualityReportCommand(ctx, database);
  });

  async function makeUpdate(fromId: number) {
    return {
      update_id: fromId,
      message: {
        message_id: 1,
        date: Math.floor(Date.now() / 1000),
        text: "/qualityreport",
        chat: { id: fromId, type: "private" as const, first_name: "Test" },
        from: { id: fromId, is_bot: false, first_name: "Test", language_code: "en" },
        entities: [{ offset: 0, length: 14, type: "bot_command" as const }]
      }
    };
  }

  lastReplyText = undefined;
  await bot.handleUpdate(await makeUpdate(777));
  const ownerText: string = lastReplyText ?? "";
  assert.ok(ownerText.includes("Качество матчинга"), "owner must see the report");
  assert.ok(ownerText.includes("Проверка отклонённых вакансий"), "owner must see audit block");
  assert.ok(!ownerText.includes("Команда доступна только владельцу"), "owner must not see the denial");

  lastReplyText = undefined;
  await bot.handleUpdate(await makeUpdate(999));
  const memberText: string = lastReplyText ?? "";
  assert.equal(memberText, "Команда доступна только владельцу", "member must be denied with exact text");

  database.close();
});

test("handler: real /qualityreport response includes audit block", async () => {
  const { config, database } = createFixture();
  database.addOrActivateBotUser("777", "owner", "777");

  const v1 = insertVacancy(database, "telegram_web_preview", "ch1", "real handler test");
  insertAuditCandidate(database, "777", v1, daysAgo(2), 15, "reason_abc", "missed_relevant");

  const grammy = await import("grammy");
  const bot = new grammy.Bot("test-token", {
    botInfo: {
      id: 123456, is_bot: true, first_name: "TestBot", username: "test_bot",
      can_join_groups: false, can_read_all_group_messages: false,
      can_manage_bots: false, supports_inline_queries: false,
      can_connect_to_business: false, has_main_web_app: false,
      has_topics_enabled: false, allows_users_to_create_topics: false
    }
  });

  let lastReplyText: string | undefined;
  bot.api.config.use((_prev, method, payload) => {
    if (method === "sendMessage") {
      lastReplyText = (payload as Record<string, unknown>).text as string | undefined;
      return Promise.resolve({ ok: true, result: { message_id: 1 } }) as never;
    }
    return Promise.resolve({ ok: true, result: {} }) as never;
  });

  bot.command("qualityreport", async (ctx) => {
    await handleQualityReportCommand(ctx, database);
  });

  await bot.handleUpdate({
    update_id: 1,
    message: {
      message_id: 1,
      date: Math.floor(Date.now() / 1000),
      text: "/qualityreport",
      chat: { id: 777, type: "private" as const, first_name: "Owner" },
      from: { id: 777, is_bot: false, first_name: "Owner", language_code: "en" },
      entities: [{ offset: 0, length: 14, type: "bot_command" as const }]
    }
  });

  const text: string = lastReplyText ?? "";
  assert.ok(text.includes("Качество матчинга"));
  assert.ok(text.includes("Проверка отклонённых вакансий"));
  assert.ok(text.includes("Сохранено кандидатов: 1"));
  assert.ok(text.includes("Пропущено релевантных: 1"));
  assert.ok(text.includes("Метрика рассчитана только по вручную проверенной audit-выборке"));

  database.close();
});
