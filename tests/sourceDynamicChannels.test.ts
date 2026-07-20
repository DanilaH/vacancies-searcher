import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { VacancyDatabase } from "../src/db/database";
import { TelegramWebPreviewSource } from "../src/sources/telegramWebPreviewSource";
import { createTestConfig } from "./helpers";

function createTempDatabaseConfig() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-tg-bot-source-"));
  return createTestConfig({
    channels: [],
    databasePath: path.join(tempDir, "bot.db"),
    databaseUrl: `file:${path.join(tempDir, "bot.db")}`,
    appDataDir: tempDir,
    runtimeDir: path.join(tempDir, "runtime"),
    initialBackfillDays: 30,
    webPreviewMaxPagesPerChannel: 1
  });
}

function createPreviewHtml(channel: string, messageId: string): string {
  return `
    <article class="tgme_widget_message" data-post="${channel}/${messageId}">
      <div class="tgme_widget_message_text">Remote React ${channel}</div>
      <time datetime="2026-07-06T10:00:00+00:00"></time>
    </article>
  `;
}

test("TelegramWebPreviewSource picks up added and removed channels from the registry without restart", async () => {
  const config = createTempDatabaseConfig();
  const database = new VacancyDatabase(config);
  database.initialize();
  database.addChannel(config.ownerUserId, "telegram_web_preview", "job_react");

  const source = new TelegramWebPreviewSource(config, {
    channelRegistry: database,
    fetchImpl: async (url) => {
      const pathname = new URL(String(url)).pathname;
      const channel = pathname.split("/").filter(Boolean).pop() ?? "unknown";
      return new Response(createPreviewHtml(channel, channel === "job_react" ? "100" : "200"), { status: 200 });
    }
  });

  const firstFetch = await source.fetchLatest();
  database.addChannel(config.ownerUserId, "telegram_web_preview", "rabotafrontend");
  const secondFetch = await source.fetchLatest();
  const firstChannel = database.getChannelByUsername("telegram_web_preview", "job_react");
  const secondChannel = database.getChannelByUsername("telegram_web_preview", "rabotafrontend");

  database.deactivateChannel(firstChannel!.id);
  const thirdFetch = await source.fetchLatest();

  await source.stop();
  database.close();

  assert.deepEqual(firstFetch.map((item) => item.channel), ["job_react"]);
  assert.equal(secondFetch.some((item) => item.channel === "rabotafrontend"), true);
  assert.equal(firstChannel?.initialBackfillCompleted, true);
  assert.equal(secondChannel?.isActive, true);
  assert.deepEqual(thirdFetch.map((item) => item.channel), []);
});
