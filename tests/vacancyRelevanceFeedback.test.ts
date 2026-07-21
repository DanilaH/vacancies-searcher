import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as grammy from "grammy";

import { VacancyDatabase } from "../src/db/database";
import { processRelevanceFeedback } from "../src/bot/relevanceFeedbackHandler";
import { createTestConfig } from "./helpers";

import type { FilterResult, SourceName, VacancyRelevanceValue } from "../src/types";

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

function makeBot() {
  return new grammy.Bot("test:token", {
    botInfo: {
      id: 123456, is_bot: true, first_name: "TestBot", username: "test_bot",
      can_join_groups: false, can_read_all_group_messages: false,
      can_manage_bots: false, supports_inline_queries: false,
      can_connect_to_business: false, has_main_web_app: false,
      has_topics_enabled: false, allows_users_to_create_topics: false
    }
  });
}

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

// --- DB-level processRelevanceFeedback tests ---

test("processRelevanceFeedback returns recorded for new value", () => {
  const { database } = createFixture();
  setupTestUsers(database);
  const vacId = insertVacancy(database, "telegram_web_preview", "ch1", "m1", "text");
  insertMatch(database, "u1", vacId);

  assert.equal(database.getUserVacancyStatus("u1", vacId), "inbox");

  const result = processRelevanceFeedback(database, "u1", vacId, "relevant");
  assert.equal(result.kind, "recorded");
  if (result.kind === "recorded") {
    assert.equal(result.event.properties.value, "relevant");
    assert.equal(result.event.properties.source_name, "telegram_web_preview");
    assert.equal(result.event.properties.source_channel, "ch1");
    assert.equal(result.event.properties.vacancy_id, vacId);
  }

  assert.equal(database.getUserVacancyStatus("u1", vacId), "inbox");
  assert.equal(database.getVacancyRelevanceFeedback("u1", vacId), "relevant");

  database.close();
});

test("processRelevanceFeedback returns unchanged for same value", () => {
  const { database } = createFixture();
  setupTestUsers(database);
  const vacId = insertVacancy(database, "telegram_web_preview", "ch1", "m2", "text");
  insertMatch(database, "u1", vacId);

  const r1 = processRelevanceFeedback(database, "u1", vacId, "relevant");
  assert.equal(r1.kind, "recorded");

  const r2 = processRelevanceFeedback(database, "u1", vacId, "relevant");
  assert.equal(r2.kind, "unchanged");

  database.close();
});

test("processRelevanceFeedback detects value change", () => {
  const { database } = createFixture();
  setupTestUsers(database);
  const vacId = insertVacancy(database, "telegram_web_preview", "ch1", "m3", "text");
  insertMatch(database, "u1", vacId);

  const r1 = processRelevanceFeedback(database, "u1", vacId, "relevant");
  assert.equal(r1.kind, "recorded");

  const r2 = processRelevanceFeedback(database, "u1", vacId, "not_relevant");
  assert.equal(r2.kind, "recorded");
  if (r2.kind === "recorded") {
    assert.equal(r2.event.properties.value, "not_relevant");
  }

  const r3 = processRelevanceFeedback(database, "u1", vacId, "relevant");
  assert.equal(r3.kind, "recorded");
  if (r3.kind === "recorded") {
    assert.equal(r3.event.properties.value, "relevant");
  }

  database.close();
});

test("processRelevanceFeedback returns vacancy_not_found for missing vacancy", () => {
  const { database } = createFixture();
  setupTestUsers(database);
  const result = processRelevanceFeedback(database, "u1", 99999, "relevant");
  assert.equal(result.kind, "vacancy_not_found");
  database.close();
});

test("Не подходит stores not_relevant via processRelevanceFeedback", () => {
  const { database } = createFixture();
  setupTestUsers(database);
  const vacId = insertVacancy(database, "telegram_web_preview", "ch1", "m4", "text");
  insertMatch(database, "u1", vacId);

  database.setUserVacancyStatus("u1", vacId, "hidden");

  const result = processRelevanceFeedback(database, "u1", vacId, "not_relevant");
  assert.equal(result.kind, "recorded");

  assert.equal(database.getUserVacancyStatus("u1", vacId), "hidden");
  assert.equal(database.getVacancyRelevanceFeedback("u1", vacId), "not_relevant");

  database.close();
});

