import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { VacancyDatabase } from "../src/db/database";
import { VacancyFilter } from "../src/services/vacancyFilter";
import { createTestConfig } from "./helpers";

function createFixture() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-tg-bot-status-"));
  const databasePath = path.join(tempDir, "bot.db");
  const config = createTestConfig({
    ownerUserId: "777",
    ownerChatId: "777",
    databasePath,
    databaseUrl: `file:${databasePath}`,
    appDataDir: tempDir,
    runtimeDir: path.join(tempDir, "runtime")
  });

  return {
    config,
    databasePath,
    createDatabase() {
      const database = new VacancyDatabase(config);
      database.initialize();
      return database;
    }
  };
}

function createMatchedVacancy(
  database: VacancyDatabase,
  filter: VacancyFilter,
  userId: string,
  messageId: string,
  text: string
) {
  const result = database.recordMessage(
    {
      source: "telegram_web_preview",
      channel: "job_react",
      messageId,
      date: new Date().toISOString(),
      text,
      url: `https://t.me/job_react/${messageId}`
    },
    filter.evaluateBaseCandidate(text),
    []
  );

  assert.equal(result.kind, "new_vacancy");
  const personalFilter = filter.evaluateForProfile(text, database.getUserSearchProfile(userId));
  assert.equal(personalFilter.matches, true);

  const match = database.createUserVacancyMatch(userId, result.vacancy.id, personalFilter);
  assert.ok(match);
  return match;
}

test("hidden vacancies disappear from weekly feed but remain in hidden list", () => {
  const fixture = createFixture();
  const database = fixture.createDatabase();
  const filter = new VacancyFilter(fixture.config);

  database.setUserSearchProfileKeywords("777", "required_context", ["remote"]);
  database.setUserSearchProfileKeywords("777", "required_primary", ["react"]);

  const match = createMatchedVacancy(
    database,
    filter,
    "777",
    "2001",
    "Senior React engineer\nRemote\nTypeScript"
  );

  const initialWeekly = database.listUserWeeklyVacancies("777", 0, 10, 7);
  assert.equal(initialWeekly.total, 1);
  assert.equal(initialWeekly.items[0]?.userStatus, "inbox");

  database.setUserVacancyStatus("777", match.id, "hidden");

  const hiddenWeekly = database.listUserWeeklyVacancies("777", 0, 10, 7);
  const hiddenPage = database.listUserVacanciesByStatus("777", "hidden", 0, 10);

  assert.equal(hiddenWeekly.total, 0);
  assert.equal(hiddenWeekly.hiddenMatchedTotal, 1);
  assert.equal(hiddenPage.total, 1);
  assert.equal(hiddenPage.items[0]?.id, match.id);
  assert.equal(hiddenPage.items[0]?.userStatus, "hidden");

  database.clearUserVacancyStatus("777", match.id);

  const restoredWeekly = database.listUserWeeklyVacancies("777", 0, 10, 7);
  assert.equal(restoredWeekly.total, 1);
  assert.equal(restoredWeekly.items[0]?.id, match.id);

  database.close();
});

test("hidden reason is historical but visible only for current hidden status", () => {
  const fixture = createFixture();
  let database = fixture.createDatabase();
  const filter = new VacancyFilter(fixture.config);

  database.setUserSearchProfileKeywords("777", "required_context", ["remote"]);
  database.setUserSearchProfileKeywords("777", "required_primary", ["react"]);

  const match = createMatchedVacancy(
    database,
    filter,
    "777",
    "2101",
    "React developer\nRemote\nTypeScript"
  );

  database.setUserVacancyStatus("777", match.id, "hidden");
  const reason = database.setUserVacancyHiddenReason("777", match.id, "stack_mismatch");
  assert.equal(reason.reason, "stack_mismatch");
  database.close();

  database = fixture.createDatabase();
  assert.equal(database.getUserVacancyHiddenReason("777", match.id)?.reason, "stack_mismatch");
  assert.equal(database.listUserVacanciesByStatus("777", "hidden", 0, 10).items[0]?.hiddenReason, "stack_mismatch");

  database.clearUserVacancyStatus("777", match.id);
  assert.equal(database.getUserVacancyHiddenReason("777", match.id)?.reason, "stack_mismatch");
  assert.equal(database.listUserWeeklyVacancies("777", 0, 10, 7).items[0]?.hiddenReason, null);

  database.close();
});

test("hidden reason summaries drive conservative filter suggestions", () => {
  const fixture = createFixture();
  const database = fixture.createDatabase();
  const filter = new VacancyFilter(fixture.config);

  database.setUserSearchProfileKeywords("777", "required_context", ["remote"]);
  database.setUserSearchProfileKeywords("777", "required_primary", ["react"]);

  for (const [index, reason] of ["not_rf", "not_rf", "not_rf", "low_salary"].entries()) {
    const match = createMatchedVacancy(
      database,
      filter,
      "777",
      `220${index}`,
      `React developer ${index}\nRemote\nTypeScript`
    );
    database.setUserVacancyStatus("777", match.id, "hidden");
    database.setUserVacancyHiddenReason("777", match.id, reason as "not_rf" | "low_salary");
  }

  const summary = database.countHiddenVacancyFeedbackSummary("777", 7);
  assert.equal(summary.totalHidden, 4);
  assert.equal(summary.withReason, 4);
  assert.equal(summary.withoutReason, 0);
  assert.equal(summary.topReasons[0]?.reason, "not_rf");
  assert.equal(summary.topReasons[0]?.count, 3);

  const suggestion = database.getHiddenVacancyFilterSuggestionCandidate("777", 7);
  assert.equal(suggestion?.suggestionKey, "hidden_not_rf");
  assert.equal(suggestion?.count, 3);

  database.markUserFilterSuggestionShown("777", "hidden_not_rf");
  assert.equal(database.getHiddenVacancyFilterSuggestionCandidate("777", 7), null);

  database.close();
});

