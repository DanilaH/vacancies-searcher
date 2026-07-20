import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { VacancyDatabase } from "../src/db/database";
import { createTestConfig } from "./helpers";

function createTempDatabaseConfig() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-tg-bot-sqli-"));
  return createTestConfig({
    databasePath: path.join(tempDir, "bot.db"),
    databaseUrl: `file:${path.join(tempDir, "bot.db")}`,
    appDataDir: tempDir,
    runtimeDir: path.join(tempDir, "runtime")
  });
}

test("SQL payloads are stored as text and do not modify the schema", () => {
  const config = createTempDatabaseConfig();
  const database = new VacancyDatabase(config);
  const filterResult = {
    matches: true,
    score: 90,
    matchedKeywords: ["react", "remote", "typescript"],
    blockedBy: [],
    summary: "remote: remote; react: react; typescript: typescript"
  };
  const payload = "'; DROP TABLE messages; --\nRemote React TypeScript";

  database.initialize();

  const insertResult = database.recordMessage(
    {
      source: "telegram_web_preview",
      channel: "job_react",
      messageId: "7001",
      date: "2026-05-27T10:00:00.000Z",
      text: payload,
      url: "https://t.me/job_react/7001"
    },
    filterResult,
    []
  );

  const weeklyPage = database.listWeeklyVacancies(0, 10, 3650);
  database.healthcheck();
  database.close();

  assert.equal(insertResult.kind, "new_vacancy");
  assert.equal(weeklyPage.items[0]?.text, payload);
  assert.equal(weeklyPage.total, 1);
});
