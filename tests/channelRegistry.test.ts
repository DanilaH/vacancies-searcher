import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { VacancyDatabase } from "../src/db/database";
import { createTestConfig } from "./helpers";

function createTempDatabaseConfig() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-tg-bot-channels-"));
  return createTestConfig({
    channels: [],
    databasePath: path.join(tempDir, "bot.db"),
    databaseUrl: `file:${path.join(tempDir, "bot.db")}`,
    appDataDir: tempDir,
    runtimeDir: path.join(tempDir, "runtime")
  });
}

test("bootstrapChannels seeds the source registry only once per source", () => {
  const config = createTempDatabaseConfig();
  const database = new VacancyDatabase(config);
  database.initialize();

  const firstBootstrap = database.bootstrapChannels(config.ownerUserId, ["job_react", "rabotafrontend"], "telegram_web_preview");
  const secondBootstrap = database.bootstrapChannels(config.ownerUserId, ["findmyremote_frontend"], "telegram_web_preview");
  const activeChannels = database.listActiveChannels("telegram_web_preview");

  database.close();

  assert.equal(firstBootstrap, 2);
  assert.equal(secondBootstrap, 0);
  assert.deepEqual(
    activeChannels.map((channel) => channel.username),
    ["job_react", "rabotafrontend"]
  );
});

test("addChannel reactivates a soft-deleted channel instead of duplicating it", () => {
  const config = createTempDatabaseConfig();
  const database = new VacancyDatabase(config);
  database.initialize();

  const firstAdd = database.addChannel(config.ownerUserId, "telegram_web_preview", "job_react");
  const deactivated = database.deactivateChannel(firstAdd.channel.id);
  const secondAdd = database.addChannel(config.ownerUserId, "telegram_web_preview", "job_react");
  const activeChannels = database.listActiveChannels("telegram_web_preview");

  database.close();

  assert.equal(firstAdd.added, true);
  assert.equal(firstAdd.reactivated, false);
  assert.equal(deactivated?.isActive, false);
  assert.equal(secondAdd.added, true);
  assert.equal(secondAdd.reactivated, true);
  assert.equal(activeChannels.length, 1);
  assert.equal(activeChannels[0]?.username, "job_react");
});
