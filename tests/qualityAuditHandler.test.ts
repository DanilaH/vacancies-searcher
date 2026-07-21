import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { VacancyDatabase } from "../src/db/database";
import { createTestConfig } from "./helpers";
import { handleQualityAuditCommand, handleAuditVerdictCallback } from "../src/bot/qualityAuditHandler";

const NOW = new Date();
const daysAgo = (n: number): string => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

function createDatabase(ownerUserId = "777") {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-tg-bot-quality-audit-"));
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

function makeAuditRecord(database: VacancyDatabase, userId: string, vacancyId: number, score = 0, reason = "test_reason"): void {
  database.saveRejectedAuditCandidate(userId, vacancyId, score, reason);
}

// ─── DB method tests ─────────────────────────────────────────────────────────

test("getOldestUnreviewedAuditWithVacancy returns null when empty", () => {
  const { database } = createDatabase();
  assert.equal(database.getOldestUnreviewedAuditWithVacancy("777"), null);
  database.close();
});

test("getOldestUnreviewedAuditWithVacancy returns joined record with vacancy data", () => {
  const { database } = createDatabase();
  const vid = makeVacancy(database, "Senior React engineer Remote TypeScript", "1001", "job_react", daysAgo(2));
  makeAuditRecord(database, "777", vid, 42, "keyword_mismatch");

  const record = database.getOldestUnreviewedAuditWithVacancy("777");
  assert.notEqual(record, null);
  if (!record) return;
  assert.equal(record.userId, "777");
  assert.equal(record.vacancyId, vid);
  assert.equal(record.id, vid);
  assert.equal(record.score, 42);
  assert.equal(record.reason, "keyword_mismatch");
  assert.equal(record.title, "Senior React engineer Remote TypeScript");
  assert.equal(record.resolution, "rejected");
  assert.equal(record.reviewedAt, null);
  assert.equal(record.verdict, null);

  database.close();
});

test("getOldestUnreviewedAuditWithVacancy returns oldest unreviewed record first", () => {
  const { database } = createDatabase();
  const vid1 = makeVacancy(database, "Vacancy A", "2001", "ch", daysAgo(5));
  const vid2 = makeVacancy(database, "Vacancy B", "2002", "ch", daysAgo(3));
  makeAuditRecord(database, "777", vid1, 10, "a");
  makeAuditRecord(database, "777", vid2, 20, "b");

  const r1 = database.getOldestUnreviewedAuditWithVacancy("777");
  assert.notEqual(r1, null);
  assert.equal(r1!.vacancyId, vid1);

  database.setAuditVerdict("777", vid1, "missed_relevant");

  const r2 = database.getOldestUnreviewedAuditWithVacancy("777");
  assert.notEqual(r2, null);
  assert.equal(r2!.vacancyId, vid2);

  database.close();
});

test("setAuditVerdict returns true when updating unreviewed record", () => {
  const { database } = createDatabase();
  const vid = makeVacancy(database, "Some text", "3001", "ch", daysAgo(1));
  makeAuditRecord(database, "777", vid);

  const result = database.setAuditVerdict("777", vid, "missed_relevant");
  assert.equal(result, true);

  const record = database.getRejectedMatchAudit("777", vid);
  assert.equal(record?.verdict, "missed_relevant");
  assert.notEqual(record?.reviewedAt, null);

  database.close();
});

test("setAuditVerdict returns false when record already reviewed", () => {
  const { database } = createDatabase();
  const vid = makeVacancy(database, "Some text", "3002", "ch", daysAgo(1));
  makeAuditRecord(database, "777", vid);

  database.setAuditVerdict("777", vid, "missed_relevant");
  const second = database.setAuditVerdict("777", vid, "correct_rejection");
  assert.equal(second, false);

  const record = database.getRejectedMatchAudit("777", vid);
  assert.equal(record?.verdict, "missed_relevant");

  database.close();
});

test("setAuditVerdict ignores non-existent records", () => {
  const { database } = createDatabase();
  const result = database.setAuditVerdict("777", 99999, "missed_relevant");
  assert.equal(result, false);
  database.close();
});

test("setAuditVerdict accepts missed_relevant and correct_rejection", () => {
  const { database } = createDatabase();
  const vid1 = makeVacancy(database, "Vacancy A", "4001", "ch", daysAgo(1));
  const vid2 = makeVacancy(database, "Vacancy B", "4002", "ch", daysAgo(1));
  makeAuditRecord(database, "777", vid1);
  makeAuditRecord(database, "777", vid2);

  assert.equal(database.setAuditVerdict("777", vid1, "missed_relevant"), true);
  assert.equal(database.setAuditVerdict("777", vid2, "correct_rejection"), true);

  assert.equal(database.getRejectedMatchAudit("777", vid1)?.verdict, "missed_relevant");
  assert.equal(database.getRejectedMatchAudit("777", vid2)?.verdict, "correct_rejection");

  database.close();
});

// ─── Handler command tests ───────────────────────────────────────────────────

test("handleQualityAuditCommand replies with access denied for non-owner", async () => {
  const { database, config } = createDatabase("777");
  let replyText = "";
  const ctx = {
    from: { id: 999 },
    reply: async (text: string) => { replyText = text; }
  } as never;

  await handleQualityAuditCommand(ctx, database, config);
  assert.ok(replyText.includes("доступна только владельцу"));
  database.close();
});

test("handleQualityAuditCommand shows done message when queue empty", async () => {
  const { database, config } = createDatabase("777");
  let replyText = "";
  const ctx = {
    from: { id: 777 },
    reply: async (text: string, _opts?: unknown) => { replyText = text; }
  } as never;

  await handleQualityAuditCommand(ctx, database, config);
  assert.ok(replyText.includes("Все записи аудита"));
  database.close();
});

test("handleQualityAuditCommand shows audit card with buttons when records exist", async () => {
  const { database, config } = createDatabase("777");
  const vid = makeVacancy(database, "Python developer Remote", "5001", "job_python", daysAgo(2));
  makeAuditRecord(database, "777", vid, 35, "keyword_mismatch");

  let replyText = "";
  let replyMarkup: unknown = null;
  const ctx = {
    from: { id: 777 },
    reply: async (text: string, opts?: { reply_markup?: unknown }) => {
      replyText = text;
      replyMarkup = opts?.reply_markup;
    }
  } as never;

  await handleQualityAuditCommand(ctx, database, config);
  assert.ok(replyText.includes("Аудит отклонённых"));
  assert.ok(replyText.includes("1/1"));
  assert.ok(replyText.includes("Python"));
  assert.ok(replyText.includes("keyword_mismatch"));
  assert.notEqual(replyMarkup, null);

  const keyboard = replyMarkup as { inline_keyboard?: Array<Array<{ text: string; callback_data: string }>> };
  const buttons = keyboard?.inline_keyboard?.flat() ?? [];
  assert.ok(buttons.some((b) => b.text.includes("Подходит мне")));
  assert.ok(buttons.some((b) => b.text.includes("Не подходит")));
  assert.ok(buttons.some((b) => b.callback_data.includes(`qualityaudit:verdict:${vid}:missed_relevant`)));
  assert.ok(buttons.some((b) => b.callback_data.includes(`qualityaudit:verdict:${vid}:correct_rejection`)));

  database.close();
});

test("handleQualityAuditCommand shows correct count with multiple records", async () => {
  const { database, config } = createDatabase("777");
  const vid1 = makeVacancy(database, "Vacancy One", "6001", "ch", daysAgo(3));
  const vid2 = makeVacancy(database, "Vacancy Two", "6002", "ch", daysAgo(2));
  makeAuditRecord(database, "777", vid1);
  makeAuditRecord(database, "777", vid2);

  let replyText = "";
  const ctx = {
    from: { id: 777 },
    reply: async (text: string, _opts?: unknown) => { replyText = text; }
  } as never;

  await handleQualityAuditCommand(ctx, database, config);
  assert.ok(replyText.includes("1/2"));
  assert.ok(replyText.includes("Vacancy One"));

  database.close();
});

// ─── Handler callback tests ──────────────────────────────────────────────────

test("handleAuditVerdictCallback answers with access denied for non-owner", async () => {
  const { database, config } = createDatabase("777");
  let answerText = "";
  const ctx = {
    from: { id: 999 },
    callbackQuery: { id: "cb1" },
    match: ["qualityaudit:verdict:1:missed_relevant", "1", "missed_relevant"],
    answerCallbackQuery: async (opts?: { text?: string }) => { answerText = opts?.text ?? ""; }
  } as never;

  await handleAuditVerdictCallback(ctx, database, config);
  assert.ok(answerText.includes("недоступен"));
  database.close();
});

test("handleAuditVerdictCallback records missed_relevant verdict", async () => {
  const { database, config } = createDatabase("777");
  const vid = makeVacancy(database, "Test vacancy", "7001", "ch", daysAgo(1));
  makeAuditRecord(database, "777", vid);

  let answerText = "";
  let replyMsgs: string[] = [];
  const ctx = {
    from: { id: 777 },
    callbackQuery: { id: "cb1", message: { reply_markup: {} } },
    match: [`qualityaudit:verdict:${vid}:missed_relevant`, String(vid), "missed_relevant"],
    answerCallbackQuery: async (opts?: { text?: string }) => { answerText = opts?.text ?? ""; },
    editMessageReplyMarkup: async () => {},
    reply: async (text: string) => { replyMsgs.push(text); }
  } as never;

  await handleAuditVerdictCallback(ctx, database, config);
  assert.ok(answerText.includes("пропущенная релевантная"));

  const record = database.getRejectedMatchAudit("777", vid);
  assert.equal(record?.verdict, "missed_relevant");
  assert.notEqual(record?.reviewedAt, null);

  database.close();
});

test("handleAuditVerdictCallback records correct_rejection verdict", async () => {
  const { database, config } = createDatabase("777");
  const vid = makeVacancy(database, "Test vacancy", "7002", "ch", daysAgo(1));
  makeAuditRecord(database, "777", vid);

  let answerText = "";
  const ctx = {
    from: { id: 777 },
    callbackQuery: { id: "cb1", message: { reply_markup: {} } },
    match: [`qualityaudit:verdict:${vid}:correct_rejection`, String(vid), "correct_rejection"],
    answerCallbackQuery: async (opts?: { text?: string }) => { answerText = opts?.text ?? ""; },
    editMessageReplyMarkup: async () => {},
    reply: async () => {}
  } as never;

  await handleAuditVerdictCallback(ctx, database, config);
  assert.ok(answerText.includes("корректное отклонение"));

  const record = database.getRejectedMatchAudit("777", vid);
  assert.equal(record?.verdict, "correct_rejection");
  assert.notEqual(record?.reviewedAt, null);

  database.close();
});

test("handleAuditVerdictCallback double click does not change verdict", async () => {
  const { database, config } = createDatabase("777");
  const vid = makeVacancy(database, "Test vacancy", "7003", "ch", daysAgo(1));
  makeAuditRecord(database, "777", vid);

  database.setAuditVerdict("777", vid, "missed_relevant");

  let answerText = "";
  const ctx = {
    from: { id: 777 },
    callbackQuery: { id: "cb1", message: { reply_markup: {} } },
    match: [`qualityaudit:verdict:${vid}:correct_rejection`, String(vid), "correct_rejection"],
    answerCallbackQuery: async (opts?: { text?: string }) => { answerText = opts?.text ?? ""; },
    editMessageReplyMarkup: async () => {},
    reply: async () => {}
  } as never;

  await handleAuditVerdictCallback(ctx, database, config);
  assert.ok(answerText.includes("уже проверена"));

  const record = database.getRejectedMatchAudit("777", vid);
  assert.equal(record?.verdict, "missed_relevant");

  database.close();
});

test("handleAuditVerdictCallback shows done after last record", async () => {
  const { database, config } = createDatabase("777");
  const vid = makeVacancy(database, "Last vacancy", "7004", "ch", daysAgo(1));
  makeAuditRecord(database, "777", vid);

  let replyMsgs: string[] = [];
  const ctx = {
    from: { id: 777 },
    callbackQuery: { id: "cb1", message: { reply_markup: {} } },
    match: [`qualityaudit:verdict:${vid}:missed_relevant`, String(vid), "missed_relevant"],
    answerCallbackQuery: async (_opts?: { text?: string }) => {},
    editMessageReplyMarkup: async () => {},
    reply: async (text: string) => { replyMsgs.push(text); }
  } as never;

  await handleAuditVerdictCallback(ctx, database, config);
  assert.ok(replyMsgs.some((m) => m.includes("Все записи аудита")));

  database.close();
});

test("handleAuditVerdictCallback shows next record after verdict when more exist", async () => {
  const { database, config } = createDatabase("777");
  const vid1 = makeVacancy(database, "Vacancy One", "7005", "ch", daysAgo(2));
  const vid2 = makeVacancy(database, "Vacancy Two", "7006", "ch", daysAgo(1));
  makeAuditRecord(database, "777", vid1);
  makeAuditRecord(database, "777", vid2);

  let replyMsgs: string[] = [];
  const ctx = {
    from: { id: 777 },
    callbackQuery: { id: "cb1", message: { reply_markup: {} } },
    match: [`qualityaudit:verdict:${vid1}:missed_relevant`, String(vid1), "missed_relevant"],
    answerCallbackQuery: async (_opts?: { text?: string }) => {},
    editMessageReplyMarkup: async () => {},
    reply: async (text: string) => { replyMsgs.push(text); }
  } as never;

  await handleAuditVerdictCallback(ctx, database, config);
  assert.ok(replyMsgs.some((m) => m.includes("Vacancy Two")));

  database.close();
});

test("handleAuditVerdictCallback rejects invalid callback data pattern", async () => {
  const { database, config } = createDatabase("777");
  let answerText = "";
  const ctx = {
    from: { id: 777 },
    callbackQuery: { id: "cb1" },
    match: null,
    answerCallbackQuery: async (opts?: { text?: string }) => { answerText = opts?.text ?? ""; }
  } as never;

  await handleAuditVerdictCallback(ctx, database, config);
  assert.ok(answerText.includes("Некорректные данные"));

  database.close();
});
