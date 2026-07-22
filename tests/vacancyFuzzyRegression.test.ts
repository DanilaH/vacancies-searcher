import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createAnalyticsService } from "../src/analytics/analyticsService";
import type { BotController } from "../src/bot/createBot";
import { VacancyDatabase } from "../src/db/database";
import { VacancyFilter } from "../src/services/vacancyFilter";
import { VacancyIngestor } from "../src/services/vacancyIngestor";
import type { MatchedVacancyRecord } from "../src/types";
import { createTestConfig } from "./helpers";

function createFixture() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-tg-bot-fuzzy-regression-"));
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
  const deliveries: number[] = [];
  const bot: BotController = {
    async start() {},
    async stop() {},
    async notifyVacancy(vacancy: MatchedVacancyRecord) {
      deliveries.push(vacancy.id);
      return true;
    },
    async sendVacancyReminder() { return true; },
    async sendApplicationFollowUp() { return true; },
    async sendNoNewVacanciesNotification() { return true; },
    async sendStartupDiagnostic() {},
    async sendAdminAlert() { return true; },
    async sendOwnerReport() { return true; }
  };
  const analytics = createAnalyticsService(config, database);
  const filter = new VacancyFilter(config);
  const ingestor = new VacancyIngestor(config, filter, database, bot, analytics);
  return { database, analytics, ingestor, deliveries };
}

test("per-user fuzzy dedup: user A matches first, user B matches second only", async () => {
  const fixture = createFixture();
  fixture.database.setUserSearchProfileKeywords("userA", "required_context", ["remote"]);
  fixture.database.setUserSearchProfileKeywords("userA", "required_primary", ["python"]);
  fixture.database.setUserSearchProfileKeywords("userB", "required_context", ["remote"]);
  fixture.database.setUserSearchProfileKeywords("userB", "required_primary", ["golang"]);

  const firstResult = await fixture.ingestor.handle({
    source: "telegram_web_preview" as const,
    channel: "ch1",
    messageId: "f1",
    date: new Date("2026-07-20T10:00:00Z").toISOString(),
    text: "Senior Python Developer (Django)\nRemote\nSalary: 5000 USD",
    url: "https://t.me/ch1/f1"
  });

  const secondResult = await fixture.ingestor.handle({
    source: "telegram_web_preview" as const,
    channel: "ch2",
    messageId: "f2",
    date: new Date("2026-07-20T14:00:00Z").toISOString(),
    text: "Senior Python Developer (Django) — релокация\nRemote\nSalary: 5000 USD\nStack: Golang, Kubernetes",
    url: "https://t.me/ch2/f2"
  });

  assert.deepEqual(firstResult, ["userA"], "User A should match first cross-post");
  assert.deepEqual(secondResult, ["userB"], "User B should match second cross-post");
  assert.equal(fixture.deliveries.length, 2, "Both users should get exactly one notification each");

  const allV = fixture.database.listVacanciesSince(7);
  assert.equal(allV.length, 2, "Both vacancy records should be present");

  const v1 = allV.find((v) => v.sourceMessageId === "f1")!;
  const v2 = allV.find((v) => v.sourceMessageId === "f2")!;

  assert.ok(fixture.database.getUserMatchedVacancy("userA", v1.id), "User A matched v1");
  assert.equal(fixture.database.getUserMatchedVacancy("userA", v2.id), null, "User A should not have second match");

  assert.equal(fixture.database.getUserMatchedVacancy("userB", v1.id), null, "User B should not match v1");
  assert.ok(fixture.database.getUserMatchedVacancy("userB", v2.id), "User B matched v2");

  await fixture.analytics.shutdown();
  fixture.database.close();
});

