import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { VacancyDatabase } from "../src/db/database";
import { buildMatchingQualityReport } from "../src/services/matchingQualityReport";
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
  return { database, tempDir };
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

function insertVacancy(
  database: VacancyDatabase,
  source: SourceName,
  channel: string,
  messageId: string,
  text: string
): number {
  const result = database.recordMessage(
    {
      source,
      channel,
      messageId,
      date: new Date().toISOString(),
      text,
      url: `https://t.me/${channel}/${messageId}`
    },
    makeFilterResult(),
    []
  );
  assert.equal(result.kind, "new_vacancy");
  return result.vacancy.id;
}

// --- Service tests ---

test("no matches returns zero report", () => {
  const { database } = createFixture();
  setupOwner(database);

  const report = buildMatchingQualityReport(database, "777");
  assert.ok(report.includes("Всего подобрано вакансий: 0"));
  assert.ok(report.includes("Вакансий с обратной связью: 0"));
  assert.ok(report.includes("Недостаточно данных для расчёта процентов"));
  assert.ok(report.includes("Пропущенные релевантные вакансии пока не измеряются"));
  database.close();
});

test("data isolation: only the requesting user's data is counted", () => {
  const { database } = createFixture();
  setupOwner(database);
  setupMember(database, "u1");
  setupMember(database, "u2");

  const v1 = insertVacancy(database, "telegram_web_preview", "ch1", "m1", "text for u1");
  const v2 = insertVacancy(database, "telegram_web_preview", "ch1", "m2", "different text for u2");

  database.createUserVacancyMatch("u1", v1, makeFilterResult());
  database.createUserVacancyMatch("u2", v2, makeFilterResult());
  database.upsertVacancyRelevanceFeedback("u1", v1, "relevant");
  database.upsertVacancyRelevanceFeedback("u2", v2, "not_relevant");

  const report = buildMatchingQualityReport(database, "u1");
  assert.ok(report.includes("Всего подобрано вакансий: 1"));
  assert.ok(report.includes("Вакансий с обратной связью: 1"));
  assert.ok(report.includes("Из них релевантных: 1"));
  assert.ok(report.includes("Из них нерелевантных: 0"));
  database.close();
});

test("counts matches and feedback correctly", () => {
  const { database } = createFixture();
  setupOwner(database);
  setupMember(database, "u1");

  const v1 = insertVacancy(database, "telegram_web_preview", "ch1", "m1", "a");
  const v2 = insertVacancy(database, "telegram_web_preview", "ch1", "m2", "b");
  const v3 = insertVacancy(database, "telegram_web_preview", "ch1", "m3", "c");
  const v4 = insertVacancy(database, "telegram_web_preview", "ch1", "m4", "d");

  database.createUserVacancyMatch("u1", v1, makeFilterResult());
  database.createUserVacancyMatch("u1", v2, makeFilterResult());
  database.createUserVacancyMatch("u1", v3, makeFilterResult());
  database.createUserVacancyMatch("u1", v4, makeFilterResult());

  database.upsertVacancyRelevanceFeedback("u1", v1, "relevant");
  database.upsertVacancyRelevanceFeedback("u1", v2, "not_relevant");
  database.upsertVacancyRelevanceFeedback("u1", v3, "relevant");

  const report = buildMatchingQualityReport(database, "u1");
  assert.ok(report.includes("Всего подобрано вакансий: 4"));
  assert.ok(report.includes("Вакансий с обратной связью: 3"));
  assert.ok(report.includes("Из них релевантных: 2"));
  assert.ok(report.includes("Из них нерелевантных: 1"));
  database.close();
});

test("uses current feedback value after change", () => {
  const { database } = createFixture();
  setupOwner(database);
  setupMember(database, "u1");

  const v1 = insertVacancy(database, "telegram_web_preview", "ch1", "m1", "a");
  database.createUserVacancyMatch("u1", v1, makeFilterResult());
  database.upsertVacancyRelevanceFeedback("u1", v1, "not_relevant");
  database.upsertVacancyRelevanceFeedback("u1", v1, "relevant");

  const report = buildMatchingQualityReport(database, "u1");
  assert.ok(report.includes("Из них релевантных: 1"));
  assert.ok(report.includes("Из них нерелевантных: 0"));
  database.close();
});

