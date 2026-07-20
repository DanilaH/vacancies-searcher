import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { VacancyDatabase } from "../src/db/database";
import { VacancyFilter } from "../src/services/vacancyFilter";
import { createTestConfig } from "./helpers";

function createFixture() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-tg-bot-backup-"));
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
    tempDir
  };
}

test("createBackupSnapshot produces a reusable SQLite snapshot", () => {
  const { config, tempDir } = createFixture();
  const database = new VacancyDatabase(config);
  database.initialize();

  const filter = new VacancyFilter(config);
  const text = "Senior React engineer\nRemote\nTypeScript";
  const result = database.recordMessage(
    {
      source: "telegram_web_preview",
      channel: "job_react",
      messageId: "5001",
      date: new Date().toISOString(),
      text,
      url: "https://t.me/job_react/5001"
    },
    filter.evaluateBaseCandidate(text),
    []
  );

  assert.equal(result.kind, "new_vacancy");

  const snapshot = database.createBackupSnapshot("vacancy-bot.db");

  assert.equal(fs.existsSync(snapshot.path), true);
  assert.ok(snapshot.sizeBytes > 0);
  assert.equal(snapshot.path.startsWith(path.join(config.runtimeDir, "backups")), true);

  database.close();

  const restoredConfig = createTestConfig({
    ownerUserId: "777",
    ownerChatId: "777",
    databasePath: snapshot.path,
    databaseUrl: `file:${snapshot.path}`,
    appDataDir: path.dirname(snapshot.path),
    runtimeDir: path.join(path.dirname(snapshot.path), "runtime")
  });
  const restoredDatabase = new VacancyDatabase(restoredConfig);
  restoredDatabase.initialize();

  const stats = restoredDatabase.getStats();
  assert.equal(stats.totalVacancies, 1);
  assert.equal(restoredDatabase.listWeeklyVacancies(0, 10, 7).total, 1);

  restoredDatabase.close();
});

test("createBackupSnapshot rejects unsafe backup file names", () => {
  const { config } = createFixture();
  const database = new VacancyDatabase(config);
  database.initialize();

  assert.throws(() => database.createBackupSnapshot("../escape.db"), /Invalid backup file name|outside the allowed directory/);
  assert.throws(() => database.createBackupSnapshot("nested/escape.db"), /Invalid backup file name|outside the allowed directory/);

  database.close();
});
