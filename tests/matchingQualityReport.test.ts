import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { VacancyDatabase } from "../src/db/database";
import { buildMatchingQualityReport } from "../src/services/matchingQualityReport";
import { createTestConfig } from "./helpers";

import type { FilterResult, SourceName } from "../src/types";

function createFixture() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-tg-bot-mqr-"));
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
  return { config, database, tempDir };
}

function setupUsers(database: VacancyDatabase): void {
  for (const uid of ["u1", "u2"]) {
    database.registerPublicUserIfNeeded(uid);
  }
  database.addOrActivateBotUser("777", "owner", "777");
}

function makeFilterResult(): FilterResult {
  return {
    matches: true,
    score: 100,
    summary: "test",
    matchedKeywords: ["test"],
    blockedBy: []
  };
}

function insertVacancy(
  database: VacancyDatabase,
  source: SourceName,
  channel: string,
  messageId: string,
  text: string
): number {
  const result = database.recordMessage(
    {
      source,
      channel,
      messageId,
      date: new Date().toISOString(),
      text,
      url: `https://t.me/${channel}/${messageId}`
    },
    makeFilterResult(),
    []
  );
  assert.equal(result.kind, "new_vacancy");
  return result.vacancy.id;
}

test("no matches returns zero report", () => {
  const { database } = createFixture();
  const report = buildMatchingQualityReport(database);
  assert.ok(report.includes("Всего подобрано вакансий: 0"));
  assert.ok(report.includes("Вакансий с обратной связью: 0"));
  assert.ok(report.includes("Доля релевантных: —"));
  database.close();
});

test("counts matches and feedback correctly", () => {
  const { config, database } = createFixture();
  setupUsers(database);

  const v1 = insertVacancy(database, "telegram_web_preview", "ch1", "m1", "test vacancy 1");
  const v2 = insertVacancy(database, "telegram_web_preview", "ch1", "m2", "test vacancy 2");
  const v3 = insertVacancy(database, "telegram_web_preview", "ch1", "m3", "test vacancy 3");
  const v4 = insertVacancy(database, "telegram_web_preview", "ch1", "m4", "test vacancy 4");

  database.createUserVacancyMatch("u1", v1, makeFilterResult());
  database.createUserVacancyMatch("u1", v2, makeFilterResult());
  database.createUserVacancyMatch("u1", v3, makeFilterResult());
  database.createUserVacancyMatch("u1", v4, makeFilterResult());
  database.createUserVacancyMatch("u2", v1, makeFilterResult());

  database.upsertVacancyRelevanceFeedback("u1", v1, "relevant");
  database.upsertVacancyRelevanceFeedback("u1", v2, "not_relevant");
  database.upsertVacancyRelevanceFeedback("u1", v3, "relevant");

  const report = buildMatchingQualityReport(database);

  assert.ok(report.includes("Всего подобрано вакансий: 5"));
  assert.ok(report.includes("Вакансий с обратной связью: 3"));
  assert.ok(report.includes("Из них релевантных: 2"));
  assert.ok(report.includes("Из них нерелевантных: 1"));
  assert.ok(report.includes("Доля релевантных: 67%"));

  database.close();
});

test("feedback without matching is not counted", () => {
  const { database } = createFixture();
  setupUsers(database);

  const v1 = insertVacancy(database, "telegram_web_preview", "ch1", "m1", "orphan vacancy");
  database.upsertVacancyRelevanceFeedback("u1", v1, "relevant");

  const report = buildMatchingQualityReport(database);
  assert.ok(report.includes("Всего подобрано вакансий: 0"));
  assert.ok(report.includes("Вакансий с обратной связью: 0"));

  database.close();
});

test("all feedback values appear correctly", () => {
  const { database } = createFixture();
  setupUsers(database);

  const v1 = insertVacancy(database, "telegram_web_preview", "ch1", "m1", "test vacancy 1");
  const v2 = insertVacancy(database, "telegram_web_preview", "ch1", "m2", "test vacancy 2");

  database.createUserVacancyMatch("u1", v1, makeFilterResult());
  database.createUserVacancyMatch("u1", v2, makeFilterResult());
  database.upsertVacancyRelevanceFeedback("u1", v1, "relevant");
  database.upsertVacancyRelevanceFeedback("u1", v2, "relevant");

  const report = buildMatchingQualityReport(database);
  assert.ok(report.includes("Всего подобрано вакансий: 2"));
  assert.ok(report.includes("Вакансий с обратной связью: 2"));
  assert.ok(report.includes("Из них релевантных: 2"));
  assert.ok(report.includes("Из них нерелевантных: 0"));
  assert.ok(report.includes("Доля релевантных: 100%"));

  database.close();
});

test("zero feedback with matches shows dash for percentage", () => {
  const { database } = createFixture();
  setupUsers(database);

  const v1 = insertVacancy(database, "telegram_web_preview", "ch1", "m1", "test vacancy 1");
  database.createUserVacancyMatch("u1", v1, makeFilterResult());

  const report = buildMatchingQualityReport(database);
  assert.ok(report.includes("Всего подобрано вакансий: 1"));
  assert.ok(report.includes("Вакансий с обратной связью: 0"));
  assert.ok(report.includes("Доля релевантных: —"));

  database.close();
});
