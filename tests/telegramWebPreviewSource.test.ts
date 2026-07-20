import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

import { VacancyDatabase } from "../src/db/database";
import { RuntimeSettingsService } from "../src/runtime/runtimeSettings";
import { TelegramWebPreviewSource, parseTelegramWebPreviewPage } from "../src/sources/telegramWebPreviewSource";
import { createTestConfig } from "./helpers";

const fixturePath = path.join(process.cwd(), "tests", "fixtures", "telegram-web-preview", "sample.html");
const fixtureHtml = fs.readFileSync(fixturePath, "utf8");

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function createPreviewHtml(channel: string, ...messageIds: string[]): string {
  return messageIds
    .map(
      (messageId) => `
        <article class="tgme_widget_message" data-post="${channel}/${messageId}">
          <div class="tgme_widget_message_text">Remote React ${channel} ${messageId}</div>
          <time datetime="2026-07-06T10:00:00+00:00"></time>
        </article>
      `
    )
    .join("\n");
}

function createPreviewPageHtml(
  channel: string,
  messages: Array<{ id: string; text?: string; date?: string }>
): string {
  return messages
    .map(
      (message) => `
        <article class="tgme_widget_message" data-post="${channel}/${message.id}">
          ${message.text === undefined ? "" : `<div class="tgme_widget_message_text">${message.text}</div>`}
          <time datetime="${message.date ?? "2026-07-06T10:00:00+00:00"}"></time>
        </article>
      `
    )
    .join("\n");
}

test("parseTelegramWebPreviewPage extracts posts from fixture HTML", () => {
  const parsed = parseTelegramWebPreviewPage("job_react", fixtureHtml);

  assert.equal(parsed.items.length, 2);
  assert.equal(parsed.nextBefore, "5355");
  assert.deepEqual(parsed.items[0], {
    source: "telegram_web_preview",
    channel: "job_react",
    messageId: "5355",
    text: "Senior React Engineer\nRemote-first\nContact: @frontend_jobs",
    date: "2026-05-27T10:00:00+00:00",
    url: "https://t.me/job_react/5355"
  });
  assert.match(parsed.items[1].text, /https:\/\/example\.com\/apply/);
});

test("parseTelegramWebPreviewPage rejects posts from an unexpected channel", () => {
  const html = `
    <article class="tgme_widget_message" data-post="evil_channel/100">
      <div class="tgme_widget_message_text">Remote React role</div>
      <time datetime="2026-05-27T10:00:00+00:00"></time>
    </article>
  `;

  const parsed = parseTelegramWebPreviewPage("job_react", html);

  assert.equal(parsed.items.length, 0);
});

test("parseTelegramWebPreviewPage advances cursor for valid posts without text", () => {
  const html = `
    <article class="tgme_widget_message" data-post="job_react/101">
      <time datetime="2026-07-06T10:00:00+00:00"></time>
    </article>
    <article class="tgme_widget_message" data-post="job_react/100">
      <div class="tgme_widget_message_text">Remote React role</div>
      <time datetime="2026-07-06T09:00:00+00:00"></time>
    </article>
  `;

  const warnings: string[] = [];
  const parsed = parseTelegramWebPreviewPage("job_react", html, (message) => warnings.push(message));

  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.nextBefore, "100");
  assert.equal(parsed.highestMessageId, "101");
  assert.equal(parsed.oldestMessageId, "100");
  assert.equal(warnings.includes("Skipped web preview post without text."), true);
});