test("saved and applied statuses persist after database restart", () => {
  const fixture = createFixture();
  let database = fixture.createDatabase();
  const filter = new VacancyFilter(fixture.config);

  database.setUserSearchProfileKeywords("777", "required_context", ["remote"]);
  database.setUserSearchProfileKeywords("777", "required_primary", ["react"]);

  const savedMatch = createMatchedVacancy(
    database,
    filter,
    "777",
    "3001",
    "React developer\nRemote\nNext.js"
  );
  const appliedMatch = createMatchedVacancy(
    database,
    filter,
    "777",
    "3002",
    "Senior React lead\nRemote\nDesign systems"
  );

  database.setUserVacancyStatus("777", savedMatch.id, "saved");
  database.setUserVacancyStatus("777", appliedMatch.id, "applied");
  database.close();

  database = fixture.createDatabase();

  const weekly = database.listUserWeeklyVacancies("777", 0, 10, 7);
  const savedPage = database.listUserVacanciesByStatus("777", "saved", 0, 10);
  const appliedPage = database.listUserVacanciesByStatus("777", "applied", 0, 10);

  assert.equal(savedPage.total, 1);
  assert.equal(savedPage.items[0]?.id, savedMatch.id);
  assert.equal(appliedPage.total, 1);
  assert.equal(appliedPage.items[0]?.id, appliedMatch.id);

  const savedWeeklyItem = weekly.items.find((item) => item.id === savedMatch.id);
  const appliedWeeklyItem = weekly.items.find((item) => item.id === appliedMatch.id);

  assert.equal(savedWeeklyItem?.userStatus, "saved");
  assert.equal(appliedWeeklyItem?.userStatus, "applied");

  database.close();
});

test("application workflow preserves applied date and manages active follow-up", () => {
  const fixture = createFixture();
  const database = fixture.createDatabase();
  const filter = new VacancyFilter(fixture.config);

  database.setUserSearchProfileKeywords("777", "required_context", ["remote"]);
  database.setUserSearchProfileKeywords("777", "required_primary", ["react"]);

  const match = createMatchedVacancy(
    database,
    filter,
    "777",
    "4001",
    "React developer\nRemote\nFollow-up friendly"
  );

  const firstAppliedAt = "2026-06-16T10:00:00.000Z";
  const secondAppliedAt = "2026-06-17T10:00:00.000Z";
  const followUpAt = "2026-06-20T10:00:00.000Z";

  database.setUserVacancyStatus("777", match.id, "applied");
  const firstApplication = database.upsertUserVacancyApplication("777", match.id, firstAppliedAt);
  assert.equal(firstApplication.appliedAt, firstAppliedAt);

  const scheduled = database.scheduleUserVacancyApplicationFollowUp("777", match.id, followUpAt);
  assert.equal(scheduled?.followUpAt, followUpAt);
  assert.equal(scheduled?.nextAttemptAt, followUpAt);

  const noted = database.setUserVacancyApplicationNote("777", match.id, "Wrote a short React note");
  assert.equal(noted?.note, "Wrote a short React note");
  assert.equal(noted?.followUpAt, followUpAt);

  const applicationPage = database.listUserVacancyApplications("777", 0, 10);
  assert.equal(applicationPage.total, 1);
  assert.equal(applicationPage.summary.waitingFollowUp, 1);
  assert.equal(applicationPage.summary.sentFollowUp, 0);
  assert.equal(applicationPage.summary.closedOrResponded, 0);
  assert.equal(applicationPage.items[0]?.id, match.id);
  assert.equal(applicationPage.items[0]?.application.note, "Wrote a short React note");

  const overdueFollowUps = database.listDueVacancyApplicationFollowUps(new Date("2026-06-20T10:01:00.000Z"));
  assert.equal(overdueFollowUps.length, 1);
  assert.equal(overdueFollowUps[0]?.id, match.id);

  const repeatedApplication = database.upsertUserVacancyApplication("777", match.id, secondAppliedAt);
  assert.equal(repeatedApplication.appliedAt, firstAppliedAt);
  assert.equal(repeatedApplication.followUpAt, null);
  assert.equal(repeatedApplication.note, "Wrote a short React note");

  const rescheduled = database.scheduleUserVacancyApplicationFollowUp("777", match.id, followUpAt);
  assert.equal(rescheduled?.followUpAt, followUpAt);
  database.cancelUserVacancyApplicationFollowUp("777", match.id);

  const cancelled = database.getUserVacancyApplication("777", match.id);
  assert.equal(cancelled?.followUpAt, followUpAt);
  assert.equal(cancelled?.nextAttemptAt, followUpAt);
  assert.ok(cancelled?.cancelledAt);

  database.close();
});
