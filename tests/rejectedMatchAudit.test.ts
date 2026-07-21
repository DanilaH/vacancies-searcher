import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createAnalyticsService } from "../src/analytics/analyticsService";
import { BotController } from "../src/bot/createBot";
import { VacancyDatabase } from "../src/db/database";
import { UserVacancyRematcher } from "../src/services/userVacancyRematcher";
import { VacancyFilter } from "../src/services/vacancyFilter";
import { VacancyIngestor } from "../src/services/vacancyIngestor";
import { MatchedVacancyRecord } from "../src/types";
import { createTestConfig } from "./helpers";

function createDatabase(ownerUserId = "777") {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-tg-bot-audit-"));
  const config = createTestConfig({
    ownerUserId,
    ownerChatId: ownerUserId,
    databasePath: path.join(tempDir, "bot.db"),
    databaseUrl: `file:${path.join(tempDir, "bot.db")}`,
    appDataDir: tempDir,
    runtimeDir: path.join(tempDir, "runtime")
  });
  const database = new VacancyDatabase(config);
  database.initialize();
  return { config, database };
}

function getDb(database: VacancyDatabase): ReturnType<typeof database["getDb"]> {
  return (database as unknown as { getDb(): ReturnType<typeof database["getDb"]> }).getDb();
}

function makeVacancy(database: VacancyDatabase, text: string, messageId: string, channel = "test_channel", date?: string): number {
  const result = database.recordMessage(
    {
      source: "telegram_web_preview",
      channel,
      messageId,
      date: date ?? new Date().toISOString(),
      text,
      url: `https://t.me/${channel}/${messageId}`
    },
    { matches: true, score: 0, matchedKeywords: [], blockedBy: [], summary: "" },
    []
  );
  if (result.kind !== "new_vacancy") throw new Error(`Failed to create vacancy: ${result.kind}`);
  return result.vacancy.id;
}

const now = new Date();
const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

// ─── Basic save ──────────────────────────────────────────────────────────────

test("saveRejectedAuditCandidate stores a record and returns it", () => {
  const { config, database } = createDatabase();
  const filter = new VacancyFilter(config);
  const rematcher = new UserVacancyRematcher(database, filter, config.ownerUserId);

  makeVacancy(database, "Senior React engineer\nRemote\nTypeScript", "1001", "job_react", daysAgo(2));

  database.setUserSearchProfileKeywords("777", "required_primary", ["python"]);
  rematcher.rebuildForUser("777", 7);

  assert.equal(database.countUnreviewedRejectedAudit("777"), 1);

  database.close();
});

test("saveRejectedAuditCandidate records score, reason, and default fields", () => {
  const { database } = createDatabase();
  const vid = makeVacancy(database, "Some text", "1002", "test_channel", daysAgo(2));

  const record = database.saveRejectedAuditCandidate("777", vid, 42, "test_reason");

  assert.equal(record.userId, "777");
  assert.equal(record.vacancyId, vid);
  assert.equal(record.resolution, "rejected");
  assert.equal(record.score, 42);
  assert.equal(record.reason, "test_reason");
  assert.equal(record.reviewedAt, null);
  assert.equal(record.verdict, null);
  assert.ok(record.decidedAt.length > 0);

  database.close();
});

test("saveRejectedAuditCandidate does not store vacancy text", () => {
  const { database } = createDatabase();
  const vid = makeVacancy(database, "Senior React engineer\nRemote\nTypeScript", "1003", "test_channel", daysAgo(2));

  database.saveRejectedAuditCandidate("777", vid, 0, "rejected");

  const row = getDb(database)
    .prepare("SELECT * FROM rejected_match_audit WHERE user_id = ? AND vacancy_id = ?")
    .get("777", vid) as Record<string, unknown>;
  const keys = Object.keys(row);
  assert.ok(!keys.includes("text"));
  assert.ok(!keys.includes("vacancy_text"));

  database.close();
});

// ─── Issue 2: ON CONFLICT preserves reviewed_at / verdict / decided_at ──────

test("saveRejectedAuditCandidate preserves reviewed_at, verdict, and decided_at on conflict", () => {
  const { database } = createDatabase();
  const vid = makeVacancy(database, "Some text", "1004", "test_channel", daysAgo(2));

  const first = database.saveRejectedAuditCandidate("777", vid, 10, "first");
  const originalDecidedAt = first.decidedAt;

  getDb(database)
    .prepare("UPDATE rejected_match_audit SET reviewed_at = ?, verdict = 'miss' WHERE user_id = ? AND vacancy_id = ?")
    .run(new Date().toISOString(), "777", vid);

  const second = database.saveRejectedAuditCandidate("777", vid, 20, "second");

  assert.equal(second.score, 20);
  assert.equal(second.reason, "second");
  assert.equal(second.decidedAt, originalDecidedAt, "decided_at must not be reset");
  assert.notEqual(second.reviewedAt, null, "reviewed_at must be preserved");
  assert.equal(second.verdict, "miss", "verdict must be preserved");

  database.close();
});

