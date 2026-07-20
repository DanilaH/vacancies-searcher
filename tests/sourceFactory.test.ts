import test from "node:test";
import assert from "node:assert/strict";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { VacancyDatabase } from "../src/db/database";
import { createVacancySource, createVacancySources } from "../src/sources";
import { createTestConfig } from "./helpers";

test("source factory returns TelegramWebPreviewSource in web mode without MTProto credentials", async () => {
  const source = await createVacancySource(
    createTestConfig({
      telegramSourceMode: "web",
      telegramApiId: undefined,
      telegramApiHash: undefined,
      telegramSession: undefined
    })
  );

  assert.equal(source.name, "telegram_web_preview");
});

test("source factory returns TelegramMtprotoSource in mtproto mode", async () => {
  const source = await createVacancySource(
    createTestConfig({
      telegramSourceMode: "mtproto",
      telegramApiId: 123456,
      telegramApiHash: "hash",
      telegramSession: "session"
    })
  );

  assert.equal(source.name, "telegram_mtproto");
});

test("source factory returns Telegram and hh.ru sources when hh source is enabled", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-tg-bot-source-factory-"));
  const config = createTestConfig({
    hhSourceEnabled: true,
    hhUserAgent: "job-tg-bot-test/1.0 (test@example.com)",
    databasePath: path.join(tempDir, "bot.db"),
    databaseUrl: `file:${path.join(tempDir, "bot.db")}`,
    appDataDir: tempDir,
    runtimeDir: path.join(tempDir, "runtime")
  });
  const database = new VacancyDatabase(config);
  database.initialize();

  const sources = await createVacancySources(config, database, database);
  database.close();

  assert.deepEqual(sources.map((source) => source.name), ["telegram_web_preview", "hh_api"]);
});

test("source factory returns company careers source when enabled", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-tg-bot-source-factory-company-"));
  const config = createTestConfig({
    companyCareersSourceEnabled: true,
    databasePath: path.join(tempDir, "bot.db"),
    databaseUrl: `file:${path.join(tempDir, "bot.db")}`,
    appDataDir: tempDir,
    runtimeDir: path.join(tempDir, "runtime")
  });
  const database = new VacancyDatabase(config);
  database.initialize();

  const sources = await createVacancySources(config, database, database);
  database.close();

  assert.deepEqual(sources.map((source) => source.name), ["telegram_web_preview", "company_careers"]);
});
