import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { VacancyDatabase } from "../src/db/database";
import { ChannelHealthMonitor } from "../src/services/channelHealthMonitor";
import { createTestConfig } from "./helpers";

const successState = {
  lastSeenMessageId: null,
  idlePollStreak: 0,
  nextPollAfter: null
} as const;

function createDatabase() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-tg-bot-channel-health-"));
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
  database.bootstrapChannels(config.ownerUserId, ["job_react"], "telegram_web_preview");
  return { config, database };
}

test("ChannelHealthMonitor sends failure alerts once per current error and resets after success", () => {
  const { database } = createDatabase();
  const channel = database.getChannelByUsername("telegram_web_preview", "job_react");
  assert.ok(channel);

  database.markChannelCheckFailure(channel.id, "HTTP 500");
  const monitor = new ChannelHealthMonitor(database, () => Date.now());

  const firstAlerts = monitor.collectAlerts("telegram_web_preview", 300);
  const secondAlerts = monitor.collectAlerts("telegram_web_preview", 300);

  assert.equal(firstAlerts.length, 1);
  assert.equal(firstAlerts[0]?.kind, "failure");
  assert.equal(secondAlerts.length, 0);

  database.markChannelCheckSuccess(channel.id, successState);
  database.markChannelCheckFailure(channel.id, "HTTP 500");

  const thirdAlerts = monitor.collectAlerts("telegram_web_preview", 300);
  assert.equal(thirdAlerts.length, 1);
  assert.equal(thirdAlerts[0]?.kind, "failure");

  database.close();
});

test("ChannelHealthMonitor sends stale alerts once until the channel recovers", () => {
  const { database } = createDatabase();
  const channel = database.getChannelByUsername("telegram_web_preview", "job_react");
  assert.ok(channel);

  database.markChannelCheckSuccess(channel.id, successState);
  const updatedChannel = database.getChannelById(channel.id);
  assert.ok(updatedChannel?.lastSuccessAt);

  const successTimestamp = Date.parse(updatedChannel.lastSuccessAt!);
  const staleNow = successTimestamp + 21 * 60 * 1000;
  const monitor = new ChannelHealthMonitor(database, () => staleNow);

  const firstAlerts = monitor.collectAlerts("telegram_web_preview", 300);
  const secondAlerts = monitor.collectAlerts("telegram_web_preview", 300);

  assert.equal(firstAlerts.length, 1);
  assert.equal(firstAlerts[0]?.kind, "stale");
  assert.equal(secondAlerts.length, 0);

  database.markChannelCheckSuccess(channel.id, successState);
  const refreshedChannel = database.getChannelById(channel.id);
  assert.ok(refreshedChannel?.lastSuccessAt);
  const refreshedTimestamp = Date.parse(refreshedChannel.lastSuccessAt!);
  const nextMonitor = new ChannelHealthMonitor(database, () => refreshedTimestamp + 21 * 60 * 1000);
  const thirdAlerts = nextMonitor.collectAlerts("telegram_web_preview", 300);

  assert.equal(thirdAlerts.length, 1);
  assert.equal(thirdAlerts[0]?.kind, "stale");

  database.close();
});
