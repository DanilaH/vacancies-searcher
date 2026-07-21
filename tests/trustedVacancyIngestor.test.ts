import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createAnalyticsService } from "../src/analytics/analyticsService";
import type { BotController } from "../src/bot/createBot";
import { VacancyDatabase } from "../src/db/database";
import { ExternalVacancyEnricher } from "../src/services/externalVacancyEnricher";
import { VacancyFilter } from "../src/services/vacancyFilter";
import { VacancyIngestor } from "../src/services/vacancyIngestor";
import type { MatchedVacancyRecord } from "../src/types";
import { createTestConfig } from "./helpers";

function createFixture(responseFactory: () => Response) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-tg-bot-trusted-ingestor-"));
  const config = createTestConfig({
    ownerUserId: "777",
    ownerChatId: "777",
    companyCareersRequestDelayMs: 0,
    databasePath: path.join(tempDir, "bot.db"),
    databaseUrl: `file:${path.join(tempDir, "bot.db")}`,
    appDataDir: tempDir,
    runtimeDir: path.join(tempDir, "runtime")
  });
  const database = new VacancyDatabase(config);
  database.initialize();
  database.setUserSearchProfileKeywords("777", "required_context", ["remote"]);
  database.setUserSearchProfileKeywords("777", "required_primary", ["frontend"]);
  const service = database.addTrustedVacancyService({
    hostname: "teletype.in",
    displayName: "Teletype",
    adapter: "teletype",
    exampleUrl: "https://teletype.in/@courierus/frontend-1"
  });
  database.markTrustedVacancyServiceCheck(service.id, null);
  database.setTrustedVacancyServiceStatus(service.id, "active", "777");
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
  const enricher = new ExternalVacancyEnricher(config, database, {
    assertSafeUrl: async (url) => url,
    fetchImpl: async () => responseFactory()
  });
  const ingestor = new VacancyIngestor(config, new VacancyFilter(config), database, bot, analytics, enricher);
  return { database, analytics, ingestor, deliveries };
}

const item = {
  source: "telegram_web_preview" as const,
  channel: "remoteit",
  messageId: "teletype-1",
  date: new Date().toISOString(),
  text: "Senior Frontend Developer\nRemote\nhttps://teletype.in/@courierus/frontend-1",
  url: "https://t.me/remoteit/1"
};

test("definitively missing trusted page stays raw and is not posted as a vacancy", async () => {
  const fixture = createFixture(() => new Response("Страница не существует", { status: 404 }));

  const matched = await fixture.ingestor.handle(item);

  assert.deepEqual(matched, []);
  assert.deepEqual(fixture.deliveries, []);
  assert.equal(fixture.database.listVacanciesSince(7).length, 0);
  await fixture.analytics.shutdown();
  fixture.database.close();
});

test("temporary trusted page failure keeps the Telegram vacancy", async () => {
  const fixture = createFixture(() => new Response("temporary failure", { status: 503 }));

  const matched = await fixture.ingestor.handle({ ...item, messageId: "teletype-2", url: "https://t.me/remoteit/2" });
  const vacancies = fixture.database.listVacanciesSince(7);

  assert.deepEqual(matched, ["777"]);
  assert.equal(vacancies.length, 1);
  assert.equal(vacancies[0]?.canonicalUrl, "https://teletype.in/@courierus/frontend-1");
  await fixture.analytics.shutdown();
  fixture.database.close();
});

test("invalid active trusted URL shape stays raw and is not posted as a vacancy", async () => {
  const fixture = createFixture(() => {
    throw new Error("fetch should not run for invalid trusted URL shape");
  });

  const matched = await fixture.ingestor.handle({
    ...item,
    messageId: "finder-invalid-shape",
    url: "https://t.me/remoteit/3",
    text: "Senior Frontend Developer\nRemote\nhttps://finder.work/resumes/new"
  });

  assert.deepEqual(matched, []);
  assert.deepEqual(fixture.deliveries, []);
  assert.equal(fixture.database.listVacanciesSince(7).length, 0);
  await fixture.analytics.shutdown();
  fixture.database.close();
});
