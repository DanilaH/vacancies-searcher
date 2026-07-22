import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import BetterSqlite3 from "better-sqlite3";
import type * as grammy from "grammy";

import type { VacancyDatabase } from "../src/db/database";
import { buildFuzzyDedupReport } from "../src/services/fuzzyDedupReport";
import { handleFuzzyDedupReportCommand } from "../src/bot/fuzzyDedupReportHandler";
import { createTestConfig } from "./helpers";

const OWNER_ID = "777";

interface VacancyInsert {
  id: number;
  sourceName: string;
  sourceChannel: string;
}

function createDb(): { database: VacancyDatabase; sqlite: BetterSqlite3.Database; tempDir: string } {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-tg-bot-fuzzy-report-"));
  const databasePath = path.join(tempDir, "bot.db");
  const config = createTestConfig({
    ownerUserId: OWNER_ID,
    ownerChatId: OWNER_ID,
    databasePath,
    databaseUrl: `file:${databasePath}`,
    appDataDir: tempDir,
    runtimeDir: path.join(tempDir, "runtime")
  });
  const database = new (require("../src/db/database").VacancyDatabase)(config);
  database.initialize();
  const sqlite = new BetterSqlite3(databasePath);
  return { database, sqlite, tempDir };
}

function insertVacancy(sqlite: BetterSqlite3.Database, sourceName: string, sourceChannel: string, daysAgo: number): VacancyInsert {
  const date = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
  const result = sqlite
    .prepare(
      `INSERT INTO vacancies (source_name, source_channel, source_message_id, message_date, title, text, normalized_text, url, fingerprint, score, match_summary, matched_keywords_json, contacts_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'Test Title', 'Some text about the job', 'some text about the job', 'https://example.com/vacancy', 'test-fp', 0, '', '[]', '[]', ?, ?)`
    )
    .run(sourceName, sourceChannel, `msg-${Date.now()}-${Math.random()}`, date, date, date);
  return { id: Number(result.lastInsertRowid), sourceName, sourceChannel };
}

function insertFuzzyLink(sqlite: BetterSqlite3.Database, a: number, b: number, score: number, daysAgo: number): void {
  const [first, second] = a < b ? [a, b] : [b, a];
  const date = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
  sqlite
    .prepare("INSERT INTO vacancy_fuzzy_duplicates (vacancy_id, duplicate_vacancy_id, score, reasons_json, created_at) VALUES (?, ?, ?, '[]', ?)")
    .run(first, second, score, date);
}

function closeAndClean(db: VacancyDatabase, sqlite: BetterSqlite3.Database, tempDir: string): void {
  sqlite.close();
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}

// ─── Aggregate stats tests ───────────────────────────────────────────────

test("empty database produces zero-state report", () => {
  const { database, sqlite, tempDir } = createDb();
  try {
    const report = buildFuzzyDedupReport(database, 30);
    assert.ok(report.includes("Нет данных о fuzzy-связях"));
    const stats = database.getFuzzyDedupStats(new Date(0).toISOString());
    assert.equal(stats.totalLinks, 0);
    assert.equal(stats.totalGroups, 0);
    assert.equal(stats.averageScore, null);
    assert.equal(stats.lastMatchDate, null);
  } finally {
    closeAndClean(database, sqlite, tempDir);
  }
});

test("single fuzzy link produces correct stats", () => {
  const { database, sqlite, tempDir } = createDb();
  try {
    const v1 = insertVacancy(sqlite, "tg", "ch1", 1);
    const v2 = insertVacancy(sqlite, "tg", "ch2", 1);
    insertFuzzyLink(sqlite, v1.id, v2.id, 0.65, 1);

    const stats = database.getFuzzyDedupStats(new Date(0).toISOString());
    assert.equal(stats.totalLinks, 1);
    assert.equal(stats.totalGroups, 1);
    assert.equal(stats.averageScore, 0.65);
    assert.equal(stats.minScore, 0.65);
    assert.equal(stats.maxScore, 0.65);
    assert.ok(stats.lastMatchDate !== null);
  } finally {
    closeAndClean(database, sqlite, tempDir);
  }
});

