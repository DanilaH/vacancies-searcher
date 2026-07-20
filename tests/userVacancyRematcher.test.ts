import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { VacancyDatabase } from "../src/db/database";
import { UserVacancyRematcher } from "../src/services/userVacancyRematcher";
import { VacancyFilter } from "../src/services/vacancyFilter";
import { createTestConfig } from "./helpers";

function createDatabase() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-tg-bot-rematch-"));
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

test("UserVacancyRematcher rebuilds matches for the current user profile", () => {
  const { config, database } = createDatabase();
  const filter = new VacancyFilter(config);
  const rematcher = new UserVacancyRematcher(database, filter);

  const now = new Date();
  const withinWindow = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();

  database.recordMessage(
    {
      source: "telegram_web_preview",
      channel: "job_react",
      messageId: "1001",
      date: withinWindow,
      text: "Senior React engineer\nRemote\nTypeScript",
      url: "https://t.me/job_react/1001"
    },
    filter.evaluateBaseCandidate("Senior React engineer\nRemote\nTypeScript"),
    []
  );
  database.recordMessage(
    {
      source: "telegram_web_preview",
      channel: "backend_jobs",
      messageId: "1002",
      date: withinWindow,
      text: "Senior Backend engineer\nRemote\nNode.js",
      url: "https://t.me/backend_jobs/1002"
    },
    filter.evaluateBaseCandidate("Senior Backend engineer\nRemote\nNode.js"),
    []
  );

  database.setUserSearchProfileKeywords("777", "required_context", ["remote"]);
  database.setUserSearchProfileKeywords("777", "required_primary", ["react"]);
  database.setUserSearchProfileKeywords("777", "preferred", ["typescript"]);

  const firstSummary = rematcher.rebuildForUser("777", 7);
  const firstWeekly = database.listUserWeeklyVacancies("777", 0, 10, 7);

  assert.equal(firstSummary.scannedVacancies, 2);
  assert.equal(firstSummary.evaluatedVacancies, 2);
  assert.equal(firstSummary.created, 1);
  assert.equal(firstSummary.removed, 0);
  assert.equal(firstSummary.totalMatched, 1);
  assert.equal(firstWeekly.total, 1);
  assert.equal(firstWeekly.items[0]?.sourceMessageId, "1001");
  assert.equal(firstSummary.profileDiagnostics[0]?.matchedVacancies, 1);
  assert.equal(firstSummary.profileDiagnostics[0]?.rejectionReasons.missing_primary, 1);

  database.setUserSearchProfileKeywords("777", "required_primary", ["backend"]);
  database.setUserSearchProfileKeywords("777", "preferred", ["node.js"]);

  const secondSummary = rematcher.rebuildForUser("777", 7);
  const secondWeekly = database.listUserWeeklyVacancies("777", 0, 10, 7);

  assert.equal(secondSummary.created, 1);
  assert.equal(secondSummary.removed, 1);
  assert.equal(secondSummary.totalMatched, 1);
  assert.equal(secondWeekly.total, 1);
  assert.equal(secondWeekly.items[0]?.sourceMessageId, "1002");

  database.resetUserSearchProfile("777");
  const clearedSummary = rematcher.rebuildForUser("777", 7);
  const clearedWeekly = database.listUserWeeklyVacancies("777", 0, 10, 7);

  assert.equal(clearedSummary.totalMatched, 0);
  assert.equal(clearedSummary.removed, 1);
  assert.equal(clearedWeekly.total, 0);

  database.close();
});

test("UserVacancyRematcher removes resume-like posts from weekly feed", () => {
  const { config, database } = createDatabase();
  const filter = new VacancyFilter(config);
  const rematcher = new UserVacancyRematcher(database, filter);

  const withinWindow = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  database.recordMessage(
    {
      source: "telegram_web_preview",
      channel: "javascript_jobs_feed",
      messageId: "2001",
      date: withinWindow,
      text: "Резюме Senior Frontend Developer\nУдаленно\nReact\nTypeScript",
      url: "https://t.me/javascript_jobs_feed/2001"
    },
    {
      matches: true,
      score: 0,
      matchedKeywords: [],
      blockedBy: [],
      summary: "Stored as a vacancy candidate for per-user matching."
    },
    []
  );

  database.setUserSearchProfileKeywords("777", "required_context", ["remote", "удаленно"]);
  database.setUserSearchProfileKeywords("777", "required_primary", ["react", "frontend"]);
  database.setUserSearchProfileKeywords("777", "preferred", ["typescript", "senior"]);

  const summary = rematcher.rebuildForUser("777", 7);
  const weekly = database.listUserWeeklyVacancies("777", 0, 10, 7);

  assert.equal(summary.totalMatched, 0);
  assert.equal(summary.profileDiagnostics[0]?.rejectionReasons.candidate_post, 1);
  assert.equal(weekly.total, 0);

  database.close();
});

