import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createTrustedVacancyServiceDetailsKeyboard } from "../src/bot/admin";
import { VacancyDatabase } from "../src/db/database";
import { ExternalVacancyEnricher } from "../src/services/externalVacancyEnricher";
import {
  detectTrustedVacancyService,
  extractTrustedVacancyUrlCandidates,
  isTrustedVacancyUrlShape,
  normalizeTrustedVacancyUrl
} from "../src/services/trustedVacancyServices";
import { createTestConfig } from "./helpers";

function createDatabase() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-tg-bot-trusted-services-"));
  const config = createTestConfig({
    databasePath: path.join(tempDir, "bot.db"),
    databaseUrl: `file:${path.join(tempDir, "bot.db")}`,
    appDataDir: tempDir,
    runtimeDir: path.join(tempDir, "runtime")
  });
  const database = new VacancyDatabase(config);
  database.initialize();
  return { config, database };
}

test("trusted vacancy services seed FindMyRemote and require activation for generic hosts", () => {
  const { database } = createDatabase();
  const builtIn = database.getActiveTrustedVacancyServiceByHostname("findmyremote.ai");
  const pending = database.addTrustedVacancyService({
    hostname: "jobs.example.com",
    displayName: "Example",
    adapter: "generic",
    exampleUrl: "https://jobs.example.com/vacancy/1"
  });

  assert.equal(builtIn?.adapter, "findmyremote");
  assert.equal(database.getActiveTrustedVacancyServiceByHostname("teletype.in")?.adapter, "teletype");
  assert.equal(database.getActiveTrustedVacancyServiceByHostname("finder.work")?.adapter, "finder_work");
  assert.equal(database.getActiveTrustedVacancyServiceByHostname("telegra.ph")?.adapter, "telegraph");
  assert.equal(pending.status, "pending");
  assert.equal(database.getActiveTrustedVacancyServiceByHostname("jobs.example.com"), null);
  assert.equal(database.getActiveTrustedVacancyServiceByHostname("sub.jobs.example.com"), null);
  assert.doesNotMatch(JSON.stringify(createTrustedVacancyServiceDetailsKeyboard(pending, 0)), /trusted_services:activate/u);

  database.markTrustedVacancyServiceCheck(pending.id, null);
  const checked = database.getTrustedVacancyServiceById(pending.id)!;
  assert.match(JSON.stringify(createTrustedVacancyServiceDetailsKeyboard(checked, 0)), /trusted_services:activate/u);
  database.setTrustedVacancyServiceStatus(pending.id, "active", "123456");
  assert.equal(database.getActiveTrustedVacancyServiceByHostname("jobs.example.com")?.status, "active");
  database.setTrustedVacancyServiceStatus(pending.id, "disabled", "123456");
  const disabled = database.getTrustedVacancyServiceById(pending.id)!;
  assert.equal(database.getActiveTrustedVacancyServiceByHostname("jobs.example.com"), null);
  assert.match(JSON.stringify(createTrustedVacancyServiceDetailsKeyboard(disabled, 0)), /trusted_services:activate/u);
  database.close();
});

