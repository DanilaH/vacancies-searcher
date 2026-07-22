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
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-tg-bot-fuzzy-ingestion-"));
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
  database.setUserSearchProfileKeywords("777", "required_context", ["remote"]);
  database.setUserSearchProfileKeywords("777", "required_primary", ["python", "developer"]);

  const delivered: number[] = [];
  const bot: BotController = {
    async start() {},
    async stop() {},
    async notifyVacancy(vacancy: MatchedVacancyRecord) {
      delivered.push(vacancy.id);
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
  return { database, analytics, ingestor, delivered };
}

test("fuzzy duplicate detection works through full ingestion pipeline", async () => {
  const fixture = createFixture();

  const firstItem = {
    source: "telegram_web_preview" as const,
    channel: "remoteit",
    messageId: "fuzzy-1",
    date: new Date("2026-07-20T10:00:00Z").toISOString(),
    text: "Senior Python Developer (Django)\nRemote\nSalary: 5000 USD\nОпыт от 3 лет",
    url: "https://t.me/remoteit/1"
  };

  const secondItem = {
    source: "telegram_web_preview" as const,
    channel: "frontendjobs",
    messageId: "fuzzy-2",
    date: new Date("2026-07-20T14:00:00Z").toISOString(),
    text: "Senior Python Developer (Django) — релокация\nRemote\nSalary: 5000 USD\nОпыт от 3 лет\nПодробнее: https://example.com",
    url: "https://t.me/frontendjobs/1"
  };

  const firstResult = await fixture.ingestor.handle(firstItem);
  assert.deepEqual(firstResult, ["777"], "First cross-post should match user");
  assert.equal(fixture.delivered.length, 1, "First cross-post should deliver notification");

  const secondResult = await fixture.ingestor.handle(secondItem);
  assert.deepEqual(secondResult, [], "Fuzzy duplicate should not trigger new notifications");
  assert.equal(fixture.delivered.length, 1, "No additional notification should be sent");

  const allVacancies = fixture.database.listVacanciesSince(7);
  assert.equal(allVacancies.length, 2, "Both vacancies should be present in DB");

  const firstId = allVacancies.find((v) => v.sourceMessageId === "fuzzy-1")!.id;
  const duplicatePosts = fixture.database.listVacancyDuplicatePosts(firstId, 5);
  assert.ok(duplicatePosts.items.length >= 1, "Duplicate posts listing should include the fuzzy duplicate");
  assert.ok(duplicatePosts.items.some((p) => p.sourceMessageId === "fuzzy-2"), "Second post should appear as duplicate source");

  await fixture.analytics.shutdown();
  fixture.database.close();
});

test("non-duplicate vacancies go through ingestion independently", async () => {
  const fixture = createFixture();

  const firstItem = {
    source: "telegram_web_preview" as const,
    channel: "remoteit",
    messageId: "indep-1",
    date: new Date("2026-07-20T10:00:00Z").toISOString(),
    text: "Senior Python Developer (Django)\nRemote\nSalary: 5000 USD",
    url: "https://t.me/remoteit/2"
  };

  const secondItem = {
    source: "telegram_web_preview" as const,
    channel: "golangjobs",
    messageId: "indep-2",
    date: new Date("2026-07-20T12:00:00Z").toISOString(),
    text: "Senior Golang Developer (Kubernetes)\nRemote\nSalary: 7000 USD",
    url: "https://t.me/golangjobs/1"
  };

  const firstResult = await fixture.ingestor.handle(firstItem);
  assert.deepEqual(firstResult, ["777"], "First distinct vacancy should match");

  const secondResult = await fixture.ingestor.handle(secondItem);
  assert.deepEqual(secondResult, ["777"], "Different vacancy should also match independently");

  assert.equal(fixture.delivered.length, 2, "Both vacancies should deliver notifications");

  await fixture.analytics.shutdown();
  fixture.database.close();
});
