import test from "node:test";
import assert from "node:assert/strict";

import { VacancyDatabase } from "../src/db/database";
import { calculateApplicationFollowUpAt } from "../src/services/applicationFollowUpSchedule";
import { ApplicationFollowUpScheduler } from "../src/services/applicationFollowUpScheduler";
import type { VacancyApplicationFollowUpRecord } from "../src/types";

function createFollowUp(id: number, attemptCount = 0): VacancyApplicationFollowUpRecord {
  return {
    id,
    sourceName: "telegram_web_preview",
    sourceChannel: "jobs",
    sourceMessageId: String(id),
    messageDate: "2026-06-16T10:00:00.000Z",
    title: "Frontend Developer",
    text: "Frontend Developer\nRemote",
    normalizedText: "frontend developer remote",
    url: `https://t.me/jobs/${id}`,
    canonicalUrl: null,
    fingerprint: `fingerprint-${id}`,
    score: 10,
    matchSummary: "react",
    matchedKeywords: ["react"],
    contacts: [],
    sentToOwnerAt: null,
    createdAt: "2026-06-16T10:00:00.000Z",
    userId: "777",
    appliedAt: "2026-06-16T10:00:00.000Z",
    note: null,
    followUpAt: "2026-06-19T10:00:00.000Z",
    nextAttemptAt: "2026-06-19T10:00:00.000Z",
    attemptCount,
    deliveredAt: null,
    cancelledAt: null,
    lastError: null,
    respondedAt: null,
    closedAt: null,
    applicationCreatedAt: "2026-06-16T10:00:00.000Z",
    applicationUpdatedAt: "2026-06-16T10:00:00.000Z"
  };
}

test("application follow-up one-minute preset is near immediate", () => {
  assert.equal(
    calculateApplicationFollowUpAt("one_minute", new Date("2026-06-17T10:00:00.000Z")).toISOString(),
    "2026-06-17T10:01:00.000Z"
  );
});

test("ApplicationFollowUpScheduler marks delivered follow-ups", async () => {
  const delivered: Array<{ userId: string; vacancyId: number; expectedNextAttemptAt: string; deliveredAt: string }> = [];
  const database = {
    listDueVacancyApplicationFollowUps: () => [createFollowUp(42)],
    markVacancyApplicationFollowUpDelivered: (
      userId: string,
      vacancyId: number,
      expectedNextAttemptAt: string,
      deliveredAt: string
    ) => delivered.push({ userId, vacancyId, expectedNextAttemptAt, deliveredAt }),
    markVacancyApplicationFollowUpFailed: () => {
      throw new Error("should not fail");
    }
  } as unknown as VacancyDatabase;

  const scheduler = new ApplicationFollowUpScheduler(database, async () => true);
  await scheduler.runDueCycle(new Date("2026-06-19T10:05:00.000Z"));

  assert.deepEqual(delivered, [{
    userId: "777",
    vacancyId: 42,
    expectedNextAttemptAt: "2026-06-19T10:00:00.000Z",
    deliveredAt: "2026-06-19T10:05:00.000Z"
  }]);
});

test("ApplicationFollowUpScheduler retries failed follow-ups", async () => {
  const failures: Array<{ userId: string; vacancyId: number; expectedNextAttemptAt: string; nextAttemptAt: string; error: string }> = [];
  const database = {
    listDueVacancyApplicationFollowUps: () => [createFollowUp(43, 1)],
    markVacancyApplicationFollowUpDelivered: () => {
      throw new Error("should not deliver");
    },
    markVacancyApplicationFollowUpFailed: (
      userId: string,
      vacancyId: number,
      expectedNextAttemptAt: string,
      nextAttemptAt: string,
      error: string
    ) => failures.push({ userId, vacancyId, expectedNextAttemptAt, nextAttemptAt, error })
  } as unknown as VacancyDatabase;

  const scheduler = new ApplicationFollowUpScheduler(database, async () => false);
  await scheduler.runDueCycle(new Date("2026-06-19T10:05:00.000Z"));

  assert.equal(failures.length, 1);
  assert.equal(failures[0]?.userId, "777");
  assert.equal(failures[0]?.vacancyId, 43);
  assert.equal(failures[0]?.expectedNextAttemptAt, "2026-06-19T10:00:00.000Z");
  assert.equal(failures[0]?.error, "Application follow-up delivery returned false.");
  assert.ok(new Date(failures[0]!.nextAttemptAt).getTime() > new Date("2026-06-19T10:05:00.000Z").getTime());
});