// ─── Issue 4: Owner activity check ──────────────────────────────────────────

test("UserVacancyRematcher does not create audit records for deactivated owner", () => {
  const { config, database } = createDatabase("777");
  const filter = new VacancyFilter(config);
  const rematcher = new UserVacancyRematcher(database, filter, config.ownerUserId);

  makeVacancy(database, "Junior Vue developer\nOffice\nAngular", "1005", "test_channel", daysAgo(2));

  getDb(database)
    .prepare("UPDATE bot_users SET is_active = 0 WHERE user_id = ?")
    .run("777");

  database.setUserSearchProfileKeywords("777", "required_primary", ["python"]);
  rematcher.rebuildForUser("777", 7);

  assert.equal(database.countUnreviewedRejectedAudit("777"), 0);

  database.close();
});

test("VacancyIngestor does not create audit records for deactivated owner", async () => {
  const { config, database } = createDatabase("777");
  const filter = new VacancyFilter(config);
  const deliveries: string[] = [];
  const bot: BotController = {
    async start() {},
    async stop() {},
    async notifyVacancy(v: MatchedVacancyRecord) { deliveries.push(v.userId); return true; },
    async sendVacancyReminder() { return true; },
    async sendApplicationFollowUp() { return true; },
    async sendNoNewVacanciesNotification() { return true; },
    async sendStartupDiagnostic() {},
    async sendAdminAlert() { return true; },
    async sendOwnerReport() { return true; }
  };
  const analytics = createAnalyticsService(config, database);

  getDb(database)
    .prepare("UPDATE bot_users SET is_active = 0 WHERE user_id = ?")
    .run("777");

  database.setUserSearchProfileKeywords("777", "required_primary", ["python"]);

  const ingestor = new VacancyIngestor(config, filter, database, bot, analytics);
  await ingestor.handle({
    source: "telegram_web_preview",
    channel: "test_channel",
    messageId: "1006",
    date: daysAgo(1),
    text: "Junior Vue developer\nOffice\nAngular",
    url: "https://t.me/test_channel/1006"
  });

  assert.equal(database.countUnreviewedRejectedAudit("777"), 0);

  await analytics.shutdown();
  database.close();
});

// ─── No recording for non-owner ──────────────────────────────────────────────

test("UserVacancyRematcher does not record audit for non-owner user", () => {
  const { config, database } = createDatabase("999");
  const filter = new VacancyFilter(config);
  const rematcher = new UserVacancyRematcher(database, filter, config.ownerUserId);

  makeVacancy(database, "Junior Vue developer\nOffice\nAngular", "1007", "test_channel", daysAgo(2));
  database.setUserSearchProfileKeywords("999", "required_primary", ["python"]);

  database.setBotUserRole("777", "member");
  rematcher.rebuildForUser("777", 7);

  assert.equal(database.countUnreviewedRejectedAudit("777"), 0);

  database.close();
});

// ─── Recording only for rejected matches ─────────────────────────────────────

test("UserVacancyRematcher records only rejected vacancies for owner", () => {
  const { config, database } = createDatabase("777");
  const filter = new VacancyFilter(config);
  const rematcher = new UserVacancyRematcher(database, filter, config.ownerUserId);

  makeVacancy(database, "Senior React engineer\nRemote\nTypeScript", "1008", "test_channel", daysAgo(2));
  makeVacancy(database, "Junior Vue developer\nOffice\nAngular", "1009", "test_channel", daysAgo(2));

  database.setUserSearchProfileKeywords("777", "required_primary", ["react"]);
  database.setUserSearchProfileKeywords("777", "preferred", ["typescript"]);

  rematcher.rebuildForUser("777", 7);

  assert.equal(database.countUnreviewedRejectedAudit("777"), 1);

  database.close();
});

// ─── Limit 500 + cleanup (issue 3: save first, then cleanup) ─────────────────

