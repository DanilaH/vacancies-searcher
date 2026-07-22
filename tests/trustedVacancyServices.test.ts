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

test("ingamejob: correct vacancy URL is accepted, HTTP and other hostnames rejected", () => {
  // Each confirmed locale accepted
  assert.equal(isTrustedVacancyUrlShape("ingamejob", "https://ingamejob.com/en/job/senior-game-character-artist"), true);
  assert.equal(isTrustedVacancyUrlShape("ingamejob", "https://ingamejob.com/pl/job/level-artist-31"), true);
  assert.equal(isTrustedVacancyUrlShape("ingamejob", "https://ingamejob.com/uk/job/1"), true);
  assert.equal(isTrustedVacancyUrlShape("ingamejob", "https://ingamejob.com/ru/job/backend-software-engineer"), true);
  // HTTP rejected via normalizeTrustedVacancyUrl
  assert.throws(() => normalizeTrustedVacancyUrl("http://ingamejob.com/en/job/some-role"), /HTTPS/u);
  // Wrong hostname
  assert.equal(isTrustedVacancyUrlShape("ingamejob", "https://other-host.com/en/job/role"), false);
  // Subdomain rejected
  assert.equal(isTrustedVacancyUrlShape("ingamejob", "https://us.ingamejob.com/en/job/role"), false);
  // Uppercase and malformed locales rejected
  assert.equal(isTrustedVacancyUrlShape("ingamejob", "https://ingamejob.com/EN/job/some-role"), false);
  assert.equal(isTrustedVacancyUrlShape("ingamejob", "https://ingamejob.com/En/job/some-role"), false);
  assert.equal(isTrustedVacancyUrlShape("ingamejob", "https://ingamejob.com/e/job/some-role"), false);
  assert.equal(isTrustedVacancyUrlShape("ingamejob", "https://ingamejob.com/eng/job/some-role"), false);
  // Unconfirmed locales rejected
  assert.equal(isTrustedVacancyUrlShape("ingamejob", "https://ingamejob.com/xx/job/some-role"), false);
  assert.equal(isTrustedVacancyUrlShape("ingamejob", "https://ingamejob.com/zz/job/some-role"), false);
  // Home page
  assert.equal(isTrustedVacancyUrlShape("ingamejob", "https://ingamejob.com/"), false);
  assert.equal(isTrustedVacancyUrlShape("ingamejob", "https://ingamejob.com/en"), false);
  // Job listing / search
  assert.equal(isTrustedVacancyUrlShape("ingamejob", "https://ingamejob.com/en/jobs"), false);
  assert.equal(isTrustedVacancyUrlShape("ingamejob", "https://ingamejob.com/en/jobs/p/3d-artist"), false);
  // Company page
  assert.equal(isTrustedVacancyUrlShape("ingamejob", "https://ingamejob.com/en/company/renderer-studios"), false);
  // Salaries / events / courses
  assert.equal(isTrustedVacancyUrlShape("ingamejob", "https://ingamejob.com/en/salaries"), false);
  assert.equal(isTrustedVacancyUrlShape("ingamejob", "https://ingamejob.com/en/events"), false);
  assert.equal(isTrustedVacancyUrlShape("ingamejob", "https://ingamejob.com/en/courses"), false);
  // Auth pages
  assert.equal(isTrustedVacancyUrlShape("ingamejob", "https://ingamejob.com/en/login"), false);
  assert.equal(isTrustedVacancyUrlShape("ingamejob", "https://ingamejob.com/en/register"), false);
  // Archived / away variant (not accepted)
  assert.equal(isTrustedVacancyUrlShape("ingamejob", "https://ingamejob.com/en/away/job/archived-role"), false);
});

test("ingamejob: detected as known host via detectTrustedVacancyService", () => {
  assert.equal(detectTrustedVacancyService("https://ingamejob.com/en/job/senior-game-character-artist").adapter, "ingamejob");
  assert.equal(detectTrustedVacancyService("https://ingamejob.com/en/job/senior-game-character-artist").displayName, "InGame Job");
  assert.equal(detectTrustedVacancyService("https://ingamejob.com/en/job/senior-game-character-artist").hostname, "ingamejob.com");
});

test("ingamejob: invalid path throws for non-vacancy URL shapes", () => {
  assert.throws(() => detectTrustedVacancyService("https://ingamejob.com/en/jobs"), /path is not supported/u);
  assert.throws(() => detectTrustedVacancyService("https://ingamejob.com/en/company/renderer-studios"), /path is not supported/u);
  assert.throws(() => detectTrustedVacancyService("https://ingamejob.com/"), /path is not supported/u);
});