test("multiple links in same group merge into one group", () => {
  const { database, sqlite, tempDir } = createDb();
  try {
    const v1 = insertVacancy(sqlite, "tg", "ch1", 1);
    const v2 = insertVacancy(sqlite, "tg", "ch1", 1);
    const v3 = insertVacancy(sqlite, "tg", "ch1", 1);
    insertFuzzyLink(sqlite, v1.id, v2.id, 0.7, 1);
    insertFuzzyLink(sqlite, v1.id, v3.id, 0.6, 1);

    const stats = database.getFuzzyDedupStats(new Date(0).toISOString());
    assert.equal(stats.totalLinks, 2);
    assert.equal(stats.totalGroups, 1, "Two links in same group => 1 group");
    assert.equal(stats.groupSizeDistribution.find((g) => g.sizeLabel === "3")?.count, 1);
  } finally {
    closeAndClean(database, sqlite, tempDir);
  }
});

test("multiple independent groups are counted separately", () => {
  const { database, sqlite, tempDir } = createDb();
  try {
    const v1 = insertVacancy(sqlite, "tg", "ch1", 1);
    const v2 = insertVacancy(sqlite, "tg", "ch2", 1);
    const v3 = insertVacancy(sqlite, "hh", "hhru", 1);
    const v4 = insertVacancy(sqlite, "hh", "hhru", 1);
    insertFuzzyLink(sqlite, v1.id, v2.id, 0.8, 1);
    insertFuzzyLink(sqlite, v3.id, v4.id, 0.5, 1);

    const stats = database.getFuzzyDedupStats(new Date(0).toISOString());
    assert.equal(stats.totalLinks, 2);
    assert.equal(stats.totalGroups, 2, "Two independent pairs => 2 groups");
  } finally {
    closeAndClean(database, sqlite, tempDir);
  }
});

test("transitive group A-B-C forms one group", () => {
  const { database, sqlite, tempDir } = createDb();
  try {
    const v1 = insertVacancy(sqlite, "tg", "ch1", 1);
    const v2 = insertVacancy(sqlite, "tg", "ch1", 1);
    const v3 = insertVacancy(sqlite, "tg", "ch1", 1);
    insertFuzzyLink(sqlite, v1.id, v2.id, 0.8, 1);
    insertFuzzyLink(sqlite, v2.id, v3.id, 0.6, 1);

    const stats = database.getFuzzyDedupStats(new Date(0).toISOString());
    assert.equal(stats.totalLinks, 2);
    assert.equal(stats.totalGroups, 1, "Transitive A-B-C => 1 group");
    assert.equal(stats.groupSizeDistribution.find((g) => g.sizeLabel === "3")?.count, 1);
  } finally {
    closeAndClean(database, sqlite, tempDir);
  }
});

test("score buckets are correctly assigned", () => {
  const { database, sqlite, tempDir } = createDb();
  try {
    const v1 = insertVacancy(sqlite, "tg", "ch1", 1);
    const v2 = insertVacancy(sqlite, "tg", "ch1", 1);
    const v3 = insertVacancy(sqlite, "tg", "ch1", 1);
    const v4 = insertVacancy(sqlite, "tg", "ch1", 1);
    const v5 = insertVacancy(sqlite, "tg", "ch1", 1);
    insertFuzzyLink(sqlite, v1.id, v2.id, 0.4, 1);
    insertFuzzyLink(sqlite, v1.id, v3.id, 0.6, 1);
    insertFuzzyLink(sqlite, v1.id, v4.id, 0.75, 1);
    insertFuzzyLink(sqlite, v1.id, v5.id, 0.9, 1);

    const stats = database.getFuzzyDedupStats(new Date(0).toISOString());
    assert.equal(stats.scoreBuckets.length, 4);
    const getBucket = (label: string) => stats.scoreBuckets.find((b) => b.label === label)?.count ?? 0;
    assert.equal(getBucket("0.35\u20130.49"), 1);
    assert.equal(getBucket("0.50\u20130.69"), 1);
    assert.equal(getBucket("0.70\u20130.84"), 1);
    assert.equal(getBucket("0.85\u20131.00"), 1);
  } finally {
    closeAndClean(database, sqlite, tempDir);
  }
});