test("saveRejectedAuditCandidate caps unreviewed records at 500 per owner", () => {
  const { database } = createDatabase("777");
  const userId = "777";

  const vids: number[] = [];
  for (let i = 0; i < 501; i++) {
    const vid = makeVacancy(database, "Vacancy " + i + " text", String(10000 + i), "test_channel", daysAgo(500 - i));
    vids.push(vid);
  }

  for (let i = 0; i < 501; i++) {
    database.saveRejectedAuditCandidate(userId, vids[i], i, "reason-" + i);
  }

  assert.equal(database.countUnreviewedRejectedAudit(userId), 500);

  const rows = getDb(database)
    .prepare("SELECT score FROM rejected_match_audit WHERE user_id = ? AND reviewed_at IS NULL ORDER BY decided_at ASC")
    .all(userId) as { score: number }[];
  assert.equal(rows[0].score, 1);
  assert.equal(rows[rows.length - 1].score, 500);

  database.close();
});

test("saveRejectedAuditCandidate at 500 records does not delete on re-save of existing pair", () => {
  const { database } = createDatabase("777");
  const userId = "777";

  const vids: number[] = [];
  for (let i = 0; i < 500; i++) {
    const vid = makeVacancy(database, "Vacancy " + i + " text", String(20000 + i), "test_channel", daysAgo(500 - i));
    vids.push(vid);
  }

  for (let i = 0; i < 500; i++) {
    database.saveRejectedAuditCandidate(userId, vids[i], i, "reason-" + i);
  }

  assert.equal(database.countUnreviewedRejectedAudit(userId), 500);

  database.saveRejectedAuditCandidate(userId, vids[0], 999, "re-save");

  assert.equal(database.countUnreviewedRejectedAudit(userId), 500);

  const row = getDb(database)
    .prepare("SELECT score FROM rejected_match_audit WHERE user_id = ? AND vacancy_id = ?")
    .get(userId, vids[0]) as { score: number };
  assert.equal(row.score, 999);

  database.close();
});

test("pruneUnreviewedRejectedAudit removes oldest unreviewed records beyond limit", () => {
  const { database } = createDatabase("777");
  const userId = "777";

  const vids: number[] = [];
  for (let i = 0; i < 100; i++) {
    const vid = makeVacancy(database, "Vacancy " + i + " text", String(30000 + i), "test_channel", daysAgo(100 - i));
    vids.push(vid);
  }
  for (let i = 0; i < 100; i++) {
    database.saveRejectedAuditCandidate(userId, vids[i], i, "reason-" + i);
  }

  const removed = database.pruneUnreviewedRejectedAudit(userId, 90);
  assert.equal(removed, 10);
  assert.equal(database.countUnreviewedRejectedAudit(userId), 90);

  const rows = getDb(database)
    .prepare("SELECT score FROM rejected_match_audit WHERE user_id = ? AND reviewed_at IS NULL ORDER BY decided_at ASC")
    .all(userId) as { score: number }[];
  assert.equal(rows[0].score, 10);
  assert.equal(rows[rows.length - 1].score, 99);

  database.close();
});

test("pruneUnreviewedRejectedAudit does nothing when under limit", () => {
  const { database } = createDatabase("777");
  const userId = "777";

  const vid = makeVacancy(database, "Some text", "2001", "test_channel", daysAgo(1));
  database.saveRejectedAuditCandidate(userId, vid, 0, "test");

  const removed = database.pruneUnreviewedRejectedAudit(userId, 500);
  assert.equal(removed, 0);
  assert.equal(database.countUnreviewedRejectedAudit(userId), 1);

  database.close();
});

// ─── Verified records preserved ──────────────────────────────────────────────

test("saveRejectedAuditCandidate does not evict reviewed records", () => {
  const { database } = createDatabase("777");
  const userId = "777";

  const reviewedVid = makeVacancy(database, "Reviewed vacancy", "3001", "test_channel", daysAgo(100));
  database.saveRejectedAuditCandidate(userId, reviewedVid, 99, "reviewed");

  getDb(database)
    .prepare("UPDATE rejected_match_audit SET reviewed_at = ?, verdict = 'miss' WHERE user_id = ? AND vacancy_id = ?")
    .run(new Date().toISOString(), userId, reviewedVid);

  const vids: number[] = [];
  for (let i = 0; i < 501; i++) {
    const vid = makeVacancy(database, "Bulk " + i, String(40000 + i), "test_channel", daysAgo(500 - i));
    vids.push(vid);
  }
  for (let i = 0; i < 501; i++) {
    database.saveRejectedAuditCandidate(userId, vids[i], i, "reason-" + i);
  }

  const reviewed = getDb(database)
    .prepare("SELECT verdict FROM rejected_match_audit WHERE user_id = ? AND vacancy_id = ?")
    .get(userId, reviewedVid) as { verdict: string } | undefined;
  assert.ok(reviewed, "reviewed record should still exist");
  assert.equal(reviewed.verdict, "miss");

  assert.equal(database.countUnreviewedRejectedAudit(userId), 500);

  database.close();
});