test("fuzzy chain: A-B-C all in one group, root shows all sources", async () => {
  const fixture = createFixture();
  fixture.database.setUserSearchProfileKeywords("777", "required_context", ["remote"]);
  fixture.database.setUserSearchProfileKeywords("777", "required_primary", ["developer"]);

  await fixture.ingestor.handle({
    source: "telegram_web_preview" as const,
    channel: "chA",
    messageId: "ca",
    date: new Date("2026-07-20T08:00:00Z").toISOString(),
    text: "Senior Python Developer (Django)\nRemote\nSalary: 5000 USD",
    url: "https://t.me/chA/ca"
  });

  await fixture.ingestor.handle({
    source: "telegram_web_preview" as const,
    channel: "chB",
    messageId: "cb",
    date: new Date("2026-07-20T12:00:00Z").toISOString(),
    text: "Senior Python Developer (Django) — релокация\nRemote\nSalary: 5000 USD\nПодробнее: https://example.com",
    url: "https://t.me/chB/cb"
  });

  await fixture.ingestor.handle({
    source: "telegram_web_preview" as const,
    channel: "chC",
    messageId: "cc",
    date: new Date("2026-07-20T16:00:00Z").toISOString(),
    text: "Senior Python Developer (Django) — релокация в IT-компанию\nRemote\nSalary: 5000 USD\nОткликнуться: https://t.me/bot",
    url: "https://t.me/chC/cc"
  });

  const allV = fixture.database.listVacanciesSince(7);
  assert.equal(allV.length, 3, "All three vacancies should be in DB");

  const root = allV.find((v) => v.sourceMessageId === "ca")!;
  const posts = fixture.database.listVacancyDuplicatePosts(root.id, 10);
  const seen = posts.items.map((p) => p.sourceMessageId).sort();
  assert.deepEqual(seen, ["cb", "cc"], "Root should show B and C as duplicate sources");

  await fixture.analytics.shutdown();
  fixture.database.close();
});

test("exact dedup by fingerprint still works alongside fuzzy dedup", async () => {
  const fixture = createFixture();
  fixture.database.setUserSearchProfileKeywords("777", "required_context", ["remote"]);
  fixture.database.setUserSearchProfileKeywords("777", "required_primary", ["python"]);

  await fixture.ingestor.handle({
    source: "telegram_web_preview" as const,
    channel: "e1",
    messageId: "e1",
    date: new Date("2026-07-20T10:00:00Z").toISOString(),
    text: "Python Developer\nRemote",
    url: "https://t.me/e1/e1"
  });

  await fixture.ingestor.handle({
    source: "telegram_web_preview" as const,
    channel: "e2",
    messageId: "e2",
    date: new Date("2026-07-20T12:00:00Z").toISOString(),
    text: "Python Developer\nRemote",
    url: "https://t.me/e2/e2"
  });

  await fixture.ingestor.handle({
    source: "telegram_web_preview" as const,
    channel: "e3",
    messageId: "e3",
    date: new Date("2026-07-20T14:00:00Z").toISOString(),
    text: "Python Developer (Remote)\nRemote work\nSalary: 3000 USD",
    url: "https://t.me/e3/e3"
  });

  const allV = fixture.database.listVacanciesSince(7);
  assert.equal(allV.length, 2, "Exact copy should not create new vacancy (fingerprint dedup)");

  const original = allV.find((v) => v.sourceMessageId === "e1")!;
  const posts = fixture.database.listVacancyDuplicatePosts(original.id, 10);
  const seen = posts.items.map((p) => p.sourceMessageId).sort();
  assert.ok(seen.includes("e2"), "Fingerprint duplicate should be listed");
  assert.ok(seen.includes("e3"), "Fuzzy duplicate should also be listed");

  await fixture.analytics.shutdown();
  fixture.database.close();
});

test("all raw and vacancy records are preserved", async () => {
  const fixture = createFixture();
  fixture.database.setUserSearchProfileKeywords("777", "required_context", ["remote"]);
  fixture.database.setUserSearchProfileKeywords("777", "required_primary", ["python"]);

  await fixture.ingestor.handle({
    source: "telegram_web_preview" as const,
    channel: "r1",
    messageId: "r1",
    date: new Date("2026-07-20T10:00:00Z").toISOString(),
    text: "Python Developer\nRemote\nSalary: 4000 USD",
    url: "https://t.me/r1/r1"
  });

  await fixture.ingestor.handle({
    source: "telegram_web_preview" as const,
    channel: "r2",
    messageId: "r2",
    date: new Date("2026-07-20T14:00:00Z").toISOString(),
    text: "Python Developer — Middle\nRemote\nSalary: 4000 USD\nПодробнее: https://example.com",
    url: "https://t.me/r2/r2"
  });

  const allV = fixture.database.listVacanciesSince(7);
  assert.equal(allV.length, 2, "Both vacancy records should be preserved");

  const rawTexts = fixture.database.listRecentRawMessageTexts(7);
  assert.ok(rawTexts.length >= 2, "Both raw messages should be preserved");

  await fixture.analytics.shutdown();
  fixture.database.close();
});

