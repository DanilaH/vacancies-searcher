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

function createIngameJobFixture(html: string, fetchOverride?: () => Promise<Response>) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-tg-bot-ingamejob-ingestor-"));
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
  database.setUserSearchProfileKeywords("777", "required_primary", ["artist"]);
  const service = database.addTrustedVacancyService({
    hostname: "ingamejob.com",
    displayName: "InGame Job",
    adapter: "ingamejob",
    exampleUrl: "https://ingamejob.com/en/job/senior-game-character-artist"
  });
  database.markTrustedVacancyServiceCheck(service.id, null);
  database.setTrustedVacancyServiceStatus(service.id, "active", "777");
  const deliveries: number[] = [];
  const bot: BotController = {
    async start() {},
    async stop() {},
    async notifyVacancy(vacancy: MatchedVacancyRecord) { deliveries.push(vacancy.id); return true; },
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
    fetchImpl: fetchOverride ?? (async () => new Response(html, { status: 200, headers: { "content-type": "text/html" } }))
  });
  const ingestor = new VacancyIngestor(config, new VacancyFilter(config), database, bot, analytics, enricher);
  return { database, analytics, ingestor, deliveries };
}

test("ingamejob: valid vacancy page enriches and creates vacancy", async () => {
  const validHtml = `
    <html><body class="job-view-page">
      <div class="job-view-lead-position-box">
        <h1 class="text-success">Senior Game Character Artist</h1>
        <p><strong><a href="/en/company/renderer-studios">Renderer Studios</a></strong>, Posted 4 days ago</p>
        Senior, Full time, Negotiable, Remote, Hungary
      </div>
      <div class="container job-view-body">
        <div class="job-view-container">
          <div class="job-view-single-section">
            <h5>For which tasks (responsibilities)?</h5>
            <p>Create high-quality 3D character art for our upcoming AAA title. Work with concept artists and designers to bring characters to life. Develop and maintain character art pipelines.</p>
            <p>Salary: 5000 USD</p>
          </div>
          <div class="job-view-single-section">
            <h5>Requirements</h5>
            <p>5+ years experience in game character art required. Expert knowledge of ZBrush, Maya, and Substance Painter.</p>
            <p>To apply send your CV to careers@renderer-studios.com</p>
          </div>
          <div class="job-view-single-section">
            <h5>Conditions and bonuses</h5>
            <ul><li>Remote work option</li><li>Flexible schedule</li><li>Competitive salary</li></ul>
          </div>
        </div>
      </div>
    </body></html>
  `;
  const fixture = createIngameJobFixture(validHtml);
  const matched = await fixture.ingestor.handle({
    source: "telegram_web_preview",
    channel: "gamedev",
    messageId: "ingamejob-1",
    date: new Date().toISOString(),
    text: "Senior Game Character Artist\nRemote\nhttps://ingamejob.com/en/job/senior-game-character-artist",
    url: "https://t.me/gamedev/ingamejob-1"
  });
  assert.deepEqual(matched, ["777"]);
  assert.equal(fixture.deliveries.length, 1);
  const vacancies = fixture.database.listVacanciesSince(7);
  assert.equal(vacancies.length, 1);
  assert.equal(vacancies[0]?.canonicalUrl, "https://ingamejob.com/en/job/senior-game-character-artist");
  await fixture.analytics.shutdown();
  fixture.database.close();
});

test("ingamejob: missing page prevents posting", async () => {
  const fixture = createIngameJobFixture("Page not found");
  const matched = await fixture.ingestor.handle({
    source: "telegram_web_preview",
    channel: "gamedev",
    messageId: "ingamejob-404",
    date: new Date().toISOString(),
    text: "Senior Game Character Artist\nRemote\nhttps://ingamejob.com/en/job/missing",
    url: "https://t.me/gamedev/ingamejob-404"
  });
  assert.deepEqual(matched, []);
  assert.deepEqual(fixture.deliveries, []);
  assert.equal(fixture.database.listVacanciesSince(7).length, 0);
  fixture.database.close();
});

test("ingamejob: temporary network failure keeps Telegram-only vacancy", async () => {
  const fixture = createIngameJobFixture("", () => Promise.resolve(new Response("temporary failure", { status: 503 })));
  const matched = await fixture.ingestor.handle({
    source: "telegram_web_preview",
    channel: "gamedev",
    messageId: "ingamejob-503",
    date: new Date().toISOString(),
    text: "Senior Game Character Artist\nRemote\nhttps://ingamejob.com/en/job/senior-game-character-artist",
    url: "https://t.me/gamedev/ingamejob-503"
  });
  assert.deepEqual(matched, ["777"]);
  assert.equal(fixture.deliveries.length, 1);
  const vacancies = fixture.database.listVacanciesSince(7);
  assert.equal(vacancies.length, 1);
  assert.equal(vacancies[0]?.canonicalUrl, "https://ingamejob.com/en/job/senior-game-character-artist");
  await fixture.analytics.shutdown();
  fixture.database.close();
});

