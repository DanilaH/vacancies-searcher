import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { VacancyDatabase } from "../src/db/database";
import { validateSearchProfileKeywordsInput } from "../src/services/searchProfileValidation";
import { createTestConfig } from "./helpers";

function createTempDatabaseConfig() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-tg-bot-search-profile-"));
  return createTestConfig({
    ownerUserId: "777",
    ownerChatId: "777",
    databasePath: path.join(tempDir, "bot.db"),
    databaseUrl: `file:${path.join(tempDir, "bot.db")}`,
    appDataDir: tempDir,
    runtimeDir: path.join(tempDir, "runtime")
  });
}

test("new user search profile starts empty and persists after update", () => {
  const config = createTempDatabaseConfig();

  const firstDatabase = new VacancyDatabase(config);
  firstDatabase.initialize();
  const initialProfile = firstDatabase.getUserSearchProfile("777");
  firstDatabase.setUserSearchProfileKeywords("777", "required_primary", ["python", "backend"]);
  firstDatabase.setUserSearchProfileKeywords("777", "preferred", ["django", "senior"]);
  firstDatabase.close();

  const secondDatabase = new VacancyDatabase(config);
  secondDatabase.initialize();
  const persistedProfile = secondDatabase.getUserSearchProfile("777");
  secondDatabase.close();

  assert.deepEqual(initialProfile.requiredContextKeywords, []);
  assert.deepEqual(initialProfile.requiredPrimaryKeywords, []);
  assert.deepEqual(initialProfile.preferredKeywords, []);
  assert.deepEqual(initialProfile.excludeKeywords, []);
  assert.deepEqual(persistedProfile.requiredPrimaryKeywords, ["python", "backend"]);
  assert.deepEqual(persistedProfile.preferredKeywords, ["django", "senior"]);
});

test("resetUserSearchProfile clears all profile blocks", () => {
  const config = createTempDatabaseConfig();

  const database = new VacancyDatabase(config);
  database.initialize();
  database.setUserSearchProfileKeywords("777", "required_context", ["remote", "europe"]);
  database.setUserSearchProfileKeywords("777", "required_primary", ["react", "frontend"]);
  database.setUserSearchProfileKeywords("777", "preferred", ["typescript", "senior"]);
  database.setUserSearchProfileKeywords("777", "exclude", ["office", "php"]);

  const clearedProfile = database.resetUserSearchProfile("777");
  database.close();

  assert.deepEqual(clearedProfile.requiredContextKeywords, []);
  assert.deepEqual(clearedProfile.requiredPrimaryKeywords, []);
  assert.deepEqual(clearedProfile.preferredKeywords, []);
  assert.deepEqual(clearedProfile.excludeKeywords, []);
});

test("search profile validation accepts clear token and rejects oversize lists", () => {
  const clearResult = validateSearchProfileKeywordsInput("required_context", "-");
  const oversizedInput = Array.from({ length: 25 }, (_, index) => `tag-${index + 1}`).join(", ");
  const oversizedResult = validateSearchProfileKeywordsInput("preferred", oversizedInput);

  assert.deepEqual(clearResult, { ok: true, keywords: [] });
  assert.equal(oversizedResult.ok, false);
});
