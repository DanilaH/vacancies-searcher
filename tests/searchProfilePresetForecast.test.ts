import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { VacancyDatabase } from "../src/db/database";
import { SearchProfilePresetForecastService } from "../src/services/searchProfilePresetForecast";
import { VacancyFilter } from "../src/services/vacancyFilter";
import { createTestConfig } from "./helpers";

function createHarness() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-tg-bot-preset-forecast-"));
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
  return { config, database };
}

function storeVacancy(
  database: VacancyDatabase,
  filter: VacancyFilter,
  source: "telegram_web_preview" | "hh_api",
  messageId: string,
  text: string
) {
  return database.recordMessage(
    {
      source,
      channel: source === "hh_api" ? "hh.ru" : "jobs",
      messageId,
      date: new Date().toISOString(),
      text,
      url: source === "hh_api" ? `https://hh.ru/vacancy/${messageId}` : `https://t.me/jobs/${messageId}`
    },
    filter.evaluateBaseCandidate(text),
    []
  );
}

test("preset forecast respects language, hh eligibility and the 60 second cache", () => {
  const { config, database } = createHarness();
  const filter = new VacancyFilter(config);
  let now = 1_000;
  const service = new SearchProfilePresetForecastService(database, filter, 60_000, () => now);

  storeVacancy(
    database,
    filter,
    "telegram_web_preview",
    "english",
    "We are hiring a remote React frontend developer for our product team."
  );
  storeVacancy(
    database,
    filter,
    "telegram_web_preview",
    "russian",
    "Ищем React frontend разработчика в продуктовую команду. Работа удалённо."
  );
  const hh = storeVacancy(
    database,
    filter,
    "hh_api",
    "hh-frontend",
    "We are hiring a remote React frontend developer for Acme."
  );
  assert.equal(hh.kind, "new_vacancy");
  if (hh.kind !== "new_vacancy") {
    database.close();
    return;
  }

  database.updateUserHhSearchSettings("777", { enabled: true, text: "react remote" });
  database.recordHhVacancyCandidate("777", hh.vacancy.id, "react-remote");

  const allLanguages = service.evaluate("777", "ru_en");
  const englishOnly = service.evaluate("777", "en_only");
  assert.equal(allLanguages.find((item) => item.presetId === "frontend")?.matchesCount, 3);
  assert.equal(englishOnly.find((item) => item.presetId === "frontend")?.matchesCount, 2);

  database.updateUserHhSearchSettings("777", { enabled: false });
  assert.equal(
    service.evaluate("777", "en_only").find((item) => item.presetId === "frontend")?.matchesCount,
    2
  );

  now += 60_001;
  assert.equal(
    service.evaluate("777", "en_only").find((item) => item.presetId === "frontend")?.matchesCount,
    1
  );
  database.close();
});
