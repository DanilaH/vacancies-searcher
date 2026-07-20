import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { VacancyDatabase } from "../src/db/database";
import { buildHhVacanciesUrl, HhApiSource } from "../src/sources/hhApiSource";
import { HhSearchSettings } from "../src/types";
import { createTestConfig } from "./helpers";

function createDatabase() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-tg-bot-hh-source-"));
  const config = createTestConfig({
    ownerUserId: "777",
    ownerChatId: "777",
    hhSourceEnabled: true,
    hhUserAgent: "job-tg-bot-test/1.0 (test@example.com)",
    hhPerPage: 10,
    databasePath: path.join(tempDir, "bot.db"),
    databaseUrl: `file:${path.join(tempDir, "bot.db")}`,
    appDataDir: tempDir,
    runtimeDir: path.join(tempDir, "runtime")
  });
  const database = new VacancyDatabase(config);
  database.initialize();

  return { config, database };
}

function createSettings(overrides: Partial<HhSearchSettings> = {}): HhSearchSettings {
  return {
    userId: "777",
    enabled: true,
    text: "frontend react",
    areaId: "113",
    experience: "between3And6",
    schedule: "remote",
    employment: "full",
    salaryFrom: 250000,
    periodDays: 7,
    updatedAt: "2026-06-02T00:00:00.000Z",
    ...overrides
  };
}

test("buildHhVacanciesUrl builds hh.ru vacancy query from user settings", () => {
  const url = new URL(buildHhVacanciesUrl(createSettings(), 0, 20));

  assert.equal(url.origin + url.pathname, "https://api.hh.ru/vacancies");
  assert.equal(url.searchParams.get("text"), "frontend react");
  assert.equal(url.searchParams.get("area"), "113");
  assert.equal(url.searchParams.get("experience"), "between3And6");
  assert.equal(url.searchParams.get("schedule"), "remote");
  assert.equal(url.searchParams.get("employment"), "full");
  assert.equal(url.searchParams.get("salary"), "250000");
  assert.equal(url.searchParams.get("only_with_salary"), "true");
  assert.equal(url.searchParams.get("period"), "7");
  assert.equal(url.searchParams.get("per_page"), "20");
});

test("HhApiSource groups identical enabled user filters into one API request", async () => {
  const { config, database } = createDatabase();
  database.updateUserHhSearchSettings("777", { enabled: true, text: "frontend react" });
  database.addOrActivateBotUser("888", "member", "777");
  database.updateUserHhSearchSettings("888", { enabled: true, text: "frontend react" });

  const calls: Array<{ url: string; userAgent: string | null }> = [];
  const source = new HhApiSource(config, database, async (url, init) => {
    const headers = new Headers(init?.headers);
    calls.push({ url: String(url), userAgent: headers.get("HH-User-Agent") });
    return new Response(
      JSON.stringify({
        page: 0,
        pages: 1,
        items: [
          {
            id: "123",
            name: "Frontend Developer",
            alternate_url: "https://hh.ru/vacancy/123",
            published_at: "2026-06-01T10:00:00+0300",
            employer: { name: "Acme" },
            area: { name: "Москва" },
            snippet: {
              requirement: "React <highlighttext>TypeScript</highlighttext>",
              responsibility: "Remote product work"
            },
            experience: { name: "3-6 лет" },
            schedule: { name: "Удаленная работа" },
            employment: { name: "Полная занятость" }
          }
        ]
      }),
      { status: 200 }
    );
  });

  const items = await source.fetchLatest();
  database.close();

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.userAgent, "job-tg-bot-test/1.0 (test@example.com)");
  assert.equal(items.length, 1);
  assert.deepEqual(items[0]?.eligibleUserIds?.sort(), ["777", "888"]);
  assert.equal(items[0]?.source, "hh_api");
  assert.equal(items[0]?.channel, "hh.ru • Acme, Москва");
  assert.match(items[0]?.text ?? "", /Frontend Developer/);
  assert.match(items[0]?.text ?? "", /React TypeScript/);
});

test("HhApiSource signals non-success API responses for poller failure handling", async () => {
  const { config, database } = createDatabase();
  database.updateUserHhSearchSettings("777", { enabled: true, text: "frontend react" });

  const source = new HhApiSource(config, database, async () => new Response("Forbidden", { status: 403 }));

  await assert.rejects(() => source.fetchLatest(), /HH vacancies API returned HTTP 403/);
  database.close();
});
