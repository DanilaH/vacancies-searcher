import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { VacancyDatabase } from "../src/db/database";
import { VacancyFilter } from "../src/services/vacancyFilter";
import { calculateVacancyReminderAt } from "../src/services/vacancyReminderSchedule";
import { VacancyReminderScheduler } from "../src/services/vacancyReminderScheduler";
import { createTestConfig } from "./helpers";

function createFixture() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-tg-bot-reminders-"));
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
    createDatabase() {
      const database = new VacancyDatabase(config);
      database.initialize();
      return database;
    }
  };
}

function createVacancy(database: VacancyDatabase, config: ReturnType<typeof createTestConfig>, messageId: string) {
  const filter = new VacancyFilter(config);
  const text = `Senior React developer\nRemote\nTypeScript\nReference: ${messageId}`;
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
  return result.vacancy;
}

test("reminder presets use calendar time in the configured timezone", () => {
  const beforeEvening = new Date("2026-06-07T12:00:00.000Z");
  const afterEvening = new Date("2026-06-07T15:00:00.000Z");

  assert.equal(
    calculateVacancyReminderAt("evening", beforeEvening, "Asia/Yekaterinburg").toISOString(),
    "2026-06-07T14:00:00.000Z"
  );
  assert.equal(
    calculateVacancyReminderAt("evening", afterEvening, "Asia/Yekaterinburg").toISOString(),
    "2026-06-08T14:00:00.000Z"
  );
  assert.equal(
    calculateVacancyReminderAt("tomorrow", beforeEvening, "Asia/Yekaterinburg").toISOString(),
    "2026-06-08T05:00:00.000Z"
  );
  assert.equal(
    calculateVacancyReminderAt("three_days", beforeEvening, "Asia/Yekaterinburg").toISOString(),
    "2026-06-10T05:00:00.000Z"
  );
});

test("reminders save vacancies, move without duplicates and persist after restart", () => {
  const fixture = createFixture();
  let database = fixture.createDatabase();
  const vacancy = createVacancy(database, fixture.config, "reminder-1");

  const first = database.scheduleUserVacancyReminder("777", vacancy.id, "2026-06-08T05:00:00.000Z");
  assert.ok(first);
  assert.equal(database.getUserVacancyStatus("777", vacancy.id), "saved");
  assert.equal(database.listUserVacancyReminders("777", 0, 10).total, 1);

  const moved = database.scheduleUserVacancyReminder("777", vacancy.id, "2026-06-10T05:00:00.000Z");
  assert.equal(moved?.remindAt, "2026-06-10T05:00:00.000Z");
  assert.equal(database.listUserVacancyReminders("777", 0, 10).total, 1);
  database.close();

  database = fixture.createDatabase();
  assert.equal(database.getActiveUserVacancyReminder("777", vacancy.id)?.remindAt, "2026-06-10T05:00:00.000Z");
  database.clearUserVacancyStatus("777", vacancy.id);
  assert.ok(database.getActiveUserVacancyReminder("777", vacancy.id));
  database.setUserVacancyStatus("777", vacancy.id, "applied");
  assert.equal(database.getActiveUserVacancyReminder("777", vacancy.id), null);
  assert.equal(database.scheduleUserVacancyReminder("777", vacancy.id, "2026-06-11T05:00:00.000Z"), null);
  database.close();
});

test("scheduler delivers overdue reminders once and retries failed delivery", async () => {
  const fixture = createFixture();
  const database = fixture.createDatabase();
  const deliveredVacancy = createVacancy(database, fixture.config, "reminder-delivered");
  const retryVacancy = createVacancy(database, fixture.config, "reminder-retry");
  const dueAt = "2026-06-07T08:00:00.000Z";
  const now = new Date("2026-06-07T09:00:00.000Z");
  database.scheduleUserVacancyReminder("777", deliveredVacancy.id, dueAt);
  database.scheduleUserVacancyReminder("777", retryVacancy.id, dueAt);

  const attempts: number[] = [];
  const scheduler = new VacancyReminderScheduler(database, async (reminder) => {
    attempts.push(reminder.id);
    return reminder.id === deliveredVacancy.id;
  });
  await scheduler.runDueCycle(now);

  assert.deepEqual(attempts, [deliveredVacancy.id, retryVacancy.id]);
  assert.equal(database.getActiveUserVacancyReminder("777", deliveredVacancy.id), null);
  const retry = database.getActiveUserVacancyReminder("777", retryVacancy.id);
  assert.equal(retry?.attemptCount, 1);
  assert.equal(retry?.nextAttemptAt, "2026-06-07T09:05:00.000Z");

  attempts.length = 0;
  await scheduler.runDueCycle(now);
  assert.deepEqual(attempts, []);
  await scheduler.stop();
  database.close();
});
