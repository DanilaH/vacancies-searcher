import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { AnalyticsService } from "../src/analytics/analyticsService";
import { createInputFlows } from "../src/bot/inputFlows";
import { VacancyDatabase } from "../src/db/database";
import { RuntimeSettingsService } from "../src/runtime/runtimeSettings";
import type { ActionCooldownAttempt } from "../src/services/actionCooldown";
import { createTestConfig } from "./helpers";

function createHarness(options: {
  tryAcquireChannelBatchAdd: () => ActionCooldownAttempt;
  probe: (username: string) => Promise<{ ok: true; url: string } | { ok: false; error: string }>;
}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-tg-bot-input-rate-limit-"));
  const config = createTestConfig({
    ownerUserId: "777",
    ownerChatId: "777",
    databasePath: path.join(tempDir, "bot.db"),
    databaseUrl: `file:${path.join(tempDir, "bot.db")}`,
    appDataDir: tempDir,
    runtimeDir: path.join(tempDir, "runtime")
  });
  const database = new VacancyDatabase(config);
  database.initialize();
  database.setPendingInputAction("777", "add_channel");
  const analytics = new AnalyticsService(database, config);
  const noopPanel = async () => {};
  const noopCompletionPanel = async () => ({
    firstCompletion: true,
    initialMatchesCount: 0,
    firstResultsShown: false
  });

  const flows = createInputFlows({
    config,
    database,
    runtimeSettings: new RuntimeSettingsService(config, database),
    analytics,
    startChannelDiscovery: () => ({ run: null, started: false, notice: "not started" }),
    tryAcquireChannelBatchAdd: options.tryAcquireChannelBatchAdd,
    sourceName: "telegram_web_preview",
    getCurrentUserId: (ctx) => ctx.from?.id ? String(ctx.from.id) : null,
    parseRuntimeSettingKey: () => null,
    buildUserAnalyticsProperties: () => ({}),
    trackProfileReadyTransition: async () => {},
    rebuildUserVacancyFeed: async () => undefined,
    refreshCommandScopes: async () => {},
    summarizeProbeError: (error) => error,
    probeTelegramWebPreviewChannel: async (_config, username) => options.probe(username),
    getProfileKeywordsForSection: () => [],
    showOnboardingCompletionPanel: noopCompletionPanel,
    showOnboardingLanguagePanel: noopPanel,
    showOnboardingManualStep: noopPanel,
    showPersonalFiltersPanel: noopPanel,
    showSearchProfileDetailPanel: noopPanel,
    showHhSearchSettingsPanel: noopPanel,
    showChannelDiscoveryRun: noopPanel,
    showCompanyCareerSourcesPage: noopPanel,
    showTrustedVacancyServicesPage: noopPanel,
    showChannelsPage: noopPanel,
    showUsersPage: noopPanel,
    showRuntimeSettingDetails: noopPanel,
    showVacancyCardById: noopPanel,
    showApplicationDetailById: noopPanel
  });

  return { database, flows };
}

function textContext(text: string, replies: string[]) {
  return {
    from: { id: 777 },
    message: { text },
    reply: async (replyText: string) => {
      replies.push(replyText);
    }
  } as never;
}

test("blocked channel batch does not probe and preserves pending input", async () => {
  let probes = 0;
  const replies: string[] = [];
  const { database, flows } = createHarness({
    tryAcquireChannelBatchAdd: () => ({ allowed: false, retryAfterSeconds: 42 }),
    probe: async () => {
      probes += 1;
      return { ok: false, error: "not expected" };
    }
  });

  await flows.handlePendingTextMessage(textContext("@channel_name", replies));

  assert.equal(probes, 0);
  assert.equal(database.getUserSettings("777").pendingInputAction, "add_channel");
  assert.match(replies[0] ?? "", /Попробуй снова через 42 сек/u);
  database.close();
});

test("channel batch probes no more than 50 unique valid usernames", async () => {
  let probes = 0;
  const replies: string[] = [];
  const { database, flows } = createHarness({
    tryAcquireChannelBatchAdd: () => ({ allowed: true }),
    probe: async () => {
      probes += 1;
      return { ok: false, error: "unavailable" };
    }
  });
  const usernames = Array.from({ length: 52 }, (_, index) => `channel_${String(index).padStart(2, "0")}`);

  await flows.handlePendingTextMessage(textContext(usernames.join(" "), replies));

  assert.equal(probes, 50);
  assert.equal(database.getUserSettings("777").pendingInputAction, null);
  assert.match(replies[0] ?? "", /Сверх лимита 50: 2/u);
  database.close();
});