test("feedback without matching is not counted", () => {
  const { database } = createFixture();
  setupOwner(database);
  setupMember(database, "u1");

  const v1 = insertVacancy(database, "telegram_web_preview", "ch1", "m1", "orphan");
  database.upsertVacancyRelevanceFeedback("u1", v1, "relevant");

  const report = buildMatchingQualityReport(database, "u1");
  assert.ok(report.includes("Всего подобрано вакансий: 0"));
  assert.ok(report.includes("Вакансий с обратной связью: 0"));
  database.close();
});

test("lower boundary: matches at exactly 30 days ago are included", () => {
  const { database } = createFixture();
  setupOwner(database);

  // Use direct SQL so we can control created_at precisely
  const v1 = insertVacancy(database, "telegram_web_preview", "ch1", "m1", "boundary");
  const boundaryDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000 + 60_000);
  const db = (database as unknown as { getDb(): ReturnType<typeof database["getDb"]> }).getDb();
  db.prepare(
    `INSERT INTO user_vacancy_matches (user_id, vacancy_id, score, match_summary, matched_keywords_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run("777", v1, 100, "test", '["test"]', boundaryDate.toISOString(), boundaryDate.toISOString());

  const report = buildMatchingQualityReport(database, "777");
  assert.ok(report.includes("Всего подобрано вакансий: 1"));
  database.close();
});

test("old matches before the window are excluded", () => {
  const { database } = createFixture();
  setupOwner(database);

  const v1 = insertVacancy(database, "telegram_web_preview", "ch1", "m1", "old");
  const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
  const db = (database as unknown as { getDb(): ReturnType<typeof database["getDb"]> }).getDb();
  db.prepare(
    `INSERT INTO user_vacancy_matches (user_id, vacancy_id, score, match_summary, matched_keywords_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run("777", v1, 100, "test", '["test"]', oldDate.toISOString(), oldDate.toISOString());

  const report = buildMatchingQualityReport(database, "777");
  assert.ok(report.includes("Всего подобрано вакансий: 0"));
  database.close();
});

test("future matches are excluded", () => {
  const { database } = createFixture();
  setupOwner(database);

  const v1 = insertVacancy(database, "telegram_web_preview", "ch1", "m1", "future");
  const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const db = (database as unknown as { getDb(): ReturnType<typeof database["getDb"]> }).getDb();
  db.prepare(
    `INSERT INTO user_vacancy_matches (user_id, vacancy_id, score, match_summary, matched_keywords_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run("777", v1, 100, "test", '["test"]', futureDate.toISOString(), futureDate.toISOString());

  const report = buildMatchingQualityReport(database, "777");
  assert.ok(report.includes("Всего подобрано вакансий: 0"));
  database.close();
});

test("coverage percentage is calculated correctly", () => {
  const { database } = createFixture();
  setupOwner(database);

  const v1 = insertVacancy(database, "telegram_web_preview", "ch1", "m1", "a");
  const v2 = insertVacancy(database, "telegram_web_preview", "ch1", "m2", "b");

  database.createUserVacancyMatch("777", v1, makeFilterResult());
  database.createUserVacancyMatch("777", v2, makeFilterResult());
  database.upsertVacancyRelevanceFeedback("777", v1, "relevant");

  const report = buildMatchingQualityReport(database, "777");
  assert.ok(report.includes("Покрытие оценками: 50%"), "1/2 = 50% coverage");
  database.close();
});

test("not-relevant share is calculated correctly", () => {
  const { database } = createFixture();
  setupOwner(database);

  const v1 = insertVacancy(database, "telegram_web_preview", "ch1", "m1", "a");
  const v2 = insertVacancy(database, "telegram_web_preview", "ch1", "m2", "b");
  const v3 = insertVacancy(database, "telegram_web_preview", "ch1", "m3", "c");

  database.createUserVacancyMatch("777", v1, makeFilterResult());
  database.createUserVacancyMatch("777", v2, makeFilterResult());
  database.createUserVacancyMatch("777", v3, makeFilterResult());
  database.upsertVacancyRelevanceFeedback("777", v1, "not_relevant");
  database.upsertVacancyRelevanceFeedback("777", v2, "not_relevant");
  database.upsertVacancyRelevanceFeedback("777", v3, "relevant");

  const report = buildMatchingQualityReport(database, "777");
  assert.ok(report.includes("Доля нерелевантных: 67%"), "2/3 = 67% not-relevant");
  database.close();
});

test("warning shown when feedback count is less than 10", () => {
  const { database } = createFixture();
  setupOwner(database);

  const v1 = insertVacancy(database, "telegram_web_preview", "ch1", "m1", "a");
  database.createUserVacancyMatch("777", v1, makeFilterResult());
  database.upsertVacancyRelevanceFeedback("777", v1, "relevant");

  const report = buildMatchingQualityReport(database, "777");
  assert.ok(report.includes("⚠️ Мало данных"));
  database.close();
});

test("no division by zero when there are matches but no feedback", () => {
  const { database } = createFixture();
  setupOwner(database);

  const v1 = insertVacancy(database, "telegram_web_preview", "ch1", "m1", "a");
  database.createUserVacancyMatch("777", v1, makeFilterResult());

  const report = buildMatchingQualityReport(database, "777");
  assert.ok(report.includes("Всего подобрано вакансий: 1"));
  assert.ok(report.includes("Вакансий с обратной связью: 0"));
  assert.ok(report.includes("Недостаточно данных для расчёта процентов"));
  database.close();
});

test("false negative disclaimer is always present", () => {
  const { database } = createFixture();
  setupOwner(database);

  const report = buildMatchingQualityReport(database, "777");
  assert.ok(report.includes("Пропущенные релевантные вакансии пока не измеряются"));
  database.close();
});

test("coverage is 100% when all matches have feedback", () => {
  const { database } = createFixture();
  setupOwner(database);

  const v1 = insertVacancy(database, "telegram_web_preview", "ch1", "m1", "a");
  database.createUserVacancyMatch("777", v1, makeFilterResult());
  database.upsertVacancyRelevanceFeedback("777", v1, "relevant");

  const report = buildMatchingQualityReport(database, "777");
  assert.ok(report.includes("Покрытие оценками: 100%"));
  database.close();
});

test("handles only not-relevant feedback", () => {
  const { database } = createFixture();
  setupOwner(database);

  const v1 = insertVacancy(database, "telegram_web_preview", "ch1", "m1", "a");
  const v2 = insertVacancy(database, "telegram_web_preview", "ch1", "m2", "b");

  database.createUserVacancyMatch("777", v1, makeFilterResult());
  database.createUserVacancyMatch("777", v2, makeFilterResult());
  database.upsertVacancyRelevanceFeedback("777", v1, "not_relevant");
  database.upsertVacancyRelevanceFeedback("777", v2, "not_relevant");

  const report = buildMatchingQualityReport(database, "777");
  assert.ok(report.includes("Из них релевантных: 0"));
  assert.ok(report.includes("Из них нерелевантных: 2"));
  assert.ok(report.includes("Доля нерелевантных: 100%"));
  database.close();
});

test("no warning shown when feedback count is 10 or more", () => {
  const { database } = createFixture();
  setupOwner(database);

  for (let i = 0; i < 10; i++) {
    const v = insertVacancy(database, "telegram_web_preview", "ch1", `m${i}`, `text ${i}`);
    database.createUserVacancyMatch("777", v, makeFilterResult());
    database.upsertVacancyRelevanceFeedback("777", v, "relevant");
  }

  const report = buildMatchingQualityReport(database, "777");
  assert.ok(!report.includes("⚠️ Мало данных"));
  database.close();
});

// --- Handler-level tests ---

test("handler: owner gets report, member is denied", async () => {
  const { database } = createFixture();
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
  assert.ok(!ownerText.includes("Команда доступна только владельцу"), "owner must not see the denial");

  lastReplyText = undefined;
  await bot.handleUpdate(await makeUpdate(999));
  const memberText: string = lastReplyText ?? "";
  assert.equal(memberText, "Команда доступна только владельцу", "member must be denied with exact text");

  database.close();
});