test("user does not get duplicate matches or notifications", async () => {
  const fixture = createFixture();
  fixture.database.setUserSearchProfileKeywords("777", "required_context", ["remote"]);
  fixture.database.setUserSearchProfileKeywords("777", "required_primary", ["python"]);

  await fixture.ingestor.handle({
    source: "telegram_web_preview" as const,
    channel: "d1",
    messageId: "d1",
    date: new Date("2026-07-20T10:00:00Z").toISOString(),
    text: "Senior Python Developer\nRemote\nSalary: 6000 USD",
    url: "https://t.me/d1/d1"
  });

  await fixture.ingestor.handle({
    source: "telegram_web_preview" as const,
    channel: "d2",
    messageId: "d2",
    date: new Date("2026-07-20T12:00:00Z").toISOString(),
    text: "Senior Python Developer — relocation\nRemote\nSalary: 6000 USD\nMore info",
    url: "https://t.me/d2/d2"
  });

  assert.equal(fixture.deliveries.length, 1, "User should get exactly one notification");

  const allV = fixture.database.listVacanciesSince(7);
  const v1 = allV.find((v) => v.sourceMessageId === "d1")!;
  assert.ok(fixture.database.getUserMatchedVacancy("777", v1.id), "User matched first post");
  assert.equal(fixture.deliveries.filter((id) => id === v1.id).length, 1, "Only one match record for first post");

  await fixture.analytics.shutdown();
  fixture.database.close();
});

test("existing vacancy status unchanged by fuzzy duplicate", async () => {
  const fixture = createFixture();
  fixture.database.setUserSearchProfileKeywords("777", "required_context", ["remote"]);
  fixture.database.setUserSearchProfileKeywords("777", "required_primary", ["python"]);

  await fixture.ingestor.handle({
    source: "telegram_web_preview" as const,
    channel: "s1",
    messageId: "s1",
    date: new Date("2026-07-20T10:00:00Z").toISOString(),
    text: "Python Developer\nRemote\nSalary: 5000 USD",
    url: "https://t.me/s1/s1"
  });

  const allV = fixture.database.listVacanciesSince(7);
  const v1 = allV.find((v) => v.sourceMessageId === "s1")!;
  assert.equal(fixture.database.getUserVacancyStatus("777", v1.id), "inbox", "Default status is inbox");

  fixture.database.setUserVacancyStatus("777", v1.id, "saved");
  assert.equal(fixture.database.getUserVacancyStatus("777", v1.id), "saved", "Status set to saved");

  await fixture.ingestor.handle({
    source: "telegram_web_preview" as const,
    channel: "s2",
    messageId: "s2",
    date: new Date("2026-07-20T14:00:00Z").toISOString(),
    text: "Python Developer — Middle\nRemote\nSalary: 5000 USD\nДетали",
    url: "https://t.me/s2/s2"
  });

  assert.equal(fixture.database.getUserVacancyStatus("777", v1.id), "saved", "Status unchanged after fuzzy dedup");

  await fixture.analytics.shutdown();
  fixture.database.close();
});

test("relevance feedback unchanged by fuzzy duplicate", async () => {
  const fixture = createFixture();
  fixture.database.setUserSearchProfileKeywords("777", "required_context", ["remote"]);
  fixture.database.setUserSearchProfileKeywords("777", "required_primary", ["python"]);

  await fixture.ingestor.handle({
    source: "telegram_web_preview" as const,
    channel: "fb1",
    messageId: "fb1",
    date: new Date("2026-07-20T10:00:00Z").toISOString(),
    text: "Python Developer\nRemote\nSalary: 5000 USD",
    url: "https://t.me/fb1/fb1"
  });

  const allV = fixture.database.listVacanciesSince(7);
  const v1 = allV.find((v) => v.sourceMessageId === "fb1")!;
  fixture.database.upsertVacancyRelevanceFeedback("777", v1.id, "relevant");
  assert.equal(fixture.database.getVacancyRelevanceFeedback("777", v1.id), "relevant", "Feedback set before");

  await fixture.ingestor.handle({
    source: "telegram_web_preview" as const,
    channel: "fb2",
    messageId: "fb2",
    date: new Date("2026-07-20T14:00:00Z").toISOString(),
    text: "Python Developer — Middle\nRemote\nSalary: 5000 USD\nMore",
    url: "https://t.me/fb2/fb2"
  });

  assert.equal(fixture.database.getVacancyRelevanceFeedback("777", v1.id), "relevant", "Feedback unchanged");

  await fixture.analytics.shutdown();
  fixture.database.close();
});