test("feedback is isolated between users", () => {
  const { database } = createFixture();
  setupTestUsers(database);
  const vacId = insertVacancy(database, "telegram_web_preview", "ch1", "m5", "text");
  insertMatch(database, "u1", vacId);
  insertMatch(database, "u2", vacId);

  processRelevanceFeedback(database, "u1", vacId, "relevant");
  processRelevanceFeedback(database, "u2", vacId, "not_relevant");

  assert.equal(database.getVacancyRelevanceFeedback("u1", vacId), "relevant");
  assert.equal(database.getVacancyRelevanceFeedback("u2", vacId), "not_relevant");

  database.close();
});

test("restoring from hidden does not auto-create positive feedback", () => {
  const { database } = createFixture();
  setupTestUsers(database);
  const vacId = insertVacancy(database, "telegram_web_preview", "ch1", "m6", "text");
  insertMatch(database, "u1", vacId);

  database.setUserVacancyStatus("u1", vacId, "hidden");
  processRelevanceFeedback(database, "u1", vacId, "not_relevant");

  database.clearUserVacancyStatus("u1", vacId);
  assert.equal(database.getUserVacancyStatus("u1", vacId), "inbox");
  assert.equal(database.getVacancyRelevanceFeedback("u1", vacId), "not_relevant");

  database.close();
});

test("save does not create relevance feedback", () => {
  const { database } = createFixture();
  setupTestUsers(database);
  const vacId = insertVacancy(database, "telegram_web_preview", "ch1", "m7", "text");
  insertMatch(database, "u1", vacId);

  database.setUserVacancyStatus("u1", vacId, "saved");
  assert.equal(database.getVacancyRelevanceFeedback("u1", vacId), null);

  database.close();
});

test("applied does not create relevance feedback", () => {
  const { database } = createFixture();
  setupTestUsers(database);
  const vacId = insertVacancy(database, "telegram_web_preview", "ch1", "m8", "text");
  insertMatch(database, "u1", vacId);

  database.setUserVacancyStatus("u1", vacId, "applied");
  assert.equal(database.getVacancyRelevanceFeedback("u1", vacId), null);

  database.close();
});

test("clear removes feedback", () => {
  const { database } = createFixture();
  setupTestUsers(database);
  const vacId = insertVacancy(database, "telegram_web_preview", "ch1", "m9", "text");
  insertMatch(database, "u1", vacId);

  processRelevanceFeedback(database, "u1", vacId, "relevant");
  assert.equal(database.getVacancyRelevanceFeedback("u1", vacId), "relevant");

  database.clearVacancyRelevanceFeedback("u1", vacId);
  assert.equal(database.getVacancyRelevanceFeedback("u1", vacId), null);

  database.close();
});