test("trusted service URL validation accepts public HTTPS and rejects unsafe protocols and hosts", () => {
  assert.equal(
    normalizeTrustedVacancyUrl("https://findmyremote.ai/job/1#description"),
    "https://findmyremote.ai/job/1"
  );
  assert.equal(detectTrustedVacancyService("https://findmyremote.ai/job/1").adapter, "findmyremote");
  assert.equal(detectTrustedVacancyService("https://teletype.in/@courierus/frontend-1").adapter, "teletype");
  assert.equal(detectTrustedVacancyService("https://finder.work/vacancies/123").adapter, "finder_work");
  assert.equal(detectTrustedVacancyService("https://telegra.ph/Senior-Frontend-Developer-01-01").adapter, "telegraph");
  assert.equal(detectTrustedVacancyService("https://www.aviasales.ru/about/vacancies/123").adapter, "aviasales_careers");
  assert.equal(detectTrustedVacancyService("https://cloud.ru/career/vacancies/frontend").adapter, "cloud_careers");
  assert.equal(detectTrustedVacancyService("https://www.tbank.ru/career/it/vacancy/frontend").adapter, "tbank_careers");
  assert.equal(detectTrustedVacancyService("https://yandex.ru/jobs/vacancies/frontend-developer").adapter, "yandex_jobs");
  assert.throws(() => normalizeTrustedVacancyUrl("http://example.com/job/1"), /HTTPS/u);
  assert.throws(() => normalizeTrustedVacancyUrl("https://127.0.0.1/job/1"), /public hostname/u);
  assert.throws(() => normalizeTrustedVacancyUrl("https://service.internal/job/1"), /public hostname/u);
  assert.throws(() => detectTrustedVacancyService("https://finder.work/resumes/new"), /path is not supported/u);
  assert.throws(() => detectTrustedVacancyService("https://www.aviasales.ru/about"), /path is not supported/u);
  assert.equal(isTrustedVacancyUrlShape("teletype", "https://teletype.in/@courierus/frontend-1"), true);
  assert.equal(isTrustedVacancyUrlShape("teletype", "https://teletype.in/@courierus"), false);
  assert.equal(isTrustedVacancyUrlShape("teletype", "https://teletype.in/"), false);
  assert.equal(isTrustedVacancyUrlShape("finder_work", "https://finder.work/vacancies/123"), true);
  assert.equal(isTrustedVacancyUrlShape("finder_work", "https://finder.work/resumes/123"), false);
  assert.equal(isTrustedVacancyUrlShape("finder_work", "https://finder.work/vacancies/123/details"), false);
  assert.equal(isTrustedVacancyUrlShape("telegraph", "https://telegra.ph/Senior-Frontend-Developer-01-01"), true);
  assert.equal(isTrustedVacancyUrlShape("telegraph", "https://telegra.ph/api"), false);
  assert.equal(isTrustedVacancyUrlShape("telegraph", "https://telegra.ph/one/two"), false);
});

test("trusted vacancy candidates include hidden HTML links and visible text links once", () => {
  assert.deepEqual(
    extractTrustedVacancyUrlCandidates({
      text: "Details: https://teletype.in/@courierus/frontend-1.",
      linkEntities: [
        { text: "Full description", url: "https://teletype.in/@courierus/frontend-1", position: 0 }
      ]
    }),
    ["https://teletype.in/@courierus/frontend-1"]
  );
});

test("external enricher ignores pending services and parses active JSON-LD services", async () => {
  const { config, database } = createDatabase();
  const service = database.addTrustedVacancyService({
    hostname: "jobs.example.com",
    displayName: "Example",
    adapter: "generic",
    exampleUrl: "https://jobs.example.com/vacancy/1"
  });
  let requests = 0;
  const html = `
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "JobPosting",
        "title": "Senior Frontend Developer",
        "description": "<p>Build a React product for remote users.</p>",
        "employmentType": "FULL_TIME",
        "hiringOrganization": { "name": "Acme" },
        "applicantLocationRequirements": { "name": "Estonia" },
        "jobLocationType": "TELECOMMUTE"
      }
    </script>
  `;
  const enricher = new ExternalVacancyEnricher(config, database, {
    assertSafeUrl: async (url) => url,
    fetchImpl: async () => {
      requests += 1;
      return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
    }
  });

  assert.equal(await enricher.enrich(service.exampleUrl), null);
  assert.equal(requests, 0);

  database.setTrustedVacancyServiceStatus(service.id, "active", "123456");
  const result = await enricher.enrich(service.exampleUrl);

  assert.equal(requests, 1);
  assert.equal(result?.parser, "json_ld");
  assert.equal(result?.company, "Acme");
  assert.equal(result?.location, "Estonia");
  assert.match(result?.text ?? "", /Employment: FULL_TIME/u);
  assert.ok(database.getTrustedVacancyServiceById(service.id)?.lastSuccessAt);
  database.close();
});