test("group size distribution for 2, 3, 4+", () => {
  const { database, sqlite, tempDir } = createDb();
  try {
    const v1 = insertVacancy(sqlite, "tg", "ch1", 1);
    const v2 = insertVacancy(sqlite, "tg", "ch1", 1);
    const v3 = insertVacancy(sqlite, "tg", "ch1", 1);
    const v4 = insertVacancy(sqlite, "tg", "ch1", 1);
    const v5 = insertVacancy(sqlite, "tg", "ch1", 1);
    const v6 = insertVacancy(sqlite, "tg", "ch1", 1);
    const v7 = insertVacancy(sqlite, "tg", "ch1", 1);
    const v8 = insertVacancy(sqlite, "tg", "ch1", 1);
    const v9 = insertVacancy(sqlite, "tg", "ch1", 1);
    insertFuzzyLink(sqlite, v1.id, v2.id, 0.5, 1);
    insertFuzzyLink(sqlite, v3.id, v4.id, 0.5, 1);
    insertFuzzyLink(sqlite, v4.id, v5.id, 0.5, 1);
    insertFuzzyLink(sqlite, v6.id, v7.id, 0.5, 1);
    insertFuzzyLink(sqlite, v7.id, v8.id, 0.5, 1);
    insertFuzzyLink(sqlite, v8.id, v9.id, 0.5, 1);

    const stats = database.getFuzzyDedupStats(new Date(0).toISOString());
    assert.equal(stats.groupSizeDistribution.find((g) => g.sizeLabel === "2")?.count, 1);
    assert.equal(stats.groupSizeDistribution.find((g) => g.sizeLabel === "3")?.count, 1);
    assert.equal(stats.groupSizeDistribution.find((g) => g.sizeLabel === "4+")?.count, 1);
    assert.equal(stats.totalLinks, 6);
    assert.equal(stats.totalGroups, 3);
  } finally {
    closeAndClean(database, sqlite, tempDir);
  }
});

test("records older than 30 days are excluded", () => {
  const { database, sqlite, tempDir } = createDb();
  try {
    const v1 = insertVacancy(sqlite, "tg", "ch1", 35);
    const v2 = insertVacancy(sqlite, "tg", "ch1", 35);
    const v3 = insertVacancy(sqlite, "tg", "ch1", 1);
    const v4 = insertVacancy(sqlite, "tg", "ch1", 1);
    insertFuzzyLink(sqlite, v1.id, v2.id, 0.8, 35);
    insertFuzzyLink(sqlite, v3.id, v4.id, 0.6, 1);

    const stats = database.getFuzzyDedupStats(new Date(0).toISOString());
    assert.equal(stats.totalLinks, 2, "Both links within all-time range");

    const recentStats = database.getFuzzyDedupStats(
      new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString()
    );
    assert.equal(recentStats.totalLinks, 1, "Only recent link within 20-day window");
    assert.equal(recentStats.totalGroups, 1);
  } finally {
    closeAndClean(database, sqlite, tempDir);
  }
});

test("top source/channel pairs are ranked by link count", () => {
  const { database, sqlite, tempDir } = createDb();
  try {
    const v1 = insertVacancy(sqlite, "tg", "ch1", 1);
    const v2 = insertVacancy(sqlite, "tg", "ch1", 1);
    const v3 = insertVacancy(sqlite, "tg", "ch1", 1);
    const v4 = insertVacancy(sqlite, "hh", "hhru", 1);
    const v5 = insertVacancy(sqlite, "hh", "hhru", 1);
    insertFuzzyLink(sqlite, v1.id, v2.id, 0.5, 1);
    insertFuzzyLink(sqlite, v1.id, v3.id, 0.5, 1);
    insertFuzzyLink(sqlite, v4.id, v5.id, 0.7, 1);

    const stats = database.getFuzzyDedupStats(new Date(0).toISOString());
    assert.equal(stats.topSourceChannelPairs.length, 2);
    assert.equal(stats.topSourceChannelPairs[0]!.sourceName, "tg");
    assert.equal(stats.topSourceChannelPairs[0]!.linkCount, 4, "Two links, each counted from both sides => 4");
    assert.equal(stats.topSourceChannelPairs[1]!.linkCount, 2, "One link, both sides counted => 2");
  } finally {
    closeAndClean(database, sqlite, tempDir);
  }
});

