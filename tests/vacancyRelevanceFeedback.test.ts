import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as grammy from "grammy";

import { VacancyDatabase } from "../src/db/database";
import { buildChannelReport } from "../src/services/channelReport";
import { handleChannelReportCommand } from "../src/bot/channelReportHandler";
import { createTestConfig } from "./helpers";

import type { FilterResult, SourceName } from "../src/types";

function createFixture() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-tg-bot-rf-"));
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

function setupTestUsers(database: VacancyDatabase): void {
  for (const uid of ["u1", "u2"]) {
    database.registerPublicUserIfNeeded(uid);
  }
  database.addOrActivateBotUser("777", "owner", "777");
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

function insertMatch(database: VacancyDatabase, userId: string, vacancyId: number): void {
  database.createUserVacancyMatch(userId, vacancyId, makeFilterResult());
}

test("positive feedback is stored and does not change vacancy status", () => {
  const { database } = createFixture();
  setupTestUsers(database);
  const vacId = insertVacancy(database, "telegram_web_preview", "ch1", "m1", "text");
  insertMatch(database, "u1", vacId);

  assert.equal(database.getUserVacancyStatus("u1", vacId), "inbox");

  const record = database.upsertVacancyRelevanceFeedback("u1", vacId, "relevant");
  assert.equal(record.value, "relevant");
  assert.equal(record.userId, "u1");
  assert.equal(record.vacancyId, vacId);
  assert.ok(record.createdAt);
  assert.ok(record.updatedAt);

  assert.equal(database.getUserVacancyStatus("u1", vacId), "inbox");
  assert.equal(database.getVacancyRelevanceFeedback("u1", vacId), "relevant");

  database.close();
});

test("Не подходит stores not_relevant and continues hide flow", () => {
  const { database } = createFixture();
  setupTestUsers(database);
  const vacId = insertVacancy(database, "telegram_web_preview", "ch1", "m2", "text2");
  insertMatch(database, "u1", vacId);

  database.setUserVacancyStatus("u1", vacId, "hidden");
  database.upsertVacancyRelevanceFeedback("u1", vacId, "not_relevant");

  assert.equal(database.getUserVacancyStatus("u1", vacId), "hidden");
  assert.equal(database.getVacancyRelevanceFeedback("u1", vacId), "not_relevant");

  database.close();
});

test("changing relevant to not_relevant and back", () => {
  const { database } = createFixture();
  setupTestUsers(database);
  const vacId = insertVacancy(database, "telegram_web_preview", "ch1", "m3", "text3");
  insertMatch(database, "u1", vacId);

  database.upsertVacancyRelevanceFeedback("u1", vacId, "relevant");
  assert.equal(database.getVacancyRelevanceFeedback("u1", vacId), "relevant");

  database.upsertVacancyRelevanceFeedback("u1", vacId, "not_relevant");
  assert.equal(database.getVacancyRelevanceFeedback("u1", vacId), "not_relevant");

  database.upsertVacancyRelevanceFeedback("u1", vacId, "relevant");
  assert.equal(database.getVacancyRelevanceFeedback("u1", vacId), "relevant");

  database.close();
});

test("repeated same value is idempotent", () => {
  const { database } = createFixture();
  setupTestUsers(database);
  const vacId = insertVacancy(database, "telegram_web_preview", "ch1", "m4", "text4");
  insertMatch(database, "u1", vacId);

  const r1 = database.upsertVacancyRelevanceFeedback("u1", vacId, "relevant");
  const r2 = database.upsertVacancyRelevanceFeedback("u1", vacId, "relevant");
  assert.equal(r2.value, "relevant");
  assert.equal(r2.updatedAt, r1.updatedAt);

  database.close();
});

test("feedback is isolated between users", () => {
  const { database } = createFixture();
  setupTestUsers(database);
  const vacId = insertVacancy(database, "telegram_web_preview", "ch1", "m5", "text5");
  insertMatch(database, "u1", vacId);
  insertMatch(database, "u2", vacId);

  database.upsertVacancyRelevanceFeedback("u1", vacId, "relevant");
  database.upsertVacancyRelevanceFeedback("u2", vacId, "not_relevant");

  assert.equal(database.getVacancyRelevanceFeedback("u1", vacId), "relevant");
  assert.equal(database.getVacancyRelevanceFeedback("u2", vacId), "not_relevant");

  database.close();
});

test("restoring from hidden does not auto-create positive feedback", () => {
  const { database } = createFixture();
  setupTestUsers(database);
  const vacId = insertVacancy(database, "telegram_web_preview", "ch1", "m6", "text6");
  insertMatch(database, "u1", vacId);

  database.setUserVacancyStatus("u1", vacId, "hidden");
  database.upsertVacancyRelevanceFeedback("u1", vacId, "not_relevant");

  database.clearUserVacancyStatus("u1", vacId);
  assert.equal(database.getUserVacancyStatus("u1", vacId), "inbox");

  assert.equal(database.getVacancyRelevanceFeedback("u1", vacId), "not_relevant");

  database.close();
});

test("save does not create relevance feedback", () => {
  const { database } = createFixture();
  setupTestUsers(database);
  const vacId = insertVacancy(database, "telegram_web_preview", "ch1", "m7", "text7");
  insertMatch(database, "u1", vacId);

  database.setUserVacancyStatus("u1", vacId, "saved");
  assert.equal(database.getVacancyRelevanceFeedback("u1", vacId), null);

  database.close();
});

test("applied does not create relevance feedback", () => {
  const { database } = createFixture();
  setupTestUsers(database);
  const vacId = insertVacancy(database, "telegram_web_preview", "ch1", "m8", "text8");
  insertMatch(database, "u1", vacId);

  database.setUserVacancyStatus("u1", vacId, "applied");
  assert.equal(database.getVacancyRelevanceFeedback("u1", vacId), null);

  database.close();
});

test("clear removes feedback", () => {
  const { database } = createFixture();
  setupTestUsers(database);
  const vacId = insertVacancy(database, "telegram_web_preview", "ch1", "m9", "text9");
  insertMatch(database, "u1", vacId);

  database.upsertVacancyRelevanceFeedback("u1", vacId, "relevant");
  assert.equal(database.getVacancyRelevanceFeedback("u1", vacId), "relevant");

  database.clearVacancyRelevanceFeedback("u1", vacId);
  assert.equal(database.getVacancyRelevanceFeedback("u1", vacId), null);

  database.close();
});

test("migration creates vacancy_relevance_feedback table", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-tg-bot-rf-mig-"));
  const databasePath = path.join(tempDir, "bot.db");
  const database = new VacancyDatabase(
    createTestConfig({ databasePath, databaseUrl: `file:${databasePath}`, appDataDir: tempDir, runtimeDir: path.join(tempDir, "runtime") })
  );
  database.initialize();

  const db = (database as unknown as { db: import("better-sqlite3").Database }).db;
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'vacancy_relevance_feedback'").get() as { name: string } | undefined;
  assert.ok(row, "vacancy_relevance_feedback table must exist");

  const columns = db.prepare("PRAGMA table_info(vacancy_relevance_feedback)").all() as Array<{ name: string }>;
  const colNames = new Set(columns.map((c) => c.name));
  assert.ok(colNames.has("user_id"));
  assert.ok(colNames.has("vacancy_id"));
  assert.ok(colNames.has("value"));
  assert.ok(colNames.has("created_at"));
  assert.ok(colNames.has("updated_at"));

  database.close();
});