test("external enricher rejects a safe-check result that changes the trusted hostname", async () => {
  const { config, database } = createDatabase();
  const service = database.addTrustedVacancyService({
    hostname: "jobs.example.com",
    displayName: "Example",
    adapter: "generic",
    exampleUrl: "https://jobs.example.com/vacancy/1"
  });
  const enricher = new ExternalVacancyEnricher(config, database, {
    assertSafeUrl: async () => "https://other.example.com/vacancy/1",
    fetchImpl: async () => {
      throw new Error("fetch should not run");
    }
  });

  await assert.rejects(() => enricher.probeService(service), /hostname does not match/u);
  assert.match(database.getTrustedVacancyServiceById(service.id)?.lastError ?? "", /hostname does not match/u);
  database.close();
});

test("Finder Work adapter parses JSON-LD first, falls back to HTML, and rejects bad paths", async () => {
  const { config, database } = createDatabase();
  const service = database.getActiveTrustedVacancyServiceByHostname("finder.work")!;
  let requests = 0;
  let html = `
    <html>
      <head>
        <meta property="og:title" content="HTML Frontend Developer">
        <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "JobPosting",
            "title": "JSON-LD Frontend Developer",
            "description": "<p>Build a remote React and TypeScript product for customers.</p>",
            "employmentType": "FULL_TIME",
            "hiringOrganization": { "name": "Schema Corp" },
            "applicantLocationRequirements": { "name": "Europe" },
            "jobLocationType": "TELECOMMUTE"
          }
        </script>
      </head>
      <body><main><h1>HTML Frontend Developer</h1><p>Company: HTML Corp</p></main></body>
    </html>
  `;
  const enricher = new ExternalVacancyEnricher(config, database, {
    assertSafeUrl: async (url) => url,
    fetchImpl: async () => {
      requests += 1;
      return new Response(html, { status: 200 });
    }
  });

  const jsonLd = await enricher.enrich("https://finder.work/vacancies/123", true);
  assert.equal(jsonLd?.parser, "json_ld");
  assert.equal(jsonLd?.title, "JSON-LD Frontend Developer");
  assert.equal(jsonLd?.company, "Schema Corp");

  html = `
    <html><body><main>
      <h1>Senior Frontend Developer</h1>
      <p>Company: Acme</p>
      <p>Location: Remote Europe</p>
      <p>Employment: Full-time</p>
      <h2>Responsibilities</h2>
      <p>Build a modern job search product with React, TypeScript, testing, accessibility, and careful code review for remote teams.</p>
      <h2>Requirements</h2>
      <p>Strong frontend engineering experience, product thinking, and the ability to apply now by sending your CV to the hiring team.</p>
    </main></body></html>
  `;
  const fallback = await enricher.enrich("https://finder.work/vacancies/456", true);
  assert.equal(fallback?.parser, "finder_work");
  assert.equal(fallback?.company, "Acme");
  assert.equal(fallback?.location, "Remote Europe");
  assert.equal(fallback?.employment, "Full-time");

  const beforeBadPath = requests;
  await assert.rejects(() => enricher.enrich("https://finder.work/resumes/new", true), /URL shape/u);
  assert.equal(requests, beforeBadPath);

  html = "<html><body><main><h1>About Finder</h1><p>A short product note without a hiring description.</p></main></body></html>";
  await assert.rejects(() => enricher.enrich("https://finder.work/vacancies/789", true), /confident vacancy/u);
  assert.equal(service.adapter, "finder_work");
  database.close();
});

