import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { formatSearchProfilePrompt } from "../src/bot/admin";
import { VacancyDatabase } from "../src/db/database";
import { createTestConfig } from "./helpers";

function createTempDatabaseConfig() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-tg-bot-onboarding-"));
  return createTestConfig({
    ownerUserId: "777",
    ownerChatId: "777",
    databasePath: path.join(tempDir, "bot.db"),
    databaseUrl: `file:${path.join(tempDir, "bot.db")}`,
    appDataDir: tempDir,
    runtimeDir: path.join(tempDir, "runtime")
  });
}

test("newly added user starts with onboarding incomplete", () => {
  const config = createTempDatabaseConfig();
  const database = new VacancyDatabase(config);
  database.initialize();

  database.addOrActivateBotUser("888", "member", "777");
  const settings = database.getUserSettings("888");

  database.close();

  assert.equal(settings.onboardingCompleted, false);
  assert.equal(settings.onboardingStep, null);
  assert.equal(settings.vacancyLanguageMode, "ru_en");
});

test("onboarding state persists after restart", () => {
  const config = createTempDatabaseConfig();

  const firstDatabase = new VacancyDatabase(config);
  firstDatabase.initialize();
  firstDatabase.addOrActivateBotUser("888", "member", "777");
  firstDatabase.setOnboardingStep("888", "language");
  firstDatabase.setVacancyLanguageMode("888", "en_only");
  firstDatabase.close();

  const secondDatabase = new VacancyDatabase(config);
  secondDatabase.initialize();
  const pendingSettings = secondDatabase.getUserSettings("888");
  secondDatabase.setOnboardingCompleted("888", true);
  secondDatabase.setOnboardingStep("888", null);
  secondDatabase.close();

  const thirdDatabase = new VacancyDatabase(config);
  thirdDatabase.initialize();
  const completedSettings = thirdDatabase.getUserSettings("888");
  thirdDatabase.close();

  assert.equal(pendingSettings.onboardingCompleted, false);
  assert.equal(pendingSettings.onboardingStep, "language");
  assert.equal(pendingSettings.vacancyLanguageMode, "en_only");
  assert.equal(completedSettings.onboardingCompleted, true);
  assert.equal(completedSettings.onboardingStep, null);
  assert.equal(completedSettings.vacancyLanguageMode, "en_only");
});

test("search profile prompt shows current block state", () => {
  const prompt = formatSearchProfilePrompt("preferred", ["typescript", "senior"]);

  assert.match(prompt, /Сейчас:/);
  assert.match(prompt, /typescript, senior/);
  assert.match(prompt, /Чтобы очистить блок/);
});
