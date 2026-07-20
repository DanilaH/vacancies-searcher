import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { VacancyDatabase } from "../src/db/database";
import { DailyDigestScheduler, hasActionableDailyDigest } from "../src/services/dailyDigestScheduler";
import {
  formatDigestScheduledFor,
  getLocalDigestDateParts,
  resolveDailyDigestTimeMinutes
} from "../src/services/dailyDigestSchedule";
import { VacancyFilter } from "../src/services/vacancyFilter";
import type { DailyDigestDeliveryRecord, DailyDigestDueRecord, DailyDigestPayload } from "../src/types";
import { createTestConfig } from "./helpers";

function createTempDatabase() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-tg-bot-digest-"));
  const databasePath = path.join(tempDir, "bot.db");
  const config = createTestConfig({
    ownerUserId: "777",
    ownerChatId: "777",
    databasePath,
    databaseUrl: `file:${databasePath}`,
    appDataDir: tempDir,
    runtimeDir: path.join(tempDir, "runtime")
  });
  const database = new VacancyDatabase(config);
  database.initialize();
  return { config, database };
}

function createPayload(overrides: Partial<DailyDigestPayload> = {}): DailyDigestPayload {
  return {
    userId: "777",
    digestDate: "2026-06-17",
    scheduledFor: "2026-06-17 09:00 UTC",
    newVacanciesCount: 0,
    savedWithoutActionCount: 0,
    dueApplicationFollowUpsCount: 0,
    hiddenLastDayCount: 0,
    ...overrides
  };
}

