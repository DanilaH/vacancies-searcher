import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import BetterSqlite3 from "better-sqlite3";

import { VacancyDatabase } from "../src/db/database";
import { createTestConfig } from "./helpers";

const EMPTY_DISCOVERY_STATS = {
  samplePosts: 0,
  primarySignalPosts: 0,
  formatSignalPosts: 0,
  hiringPosts: 0,
  vacancyLikePosts: 0,
  resumePosts: 0,
  resumeRate: 0
};

test("technical cleanup removes expired history while preserving user-visible discovery state", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-tg-bot-cleanup-"));
  const databasePath = path.join(tempDir, "bot.db");
  const config = createTestConfig({
    databasePath,
    databaseUrl: `file:${databasePath}`,
    appDataDir: tempDir,
    runtimeDir: path.join(tempDir, "runtime"),
    analyticsRetentionDays: 90,
    channelDiscoveryRunRetentionDays: 30,
    channelDiscoveryCheckRetentionDays: 180
  });
  let database = new VacancyDatabase(config);
  database.initialize();

  database.recordAnalyticsEvent({
    eventName: "user_started",
    occurredAt: "2025-01-01T00:00:00.000Z"
  });
  database.recordAnalyticsEvent({
    eventName: "poll_cycle_completed",
    occurredAt: "2026-06-01T00:00:00.000Z"
  });

  const createRun = () =>
    database.createChannelDiscoveryRun({
      startedByUserId: config.ownerUserId,
      profileId: "frontend",
      profileLabel: "Frontend",
      seedQueries: ["frontend jobs"]
    });
  const completeRun = (runId: number) =>
    database.completeChannelDiscoveryRun(runId, {
      totalCandidatesFound: 1,
      candidatesToCheck: 1,
      candidatesChecked: 1,
      candidatesRecommended: 1,
      candidatesFiltered: 0
    });
  const addCandidate = (runId: number, username: string, status: "approved" | "pending" | "blocked") =>
    database.upsertChannelDiscoveryCandidate({
      runId,
      username,
      status,
      score: 50,
      sources: ["manual_seed"],
      stats: EMPTY_DISCOVERY_STATS,
      reasons: ["fixture"]
    });

  const removableRun = createRun();
  completeRun(removableRun.id);
  addCandidate(removableRun.id, "approved_old", "approved");

  const pendingRun = createRun();
  completeRun(pendingRun.id);
  addCandidate(pendingRun.id, "pending_old", "pending");

  const blockedRun = createRun();
  completeRun(blockedRun.id);
  addCandidate(blockedRun.id, "blocked_old", "blocked");

  const runningRun = createRun();
  const recentRun = createRun();
  completeRun(recentRun.id);

  database.recordChannelDiscoveryCheck("old-search", "old_checked_channel");
  database.recordChannelDiscoveryCheck("recent-search", "recent_checked_channel");
  database.close();

  const sqlite = new BetterSqlite3(databasePath);
  sqlite
    .prepare("UPDATE channel_discovery_runs SET started_at = ?, completed_at = ? WHERE id IN (?, ?, ?)")
    .run("2025-01-01T00:00:00.000Z", "2025-01-01T01:00:00.000Z", removableRun.id, pendingRun.id, blockedRun.id);
  sqlite
    .prepare("UPDATE channel_discovery_runs SET started_at = ? WHERE id = ?")
    .run("2025-01-01T00:00:00.000Z", runningRun.id);
  sqlite
    .prepare("UPDATE channel_discovery_runs SET started_at = ?, completed_at = ? WHERE id = ?")
    .run("2026-06-01T00:00:00.000Z", "2026-06-01T01:00:00.000Z", recentRun.id);
  sqlite
    .prepare("UPDATE channel_discovery_checks SET last_checked_at = ? WHERE search_key = ?")
    .run("2025-01-01T00:00:00.000Z", "old-search");
  sqlite
    .prepare("UPDATE channel_discovery_checks SET last_checked_at = ? WHERE search_key = ?")
    .run("2026-06-01T00:00:00.000Z", "recent-search");
  sqlite.close();

  database = new VacancyDatabase(config);
  database.initialize();
  const summary = database.cleanupTechnicalData(new Date("2026-06-06T00:00:00.000Z"));

  assert.deepEqual(summary, {
    analyticsEventsDeleted: 1,
    discoveryRunsDeleted: 1,
    discoveryCandidatesDeleted: 1,
    discoveryChecksDeleted: 1
  });
  assert.equal(database.countAnalyticsEvents(), 1);
  assert.equal(database.getChannelDiscoveryRun(removableRun.id), null);
  assert.notEqual(database.getChannelDiscoveryRun(pendingRun.id), null);
  assert.notEqual(database.getChannelDiscoveryRun(blockedRun.id), null);
  assert.notEqual(database.getChannelDiscoveryRun(runningRun.id), null);
  assert.notEqual(database.getChannelDiscoveryRun(recentRun.id), null);
  assert.equal(database.isChannelDiscoveryUsernameBlocked("blocked_old"), true);
  assert.equal(database.listChannelDiscoveryCheckTimes("old-search").size, 0);
  assert.equal(database.listChannelDiscoveryCheckTimes("recent-search").size, 1);

  assert.deepEqual(database.cleanupTechnicalData(new Date("2026-06-06T00:00:00.000Z")), {
    analyticsEventsDeleted: 0,
    discoveryRunsDeleted: 0,
    discoveryCandidatesDeleted: 0,
    discoveryChecksDeleted: 0
  });
  database.close();
});