test("idempotent upsert does not change updated_at", () => {
  const { database } = createFixture();
  setupTestUsers(database);
  const vacId = insertVacancy(database, "telegram_web_preview", "ch1", "m10", "text");
  insertMatch(database, "u1", vacId);

  const r1 = database.upsertVacancyRelevanceFeedback("u1", vacId, "relevant");
  const r2 = database.upsertVacancyRelevanceFeedback("u1", vacId, "relevant");
  assert.equal(r2.value, "relevant");
  assert.equal(r2.updatedAt, r1.updatedAt);

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

// --- Handler-level tests via bot.handleUpdate ---

test("handler: positive feedback stores value and fires analytics", async () => {
  const { database } = createFixture();
  setupTestUsers(database);
  const vacId = insertVacancy(database, "telegram_web_preview", "ch1", "h1", "text");
  insertMatch(database, "u1", vacId);

  const bot = makeBot();

  const capturedEvents: Array<{ eventName: string; userId?: string | null; properties?: Record<string, unknown> }> = [];
  const originalCapture = database.recordAnalyticsEvent.bind(database);
  database.recordAnalyticsEvent = ((input: Parameters<VacancyDatabase["recordAnalyticsEvent"]>[0]) => {
    capturedEvents.push({ eventName: input.eventName, userId: input.userId, properties: input.properties as Record<string, unknown> | undefined });
    return originalCapture(input);
  }) as unknown as VacancyDatabase["recordAnalyticsEvent"];

  let lastCbAnswer: string | undefined;
  bot.api.config.use((prev, method, payload) => {
    if (method === "answerCallbackQuery") {
      lastCbAnswer = (payload as Record<string, unknown>).text as string | undefined;
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
    const result = processRelevanceFeedback(database, currentUserId, vacancyId, value);
    if (result.kind === "unchanged") {
      await ctx.answerCallbackQuery({ text: "👍 Уже отмечено как релевантное." });
      return;
    }
    if (result.kind === "vacancy_not_found") {
      await ctx.answerCallbackQuery({ text: "⚠️ Вакансия больше недоступна." });
      return;
    }
    database.recordAnalyticsEvent(result.event);
    await ctx.answerCallbackQuery({ text: "👍 Отмечено как релевантное." });
  });

  assert.equal(database.getVacancyRelevanceFeedback("777", vacId), null);

  await bot.handleUpdate(makeCallbackUpdate(777, `vacancy:relevance:${vacId}:relevant:compact`));
  assert.equal(database.getVacancyRelevanceFeedback("777", vacId), "relevant");
  assert.equal(lastCbAnswer, "👍 Отмечено как релевантное.");

  const rfEvents = capturedEvents.filter((e) => e.eventName === "vacancy_relevance_feedback");
  assert.equal(rfEvents.length, 1);
  assert.equal(rfEvents[0].properties?.vacancy_id, vacId);
  assert.equal(rfEvents[0].properties?.value, "relevant");
  assert.equal(rfEvents[0].properties?.source_name, "telegram_web_preview");
  assert.equal(rfEvents[0].properties?.source_channel, "ch1");
  assert.equal(rfEvents[0].properties?.user_id, undefined, "analytics must not contain user_id");
  assert.equal(rfEvents[0].properties?.user_name, undefined, "analytics must not contain user_name");
  assert.equal(rfEvents[0].properties?.text, undefined, "analytics must not contain vacancy text");
  assert.equal(rfEvents[0].properties?.contact, undefined, "analytics must not contain contacts");

  assert.equal(database.getUserVacancyStatus("777", vacId), "inbox");

  database.close();
});

test("handler: repeated positive feedback returns unchanged without second event", async () => {
  const { database } = createFixture();
  setupTestUsers(database);
  const vacId = insertVacancy(database, "telegram_web_preview", "ch1", "h2", "text");
  insertMatch(database, "u1", vacId);

  const bot = makeBot();

  const capturedEvents: Array<{ eventName: string; properties?: Record<string, unknown> }> = [];
  const originalCapture = database.recordAnalyticsEvent.bind(database);
  database.recordAnalyticsEvent = ((input: Parameters<VacancyDatabase["recordAnalyticsEvent"]>[0]) => {
    capturedEvents.push({ eventName: input.eventName, properties: input.properties as Record<string, unknown> | undefined });
    return originalCapture(input);
  }) as unknown as VacancyDatabase["recordAnalyticsEvent"];

  let lastCbAnswer: string | undefined;
  bot.api.config.use((prev, method, payload) => {
    if (method === "answerCallbackQuery") {
      lastCbAnswer = (payload as Record<string, unknown>).text as string | undefined;
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
    const result = processRelevanceFeedback(database, currentUserId, vacancyId, value);
    if (result.kind === "unchanged") {
      await ctx.answerCallbackQuery({ text: "👍 Уже отмечено как релевантное." });
      return;
    }
    if (result.kind === "vacancy_not_found") {
      await ctx.answerCallbackQuery({ text: "⚠️ Вакансия больше недоступна." });
      return;
    }
    database.recordAnalyticsEvent(result.event);
    await ctx.answerCallbackQuery({ text: "👍 Отмечено как релевантное." });
  });

  await bot.handleUpdate(makeCallbackUpdate(777, `vacancy:relevance:${vacId}:relevant:compact`));
  assert.equal(capturedEvents.filter((e) => e.eventName === "vacancy_relevance_feedback").length, 1);

  lastCbAnswer = undefined;
  await bot.handleUpdate(makeCallbackUpdate(777, `vacancy:relevance:${vacId}:relevant:compact`));
  assert.equal(lastCbAnswer, "👍 Уже отмечено как релевантное.");
  assert.equal(capturedEvents.filter((e) => e.eventName === "vacancy_relevance_feedback").length, 1, "no second event for repeated same value");

  database.close();
});

test("handler: hide vacancy creates not_relevant feedback with analytics", async () => {
  const { database } = createFixture();
  setupTestUsers(database);
  const vacId = insertVacancy(database, "telegram_web_preview", "ch1", "h3", "text");
  insertMatch(database, "u1", vacId);

  const bot = makeBot();
  const capturedEvents: Array<{ eventName: string; properties?: Record<string, unknown> }> = [];
  const originalCapture = database.recordAnalyticsEvent.bind(database);
  database.recordAnalyticsEvent = ((input: Parameters<VacancyDatabase["recordAnalyticsEvent"]>[0]) => {
    capturedEvents.push({ eventName: input.eventName, properties: input.properties as Record<string, unknown> | undefined });
    return originalCapture(input);
  }) as unknown as VacancyDatabase["recordAnalyticsEvent"];

  bot.api.config.use((prev, method, payload) => {
    if (method === "answerCallbackQuery" || method === "sendMessage" || method === "editMessageReplyMarkup" || method === "editMessageText" || method === "deleteMessage") {
      return Promise.resolve({ ok: true, result: {} }) as never;
    }
    return prev(method, payload);
  });

  const REGEX_HIDE = /^vacancy:status:(\d+):(saved|applied|hidden)(?::(compact|full))?(?::(w[0-9a-z]+|p[0-9a-z]+\.[0-9a-z]+))?$/;
  bot.callbackQuery(REGEX_HIDE, async (ctx) => {
    const currentUserId = String(ctx.from?.id ?? "");
    const vacancyId = Number.parseInt(ctx.match?.[1] ?? "0", 10);
    const requestedStatus = ctx.match?.[2] as string | undefined;
    if (!currentUserId || !vacancyId || requestedStatus !== "hidden") return;

    database.setUserVacancyStatus(currentUserId, vacancyId, "hidden");
    const result = processRelevanceFeedback(database, currentUserId, vacancyId, "not_relevant");
    if (result.kind === "recorded") {
      database.recordAnalyticsEvent(result.event);
    }
    await ctx.answerCallbackQuery({ text: "👎 Скрыто." });
  });

  assert.equal(database.getVacancyRelevanceFeedback("777", vacId), null);
  assert.equal(database.getUserVacancyStatus("777", vacId), "inbox");

  await bot.handleUpdate(makeCallbackUpdate(777, `vacancy:status:${vacId}:hidden:compact`));

  assert.equal(database.getUserVacancyStatus("777", vacId), "hidden");
  assert.equal(database.getVacancyRelevanceFeedback("777", vacId), "not_relevant");
  assert.equal(capturedEvents.filter((e) => e.eventName === "vacancy_relevance_feedback").length, 1);

  database.close();
});

test("handler: second hide does not fire second analytics event", async () => {
  const { database } = createFixture();
  setupTestUsers(database);
  const vacId = insertVacancy(database, "telegram_web_preview", "ch1", "h4", "text");
  insertMatch(database, "u1", vacId);

  const bot = makeBot();
  const capturedEvents: Array<{ eventName: string; properties?: Record<string, unknown> }> = [];
  const originalCapture = database.recordAnalyticsEvent.bind(database);
  database.recordAnalyticsEvent = ((input: Parameters<VacancyDatabase["recordAnalyticsEvent"]>[0]) => {
    capturedEvents.push({ eventName: input.eventName, properties: input.properties as Record<string, unknown> | undefined });
    return originalCapture(input);
  }) as unknown as VacancyDatabase["recordAnalyticsEvent"];

  bot.api.config.use((prev, method, payload) => {
    if (method === "answerCallbackQuery" || method === "sendMessage" || method === "editMessageReplyMarkup" || method === "editMessageText" || method === "deleteMessage") {
      return Promise.resolve({ ok: true, result: {} }) as never;
    }
    return prev(method, payload);
  });

  bot.callbackQuery(/^vacancy:status:(\d+):(saved|applied|hidden)(?::(compact|full))?(?::(w[0-9a-z]+|p[0-9a-z]+\.[0-9a-z]+))?$/, async (ctx) => {
    const currentUserId = String(ctx.from?.id ?? "");
    const vacancyId = Number.parseInt(ctx.match?.[1] ?? "0", 10);
    const requestedStatus = ctx.match?.[2] as string | undefined;
    if (!currentUserId || !vacancyId || requestedStatus !== "hidden") return;
    database.setUserVacancyStatus(currentUserId, vacancyId, "hidden");
    const result = processRelevanceFeedback(database, currentUserId, vacancyId, "not_relevant");
    if (result.kind === "recorded") {
      database.recordAnalyticsEvent(result.event);
    }
    await ctx.answerCallbackQuery();
  });

  await bot.handleUpdate(makeCallbackUpdate(777, `vacancy:status:${vacId}:hidden:compact`));
  assert.equal(capturedEvents.filter((e) => e.eventName === "vacancy_relevance_feedback").length, 1);

  await bot.handleUpdate(makeCallbackUpdate(777, `vacancy:status:${vacId}:hidden:compact`));
  assert.equal(capturedEvents.filter((e) => e.eventName === "vacancy_relevance_feedback").length, 1, "no second event for second hide");

  database.close();
});

test("processRelevanceFeedback returns event on value change", () => {
  const { database } = createFixture();
  setupTestUsers(database);
  const vacId = insertVacancy(database, "telegram_web_preview", "ch1", "h5", "text");
  insertMatch(database, "u1", vacId);

  const r1 = processRelevanceFeedback(database, "u1", vacId, "relevant");
  assert.equal(r1.kind, "recorded");
  assert.ok(r1.kind === "recorded" ? r1.event.properties.value === "relevant" : false);

  const r2 = processRelevanceFeedback(database, "u1", vacId, "not_relevant");
  assert.equal(r2.kind, "recorded");
  assert.ok(r2.kind === "recorded" ? r2.event.properties.value === "not_relevant" : false);

  const r3 = processRelevanceFeedback(database, "u1", vacId, "relevant");
  assert.equal(r3.kind, "recorded");
  assert.ok(r3.kind === "recorded" ? r3.event.properties.value === "relevant" : false);

  database.close();
});

test("handler: forged/stale callback does not create feedback", async () => {
  const { database } = createFixture();
  setupTestUsers(database);
  const bot = makeBot();

  const capturedEvents: Array<{ eventName: string }> = [];
  const originalCapture = database.recordAnalyticsEvent.bind(database);
  database.recordAnalyticsEvent = ((input: Parameters<VacancyDatabase["recordAnalyticsEvent"]>[0]) => {
    capturedEvents.push({ eventName: input.eventName });
    return originalCapture(input);
  }) as unknown as VacancyDatabase["recordAnalyticsEvent"];

  bot.api.config.use((prev, method, payload) => {
    if (method === "answerCallbackQuery" || method === "sendMessage" || method === "editMessageReplyMarkup" || method === "editMessageText") {
      return Promise.resolve({ ok: true, result: {} }) as never;
    }
    return prev(method, payload);
  });

  bot.callbackQuery(/^vacancy:relevance:(\d+):(relevant)(?::(compact|full))?(?::(w[0-9a-z]+|p[0-9a-z]+\.[0-9a-z]+))?$/, async (ctx) => {
    const currentUserId = String(ctx.from?.id ?? "");
    const vacancyId = Number.parseInt(ctx.match?.[1] ?? "0", 10);
    const value = ctx.match?.[2] as "relevant" | undefined;
    if (!currentUserId || !vacancyId || !value) return;
    const result = processRelevanceFeedback(database, currentUserId, vacancyId, value);
    if (result.kind === "vacancy_not_found") {
      await ctx.answerCallbackQuery({ text: "⚠️ Вакансия больше недоступна." });
      return;
    }
    if (result.kind === "recorded") {
      database.recordAnalyticsEvent(result.event);
    }
    await ctx.answerCallbackQuery();
  });

  await bot.handleUpdate(makeCallbackUpdate(777, "vacancy:relevance:99999:relevant:compact"));
  assert.equal(capturedEvents.filter((e) => e.eventName === "vacancy_relevance_feedback").length, 0, "no analytics for non-existent vacancy");
  assert.equal(database.getVacancyRelevanceFeedback("777", 99999), null, "no feedback for non-existent vacancy");

  database.close();
});

test("handler: restore from hidden does not create positive feedback", async () => {
  const { database } = createFixture();
  setupTestUsers(database);
  const vacId = insertVacancy(database, "telegram_web_preview", "ch1", "h6", "text");
  insertMatch(database, "u1", vacId);

  database.setUserVacancyStatus("u1", vacId, "hidden");
  processRelevanceFeedback(database, "u1", vacId, "not_relevant");

  database.clearUserVacancyStatus("u1", vacId);
  assert.equal(database.getVacancyRelevanceFeedback("u1", vacId), "not_relevant");

  database.close();
});

test("handler: analytics event contains allowed fields only", async () => {
  const { database } = createFixture();
  setupTestUsers(database);
  const vacId = insertVacancy(database, "telegram_web_preview", "ch1", "h7", "confidential text with contact@example.com");
  insertMatch(database, "u1", vacId);

  const result = processRelevanceFeedback(database, "u1", vacId, "relevant");
  assert.equal(result.kind, "recorded");
  if (result.kind === "recorded") {
    const props = result.event.properties;
    const allowedKeys = ["vacancy_id", "value", "source_name", "source_channel"];
    for (const key of Object.keys(props)) {
      assert.ok(allowedKeys.includes(key), `unexpected analytics key: ${key}`);
    }
    assert.equal(props.vacancy_id, vacId);
    assert.equal(props.value, "relevant");
    assert.equal(props.source_name, "telegram_web_preview");
    assert.equal(props.source_channel, "ch1");
    assert.equal((props as Record<string, unknown>).text, undefined);
    assert.equal((props as Record<string, unknown>).contacts, undefined);
    assert.equal((props as Record<string, unknown>).user_name, undefined);
  }

  database.close();
});