// ─── Handler access tests ────────────────────────────────────────────────

test("owner receives the fuzzy dedup report", async () => {
  const { database, sqlite, tempDir } = createDb();
  try {
    const v1 = insertVacancy(sqlite, "tg", "ch1", 1);
    const v2 = insertVacancy(sqlite, "tg", "ch1", 1);
    insertFuzzyLink(sqlite, v1.id, v2.id, 0.55, 1);

    let replyText = "";
    const ctx = {
      from: { id: 777, is_bot: false, first_name: "Owner" },
      reply: async (text: string) => { replyText = text; }
    } as unknown as grammy.Context;

    await handleFuzzyDedupReportCommand(ctx, database);
    assert.ok(replyText.includes("Всего связей: 1"), "Owner receives report with link count");
    assert.ok(replyText.includes("Средний score"));
  } finally {
    closeAndClean(database, sqlite, tempDir);
  }
});

test("admin does not receive the report", async () => {
  const { database, sqlite, tempDir } = createDb();
  try {
    let replyText = "";
    const ctx = {
      from: { id: 111, is_bot: false, first_name: "Admin" },
      reply: async (text: string) => { replyText = text; }
    } as unknown as grammy.Context;

    sqlite.prepare("INSERT OR IGNORE INTO bot_users (user_id, role, is_active, created_at, updated_at) VALUES ('111', 'admin', 1, datetime('now'), datetime('now'))").run();
    await handleFuzzyDedupReportCommand(ctx, database);
    assert.ok(replyText.includes("🔒"), "Admin sees access denied");
  } finally {
    closeAndClean(database, sqlite, tempDir);
  }
});

test("member does not receive the report", async () => {
  const { database, sqlite, tempDir } = createDb();
  try {
    let replyText = "";
    const ctx = {
      from: { id: 222, is_bot: false, first_name: "Member" },
      reply: async (text: string) => { replyText = text; }
    } as unknown as grammy.Context;

    sqlite.prepare("INSERT OR IGNORE INTO bot_users (user_id, role, is_active, created_at, updated_at) VALUES ('222', 'member', 1, datetime('now'), datetime('now'))").run();
    await handleFuzzyDedupReportCommand(ctx, database);
    assert.ok(replyText.includes("🔒"), "Member sees access denied");
  } finally {
    closeAndClean(database, sqlite, tempDir);
  }
});

test("cross-source link counts both sides correctly", () => {
  const { database, sqlite, tempDir } = createDb();
  try {
    const v1 = insertVacancy(sqlite, "telegram_web_preview", "frontend_channel", 1);
    const v2 = insertVacancy(sqlite, "hh_api", "hhru", 1);
    insertFuzzyLink(sqlite, v1.id, v2.id, 0.65, 1);

    const stats = database.getFuzzyDedupStats(new Date(0).toISOString());
    const tgPair = stats.topSourceChannelPairs.find((p) => p.sourceChannel === "frontend_channel");
    const hhPair = stats.topSourceChannelPairs.find((p) => p.sourceChannel === "hhru");
    assert.ok(tgPair, "Telegram source appears in top pairs");
    assert.ok(hhPair, "hh.ru source appears in top pairs");
    assert.equal(tgPair!.linkCount, 1, "Telegram side counted once");
    assert.equal(hhPair!.linkCount, 1, "hh.ru side counted once");
  } finally {
    closeAndClean(database, sqlite, tempDir);
  }
});

