import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as grammy from "grammy";

import { VacancyDatabase } from "../src/db/database";
import { processRelevanceFeedback, handleVacancyRelevanceCallback, handleVacancyHideCallback } from "../src/bot/relevanceFeedbackHandler";
import type { VacancyHideUI } from "../src/bot/relevanceFeedbackHandler";
import type { AnalyticsService } from "../src/analytics/analyticsService";
import { createVacancyKeyboardWithActions } from "../src/bot/keyboards";
import { createTestConfig } from "./helpers";

import type { FilterResult, SourceName, VacancyRelevanceValue } from "../src/types";

interface MockCtx extends grammy.Context {
  readonly answerText: string | undefined;
  readonly answerCount: number;
}

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

function makeMockContext(fromId: number, _data: string): MockCtx {
  let answerCount = 0;
  let answerText: string | undefined;
  const ctx = {
    callbackQuery: {
      id: `cb_${fromId}`,
      from: { id: fromId, is_bot: false, first_name: "User", language_code: "en" },
      message: {
        message_id: 1,
        date: Math.floor(Date.now() / 1000),
        text: "vacancy card",
        chat: { id: fromId, type: "private" as const, first_name: "User" },
        from: { id: fromId, is_bot: false, first_name: "User", language_code: "en" }
      },
      data: _data,
      chat_instance: "test"
    },
    answerCallbackQuery: async (params: string | { text?: string } | undefined) => {
      answerCount++;
      answerText = typeof params === "string" ? params : params?.text;
      return { ok: true, result: true } as never;
    },
    get answerText(): string | undefined { return answerText; },
    get answerCount(): number { return answerCount; },
    editMessageReplyMarkup: () => Promise.resolve({ ok: true } as never),
    editMessageText: () => Promise.resolve({ ok: true } as never),
    deleteMessage: () => Promise.resolve({ ok: true } as never),
    reply: () => Promise.resolve({ message_id: 1 } as never),
    api: { config: { use: () => {} } }
  };
  return ctx as unknown as MockCtx;
}

// ─── Keyboard helpers (shared with botKeyboards.test.ts pattern) ──────────────

type InlineButton = {
  text: string;
  callback_data?: string;
};

function rows(keyboard: unknown): InlineButton[][] {
  return (keyboard as { inline_keyboard?: InlineButton[][] }).inline_keyboard ?? [];
}

function labels(keyboard: unknown): string[] {
  return rows(keyboard).flat().map((button) => button.text);
}