test("parseTelegramWebPreviewPage splits a structured linked aggregate and keeps the parent cursor", () => {
  const html = `
    <article class="tgme_widget_message" data-post="findmyremote_frontend/887">
      <div class="tgme_widget_message_text">
        <a href="https://findmyremote.ai/companies/acme/jobs/frontend-1">Senior Frontend Developer</a> @ Acme<br>
        Posted: 11 Jun 2026<br>
        Employment: Full-time<br>
        Locations: Brazil<br><br>
        <a href="https://findmyremote.ai/companies/site/jobs/frontend-2">Senior Software Engineer (Frontend)</a> @ Site<br>
        Posted: 11 Jun 2026<br>
        Employment: Full-time<br>
        Locations: Estonia
      </div>
      <time datetime="2026-06-12T08:00:00+00:00"></time>
    </article>
  `;

  const parsed = parseTelegramWebPreviewPage("findmyremote_frontend", html);

  assert.equal(parsed.items.length, 2);
  assert.equal(parsed.nextBefore, "887");
  assert.equal(parsed.items[0]?.cursorMessageId, "887");
  assert.equal(parsed.items[1]?.cursorMessageId, "887");
  assert.match(parsed.items[0]?.text ?? "", /Brazil/u);
  assert.match(parsed.items[1]?.text ?? "", /Estonia/u);
});

test("TelegramWebPreviewSource fetchLatest returns parsed items in web mode", async () => {
  const source = new TelegramWebPreviewSource(
    createTestConfig({
      channels: ["job_react"],
      initialBackfillDays: 365,
      webPreviewMaxPagesPerChannel: 1
    }),
    {
      fetchImpl: async () => new Response(fixtureHtml, { status: 200 })
    }
  );

  const items = await source.fetchLatest();

  assert.equal(items.length, 2);
  assert.equal(items[0].channel, "job_react");
  assert.equal(items[1].messageId, "5356");
});

test("TelegramWebPreviewSource uses timeout and blocks redirects", async () => {
  let observedInit: RequestInit | undefined;

  const source = new TelegramWebPreviewSource(
    createTestConfig({
      channels: ["job_react"],
      initialBackfillDays: 365,
      webPreviewMaxPagesPerChannel: 1
    }),
    {
      fetchImpl: async (_url, init) => {
        observedInit = init;
        return new Response(fixtureHtml, { status: 200 });
      }
    }
  );

  await source.fetchLatest();

  assert.equal(observedInit?.redirect, "error");
  assert.ok(observedInit?.signal instanceof AbortSignal);
});

test("TelegramWebPreviewSource drops oversized HTML responses", async () => {
  const source = new TelegramWebPreviewSource(
    createTestConfig({
      channels: ["job_react"],
      webPreviewMaxPagesPerChannel: 1,
      webPreviewMaxResponseBytes: 64
    }),
    {
      fetchImpl: async () =>
        new Response(fixtureHtml, {
          status: 200,
          headers: {
            "content-length": String(Buffer.byteLength(fixtureHtml, "utf8"))
          }
        })
    }
  );

  const items = await source.fetchLatest();

  assert.deepEqual(items, []);
});

test("TelegramWebPreviewSource picks up runtime setting overrides without restart", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-tg-bot-runtime-preview-"));
  const config = createTestConfig({
    channels: ["job_react"],
    databasePath: path.join(tempDir, "bot.db"),
    databaseUrl: `file:${path.join(tempDir, "bot.db")}`,
    appDataDir: tempDir,
    runtimeDir: path.join(tempDir, "runtime"),
    initialBackfillDays: 365,
    webPreviewMaxPagesPerChannel: 1,
    webPreviewMaxItemsPerChannel: 2
  });

  const database = new VacancyDatabase(config);
  database.initialize();
  const runtimeSettings = new RuntimeSettingsService(config, database);
  let currentHtml = fixtureHtml;

  const source = new TelegramWebPreviewSource(config, {
    runtimeSettings,
    fetchImpl: async () => new Response(currentHtml, { status: 200 })
  });

  runtimeSettings.setNumericValue("WEB_PREVIEW_MAX_ITEMS_PER_CHANNEL", 1, config.ownerUserId);
  const firstItems = await source.fetchLatest();

  currentHtml = fixtureHtml
    .replace(/job_react\/5355/g, "job_react/5357")
    .replace(/job_react\/5356/g, "job_react/5358");
  runtimeSettings.setNumericValue("WEB_PREVIEW_MAX_ITEMS_PER_CHANNEL", 2, config.ownerUserId);
  const secondItems = await source.fetchLatest();

  await source.stop();
  database.close();

  assert.equal(firstItems.length, 1);
  assert.equal(secondItems.length, 2);
});