test("Telegraph adapter parses confident vacancy articles and rejects missing or non-vacancy pages", async () => {
  const { config, database } = createDatabase();
  const service = database.getActiveTrustedVacancyServiceByHostname("telegra.ph")!;
  let html = `
    <html>
      <head><meta property="og:title" content="Senior Frontend Developer"></head>
      <body><article>
        <h1>Senior Frontend Developer</h1>
        <div class="tl_article_content">
          <p>Company: Acme</p>
          <p>Location: Remote Europe</p>
          <p>Employment: Full-time</p>
          <h3>Responsibilities</h3>
          <p>Build a React and TypeScript product, improve frontend architecture, review code, and collaborate with designers and backend engineers.</p>
          <h3>Requirements</h3>
          <p>Commercial frontend engineering experience, testing habits, communication skills, and readiness to apply now by sending your CV.</p>
        </div>
      </article></body>
    </html>
  `;
  const enricher = new ExternalVacancyEnricher(config, database, {
    assertSafeUrl: async (url) => url,
    fetchImpl: async () => new Response(html, { status: 200 })
  });

  const vacancy = await enricher.enrich("https://telegra.ph/Senior-Frontend-Developer-01-01", true);
  assert.equal(vacancy?.parser, "telegraph");
  assert.equal(vacancy?.company, "Acme");
  assert.equal(vacancy?.location, "Remote Europe");
  assert.equal(vacancy?.employment, "Full-time");

  html = "<html><body><main>PAGE_NOT_FOUND</main></body></html>";
  await assert.rejects(() => enricher.enrich("https://telegra.ph/Missing-Page-01-01", true), /does not exist/u);

  html = "<html><body><article><h1>Personal notes</h1><p>A short article about work routines and planning.</p></article></body></html>";
  await assert.rejects(() => enricher.enrich("https://telegra.ph/Personal-Notes-01-01", true), /confident vacancy/u);
  assert.equal(service.adapter, "telegraph");
  database.close();
});

test("Teletype adapter parses confident vacancy pages and rejects missing or non-vacancy pages", async () => {
  const { config, database } = createDatabase();
  const service = database.addTrustedVacancyService({
    hostname: "teletype.in",
    displayName: "Teletype",
    adapter: "teletype",
    exampleUrl: "https://teletype.in/@courierus/frontend-1"
  });
  database.setTrustedVacancyServiceStatus(service.id, "active", "123456");
  let html = `
    <html>
      <head><meta property="og:title" content="Senior Frontend Developer"></head>
      <body><article>
        <h1>Senior Frontend Developer</h1>
        <p>Компания: Acme</p>
        <p>Локация: Россия</p>
        <p>Занятость: Full-time</p>
        <h2>Обязанности</h2>
        <p>Разрабатывать продукт на React и TypeScript, проводить code review и улучшать архитектуру.</p>
        <h2>Требования</h2>
        <p>Опыт коммерческой разработки от трёх лет. Для отклика отправьте резюме рекрутеру.</p>
      </article></body>
    </html>
  `;
  const enricher = new ExternalVacancyEnricher(config, database, {
    assertSafeUrl: async (url) => url,
    fetchImpl: async () => new Response(html, { status: 200 })
  });

  const vacancy = await enricher.enrich(service.exampleUrl);
  assert.equal(vacancy?.parser, "teletype");
  assert.equal(vacancy?.company, "Acme");
  assert.equal(vacancy?.location, "Россия");
  assert.equal(vacancy?.employment, "Full-time");

  html = "<html><head><title>Страница не существует</title></head><body><main>Страница не существует</main></body></html>";
  await assert.rejects(() => enricher.enrich("https://teletype.in/@courierus/missing", true), /does not exist/u);

  html = "<html><body><article><h1>Мои заметки</h1><p>Сегодня был хороший день и я решил записать несколько мыслей о работе.</p></article></body></html>";
  await assert.rejects(() => enricher.enrich("https://teletype.in/@courierus/notes", true), /confident vacancy/u);
  database.close();
});
