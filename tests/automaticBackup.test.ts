import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { VacancyDatabase } from "../src/db/database";
import { AutomaticBackupService } from "../src/services/automaticBackup";
import { createTestConfig } from "./helpers";

function createFixture(overrides = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-tg-bot-auto-backup-"));
  const databasePath = path.join(tempDir, "bot.db");
  const config = createTestConfig({
    ownerUserId: "777",
    ownerChatId: "777",
    databasePath,
    databaseUrl: `file:${databasePath}`,
    appDataDir: tempDir,
    runtimeDir: path.join(tempDir, "runtime"),
    ...overrides
  });
  const database = new VacancyDatabase(config);
  database.initialize();
  return { config, database };
}

test("automatic backup creates a SQLite snapshot and keeps manual backups", async () => {
  const { config, database } = createFixture();
  const manual = database.createBackupSnapshot("manual-backup.db");
  const service = new AutomaticBackupService(config, database);

  const summary = await service.runBackup(new Date("2026-06-07T10:00:00.000Z"));

  assert.ok(summary);
  assert.match(path.basename(summary.path), /^auto-backup-/u);
  assert.equal(fs.existsSync(summary.path), true);
  assert.equal(fs.existsSync(manual.path), true);
  await service.stop();
  database.close();
});

test("automatic backup removes only expired automatic snapshots", async () => {
  const { config, database } = createFixture({ automaticBackupRetentionDays: 2 });
  const backupDir = path.join(config.runtimeDir, "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const expiredAuto = path.join(backupDir, "auto-backup-2026-06-01T10-00-00-000Z.db");
  const expiredManual = path.join(backupDir, "manual-old.db");
  fs.writeFileSync(expiredAuto, "old");
  fs.writeFileSync(expiredManual, "old");
  const oldTime = new Date("2026-06-01T10:00:00.000Z");
  fs.utimesSync(expiredAuto, oldTime, oldTime);
  fs.utimesSync(expiredManual, oldTime, oldTime);

  const service = new AutomaticBackupService(config, database);
  const summary = await service.runBackup(new Date("2026-06-07T10:00:00.000Z"));

  assert.equal(summary?.expiredBackupsDeleted, 1);
  assert.equal(fs.existsSync(expiredAuto), false);
  assert.equal(fs.existsSync(expiredManual), true);
  await service.stop();
  database.close();
});

test("automatic backup failure is reported without throwing", async () => {
  const { config, database } = createFixture();
  database.close();
  const errors: unknown[] = [];
  const service = new AutomaticBackupService(config, database, (error) => {
    errors.push(error);
  });

  const summary = await service.runBackup();

  assert.equal(summary, null);
  assert.equal(errors.length, 1);
  await service.stop();
});