test("TelegramWebPreviewSource persists last seen message ids across source restarts", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-tg-bot-preview-cursor-"));
  const config = createTestConfig({
    channels: [],
    databasePath: path.join(tempDir, "bot.db"),
    databaseUrl: `file:${path.join(tempDir, "bot.db")}`,
    appDataDir: tempDir,
    runtimeDir: path.join(tempDir, "runtime"),
    initialBackfillDays: 30,
    webPreviewMaxPagesPerChannel: 1
  });

  const database = new VacancyDatabase(config);
  database.initialize();
  database.addChannel(config.ownerUserId, "telegram_web_preview", "job_react");

  const fetchImpl = async () => new Response(createPreviewHtml("job_react", "100"), { status: 200 });

  const firstSource = new TelegramWebPreviewSource(config, {
    channelRegistry: database,
    fetchImpl
  });
  const firstItems = await firstSource.fetchLatest();
  await firstSource.stop();

  const secondSource = new TelegramWebPreviewSource(config, {
    channelRegistry: database,
    fetchImpl
  });
  const secondItems = await secondSource.fetchLatest();

  await secondSource.stop();
  const channel = database.getChannelByUsername("telegram_web_preview", "job_react");
  database.close();

  assert.equal(firstItems.length, 1);
  assert.equal(secondItems.length, 0);
  assert.equal(channel?.lastSeenMessageId, "100");
});

test("TelegramWebPreviewSource catch-up paginates stale channels until last seen message", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-tg-bot-preview-catchup-"));
  const config = createTestConfig({
    channels: [],
    databasePath: path.join(tempDir, "bot.db"),
    databaseUrl: `file:${path.join(tempDir, "bot.db")}`,
    appDataDir: tempDir,
    runtimeDir: path.join(tempDir, "runtime"),
    initialBackfillDays: 30,
    webPreviewMaxPagesPerChannel: 5,
    webPreviewChannelDelayMs: 1
  });

  const database = new VacancyDatabase(config);
  database.initialize();
  database.addChannel(config.ownerUserId, "telegram_web_preview", "job_react");
  const channel = database.getChannelByUsername("telegram_web_preview", "job_react");
  assert.ok(channel);
  database.markChannelCheckSuccess(channel.id, {
    lastSeenMessageId: "100",
    idlePollStreak: 0,
    nextPollAfter: null
  });
  database.markChannelBackfillCompleted(channel.id);
  const rawDb = new Database(config.databasePath);
  rawDb
    .prepare("UPDATE monitored_channels SET last_success_at = ? WHERE id = ?")
    .run(new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString(), channel.id);
  rawDb.close();

  const requestedUrls: string[] = [];
  const fetchImpl = async (url: string | URL | Request) => {
    const value = String(url);
    requestedUrls.push(value);
    const before = new URL(value).searchParams.get("before");
    if (!before) {
      return new Response(createPreviewPageHtml("job_react", [
        { id: "103", text: "Remote React 103" },
        { id: "102", text: "Remote React 102" }
      ]), { status: 200 });
    }

    assert.equal(before, "102");
    return new Response(createPreviewPageHtml("job_react", [
      { id: "101", text: "Remote React 101" },
      { id: "100", text: "Remote React 100" }
    ]), { status: 200 });
  };

  const source = new TelegramWebPreviewSource(config, {
    channelRegistry: database,
    fetchImpl
  });

  const items = await source.fetchLatest();
  const updatedChannel = database.getChannelByUsername("telegram_web_preview", "job_react");

  await source.stop();
  database.close();

  assert.deepEqual(items.map((item) => item.messageId), ["101", "102", "103"]);
  assert.equal(requestedUrls.length, 2);
  assert.equal(updatedChannel?.lastSeenMessageId, "103");
  assert.equal(updatedChannel?.initialBackfillCompleted, true);
});

