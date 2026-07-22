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
    assert.equal(stats.topSourceChannelPairs[0]!.linkCount, 2);
    assert.equal(stats.topSourceChannelPairs[1]!.linkCount, 1);
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

test("report does not contain vacancy text, contacts, or user IDs", () => {
  const { database, sqlite, tempDir } = createDb();
  try {
    const v1 = insertVacancy(sqlite, "tg", "ch1", 1);
    const v2 = insertVacancy(sqlite, "tg", "ch2", 1);
    insertFuzzyLink(sqlite, v1.id, v2.id, 0.55, 1);

    const report = buildFuzzyDedupReport(database, 30);
    assert.ok(!report.includes("Test Vacancy"), "No title text");
    assert.ok(!report.includes("Some text about the job"), "No vacancy text");
    assert.ok(!report.includes("777"), "No user ID");
    assert.ok(!report.includes("https://"), "No URLs");
    assert.ok(!report.includes("@"), "No contacts");
  } finally {
    closeAndClean(database, sqlite, tempDir);
  }
});