test("active reminder not removed by fuzzy duplicate", async () => {
  const fixture = createFixture();
  fixture.database.setUserSearchProfileKeywords("777", "required_context", ["remote"]);
  fixture.database.setUserSearchProfileKeywords("777", "required_primary", ["python"]);

  await fixture.ingestor.handle({
    source: "telegram_web_preview" as const,
    channel: "rm1",
    messageId: "rm1",
    date: new Date("2026-07-20T10:00:00Z").toISOString(),
    text: "Python Developer\nRemote\nSalary: 5000 USD",
    url: "https://t.me/rm1/rm1"
  });

  const allV = fixture.database.listVacanciesSince(7);
  const v1 = allV.find((v) => v.sourceMessageId === "rm1")!;
  fixture.database.scheduleUserVacancyReminder("777", v1.id, new Date("2026-07-27T10:00:00Z").toISOString());
  assert.ok(fixture.database.getActiveUserVacancyReminder("777", v1.id), "Reminder set before");

  await fixture.ingestor.handle({
    source: "telegram_web_preview" as const,
    channel: "rm2",
    messageId: "rm2",
    date: new Date("2026-07-20T14:00:00Z").toISOString(),
    text: "Python Developer — Middle\nRemote\nSalary: 5000 USD\nДетали",
    url: "https://t.me/rm2/rm2"
  });

  assert.ok(fixture.database.getActiveUserVacancyReminder("777", v1.id), "Reminder intact after fuzzy dedup");

  await fixture.analytics.shutdown();
  fixture.database.close();
});

test("card shows all fuzzy sources via listVacancyDuplicatePosts", async () => {
  const fixture = createFixture();
  fixture.database.setUserSearchProfileKeywords("777", "required_context", ["remote"]);
  fixture.database.setUserSearchProfileKeywords("777", "required_primary", ["python"]);

  const seenSources: string[] = [];

  await fixture.ingestor.handle({
    source: "telegram_web_preview" as const,
    channel: "srcA",
    messageId: "srcA",
    date: new Date("2026-07-20T10:00:00Z").toISOString(),
    text: "Python Developer\nRemote\nSalary: 5000 USD",
    url: "https://t.me/srcA/srcA"
  });

  await fixture.ingestor.handle({
    source: "telegram_web_preview" as const,
    channel: "srcB",
    messageId: "srcB",
    date: new Date("2026-07-20T12:00:00Z").toISOString(),
    text: "Python Developer — Middle\nRemote\nSalary: 5000 USD\nDetails",
    url: "https://t.me/srcB/srcB"
  });

  await fixture.ingestor.handle({
    source: "telegram_web_preview" as const,
    channel: "srcC",
    messageId: "srcC",
    date: new Date("2026-07-20T14:00:00Z").toISOString(),
    text: "Python Developer (Middle) — relocation\nRemote\nSalary: 5000 USD\nMore info",
    url: "https://t.me/srcC/srcC"
  });

  const allV = fixture.database.listVacanciesSince(7);
  assert.equal(allV.length, 3, "Three vacancies present");

  const root = allV.find((v) => v.sourceMessageId === "srcA")!;
  const posts = fixture.database.listVacancyDuplicatePosts(root.id, 10);
  const seen = posts.items.map((p) => p.sourceMessageId).sort();
  assert.deepEqual(seen, ["srcB", "srcC"], "Root card shows all fuzzy sources");

  await fixture.analytics.shutdown();
  fixture.database.close();
});