test("score buckets zero-fill missing ranges", () => {
  const { database, sqlite, tempDir } = createDb();
  try {
    const v1 = insertVacancy(sqlite, "tg", "ch1", 1);
    const v2 = insertVacancy(sqlite, "tg", "ch1", 1);
    insertFuzzyLink(sqlite, v1.id, v2.id, 0.6, 1);

    const stats = database.getFuzzyDedupStats(new Date(0).toISOString());
    assert.equal(stats.scoreBuckets.length, 4, "All 4 buckets present");
    const getBucket = (label: string) => stats.scoreBuckets.find((b) => b.label === label)?.count ?? -1;
    assert.equal(getBucket("0.35\u20130.49"), 0, "Empty bucket is zero");
    assert.equal(getBucket("0.50\u20130.69"), 1, "Populated bucket has 1");
    assert.equal(getBucket("0.70\u20130.84"), 0, "Empty bucket is zero");
    assert.equal(getBucket("0.85\u20131.00"), 0, "Empty bucket is zero");
    const sum = stats.scoreBuckets.reduce((a, b) => a + b.count, 0);
    assert.equal(sum, stats.totalLinks, "Bucket sum equals totalLinks");
  } finally {
    closeAndClean(database, sqlite, tempDir);
  }
});

test("score bucket boundaries at 0.35, 0.50, 0.70, 0.85, 1.00", () => {
  const { database, sqlite, tempDir } = createDb();
  try {
    const v1 = insertVacancy(sqlite, "tg", "ch1", 1);
    const v2 = insertVacancy(sqlite, "tg", "ch1", 1);
    const v3 = insertVacancy(sqlite, "tg", "ch1", 1);
    const v4 = insertVacancy(sqlite, "tg", "ch1", 1);
    const v5 = insertVacancy(sqlite, "tg", "ch1", 1);
    insertFuzzyLink(sqlite, v1.id, v2.id, 0.35, 1);
    insertFuzzyLink(sqlite, v1.id, v3.id, 0.5, 1);
    insertFuzzyLink(sqlite, v1.id, v4.id, 0.7, 1);
    insertFuzzyLink(sqlite, v1.id, v5.id, 0.85, 1);

    const stats = database.getFuzzyDedupStats(new Date(0).toISOString());
    assert.equal(stats.scoreBuckets.length, 4);
    const getBucket = (label: string) => stats.scoreBuckets.find((b) => b.label === label)?.count ?? 0;
    assert.equal(getBucket("0.35\u20130.49"), 1, "0.35 is in 0.35-0.49");
    assert.equal(getBucket("0.50\u20130.69"), 1, "0.50 is in 0.50-0.69");
    assert.equal(getBucket("0.70\u20130.84"), 1, "0.70 is in 0.70-0.84");
    assert.equal(getBucket("0.85\u20131.00"), 1, "0.85 is in 0.85-1.00");
    const sum = stats.scoreBuckets.reduce((a, b) => a + b.count, 0);
    assert.equal(sum, stats.totalLinks, "Bucket sum equals totalLinks");
  } finally {
    closeAndClean(database, sqlite, tempDir);
  }
});

test("last match date with SQLite format", () => {
  const { database, sqlite, tempDir } = createDb();
  try {
    const v1 = insertVacancy(sqlite, "tg", "ch1", 1);
    const v2 = insertVacancy(sqlite, "tg", "ch1", 1);
    sqlite
      .prepare("INSERT INTO vacancy_fuzzy_duplicates (vacancy_id, duplicate_vacancy_id, score, reasons_json, created_at) VALUES (?, ?, 0.5, '[]', '2026-07-20 14:30:00')")
      .run(v1.id, v2.id);

    const stats = database.getFuzzyDedupStats(new Date(0).toISOString());
    assert.equal(stats.lastMatchDate, "2026-07-20 14:30:00");

    const report = buildFuzzyDedupReport(database, 30);
    assert.ok(report.includes("20.07.2026"), "Date formatted correctly from SQLite format");
    assert.ok(!report.includes("NaN"), "No NaN in report");
  } finally {
    closeAndClean(database, sqlite, tempDir);
  }
});

