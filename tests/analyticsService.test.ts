import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createAnalyticsService } from "../src/analytics/analyticsService";
import { VacancyDatabase } from "../src/db/database";
import { createTestConfig } from "./helpers";

function createDatabase() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-tg-bot-analytics-"));
  const config = createTestConfig({
    databasePath: path.join(tempDir, "bot.db"),
    databaseUrl: `file:${path.join(tempDir, "bot.db")}`,
    appDataDir: tempDir,
    runtimeDir: path.join(tempDir, "runtime")
  });
  const database = new VacancyDatabase(config);
  database.initialize();

  return { config, database };
}

test("AnalyticsService stores events locally with common properties", async () => {
  const { config, database } = createDatabase();
  const analytics = createAnalyticsService(config, database);

  await analytics.capture({
    eventName: "user_started",
    userId: "123456",
    properties: {
      entrypoint: "command"
    }
  });

  const events = database.listAnalyticsEvents(5, "user_started");
  assert.equal(events.length, 1);
  assert.equal(events[0]?.userId, "123456");
  assert.equal(events[0]?.distinctId, "123456");
  assert.equal(events[0]?.properties.entrypoint, "command");
  assert.equal(events[0]?.properties.environment, "test");
  assert.equal(events[0]?.properties.telegram_source_mode, "web");

  await analytics.shutdown();
  database.close();
});

test("AnalyticsService uses system distinct id for system events", async () => {
  const { config, database } = createDatabase();
  const analytics = createAnalyticsService(config, database);

  await analytics.capture({
    eventName: "poll_cycle_completed",
    properties: {
      source_name: "telegram_web_preview",
      fetched_items_count: 12
    }
  });

  const [event] = database.listAnalyticsEvents(1, "poll_cycle_completed");
  assert.equal(event?.distinctId, "system:bot");
  assert.equal(event?.userId, null);
  assert.equal(event?.properties.fetched_items_count, 12);

  await analytics.shutdown();
  database.close();
});