test("UserVacancyRematcher applies the current vacancy language mode", () => {
  const { config, database } = createDatabase();
  const filter = new VacancyFilter(config);
  const rematcher = new UserVacancyRematcher(database, filter);
  const withinWindow = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  database.recordMessage(
    {
      source: "telegram_web_preview",
      channel: "mixed_jobs",
      messageId: "3001",
      date: withinWindow,
      text: "Удалённо\nSenior React Engineer\nTypeScript",
      url: "https://t.me/mixed_jobs/3001"
    },
    filter.evaluateBaseCandidate("Удалённо\nSenior React Engineer\nTypeScript"),
    []
  );
  database.recordMessage(
    {
      source: "telegram_web_preview",
      channel: "english_jobs",
      messageId: "3002",
      date: withinWindow,
      text: "Remote senior React engineer\nTypeScript\nProduct team",
      url: "https://t.me/english_jobs/3002"
    },
    filter.evaluateBaseCandidate("Remote senior React engineer\nTypeScript\nProduct team"),
    []
  );

  database.setUserSearchProfileKeywords("777", "required_context", ["remote", "удаленно", "удалённо"]);
  database.setUserSearchProfileKeywords("777", "required_primary", ["react", "engineer"]);
  database.setUserSearchProfileKeywords("777", "preferred", ["typescript"]);

  database.setVacancyLanguageMode("777", "ru_only");
  const russianSummary = rematcher.rebuildForUser("777", 7);
  const russianWeekly = database.listUserWeeklyVacancies("777", 0, 10, 7);

  assert.equal(russianSummary.totalMatched, 1);
  assert.equal(russianWeekly.total, 1);
  assert.equal(russianWeekly.items[0]?.sourceMessageId, "3001");

  database.setVacancyLanguageMode("777", "en_only");
  const englishSummary = rematcher.rebuildForUser("777", 7);
  const englishWeekly = database.listUserWeeklyVacancies("777", 0, 10, 7);

  assert.equal(englishSummary.totalMatched, 1);
  assert.equal(englishWeekly.total, 1);
  assert.equal(englishWeekly.items[0]?.sourceMessageId, "3002");

  database.close();
});

test("UserVacancyRematcher only keeps hh vacancies eligible for the user", () => {
  const { config, database } = createDatabase();
  const filter = new VacancyFilter(config);
  const rematcher = new UserVacancyRematcher(database, filter);
  const withinWindow = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const result = database.recordMessage(
    {
      source: "hh_api",
      channel: "hh.ru • Acme, Москва",
      messageId: "4001",
      date: withinWindow,
      text: "Frontend React engineer\nRemote\nTypeScript",
      url: "https://hh.ru/vacancy/4001"
    },
    filter.evaluateBaseCandidate("Frontend React engineer\nRemote\nTypeScript"),
    []
  );

  assert.equal(result.kind, "new_vacancy");
  if (result.kind !== "new_vacancy") {
    database.close();
    return;
  }

  database.updateUserHhSearchSettings("777", { enabled: true, text: "react remote" });
  database.recordHhVacancyCandidate("777", result.vacancy.id, "react-remote");
  database.setUserSearchProfileKeywords("777", "required_context", ["remote"]);
  database.setUserSearchProfileKeywords("777", "required_primary", ["react"]);

  const enabledSummary = rematcher.rebuildForUser("777", 7);
  assert.equal(enabledSummary.totalMatched, 1);
  assert.equal(database.listUserWeeklyVacancies("777", 0, 10, 7).total, 1);

  database.updateUserHhSearchSettings("777", { enabled: false });
  const disabledSummary = rematcher.rebuildForUser("777", 7);
  assert.equal(disabledSummary.totalMatched, 0);
  assert.equal(database.listUserWeeklyVacancies("777", 0, 10, 7).total, 0);

  database.close();
});
