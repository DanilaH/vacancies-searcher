import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import BetterSqlite3 from "better-sqlite3";

import { VacancyDatabase } from "../src/db/database";
import { getSchemaTableColumns } from "../src/db/schema";
import { createTestConfig } from "./helpers";

function createTempDatabaseConfig() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-tg-bot-users-"));
  return createTestConfig({
    ownerUserId: "777",
    ownerChatId: "777",
    databasePath: path.join(tempDir, "bot.db"),
    databaseUrl: `file:${path.join(tempDir, "bot.db")}`,
    appDataDir: tempDir,
    runtimeDir: path.join(tempDir, "runtime")
  });
}

test("user role and active state persist after restart", () => {
  const config = createTempDatabaseConfig();

  const firstDatabase = new VacancyDatabase(config);
  firstDatabase.initialize();
  firstDatabase.addOrActivateBotUser("888", "member", config.ownerUserId);
  firstDatabase.setBotUserRole("888", "admin");
  firstDatabase.setBotUserActive("888", false);
  firstDatabase.close();

  const secondDatabase = new VacancyDatabase(config);
  secondDatabase.initialize();
  const user = secondDatabase.getBotUser("888");
  const isAllowed = secondDatabase.isAllowedUser("888");
  const hasAdminAccess = secondDatabase.hasAdminAccess("888");
  secondDatabase.close();

  assert.ok(user);
  assert.equal(user.role, "admin");
  assert.equal(user.isActive, false);
  assert.equal(isAllowed, false);
  assert.equal(hasAdminAccess, false);
});

test("owner cannot be demoted or disabled", () => {
  const config = createTempDatabaseConfig();
  const database = new VacancyDatabase(config);
  database.initialize();

  database.setBotUserRole("777", "member");
  database.setBotUserActive("777", false);
  const owner = database.getBotUser("777");
  database.close();

  assert.ok(owner);
  assert.equal(owner.role, "owner");
  assert.equal(owner.isActive, true);
});

test("owner access is narrower than admin access", () => {
  const config = createTempDatabaseConfig();
  const database = new VacancyDatabase(config);
  database.initialize();
  database.addOrActivateBotUser("888", "member", config.ownerUserId);
  database.setBotUserRole("888", "admin");

  const ownerHasOwnerAccess = database.hasOwnerAccess("777");
  const adminHasOwnerAccess = database.hasOwnerAccess("888");
  const adminHasAdminAccess = database.hasAdminAccess("888");
  database.close();

  assert.equal(ownerHasOwnerAccess, true);
  assert.equal(adminHasOwnerAccess, false);
  assert.equal(adminHasAdminAccess, true);
});

test("schema column lookup only supports allowlisted tables", () => {
  const config = createTempDatabaseConfig();
  const database = new VacancyDatabase(config);
  database.initialize();
  const sqlite = new BetterSqlite3(config.databasePath, { readonly: true });

  const userSettingsColumns = getSchemaTableColumns(sqlite, "user_settings");
  const applicationColumns = getSchemaTableColumns(sqlite, "user_vacancy_applications");

  assert.equal(userSettingsColumns.has("notify_on_empty_cycle"), true);
  assert.equal(userSettingsColumns.has("weekly_page_size"), true);
  assert.equal(applicationColumns.has("follow_up_at"), true);
  assert.throws(() => getSchemaTableColumns(sqlite, "bot_users" as never), /Unsupported table lookup/);

  sqlite.close();
  database.close();
});
