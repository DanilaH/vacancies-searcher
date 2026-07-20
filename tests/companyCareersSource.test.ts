import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { VacancyDatabase } from "../src/db/database";
import { CompanyCareersSource } from "../src/sources/companyCareersSource";
import { createTestConfig } from "./helpers";

function createDatabase() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-tg-bot-company-source-"));
  const config = createTestConfig({
    companyCareersSourceEnabled: true,
    companyCareersPollIntervalSeconds: 3600,
    databasePath: path.join(tempDir, "bot.db"),
    databaseUrl: `file:${path.join(tempDir, "bot.db")}`,
    appDataDir: tempDir,
    runtimeDir: path.join(tempDir, "runtime")
  });
  const database = new VacancyDatabase(config);
  database.initialize();
  return { config, database };
}

test("CompanyCareersSource parses Aviasales careers HTML and marks source success", async () => {
  const { config, database } = createDatabase();
  database.addCompanyCareerSource({
    companyName: "Aviasales",
    adapter: "aviasales_html",
    startUrl: "https://www.aviasales.ru/about/vacancies",
    addedByUserId: "123456"
  });

  const source = new CompanyCareersSource(config, database, async (url) => {
    const value = String(url);
    if (value === "https://www.aviasales.ru/about/vacancies") {
      return new Response('<a href="/about/vacancies/4263584">Frontend Developer</a>', { status: 200 });
    }

    if (value === "https://www.aviasales.ru/about/vacancies/4263584") {
      return new Response(
        `
          <html>
            <head><link rel="canonical" href="https://www.aviasales.ru/about/vacancies/4263584" /></head>
            <body><main><h1>Frontend Developer</h1><p>Remote React TypeScript product work.</p></main></body>
          </html>
        `,
        { status: 200 }
      );
    }

    throw new Error(`Unexpected URL: ${value}`);
  });

  const items = await source.fetchLatest();
  const page = database.listCompanyCareerSourcesPage(0, 10);
  database.close();

  assert.equal(items.length, 1);
  assert.equal(items[0]?.source, "company_careers");
  assert.equal(items[0]?.channel, "Aviasales");
  assert.equal(items[0]?.url, "https://www.aviasales.ru/about/vacancies/4263584");
  assert.equal(items[0]?.canonicalUrl, "https://www.aviasales.ru/about/vacancies/4263584");
  assert.match(items[0]?.text ?? "", /Frontend Developer/);
  assert.match(items[0]?.text ?? "", /Remote React TypeScript/);
  assert.equal(page.items[0]?.lastError, null);
  assert.ok(page.items[0]?.lastSuccessAt);
  assert.ok(page.items[0]?.nextPollAfter);
});

test("CompanyCareersSource reads Greenhouse job board API", async () => {
  const { config, database } = createDatabase();
  database.addCompanyCareerSource({
    companyName: "Acme",
    adapter: "greenhouse_job_board",
    startUrl: "https://boards.greenhouse.io/acme",
    addedByUserId: "123456"
  });

  const source = new CompanyCareersSource(config, database, async (url, init) => {
    assert.equal(String(url), "https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true");
    assert.equal(new Headers(init?.headers).get("user-agent"), config.companyCareersUserAgent);
    return new Response(
      JSON.stringify({
        jobs: [
          {
            id: 42,
            title: "Senior Frontend Engineer",
            absolute_url: "https://boards.greenhouse.io/acme/jobs/42?utm_source=tg",
            updated_at: "2026-06-03T10:00:00.000Z",
            location: { name: "Remote" },
            departments: [{ name: "Engineering" }],
            content: "<p>React and TypeScript.</p>"
          }
        ]
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  });

  const items = await source.fetchLatest();
  database.close();

  assert.equal(items.length, 1);
  assert.equal(items[0]?.messageId, "1:42");
  assert.equal(items[0]?.canonicalUrl, "https://boards.greenhouse.io/acme/jobs/42");
  assert.match(items[0]?.text ?? "", /Senior Frontend Engineer/);
  assert.match(items[0]?.text ?? "", /Engineering/);
});

test("CompanyCareersSource records source errors without throwing the poll cycle", async () => {
  const { config, database } = createDatabase();
  database.addCompanyCareerSource({
    companyName: "Acme",
    adapter: "greenhouse_job_board",
    startUrl: "https://boards.greenhouse.io/acme",
    addedByUserId: "123456"
  });

  const source = new CompanyCareersSource(config, database, async () => new Response("Forbidden", { status: 403 }));
  const items = await source.fetchLatest();
  const page = database.listCompanyCareerSourcesPage(0, 10);
  database.close();

  assert.deepEqual(items, []);
  assert.match(page.items[0]?.lastError ?? "", /HTTP 403/);
  assert.ok(page.items[0]?.nextPollAfter);
});
