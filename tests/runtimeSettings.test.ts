import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { VacancyDatabase } from "../src/db/database";
import { RuntimeSettingsService } from "../src/runtime/runtimeSettings";
import { getEffectiveWeeklyPageSize, nextWeeklyPageSize } from "../src/services/weeklyPageSize";
import { createTestConfig } from "./helpers";

function createTempDatabaseConfig() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-tg-bot-settings-"));
  return createTestConfig({
    databasePath: path.join(tempDir, "bot.db"),
    databaseUrl: `file:${path.join(tempDir, "bot.db")}`,
    appDataDir: tempDir,
    runtimeDir: path.join(tempDir, "runtime")
  });
}

test("pause state persists after restart", () => {
  const config = createTempDatabaseConfig();

  const firstDatabase = new VacancyDatabase(config);
  firstDatabase.initialize();
  firstDatabase.setBotPaused(config.ownerUserId!, true);
  firstDatabase.close();

  const secondDatabase = new VacancyDatabase(config);
  secondDatabase.initialize();
  const settings = secondDatabase.getUserSettings(config.ownerUserId!);
  secondDatabase.close();

  assert.equal(settings.botPaused, true);
});

test("notify-on-empty-cycle flag is disabled by default and persists after toggle", () => {
  const config = createTempDatabaseConfig();

  const firstDatabase = new VacancyDatabase(config);
  firstDatabase.initialize();
  const initialSettings = firstDatabase.getUserSettings(config.ownerUserId!);
  firstDatabase.setNotifyOnEmptyCycle(config.ownerUserId!, true);
  firstDatabase.close();

  const secondDatabase = new VacancyDatabase(config);
  secondDatabase.initialize();
  const persistedSettings = secondDatabase.getUserSettings(config.ownerUserId!);
  secondDatabase.close();

  assert.equal(initialSettings.notifyOnEmptyCycle, false);
  assert.equal(persistedSettings.notifyOnEmptyCycle, true);
});

test("daily digest is disabled by default and persists after toggle", () => {
  const config = createTempDatabaseConfig();

  const firstDatabase = new VacancyDatabase(config);
  firstDatabase.initialize();
  const initialSettings = firstDatabase.getUserSettings(config.ownerUserId!);
  firstDatabase.setDailyDigestEnabled(config.ownerUserId!, true);
  firstDatabase.close();

  const secondDatabase = new VacancyDatabase(config);
  secondDatabase.initialize();
  const persistedSettings = secondDatabase.getUserSettings(config.ownerUserId!);
  secondDatabase.close();

  assert.equal(initialSettings.dailyDigestEnabled, false);
  assert.equal(initialSettings.dailyDigestTimeMinutes, null);
  assert.equal(persistedSettings.dailyDigestEnabled, true);
  assert.equal(persistedSettings.dailyDigestTimeMinutes, null);
});

test("weekly page size uses global default until user override is set", () => {
  const config = createTempDatabaseConfig();

  const firstDatabase = new VacancyDatabase(config);
  firstDatabase.initialize();
  const runtimeSettings = new RuntimeSettingsService(config, firstDatabase);
  const initialSettings = firstDatabase.getUserSettings(config.ownerUserId!);
  const initialEffective = getEffectiveWeeklyPageSize(initialSettings, runtimeSettings.getSnapshot().weeklyPageSize);
  firstDatabase.setUserWeeklyPageSize(config.ownerUserId!, 4);
  firstDatabase.close();

  const secondDatabase = new VacancyDatabase(config);
  secondDatabase.initialize();
  const persistedSettings = secondDatabase.getUserSettings(config.ownerUserId!);
  const persistedEffective = getEffectiveWeeklyPageSize(persistedSettings, config.weeklyPageSize);
  secondDatabase.close();

  assert.equal(initialSettings.weeklyPageSize, null);
  assert.equal(initialEffective, 3);
  assert.equal(persistedSettings.weeklyPageSize, 4);
  assert.equal(persistedEffective, 4);
});

test("weekly page size cycles through one to five", () => {
  assert.equal(nextWeeklyPageSize(1), 2);
  assert.equal(nextWeeklyPageSize(2), 3);
  assert.equal(nextWeeklyPageSize(3), 4);
  assert.equal(nextWeeklyPageSize(4), 5);
  assert.equal(nextWeeklyPageSize(5), 1);
});

test("SQL injection payload is stored safely as keyword", () => {
  const config = createTempDatabaseConfig();
  const database = new VacancyDatabase(config);
  database.initialize();

  const payload = "react'); DROP TABLE user_keywords; --";
  const inserted = database.addUserKeyword(config.ownerUserId!, "include", payload);
  const storedKeywords = database.listUserKeywords(config.ownerUserId!, "include");

  database.close();

  assert.equal(inserted.added, true);
  assert.equal(storedKeywords.some((keyword) => keyword.keyword === payload), true);
});

test("runtime numeric setting persists after restart", () => {
  const config = createTempDatabaseConfig();

  const firstDatabase = new VacancyDatabase(config);
  firstDatabase.initialize();
  const firstRuntimeSettings = new RuntimeSettingsService(config, firstDatabase);
  firstRuntimeSettings.setNumericValue("CHECK_INTERVAL_SECONDS", 120, config.ownerUserId);
  firstDatabase.close();

  const secondDatabase = new VacancyDatabase(config);
  secondDatabase.initialize();
  const secondRuntimeSettings = new RuntimeSettingsService(config, secondDatabase);
  const savedValue = secondRuntimeSettings.getValue("CHECK_INTERVAL_SECONDS");
  secondDatabase.close();

  assert.equal(savedValue.value, 120);
  assert.equal(savedValue.source, "override");
});