// ─── Integration: rematcher records audit for owner ──────────────────────────

test("UserVacancyRematcher integration: owner rebuild records rejected audit entries", () => {
  const { config, database } = createDatabase("777");
  const filter = new VacancyFilter(config);
  const rematcher = new UserVacancyRematcher(database, filter, config.ownerUserId);

  const matchingText = "Senior React engineer\nRemote\nTypeScript";
  const rejectedText1 = "Junior Vue developer\nOffice\nAngular";
  const rejectedText2 = "Intern C++ developer\nOffice\nWindows";

  makeVacancy(database, matchingText, "4001", "test_channel", daysAgo(2));
  makeVacancy(database, rejectedText1, "4002", "test_channel", daysAgo(2));
  makeVacancy(database, rejectedText2, "4003", "test_channel", daysAgo(2));

  database.setUserSearchProfileKeywords("777", "required_context", ["remote"]);
  database.setUserSearchProfileKeywords("777", "required_primary", ["react"]);
  database.setUserSearchProfileKeywords("777", "preferred", ["typescript"]);

  const summary = rematcher.rebuildForUser("777", 7);

  assert.equal(summary.created, 1);
  assert.equal(summary.evaluatedVacancies, 3);

  assert.equal(database.countUnreviewedRejectedAudit("777"), 2);

  const rows = getDb(database)
    .prepare("SELECT r.score, r.reason FROM rejected_match_audit r JOIN vacancies v ON v.id = r.vacancy_id WHERE r.user_id = ? ORDER BY r.decided_at")
    .all("777") as { score: number; reason: string }[];
  for (const row of rows) {
    assert.equal(typeof row.score, "number");
    assert.ok(row.reason.length > 0);
  }

  database.close();
});

// ─── Issue 1: Live ingestion path ───────────────────────────────────────────

test("VacancyIngestor records rejected audit entries for the owner during live ingestion", async () => {
  const { config, database } = createDatabase("777");
  const filter = new VacancyFilter(config);
  const deliveries: string[] = [];
  const bot: BotController = {
    async start() {},
    async stop() {},
    async notifyVacancy(v: MatchedVacancyRecord) { deliveries.push(v.userId); return true; },
    async sendVacancyReminder() { return true; },
    async sendApplicationFollowUp() { return true; },
    async sendNoNewVacanciesNotification() { return true; },
    async sendStartupDiagnostic() {},
    async sendAdminAlert() { return true; },
    async sendOwnerReport() { return true; }
  };
  const analytics = createAnalyticsService(config, database);

  database.setUserSearchProfileKeywords("777", "required_primary", ["python"]);

  const ingestor = new VacancyIngestor(config, filter, database, bot, analytics);
  await ingestor.handle({
    source: "telegram_web_preview",
    channel: "test_channel",
    messageId: "5001",
    date: daysAgo(1),
    text: "Senior React engineer\nRemote\nTypeScript",
    url: "https://t.me/test_channel/5001"
  });

  assert.equal(database.countUnreviewedRejectedAudit("777"), 1);

  await analytics.shutdown();
  database.close();
});

test("VacancyIngestor records audit entry with correct score and reason from live ingestion", async () => {
  const { config, database } = createDatabase("777");
  const filter = new VacancyFilter(config);
  const deliveries: string[] = [];
  const bot: BotController = {
    async start() {},
    async stop() {},
    async notifyVacancy(v: MatchedVacancyRecord) { deliveries.push(v.userId); return true; },
    async sendVacancyReminder() { return true; },
    async sendApplicationFollowUp() { return true; },
    async sendNoNewVacanciesNotification() { return true; },
    async sendStartupDiagnostic() {},
    async sendAdminAlert() { return true; },
    async sendOwnerReport() { return true; }
  };
  const analytics = createAnalyticsService(config, database);

  database.setUserSearchProfileKeywords("777", "exclude", ["react"]);

  const ingestor = new VacancyIngestor(config, filter, database, bot, analytics);
  await ingestor.handle({
    source: "telegram_web_preview",
    channel: "test_channel",
    messageId: "5002",
    date: daysAgo(1),
    text: "Senior React engineer\nRemote\nTypeScript",
    url: "https://t.me/test_channel/5002"
  });

  assert.equal(database.countUnreviewedRejectedAudit("777"), 1);

  const rows = getDb(database)
    .prepare("SELECT score, reason FROM rejected_match_audit WHERE user_id = ?")
    .all("777") as { score: number; reason: string }[];
  assert.equal(typeof rows[0].score, "number");
  assert.ok(rows[0].reason.length > 0);

  await analytics.shutdown();
  database.close();
});