test("handler: positive feedback via bot callback query", async () => {
  const { database } = createFixture();
  setupTestUsers(database);
  const vacId = insertVacancy(database, "telegram_web_preview", "ch1", "m10", "text for handler test");
  insertMatch(database, "u1", vacId);

  const bot = new grammy.Bot("test:token", {
    botInfo: {
      id: 123456, is_bot: true, first_name: "TestBot", username: "test_bot",
      can_join_groups: false, can_read_all_group_messages: false,
      can_manage_bots: false, supports_inline_queries: false,
      can_connect_to_business: false, has_main_web_app: false,
      has_topics_enabled: false, allows_users_to_create_topics: false
    }
  });

  const capturedEvents: Array<{ eventName: string; userId?: string | null; properties?: Record<string, unknown> }> = [];
  const originalCapture = database.recordAnalyticsEvent.bind(database);
  database.recordAnalyticsEvent = ((input: Parameters<VacancyDatabase["recordAnalyticsEvent"]>[0]) => {
    capturedEvents.push({
      eventName: input.eventName,
      userId: input.userId,
      properties: input.properties as Record<string, unknown> | undefined
    });
    return originalCapture(input);
  }) as unknown as VacancyDatabase["recordAnalyticsEvent"];

  let answerCbText: string | undefined;
  bot.api.config.use((prev, method, payload) => {
    if (method === "answerCallbackQuery") {
      answerCbText = (payload as Record<string, unknown>).text as string | undefined;
      return Promise.resolve({ ok: true, result: true }) as never;
    }
    if (method === "sendMessage" || method === "editMessageReplyMarkup" || method === "editMessageText") {
      return Promise.resolve({ ok: true, result: { message_id: 1 } }) as never;
    }
    return prev(method, payload);
  });

  bot.callbackQuery(/^vacancy:relevance:(\d+):(relevant)(?::(compact|full))?(?::(w[0-9a-z]+|p[0-9a-z]+\.[0-9a-z]+))?$/, async (ctx) => {
    const currentUserId = String(ctx.from?.id ?? "");
    const vacancyId = Number.parseInt(ctx.match?.[1] ?? "0", 10);
    const value = ctx.match?.[2] as "relevant" | undefined;
    if (!currentUserId || !vacancyId || !value) return;
    const existing = database.getVacancyRelevanceFeedback(currentUserId, vacancyId);
    if (existing === value) {
      await ctx.answerCallbackQuery({ text: "👍 Уже отмечено как релевантное." });
      return;
    }
    database.upsertVacancyRelevanceFeedback(currentUserId, vacancyId, value);
    const vacancy = database.getVacancy(vacancyId);
    if (vacancy) {
      database.recordAnalyticsEvent({
        eventName: "vacancy_relevance_feedback",
        userId: currentUserId,
        properties: {
          vacancy_id: vacancyId,
          value,
          source_name: vacancy.sourceName,
          source_channel: vacancy.sourceChannel
        }
      });
    }
    await ctx.answerCallbackQuery({ text: "👍 Отмечено как релевантное." });
  });

  function makeCallbackUpdate(fromId: number, data: string) {
    return {
      update_id: fromId,
      callback_query: {
        id: `cb_${fromId}`,
        from: { id: fromId, is_bot: false, first_name: "User", language_code: "en" },
        message: {
          message_id: 1,
          date: Math.floor(Date.now() / 1000),
          text: "vacancy card",
          chat: { id: fromId, type: "private" as const, first_name: "User" },
          from: { id: fromId, is_bot: false, first_name: "User", language_code: "en" }
        },
        data,
        chat_instance: "test"
      }
    };
  }

  assert.equal(database.getVacancyRelevanceFeedback("777", vacId), null);

  await bot.handleUpdate(makeCallbackUpdate(777, `vacancy:relevance:${vacId}:relevant:compact`));
  assert.equal(database.getVacancyRelevanceFeedback("777", vacId), "relevant");
  assert.equal(answerCbText, "👍 Отмечено как релевантное.");

  const rfEvents = capturedEvents.filter((e) => e.eventName === "vacancy_relevance_feedback");
  assert.equal(rfEvents.length, 1);
  assert.equal(rfEvents[0].properties?.vacancy_id, vacId);
  assert.equal(rfEvents[0].properties?.value, "relevant");
  assert.equal(rfEvents[0].properties?.source_name, "telegram_web_preview");
  assert.equal(rfEvents[0].properties?.source_channel, "ch1");

  assert.equal(database.getUserVacancyStatus("777", vacId), "inbox");

  database.close();
});