test("last match date with ISO Z format", () => {
  const { database, sqlite, tempDir } = createDb();
  try {
    const v1 = insertVacancy(sqlite, "tg", "ch1", 1);
    const v2 = insertVacancy(sqlite, "tg", "ch1", 1);
    sqlite
      .prepare("INSERT INTO vacancy_fuzzy_duplicates (vacancy_id, duplicate_vacancy_id, score, reasons_json, created_at) VALUES (?, ?, 0.5, '[]', '2026-07-20T14:30:00.000Z')")
      .run(v1.id, v2.id);

    const stats = database.getFuzzyDedupStats(new Date(0).toISOString());
    assert.equal(stats.lastMatchDate, "2026-07-20T14:30:00.000Z");

    const report = buildFuzzyDedupReport(database, 30);
    assert.ok(report.includes("20.07.2026"), "Date formatted correctly from ISO Z format");
    assert.ok(!report.includes("NaN"), "No NaN in report");
  } finally {
    closeAndClean(database, sqlite, tempDir);
  }
});

test("boundary group size with old link A-B and new link B-C", () => {
  const { database, sqlite, tempDir } = createDb();
  try {
    const v1 = insertVacancy(sqlite, "tg", "ch1", 35);
    const v2 = insertVacancy(sqlite, "tg", "ch1", 35);
    const v3 = insertVacancy(sqlite, "tg", "ch1", 1);
    insertFuzzyLink(sqlite, v1.id, v2.id, 0.5, 35);
    insertFuzzyLink(sqlite, v2.id, v3.id, 0.6, 1);

    const stats = database.getFuzzyDedupStats(
      new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString()
    );
    assert.equal(stats.totalLinks, 1, "Only the new link counted in totalLinks");
    assert.equal(stats.totalGroups, 1, "One group touched by new link");
    assert.equal(stats.groupSizeDistribution.find((g) => g.sizeLabel === "3")?.count, 1, "Full group size is 3 (A-B-C)");
    assert.equal(stats.groupSizeDistribution.find((g) => g.sizeLabel === "2")?.count, 0, "No group of size 2");
  } finally {
    closeAndClean(database, sqlite, tempDir);
  }
});

test("report does not contain vacancy text, contacts, or user IDs", () => {
  const { database, sqlite, tempDir } = createDb();
  try {
    const uniqueTitle = "Senior Rust Developer XYZ123";
    const uniqueText = "This is a confidential job description with salary details ABC789";
    const contact = "@rust_recruiter";
    const email = "hr@rustcorp.example.com";
    const url = "https://rustcorp.example.com/jobs/apply?token=secret123";
    const userId = "777";

    const date = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
    sqlite
      .prepare(
        `INSERT INTO vacancies (source_name, source_channel, source_message_id, message_date, title, text, normalized_text, url, fingerprint, score, match_summary, matched_keywords_json, contacts_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'test-fp', 0, '', '[]', ?, ?, ?)`
      )
      .run("tg", "ch1", `privacy-msg1`, date, uniqueTitle, uniqueText, uniqueText.toLowerCase(), url, JSON.stringify([contact, email]), date, date);
    const v1 = Number((sqlite.prepare("SELECT last_insert_rowid() AS id").get() as { id: number }).id);
    sqlite
      .prepare(
        `INSERT INTO vacancies (source_name, source_channel, source_message_id, message_date, title, text, normalized_text, url, fingerprint, score, match_summary, matched_keywords_json, contacts_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'test-fp', 0, '', '[]', ?, ?, ?)`
      )
      .run("tg", "ch2", `privacy-msg2`, date, uniqueTitle, uniqueText, uniqueText.toLowerCase(), url, JSON.stringify([contact, email]), date, date);
    const v2 = Number((sqlite.prepare("SELECT last_insert_rowid() AS id").get() as { id: number }).id);
    insertFuzzyLink(sqlite, v1, v2, 0.55, 1);

    const report = buildFuzzyDedupReport(database, 30);
    assert.ok(!report.includes(uniqueTitle), "No title text");
    assert.ok(!report.includes(uniqueText), "No vacancy text");
    assert.ok(!report.includes("ABC789"), "No unique text fragment");
    assert.ok(!report.includes(userId), "No user ID");
    assert.ok(!report.includes("https://rustcorp.example.com"), "No URLs");
    assert.ok(!report.includes("@rust_recruiter"), "No Telegram contact");
    assert.ok(!report.includes("hr@rustcorp.example.com"), "No email");
    assert.ok(!report.includes("secret123"), "No token in URL");
  } finally {
    closeAndClean(database, sqlite, tempDir);
  }
});