function createDeliveryState(overrides: Partial<DailyDigestDeliveryRecord> = {}): DailyDigestDeliveryRecord {
  return {
    userId: "777",
    digestDate: "2026-06-17",
    scheduledFor: "2026-06-17 09:00 UTC",
    nextAttemptAt: null,
    attemptCount: 0,
    deliveredAt: null,
    skippedAt: null,
    lastError: null,
    createdAt: "2026-06-17T09:00:00.000Z",
    updatedAt: "2026-06-17T09:00:00.000Z",
    ...overrides
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

test("daily digest time helpers use 09:00 default and local date", () => {
  assert.equal(resolveDailyDigestTimeMinutes(null), 9 * 60);
  assert.equal(resolveDailyDigestTimeMinutes(8 * 60 + 30), 8 * 60 + 30);
  assert.equal(resolveDailyDigestTimeMinutes(1440), 9 * 60);
  assert.deepEqual(getLocalDigestDateParts(new Date("2026-06-17T09:15:00.000Z"), "UTC"), {
    date: "2026-06-17",
    minutes: 9 * 60 + 15
  });
  assert.equal(formatDigestScheduledFor("2026-06-17", 9 * 60, "UTC"), "2026-06-17 09:00 UTC");
});

test("daily digest payload counts actionable buckets", () => {
  const { config, database } = createTempDatabase();
  const filter = new VacancyFilter(config);

  database.setUserSearchProfileKeywords("777", "required_context", ["remote"]);
  database.setUserSearchProfileKeywords("777", "required_primary", ["react"]);

  createMatchedVacancy(database, filter, "777", "digest-1", "React developer\nRemote");
  const saved = createMatchedVacancy(database, filter, "777", "digest-2", "React engineer\nRemote");
  const applied = createMatchedVacancy(database, filter, "777", "digest-3", "React lead\nRemote");
  const hidden = createMatchedVacancy(database, filter, "777", "digest-4", "React manager\nRemote");

  database.setUserVacancyStatus("777", saved.id, "saved");
  database.setUserVacancyStatus("777", applied.id, "applied");
  database.setUserVacancyStatus("777", hidden.id, "hidden");
  database.setUserVacancyHiddenReason("777", hidden.id, "low_salary");
  database.upsertUserVacancyApplication("777", applied.id);
  database.scheduleUserVacancyApplicationFollowUp(
    "777",
    applied.id,
    new Date(Date.now() - 60_000).toISOString()
  );

  const payload = database.buildDailyDigestPayload("777", "2026-06-17", "2026-06-17 09:00 UTC", new Date());
  database.close();

  assert.equal(payload.newVacanciesCount, 2);
  assert.equal(payload.savedWithoutActionCount, 1);
  assert.equal(payload.dueApplicationFollowUpsCount, 1);
  assert.equal(payload.hiddenLastDayCount, 1);
  assert.deepEqual(payload.hiddenReasonTop, [{ reason: "low_salary", count: 1 }]);
  assert.equal(hasActionableDailyDigest(payload), true);
  assert.equal(hasActionableDailyDigest({ ...payload, newVacanciesCount: 0, savedWithoutActionCount: 0, dueApplicationFollowUpsCount: 0 }), false);
});

test("DailyDigestScheduler sends overdue digest once after scheduled local time", async () => {
  let deliveryState: DailyDigestDeliveryRecord | null = null;
  const delivered: DailyDigestDueRecord[] = [];
  const database = {
    listDailyDigestEnabledUsers: () => [{ userId: "777", dailyDigestTimeMinutes: null }],
    getDailyDigestDelivery: () => deliveryState,
    buildDailyDigestPayload: (_userId: string, digestDate: string, scheduledFor: string) =>
      createPayload({ digestDate, scheduledFor, newVacanciesCount: 2 }),
    markDailyDigestDelivered: (userId: string, digestDate: string, scheduledFor: string, deliveredAt: string) => {
      deliveryState = createDeliveryState({ userId, digestDate, scheduledFor, deliveredAt });
    },
    markDailyDigestSkipped: () => {
      throw new Error("should not skip");
    },
    markDailyDigestFailed: () => {
      throw new Error("should not fail");
    }
  } as unknown as VacancyDatabase;

  const scheduler = new DailyDigestScheduler(database, "UTC", async (digest) => {
    delivered.push(digest);
    return true;
  });

  await scheduler.runDueCycle(new Date("2026-06-17T08:59:00.000Z"));
  await scheduler.runDueCycle(new Date("2026-06-17T09:05:00.000Z"));
  await scheduler.runDueCycle(new Date("2026-06-17T09:10:00.000Z"));

  assert.equal(delivered.length, 1);
  assert.equal(delivered[0]?.digestDate, "2026-06-17");
  assert.equal(delivered[0]?.scheduledFor, "2026-06-17 09:00 UTC");
  const finalDeliveryState = deliveryState as DailyDigestDeliveryRecord | null;
  assert.equal(finalDeliveryState?.deliveredAt, "2026-06-17T09:05:00.000Z");
});

test("DailyDigestScheduler skips empty digests for the local date", async () => {
  let deliveryState: DailyDigestDeliveryRecord | null = null;
  const skipped: DailyDigestPayload[] = [];
  const database = {
    listDailyDigestEnabledUsers: () => [{ userId: "777", dailyDigestTimeMinutes: null }],
    getDailyDigestDelivery: () => deliveryState,
    buildDailyDigestPayload: (_userId: string, digestDate: string, scheduledFor: string) =>
      createPayload({ digestDate, scheduledFor, hiddenLastDayCount: 4 }),
    markDailyDigestSkipped: (userId: string, digestDate: string, scheduledFor: string, skippedAt: string) => {
      deliveryState = createDeliveryState({ userId, digestDate, scheduledFor, skippedAt });
    },
    markDailyDigestDelivered: () => {
      throw new Error("should not deliver");
    },
    markDailyDigestFailed: () => {
      throw new Error("should not fail");
    }
  } as unknown as VacancyDatabase;

  const scheduler = new DailyDigestScheduler(database, "UTC", async () => {
    throw new Error("should not call deliver");
  }, async (payload) => {
    skipped.push(payload);
  });

  await scheduler.runDueCycle(new Date("2026-06-17T09:05:00.000Z"));
  await scheduler.runDueCycle(new Date("2026-06-17T09:10:00.000Z"));

  assert.equal(skipped.length, 1);
  const finalDeliveryState = deliveryState as DailyDigestDeliveryRecord | null;
  assert.equal(finalDeliveryState?.skippedAt, "2026-06-17T09:05:00.000Z");
});

test("DailyDigestScheduler retries failed delivery with backoff", async () => {
  let deliveryState: DailyDigestDeliveryRecord | null = null;
  const delivered: DailyDigestDueRecord[] = [];
  const failures: Array<{ digest: DailyDigestDueRecord; error: string }> = [];
  const database = {
    listDailyDigestEnabledUsers: () => [{ userId: "777", dailyDigestTimeMinutes: null }],
    getDailyDigestDelivery: () => deliveryState,
    buildDailyDigestPayload: (_userId: string, digestDate: string, scheduledFor: string) =>
      createPayload({ digestDate, scheduledFor, dueApplicationFollowUpsCount: 1 }),
    markDailyDigestFailed: (userId: string, digestDate: string, scheduledFor: string, nextAttemptAt: string, error: string) => {
      deliveryState = createDeliveryState({
        userId,
        digestDate,
        scheduledFor,
        nextAttemptAt,
        attemptCount: (deliveryState?.attemptCount ?? 0) + 1,
        lastError: error
      });
    },
    markDailyDigestDelivered: () => {
      throw new Error("should not deliver");
    },
    markDailyDigestSkipped: () => {
      throw new Error("should not skip");
    }
  } as unknown as VacancyDatabase;

  const scheduler = new DailyDigestScheduler(database, "UTC", async (digest) => {
    delivered.push(digest);
    return false;
  }, async () => {}, async (digest, error) => {
    failures.push({ digest, error });
  });

  await scheduler.runDueCycle(new Date("2026-06-17T09:00:00.000Z"));
  await scheduler.runDueCycle(new Date("2026-06-17T09:01:00.000Z"));
  await scheduler.runDueCycle(new Date("2026-06-17T09:05:00.000Z"));

  assert.equal(delivered.length, 2);
  assert.equal(failures.length, 2);
  assert.equal(failures[0]?.error, "Daily digest delivery returned false.");
  const finalDeliveryState = deliveryState as DailyDigestDeliveryRecord | null;
  assert.equal(finalDeliveryState?.attemptCount, 2);
  assert.equal(finalDeliveryState?.nextAttemptAt, "2026-06-17T09:15:00.000Z");
});