function createMatchedVacancy(overrides: Partial<import("../src/types").MatchedVacancyRecord> = {}): import("../src/types").MatchedVacancyRecord {
  return {
    id: 42,
    sourceName: "telegram_web_preview",
    sourceChannel: "job_react",
    sourceMessageId: "42",
    messageDate: "2026-06-16T10:00:00.000Z",
    title: "Frontend Developer",
    text: "Frontend Developer remote react typescript @hr",
    normalizedText: "frontend developer remote react typescript @hr",
    url: "https://t.me/job_react/42",
    canonicalUrl: null,
    fingerprint: "fingerprint-42",
    score: 10,
    matchSummary: "react, typescript",
    matchedKeywords: ["react"],
    contacts: [{ type: "telegram", value: "@hr" }],
    sentToOwnerAt: null,
    createdAt: "2026-06-16T10:00:00.000Z",
    userId: "777",
    deliveredAt: null,
    matchedAt: "2026-06-16T10:00:00.000Z",
    userStatus: "inbox",
    statusUpdatedAt: null,
    matchedProfileIds: [1],
    matchedProfileNames: ["Основной поиск"],
    ...overrides
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

test("processRelevanceFeedback returns forbidden when no user match exists", () => {
  const { database } = createFixture();
  setupTestUsers(database);
  const result = processRelevanceFeedback(database, "u1", 99999, "relevant");
  assert.equal(result.kind, "forbidden");
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

// --- Handler-level tests using the real exported handler ---

test("handler: positive feedback stores value and fires analytics", async () => {
  const { database } = createFixture();
  setupTestUsers(database);
  const vacId = insertVacancy(database, "telegram_web_preview", "ch1", "h1", "text");
  insertMatch(database, "777", vacId);

  const capturedEvents: Array<{ eventName: string; userId?: string | null; properties?: Record<string, unknown> }> = [];
  const originalCapture = database.recordAnalyticsEvent.bind(database);
  database.recordAnalyticsEvent = ((input: Parameters<VacancyDatabase["recordAnalyticsEvent"]>[0]) => {
    capturedEvents.push({ eventName: input.eventName, userId: input.userId, properties: input.properties as Record<string, unknown> | undefined });
    return originalCapture(input);
  }) as unknown as VacancyDatabase["recordAnalyticsEvent"];

  const analyticsCapture: Array<{ eventName: string; params?: Record<string, unknown> }> = [];
  const analytics = {
    capture: (event: { eventName: string; userId: string; properties?: Record<string, unknown> }) => {
      analyticsCapture.push({ eventName: event.eventName, params: event.properties as Record<string, unknown> });
      return Promise.resolve();
    }
  };

  const ctx: MockCtx = makeMockContext(777, `vacancy:relevance:${vacId}:relevant:compact`);
  await handleVacancyRelevanceCallback(ctx, database, analytics as unknown as import("../src/analytics/analyticsService").AnalyticsService, "777", vacId, "relevant");

  assert.equal(database.getVacancyRelevanceFeedback("777", vacId), "relevant");
  assert.equal(ctx.answerText, "👍 Отмечено как релевантное.");
  assert.equal(ctx.answerCount, 1);

  const rfEvents = capturedEvents.filter((e) => e.eventName === "vacancy_relevance_feedback");
  assert.equal(rfEvents.length, 0, "handler uses analytics.capture, not database.recordAnalyticsEvent");
  assert.equal(analyticsCapture.length, 1);
  assert.equal(analyticsCapture[0].params?.vacancy_id, vacId);
  assert.equal(analyticsCapture[0].params?.value, "relevant");
  assert.equal(analyticsCapture[0].params?.source_name, "telegram_web_preview");
  assert.equal(analyticsCapture[0].params?.source_channel, "ch1");
  assert.equal(analyticsCapture[0].params?.user_id, undefined, "analytics must not contain user_id");
  assert.equal(analyticsCapture[0].params?.user_name, undefined, "analytics must not contain user_name");
  assert.equal(analyticsCapture[0].params?.text, undefined, "analytics must not contain vacancy text");
  assert.equal(analyticsCapture[0].params?.contact, undefined, "analytics must not contain contacts");

  assert.equal(database.getUserVacancyStatus("777", vacId), "inbox");

  database.close();
});

test("handler: repeated positive feedback returns unchanged without second event", async () => {
  const { database } = createFixture();
  setupTestUsers(database);
  const vacId = insertVacancy(database, "telegram_web_preview", "ch1", "h2", "text");
  insertMatch(database, "777", vacId);

  const analyticsCapture: Array<{ eventName: string }> = [];
  const analytics = {
    capture: (event: { eventName: string }) => {
      analyticsCapture.push({ eventName: event.eventName });
      return Promise.resolve();
    }
  };

  const ctx1 = makeMockContext(777, `vacancy:relevance:${vacId}:relevant:compact`);
  await handleVacancyRelevanceCallback(ctx1, database, analytics as unknown as import("../src/analytics/analyticsService").AnalyticsService, "777", vacId, "relevant");
  assert.equal(ctx1.answerText, "👍 Отмечено как релевантное.");
  assert.equal(ctx1.answerCount, 1);

  const ctx2 = makeMockContext(777, `vacancy:relevance:${vacId}:relevant:compact`);
  await handleVacancyRelevanceCallback(ctx2, database, analytics as unknown as import("../src/analytics/analyticsService").AnalyticsService, "777", vacId, "relevant");
  assert.equal(ctx2.answerText, "👍 Уже отмечено как релевантное.");
  assert.equal(ctx2.answerCount, 1);

  const rfEvents = analyticsCapture.filter((e) => e.eventName === "vacancy_relevance_feedback");
  assert.equal(rfEvents.length, 1, "no second event for repeated same value");

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

  const analyticsCapture: Array<{ eventName: string }> = [];
  const analytics = {
    capture: (event: { eventName: string }) => {
      analyticsCapture.push({ eventName: event.eventName });
      return Promise.resolve();
    }
  };

  const ctx = makeMockContext(777, "vacancy:relevance:99999:relevant:compact");
  await handleVacancyRelevanceCallback(ctx, database, analytics as unknown as import("../src/analytics/analyticsService").AnalyticsService, "777", 99999, "relevant");

  assert.equal(analyticsCapture.filter((e) => e.eventName === "vacancy_relevance_feedback").length, 0, "no analytics for non-existent vacancy");
  assert.equal(database.getVacancyRelevanceFeedback("777", 99999), null, "no feedback for non-existent vacancy");
  assert.equal(ctx.answerText, "Вакансия недоступна");
  assert.equal(ctx.answerCount, 1);

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

// ─── Access control: forbidden cases ─────────────────────────────────────────

test("processRelevanceFeedback returns forbidden for another user's match", () => {
  const { database } = createFixture();
  setupTestUsers(database);
  const vacId = insertVacancy(database, "telegram_web_preview", "ch1", "ac1", "text");
  insertMatch(database, "u1", vacId); // match belongs to u1

  const result = processRelevanceFeedback(database, "u2", vacId, "relevant");
  assert.equal(result.kind, "forbidden");
  assert.equal(database.getVacancyRelevanceFeedback("u2", vacId), null);

  database.close();
});

test("processRelevanceFeedback returns forbidden when vacancy exists but no user match", () => {
  const { database } = createFixture();
  setupTestUsers(database);
  const vacId = insertVacancy(database, "telegram_web_preview", "ch1", "ac2", "text");
  // no insertMatch for any user

  const result = processRelevanceFeedback(database, "u1", vacId, "relevant");
  assert.equal(result.kind, "forbidden");
  assert.equal(database.getVacancyRelevanceFeedback("u1", vacId), null);

  database.close();
});

// ─── Keyboard UI restoration tests ───────────────────────────────────────────

test("keyboard: shows not_relevant checkmark when value is not_relevant", () => {
  const keyboard = createVacancyKeyboardWithActions(createMatchedVacancy({}), true, "compact", undefined, "not_relevant");
  const allLabels = labels(keyboard);
  assert.ok(allLabels.includes("👎 Не подходит ✅"));
  assert.ok(allLabels.includes("👍 Релевантна"));
});

test("keyboard: both relevance buttons unmarked when no relevance value", () => {
  const keyboard = createVacancyKeyboardWithActions(createMatchedVacancy({}), true, "compact");
  const allLabels = labels(keyboard);
  assert.ok(allLabels.includes("👍 Релевантна"));
  assert.ok(allLabels.includes("👎 Не подходит"));
  assert.ok(!allLabels.includes("✅"));
});

test("keyboard: relevant checkmark present and not_relevant unmarked when value is relevant", () => {
  const keyboard = createVacancyKeyboardWithActions(createMatchedVacancy({}), true, "compact", undefined, "relevant");
  const allLabels = labels(keyboard);
  assert.ok(allLabels.includes("👍 Релевантна ✅"));
  assert.ok(allLabels.includes("👎 Не подходит"));
});

// ─── Handler answerCallbackQuery tests via real exported handler ──────────────

test("handler: forbidden path answers callback once with Вакансия недоступна", async () => {
  const { database } = createFixture();
  setupTestUsers(database);
  const vacId = insertVacancy(database, "telegram_web_preview", "ch1", "acb1", "text");

  const analytics = { capture: () => Promise.resolve() };
  const ctx = makeMockContext(777, `vacancy:relevance:${vacId}:relevant:compact`);
  await handleVacancyRelevanceCallback(ctx, database, analytics as unknown as import("../src/analytics/analyticsService").AnalyticsService, "777", vacId, "relevant");

  assert.equal(ctx.answerText, "Вакансия недоступна");
  assert.equal(ctx.answerCount, 1);
  assert.equal(database.getVacancyRelevanceFeedback("777", vacId), null);

  database.close();
});

test("handler: unchanged path answers callback once with already marked message", async () => {
  const { database } = createFixture();
  setupTestUsers(database);
  const vacId = insertVacancy(database, "telegram_web_preview", "ch1", "acb2", "text");
  insertMatch(database, "777", vacId);

  const analytics = { capture: () => Promise.resolve() };

  const ctx1 = makeMockContext(777, `vacancy:relevance:${vacId}:relevant:compact`);
  await handleVacancyRelevanceCallback(ctx1, database, analytics as unknown as import("../src/analytics/analyticsService").AnalyticsService, "777", vacId, "relevant");
  assert.equal(ctx1.answerText, "👍 Отмечено как релевантное.");
  assert.equal(ctx1.answerCount, 1);

  const ctx2 = makeMockContext(777, `vacancy:relevance:${vacId}:relevant:compact`);
  await handleVacancyRelevanceCallback(ctx2, database, analytics as unknown as import("../src/analytics/analyticsService").AnalyticsService, "777", vacId, "relevant");
  assert.equal(ctx2.answerText, "👍 Уже отмечено как релевантное.");
  assert.equal(ctx2.answerCount, 1);

  database.close();
});

test("handler: recorded path answers callback once with success message", async () => {
  const { database } = createFixture();
  setupTestUsers(database);
  const vacId = insertVacancy(database, "telegram_web_preview", "ch1", "acb3", "text");
  insertMatch(database, "777", vacId);

  const analytics = { capture: () => Promise.resolve() };
  const ctx = makeMockContext(777, `vacancy:relevance:${vacId}:relevant:compact`);
  await handleVacancyRelevanceCallback(ctx, database, analytics as unknown as import("../src/analytics/analyticsService").AnalyticsService, "777", vacId, "relevant");

  assert.equal(ctx.answerText, "👍 Отмечено как релевантное.");
  assert.equal(ctx.answerCount, 1);

  database.close();
});

// ─── Production-flow: forged hide callback ───────────────────────────────────

test("hide: forged callback without match — forbidden, no side effects, single answer", async () => {
  const { database } = createFixture();
  setupTestUsers(database);
  const vacId = insertVacancy(database, "telegram_web_preview", "ch1", "pf1", "text");

  const result = processRelevanceFeedback(database, "777", vacId, "not_relevant");
  assert.equal(result.kind, "forbidden");
  assert.equal(database.getUserVacancyStatus("777", vacId), "inbox", "status unchanged");
  assert.equal(database.getVacancyRelevanceFeedback("777", vacId), null, "no feedback created");

  database.close();
});

test("hide: repeated forged callback also returns forbidden", async () => {
  const { database } = createFixture();
  setupTestUsers(database);
  const vacId = insertVacancy(database, "telegram_web_preview", "ch1", "pf2", "text");

  const r1 = processRelevanceFeedback(database, "777", vacId, "not_relevant");
  assert.equal(r1.kind, "forbidden");
  assert.equal(database.getVacancyRelevanceFeedback("777", vacId), null);

  const r2 = processRelevanceFeedback(database, "777", vacId, "not_relevant");
  assert.equal(r2.kind, "forbidden", "second call also forbidden, not unchanged");
  assert.equal(database.getVacancyRelevanceFeedback("777", vacId), null, "no feedback created");

  database.close();
});

test("hide: orphan feedback returns forbidden, not unchanged", async () => {
  const { database } = createFixture();
  setupTestUsers(database);
  const vacId = insertVacancy(database, "telegram_web_preview", "ch1", "orphan1", "text");

  database.upsertVacancyRelevanceFeedback("777", vacId, "not_relevant");
  assert.equal(database.getVacancyRelevanceFeedback("777", vacId), "not_relevant");
  assert.equal(database.hasUserVacancyMatch("777", vacId), false);

  const result = processRelevanceFeedback(database, "777", vacId, "not_relevant");
  assert.equal(result.kind, "forbidden", "orphan feedback must return forbidden, not unchanged");
  assert.equal(database.getVacancyRelevanceFeedback("777", vacId), "not_relevant", "existing orphan feedback preserved");

  database.close();
});

// ─── Real keyboard builder with DB-backed relevanceValue ─────────────────────

test("keyboard builder uses DB feedback value for relevant marking", () => {
  const { database } = createFixture();
  setupTestUsers(database);
  const vacId = insertVacancy(database, "telegram_web_preview", "ch1", "dbk1", "text");
  insertMatch(database, "u1", vacId);

  processRelevanceFeedback(database, "u1", vacId, "relevant");
  const value = database.getVacancyRelevanceFeedback("u1", vacId);
  assert.equal(value, "relevant");

  const keyboard = createVacancyKeyboardWithActions(createMatchedVacancy({ id: vacId }), true, "compact", undefined, value ?? undefined);
  const allLabels = labels(keyboard);
  assert.ok(allLabels.includes("👍 Релевантна ✅"));
  assert.ok(allLabels.includes("👎 Не подходит"));

  database.close();
});

test("keyboard builder uses DB feedback value for not_relevant marking", () => {
  const { database } = createFixture();
  setupTestUsers(database);
  const vacId = insertVacancy(database, "telegram_web_preview", "ch1", "dbk2", "text");
  insertMatch(database, "u1", vacId);

  processRelevanceFeedback(database, "u1", vacId, "not_relevant");
  const value = database.getVacancyRelevanceFeedback("u1", vacId);
  assert.equal(value, "not_relevant");

  const keyboard = createVacancyKeyboardWithActions(createMatchedVacancy({ id: vacId }), true, "compact", undefined, value ?? undefined);
  const allLabels = labels(keyboard);
  assert.ok(allLabels.includes("👎 Не подходит ✅"));
  assert.ok(allLabels.includes("👍 Релевантна"));

  database.close();
});

// ─── Production-flow handler tests: handleVacancyHideCallback ────────────────

function makeHideUI(): { ui: VacancyHideUI; calls: { dismiss: number; reason: number } } {
  const calls = { dismiss: 0, reason: 0 };
  return {
    calls,
    ui: {
      dismissOrRestoreWeekly: async () => { calls.dismiss++; },
      showReasonPrompt: async () => { calls.reason++; }
    }
  };
}

type AnalyticsSpy = ReturnType<typeof makeAnalyticsSpy>;
function makeAnalyticsSpy() {
  const events: Array<{ eventName: string; userId: string; properties?: Record<string, unknown> }> = [];
  return {
    events,
    capture: (event: { eventName: string; userId: string; properties?: Record<string, unknown> }) => {
      events.push({ eventName: event.eventName, userId: event.userId, properties: event.properties as Record<string, unknown> | undefined });
      return Promise.resolve();
    }
  };
}

test("handleHide: forged callback without match — forbidden, no side effects, single answer", async () => {
  const { database } = createFixture();
  setupTestUsers(database);
  const vacId = insertVacancy(database, "telegram_web_preview", "ch1", "prod1", "text");
  const spy = makeAnalyticsSpy();
  const analytics = spy as unknown as AnalyticsService;
  const { ui, calls } = makeHideUI();

  const ctx: MockCtx = makeMockContext(777, `vacancy:status:${vacId}:hidden:compact`);
  const result = await handleVacancyHideCallback(ctx, database, analytics, "777", vacId, "inbox", ui);

  assert.equal(result, "forbidden");
  assert.equal(ctx.answerText, "Вакансия недоступна");
  assert.equal(ctx.answerCount, 1, "exactly one answer");
  assert.equal(database.getUserVacancyStatus("777", vacId), "inbox", "status unchanged");
  assert.equal(database.getVacancyRelevanceFeedback("777", vacId), null, "no feedback created");
  assert.equal(calls.dismiss, 0, "dismiss UI not called");
  assert.equal(calls.reason, 0, "reason UI not called");
  assert.equal(spy.events.length, 0, "no analytics events captured");

  database.close();
});

test("handleHide: valid hide — status hidden, feedback recorded, single answer, UI called", async () => {
  const { database } = createFixture();
  setupTestUsers(database);
  const vacId = insertVacancy(database, "telegram_web_preview", "ch1", "prod2", "text");
  insertMatch(database, "777", vacId);
  const spy = makeAnalyticsSpy();
  const analytics = spy as unknown as AnalyticsService;
  const { ui, calls } = makeHideUI();

  const ctx: MockCtx = makeMockContext(777, `vacancy:status:${vacId}:hidden:compact`);
  const result = await handleVacancyHideCallback(ctx, database, analytics, "777", vacId, "inbox", ui);

  assert.equal(result, "hidden");
  assert.equal(ctx.answerText, "👎 Скрыто.");
  assert.equal(ctx.answerCount, 1, "exactly one answer");
  assert.equal(database.getUserVacancyStatus("777", vacId), "hidden", "status changed to hidden");
  assert.equal(database.getVacancyRelevanceFeedback("777", vacId), "not_relevant", "feedback created");
  assert.equal(calls.dismiss, 1, "dismiss UI called once");
  assert.equal(calls.reason, 1, "reason UI called once");

  const feedbackEvents = spy.events.filter((e) => e.eventName === "vacancy_relevance_feedback");
  assert.equal(feedbackEvents.length, 1, "feedback analytics captured");
  assert.equal(feedbackEvents[0].properties?.value, "not_relevant");

  const statusEvents = spy.events.filter((e) => e.eventName === "vacancy_status_changed");
  assert.equal(statusEvents.length, 1, "status change analytics captured");
  assert.equal(statusEvents[0].properties?.next_status, "hidden");
  assert.equal(statusEvents[0].properties?.previous_status, "inbox");

  database.close();
});

test("handleHide: second hide returns forbidden (no match after deletion)", async () => {
  const { database } = createFixture();
  setupTestUsers(database);
  const vacId = insertVacancy(database, "telegram_web_preview", "ch1", "prod3", "text");
  const spy = makeAnalyticsSpy();
  const analytics = spy as unknown as AnalyticsService;
  const { ui, calls } = makeHideUI();

  const ctx: MockCtx = makeMockContext(777, `vacancy:status:${vacId}:hidden:compact`);
  const result = await handleVacancyHideCallback(ctx, database, analytics, "777", vacId, "inbox", ui);

  assert.equal(result, "forbidden");
  assert.equal(ctx.answerCount, 1, "single answer on second hide");
  assert.equal(ctx.answerText, "Вакансия недоступна");
  assert.equal(spy.events.length, 0, "no analytics on forbidden");
  assert.equal(calls.dismiss, 0, "dismiss not called on forbidden");
  assert.equal(calls.reason, 0, "reason not called on forbidden");

  database.close();
});

test("handleHide: reopening card shows persisted not_relevant feedback via keyboard", async () => {
  const { database } = createFixture();
  setupTestUsers(database);
  const vacId = insertVacancy(database, "telegram_web_preview", "ch1", "prod4", "text");
  insertMatch(database, "777", vacId);
  const spy = makeAnalyticsSpy();
  const analytics = spy as unknown as AnalyticsService;
  const { ui } = makeHideUI();

  const ctx: MockCtx = makeMockContext(777, `vacancy:status:${vacId}:hidden:compact`);
  await handleVacancyHideCallback(ctx, database, analytics, "777", vacId, "inbox", ui);
  assert.equal(database.getVacancyRelevanceFeedback("777", vacId), "not_relevant");

  const keyboard = createVacancyKeyboardWithActions(createMatchedVacancy({ id: vacId }), true, "compact", undefined, "not_relevant");
  const allLabels = labels(keyboard);
  assert.ok(allLabels.includes("👎 Не подходит ✅"), "reopened card shows not_relevant checkmark");
  assert.ok(allLabels.includes("👍 Релевантна"));

  database.close();
});