test("ingamejob: adapter parses valid vacancy page, rejects missing and non-vacancy pages", async () => {
  const { config, database } = createDatabase();
  const service = database.getActiveTrustedVacancyServiceByHostname("ingamejob.com");
  // ingamejob is seeded as pending; add an active service for testing
  const testService = database.addTrustedVacancyService({
    hostname: "ingamejob.com",
    displayName: "InGame Job",
    adapter: "ingamejob",
    exampleUrl: "https://ingamejob.com/en/job/senior-game-character-artist"
  });
  database.setTrustedVacancyServiceStatus(testService.id, "active", "123456");

  let html = `
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

  const enricher = new ExternalVacancyEnricher(config, database, {
    assertSafeUrl: async (url) => url,
    fetchImpl: async () => new Response(html, { status: 200 })
  });

  const vacancy = await enricher.enrich("https://ingamejob.com/en/job/senior-game-character-artist", true);
  assert.equal(vacancy?.parser, "ingamejob");
  assert.equal(vacancy?.title, "Senior Game Character Artist");
  assert.equal(vacancy?.company, "Renderer Studios");
  assert.match(vacancy?.text ?? "", /Remote/iu);
  assert.match(vacancy?.text ?? "", /character art/iu);

  // 404 page rejection
  html = "<html><body><main>Page not found</main></body></html>";
  await assert.rejects(() =>
    enricher.enrich("https://ingamejob.com/en/job/missing-page", true),
    /does not exist/u
  );

  // Non-vacancy page (no job-view-page body class, different URL to bypass shape guard)
  html = `
    <html><body class="listing-page">
      <h1>Job Search</h1>
      <p>Browse game development job openings from leading studios worldwide.</p>
    </body></html>
  `;
  await assert.rejects(() =>
    enricher.enrich("https://ingamejob.com/en/job/expired-position", true),
    /confident vacancy/u
  );

  // Temporary network error (503) — should throw generic error, not definitive
  const enricher2 = new ExternalVacancyEnricher(config, database, {
    assertSafeUrl: async (url) => url,
    fetchImpl: async () => new Response("Service unavailable", { status: 503 })
  });
  await assert.rejects(() =>
    enricher2.enrich("https://ingamejob.com/en/job/some-role", true),
    /HTTP 503/u
  );

  database.close();
});

test("ingamejob: oversized response is rejected", async () => {
  const { config, database } = createDatabase();
  const testService = database.addTrustedVacancyService({
    hostname: "ingamejob.com",
    displayName: "InGame Job",
    adapter: "ingamejob",
    exampleUrl: "https://ingamejob.com/en/job/senior-game-character-artist"
  });
  database.setTrustedVacancyServiceStatus(testService.id, "active", "123456");

  const largeHtml = "x".repeat(config.companyCareersMaxResponseBytes + 1);
  const enricher = new ExternalVacancyEnricher(config, database, {
    assertSafeUrl: async (url) => url,
    fetchImpl: async () =>
      new Response(largeHtml, {
        status: 200,
        headers: { "content-type": "text/html" }
      })
  });

  await assert.rejects(() =>
    enricher.enrich("https://ingamejob.com/en/job/senior-game-character-artist", true),
    /too large/u
  );

  database.close();
});

test("ingamejob: redirect is rejected", async () => {
  const { config, database } = createDatabase();
  const testService = database.addTrustedVacancyService({
    hostname: "ingamejob.com",
    displayName: "InGame Job",
    adapter: "ingamejob",
    exampleUrl: "https://ingamejob.com/en/job/senior-game-character-artist"
  });
  database.setTrustedVacancyServiceStatus(testService.id, "active", "123456");

  const enricher = new ExternalVacancyEnricher(config, database, {
    assertSafeUrl: async (url) => url,
    fetchImpl: async () => new Response(null, { status: 302, headers: { location: "https://other.com" } })
  });

  await assert.rejects(() =>
    enricher.enrich("https://ingamejob.com/en/job/some-role", true),
    /HTTP 302/u
  );

  database.close();
});

test("designer_ru: correct vacancy URL is accepted, HTTP and other hostnames rejected", () => {
  // Each confirmed category accepted
  assert.equal(isTrustedVacancyUrlShape("designer_ru", "https://designer.ru/t/some-vacancy/"), true);
  assert.equal(isTrustedVacancyUrlShape("designer_ru", "https://designer.ru/u/another-vacancy/"), true);
  assert.equal(isTrustedVacancyUrlShape("designer_ru", "https://designer.ru/r/relocation-role/"), true);
  assert.equal(isTrustedVacancyUrlShape("designer_ru", "https://designer.ru/m/freelance-gig/"), true);
  // HTTP rejected via normalizeTrustedVacancyUrl
  assert.throws(() => normalizeTrustedVacancyUrl("http://designer.ru/u/some-role/"), /HTTPS/u);
  // Wrong hostname
  assert.equal(isTrustedVacancyUrlShape("designer_ru", "https://other.com/u/some-role/"), false);
  // Subdomain rejected
  assert.equal(isTrustedVacancyUrlShape("designer_ru", "https://www.designer.ru/u/some-role/"), false);
  assert.equal(isTrustedVacancyUrlShape("designer_ru", "https://blog.designer.ru/u/some-role/"), false);
  // Home page
  assert.equal(isTrustedVacancyUrlShape("designer_ru", "https://designer.ru/"), false);
  // List pages (single segment)
  assert.equal(isTrustedVacancyUrlShape("designer_ru", "https://designer.ru/t/"), false);
  assert.equal(isTrustedVacancyUrlShape("designer_ru", "https://designer.ru/u/"), false);
  assert.equal(isTrustedVacancyUrlShape("designer_ru", "https://designer.ru/r/"), false);
  assert.equal(isTrustedVacancyUrlShape("designer_ru", "https://designer.ru/m/"), false);
  // Profile / resume database
  assert.equal(isTrustedVacancyUrlShape("designer_ru", "https://designer.ru/prodesigners/"), false);
  // Account / auth
  assert.equal(isTrustedVacancyUrlShape("designer_ru", "https://designer.ru/account/"), false);
  // News
  assert.equal(isTrustedVacancyUrlShape("designer_ru", "https://designer.ru/news/"), false);
  // Telegram channels
  assert.equal(isTrustedVacancyUrlShape("designer_ru", "https://designer.ru/c/"), false);
  // Career articles
  assert.equal(isTrustedVacancyUrlShape("designer_ru", "https://designer.ru/design-career/"), false);
  // How-to page
  assert.equal(isTrustedVacancyUrlShape("designer_ru", "https://designer.ru/kak-nayti-dizaynera/"), false);
  // Unknown single-letter category
  assert.equal(isTrustedVacancyUrlShape("designer_ru", "https://designer.ru/x/some-role/"), false);
  assert.equal(isTrustedVacancyUrlShape("designer_ru", "https://designer.ru/a/some-role/"), false);
  // Non-vacancy two-segment path
  assert.equal(isTrustedVacancyUrlShape("designer_ru", "https://designer.ru/some/section/"), false);
  // 404
  assert.equal(isTrustedVacancyUrlShape("designer_ru", "https://designer.ru/jobs/"), false);
});

test("designer_ru: detected as known host via detectTrustedVacancyService", () => {
  const detection = detectTrustedVacancyService("https://designer.ru/u/senior-product-designer/");
  assert.equal(detection.adapter, "designer_ru");
  assert.equal(detection.displayName, "Designer.ru");
  assert.equal(detection.hostname, "designer.ru");
});

test("designer_ru: invalid path throws for non-vacancy URL shapes", () => {
  assert.throws(
    () => detectTrustedVacancyService("https://designer.ru/"),
    /not supported/u
  );
  assert.throws(
    () => detectTrustedVacancyService("https://designer.ru/prodesigners/"),
    /not supported/u
  );
  // Subdomain returns generic, not designer_ru
  const detection = detectTrustedVacancyService("https://www.designer.ru/u/some-role/");
  assert.equal(detection.adapter, "generic");
});

test("designer_ru: adapter parses valid vacancy page with JSON-LD, rejects missing and non-vacancy pages", async () => {
  const { config, database } = createDatabase();
  const testService = database.addTrustedVacancyService({
    hostname: "designer.ru",
    displayName: "Designer.ru",
    adapter: "designer_ru",
    exampleUrl: "https://designer.ru/u/senior-product-designer/"
  });
  database.setTrustedVacancyServiceStatus(testService.id, "active", "123456");

  const enricher = new ExternalVacancyEnricher(config, database, {
    assertSafeUrl: async (url) => url,
    fetchImpl: async () =>
      new Response(
        `<!DOCTYPE html><html lang="ru"><head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "JobPosting",
  "title": "Senior Product Designer",
  "url": "https://designer.ru/u/senior-product-designer/",
  "description": "<h3>Responsibilities</h3><p>Design and improve product features.</p><h3>Requirements</h3><p>5+ years of experience.</p>",
  "hiringOrganization": { "@type": "Organization", "name": "TechCorp" },
  "jobLocation": { "@type": "Place", "address": { "@type": "PostalAddress", "addressLocality": "Moscow", "addressCountry": "Russia" } },
  "jobLocationType": "TELECOMMUTE",
  "employmentType": "FULL_TIME"
}
</script></head><body><h1>Senior Product Designer</h1><main>Design and improve product features.</main></body></html>`,
        { status: 200, headers: { "content-type": "text/html" } }
      )
  });

  const vacancy = await enricher.enrich("https://designer.ru/u/senior-product-designer/", true);
  assert.equal(vacancy?.parser, "json_ld");
  assert.equal(vacancy?.title, "Senior Product Designer");
  assert.equal(vacancy?.company, "TechCorp");
  assert.equal(vacancy?.location, "Russia");
  assert.equal(vacancy?.employment, "FULL_TIME");
  assert.match(vacancy?.text ?? "", /Remote/iu);
  assert.match(vacancy?.text ?? "", /Product Designer/iu);

  // 404 page rejection
  const enricher404 = new ExternalVacancyEnricher(config, database, {
    assertSafeUrl: async (url) => url,
    fetchImpl: async () => new Response("Not found", { status: 404 })
  });
  await assert.rejects(() =>
    enricher404.enrich("https://designer.ru/t/missing-vacancy/", true),
    /HTTP 404/u
  );

  // Non-vacancy page (no JSON-LD, no confident HTML content)
  const enricherNonVacancy = new ExternalVacancyEnricher(config, database, {
    assertSafeUrl: async (url) => url,
    fetchImpl: async () =>
      new Response(
        "<html><body><h1>About us</h1><p>This is a design community platform.</p></body></html>",
        { status: 200, headers: { "content-type": "text/html" } }
      )
  });
  await assert.rejects(() =>
    enricherNonVacancy.enrich("https://designer.ru/t/about-us/", true),
    /confident vacancy/u
  );

  // Temporary network error (503) — should throw generic error
  const enricher503 = new ExternalVacancyEnricher(config, database, {
    assertSafeUrl: async (url) => url,
    fetchImpl: async () => new Response("Service unavailable", { status: 503 })
  });
  await assert.rejects(() =>
    enricher503.enrich("https://designer.ru/u/some-role/", true),
    /HTTP 503/u
  );

  database.close();
});

test("designer_ru: oversized response is rejected", async () => {
  const { config, database } = createDatabase();
  const testService = database.addTrustedVacancyService({
    hostname: "designer.ru",
    displayName: "Designer.ru",
    adapter: "designer_ru",
    exampleUrl: "https://designer.ru/u/senior-product-designer/"
  });
  database.setTrustedVacancyServiceStatus(testService.id, "active", "123456");

  const largeHtml = "x".repeat(config.companyCareersMaxResponseBytes + 1);
  const enricher = new ExternalVacancyEnricher(config, database, {
    assertSafeUrl: async (url) => url,
    fetchImpl: async () =>
      new Response(largeHtml, {
        status: 200,
        headers: { "content-type": "text/html" }
      })
  });

  await assert.rejects(() =>
    enricher.enrich("https://designer.ru/u/senior-product-designer/", true),
    /too large/u
  );

  database.close();
});

test("designer_ru: redirect is rejected", async () => {
  const { config, database } = createDatabase();
  const testService = database.addTrustedVacancyService({
    hostname: "designer.ru",
    displayName: "Designer.ru",
    adapter: "designer_ru",
    exampleUrl: "https://designer.ru/u/senior-product-designer/"
  });
  database.setTrustedVacancyServiceStatus(testService.id, "active", "123456");

  const enricher = new ExternalVacancyEnricher(config, database, {
    assertSafeUrl: async (url) => url,
    fetchImpl: async () => new Response(null, { status: 302, headers: { location: "https://other.com" } })
  });

  await assert.rejects(() =>
    enricher.enrich("https://designer.ru/u/some-role/", true),
    /HTTP 302/u
  );

  database.close();
});