test("TelegramWebPreviewSource applies inactivity backoff and resets it after new activity", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-tg-bot-preview-backoff-"));
  const config = createTestConfig({
    channels: [],
    checkIntervalSeconds: 0.01,
    databasePath: path.join(tempDir, "bot.db"),
    databaseUrl: `file:${path.join(tempDir, "bot.db")}`,
    appDataDir: tempDir,
    runtimeDir: path.join(tempDir, "runtime"),
    initialBackfillDays: 30,
    webPreviewMaxPagesPerChannel: 1
  });

  const database = new VacancyDatabase(config);
  database.initialize();
  database.addChannel(config.ownerUserId, "telegram_web_preview", "job_react");

  let currentHtml = createPreviewHtml("job_react", "100");
  let fetchCount = 0;
  const source = new TelegramWebPreviewSource(config, {
    channelRegistry: database,
    fetchImpl: async () => {
      fetchCount += 1;
      return new Response(currentHtml, { status: 200 });
    }
  });

  await source.fetchLatest();
  for (let index = 0; index < 5; index += 1) {
    await source.fetchLatest();
  }

  const channelAfterIdle = database.getChannelByUsername("telegram_web_preview", "job_react");
  assert.equal(channelAfterIdle?.idlePollStreak, 5);
  assert.ok(channelAfterIdle?.nextPollAfter);

  const fetchCountBeforeSkip = fetchCount;
  const skippedItems = await source.fetchLatest();
  assert.equal(fetchCount, fetchCountBeforeSkip);
  assert.deepEqual(skippedItems, []);

  await sleep(30);
  currentHtml = createPreviewHtml("job_react", "101");
  const resumedItems = await source.fetchLatest();
  const channelAfterResume = database.getChannelByUsername("telegram_web_preview", "job_react");

  await source.stop();
  database.close();

  assert.equal(resumedItems.length, 1);
  assert.equal(channelAfterResume?.idlePollStreak, 0);
  assert.equal(channelAfterResume?.nextPollAfter, null);
});

test("TelegramWebPreviewSource does not deepen inactivity backoff after a fetch error", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-tg-bot-preview-failure-"));
  const config = createTestConfig({
    channels: [],
    checkIntervalSeconds: 0.01,
    databasePath: path.join(tempDir, "bot.db"),
    databaseUrl: `file:${path.join(tempDir, "bot.db")}`,
    appDataDir: tempDir,
    runtimeDir: path.join(tempDir, "runtime"),
    initialBackfillDays: 30,
    webPreviewMaxPagesPerChannel: 1
  });

  const database = new VacancyDatabase(config);
  database.initialize();
  database.addChannel(config.ownerUserId, "telegram_web_preview", "job_react");

  let shouldFail = false;
  const source = new TelegramWebPreviewSource(config, {
    channelRegistry: database,
    fetchImpl: async () => {
      if (shouldFail) {
        throw new Error("boom");
      }

      return new Response(createPreviewHtml("job_react", "100"), { status: 200 });
    }
  });

  await source.fetchLatest();
  for (let index = 0; index < 5; index += 1) {
    await source.fetchLatest();
  }

  const beforeFailure = database.getChannelByUsername("telegram_web_preview", "job_react");
  assert.ok(beforeFailure?.nextPollAfter);

  await sleep(30);
  shouldFail = true;
  await source.fetchLatest();
  const afterFailure = database.getChannelByUsername("telegram_web_preview", "job_react");

  await source.stop();
  database.close();

  assert.equal(afterFailure?.idlePollStreak, beforeFailure?.idlePollStreak);
  assert.equal(afterFailure?.nextPollAfter, beforeFailure?.nextPollAfter);
  assert.equal(afterFailure?.lastError, "boom");
});
