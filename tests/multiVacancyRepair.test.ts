import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { VacancyDatabase } from "../src/db/database";
import { VacancyFilter } from "../src/services/vacancyFilter";
import { createTestConfig } from "./helpers";

function createFixture() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-tg-bot-multi-repair-"));
  const config = createTestConfig({
    databasePath: path.join(tempDir, "bot.db"),
    databaseUrl: `file:${path.join(tempDir, "bot.db")}`,
    appDataDir: tempDir,
    runtimeDir: path.join(tempDir, "runtime")
  });
  const database = new VacancyDatabase(config);
  database.initialize();
  const text = "Frontend roles\nPosted: 11 Jun\nLocations: Brazil\n\nAnother role\nPosted: 11 Jun\nLocations: Estonia";
  const result = database.recordMessage(
    {
      source: "telegram_web_preview",
      channel: "findmyremote_frontend",
      messageId: "887",
      text,
      url: "https://t.me/findmyremote_frontend/887"
    },
    new VacancyFilter(config).evaluateBaseCandidate(text),
    []
  );
  assert.equal(result.kind, "new_vacancy");
  return { database, vacancy: result.vacancy };
}

test("aggregate replacement deletes unmanaged vacancy but preserves its raw evidence", () => {
  const { database, vacancy } = createFixture();

  assert.equal(database.canReplaceVacancyAggregate(vacancy.id), true);
  assert.equal(database.deleteVacancyAggregateIfUnmanaged(vacancy.id), true);
  assert.equal(database.getVacancy(vacancy.id), null);
  assert.equal(database.recordMessage(
    {
      source: "telegram_web_preview",
      channel: "findmyremote_frontend",
      messageId: "887",
      text: vacancy.text,
      url: vacancy.url
    },
    { matches: true, score: 0, matchedKeywords: [], blockedBy: [], summary: "test" },
    []
  ).kind, "duplicate_raw_message");
  database.close();
});

test("aggregate replacement refuses vacancies with a user status or active reminder", () => {
  const statusFixture = createFixture();
  statusFixture.database.setUserVacancyStatus("123456", statusFixture.vacancy.id, "saved");
  assert.equal(statusFixture.database.canReplaceVacancyAggregate(statusFixture.vacancy.id), false);
  assert.equal(statusFixture.database.deleteVacancyAggregateIfUnmanaged(statusFixture.vacancy.id), false);
  statusFixture.database.close();

  const reminderFixture = createFixture();
  reminderFixture.database.scheduleUserVacancyReminder("123456", reminderFixture.vacancy.id, new Date(Date.now() + 60_000).toISOString());
  assert.equal(reminderFixture.database.canReplaceVacancyAggregate(reminderFixture.vacancy.id), false);
  assert.equal(reminderFixture.database.deleteVacancyAggregateIfUnmanaged(reminderFixture.vacancy.id), false);
  reminderFixture.database.close();
});