function createDesignerRuFixture(html: string, fetchOverride?: () => Promise<Response>) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-tg-bot-designer-ru-ingestor-"));
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
  database.setUserSearchProfileKeywords("777", "required_primary", ["designer"]);
  const service = database.addTrustedVacancyService({
    hostname: "designer.ru",
    displayName: "Designer.ru",
    adapter: "designer_ru",
    exampleUrl: "https://designer.ru/u/senior-product-designer/"
  });
  database.markTrustedVacancyServiceCheck(service.id, null);
  database.setTrustedVacancyServiceStatus(service.id, "active", "777");
  const deliveries: number[] = [];
  const bot: BotController = {
    async start() {},
    async stop() {},
    async notifyVacancy(vacancy: MatchedVacancyRecord) { deliveries.push(vacancy.id); return true; },
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
    fetchImpl: fetchOverride ?? (async () => new Response(html, { status: 200, headers: { "content-type": "text/html" } }))
  });
  const ingestor = new VacancyIngestor(config, new VacancyFilter(config), database, bot, analytics, enricher);
  return { database, analytics, ingestor, deliveries };
}

test("designer_ru: valid vacancy page enriches and creates vacancy", async () => {
  const validHtml = `<!DOCTYPE html><html lang="ru"><head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "JobPosting",
  "title": "Senior Product Designer",
  "description": "<p>Design and improve features.</p>",
  "hiringOrganization": { "@type": "Organization", "name": "TechCorp" },
  "jobLocation": { "@type": "Place", "address": { "@type": "PostalAddress", "addressLocality": "Moscow" } },
  "jobLocationType": "TELECOMMUTE",
  "employmentType": "FULL_TIME"
}
</script></head><body><h1>Senior Product Designer</h1><main>Design and improve features.</main></body></html>`;
  const fixture = createDesignerRuFixture(validHtml);
  const matched = await fixture.ingestor.handle({
    source: "telegram_web_preview",
    channel: "designjobs",
    messageId: "designer-ru-1",
    date: new Date().toISOString(),
    text: "Senior Product Designer\nRemote\nhttps://designer.ru/u/senior-product-designer/",
    url: "https://t.me/designjobs/designer-ru-1"
  });
  assert.deepEqual(matched, ["777"]);
  assert.equal(fixture.deliveries.length, 1);
  const vacancies = fixture.database.listVacanciesSince(7);
  assert.equal(vacancies.length, 1);
  assert.equal(vacancies[0]?.canonicalUrl, "https://designer.ru/u/senior-product-designer/");
  await fixture.analytics.shutdown();
  fixture.database.close();
});

test("designer_ru: missing page prevents posting", async () => {
  const fixture = createDesignerRuFixture("Page not found");
  const matched = await fixture.ingestor.handle({
    source: "telegram_web_preview",
    channel: "designjobs",
    messageId: "designer-ru-404",
    date: new Date().toISOString(),
    text: "Senior Product Designer\nRemote\nhttps://designer.ru/t/missing-vacancy/",
    url: "https://t.me/designjobs/designer-ru-404"
  });
  assert.deepEqual(matched, []);
  assert.deepEqual(fixture.deliveries, []);
  assert.equal(fixture.database.listVacanciesSince(7).length, 0);
  fixture.database.close();
});

test("designer_ru: temporary network failure keeps Telegram-only vacancy", async () => {
  const fixture = createDesignerRuFixture("", () => Promise.resolve(new Response("temporary failure", { status: 503 })));
  const matched = await fixture.ingestor.handle({
    source: "telegram_web_preview",
    channel: "designjobs",
    messageId: "designer-ru-503",
    date: new Date().toISOString(),
    text: "Senior Product Designer\nRemote\nhttps://designer.ru/u/senior-product-designer/",
    url: "https://t.me/designjobs/designer-ru-503"
  });
  assert.deepEqual(matched, ["777"]);
  assert.equal(fixture.deliveries.length, 1);
  const vacancies = fixture.database.listVacanciesSince(7);
  assert.equal(vacancies.length, 1);
  assert.equal(vacancies[0]?.canonicalUrl, "https://designer.ru/u/senior-product-designer/");
  await fixture.analytics.shutdown();
  fixture.database.close();
});
