import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { AnalyticsService } from "../src/analytics/analyticsService";
import { createOnboardingFlow } from "../src/bot/onboardingFlow";
import { VacancyDatabase } from "../src/db/database";
import { UserVacancyRematchSummary } from "../src/types";
import { createTestConfig } from "./helpers";

function createHarness(firstWeeklyResult = true) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-tg-bot-onboarding-completion-"));
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
  database.addOrActivateBotUser("888", "member", "777");
  database.setUserSearchProfileKeywords("888", "required_context", ["remote"]);
  database.setUserSearchProfileKeywords("888", "required_primary", ["frontend"]);
  database.setOnboardingStep("888", "language");

  const analytics = new AnalyticsService(database, config);
  const rendered: string[] = [];
  let firstWeeklyPages = 0;
  let startPanels = 0;
  const ctx = {
    from: { id: 888 },
    chat: { id: 888 },
    callbackQuery: { id: "callback" },
    editMessageText: async (text: string) => {
      rendered.push(text);
    },
    reply: async (text: string) => {
      rendered.push(text);
    }
  } as never;
  const flow = createOnboardingFlow({
    database,
    analytics,
    getCurrentUserId: () => "888",
    shouldShowAdmin: () => false,
    buildUserAnalyticsProperties: () => ({}),
    getPresetForecasts: () => [],
    sendFirstWeeklyPage: async () => {
      firstWeeklyPages += 1;
      return firstWeeklyResult;
    },
    showStartPanel: async () => {
      startPanels += 1;
    }
  });

  return {
    analytics,
    ctx,
    database,
    flow,
    rendered,
    getFirstWeeklyPages: () => firstWeeklyPages,
    getStartPanels: () => startPanels
  };
}

const rematchSummary: UserVacancyRematchSummary = {
  userId: "888",
  windowDays: 7,
  scannedVacancies: 100,
  evaluatedVacancies: 100,
  profileDiagnostics: [],
  profileStatus: "ready",
  created: 3,
  updated: 0,
  unchanged: 0,
  removed: 0,
  totalMatched: 3
};

test("configured completion sends first weekly page once and stores analytics", async () => {
  const harness = createHarness();

  const first = await harness.flow.showOnboardingCompletionPanel(harness.ctx, "edit", {
    trigger: "configured",
    rematchSummary
  });
  const repeated = await harness.flow.showOnboardingCompletionPanel(harness.ctx, "edit", {
    trigger: "configured",
    rematchSummary
  });

  const [event] = harness.database.listAnalyticsEvents(5, "onboarding_completed");
  assert.equal(first.firstCompletion, true);
  assert.equal(first.firstResultsShown, true);
  assert.equal(first.initialMatchesCount, 3);
  assert.equal(repeated.firstCompletion, false);
  assert.equal(harness.getFirstWeeklyPages(), 1);
  assert.equal(harness.getStartPanels(), 1);
  assert.equal(harness.database.getUserSettings("888").onboardingCompleted, true);
  assert.equal(event?.properties.initial_matches_count, 3);
  assert.equal(event?.properties.first_results_shown, true);
  assert.equal(event?.properties.completion_trigger, "configured");

  await harness.analytics.shutdown();
  harness.database.close();
});

test("skipped completion does not send first results", async () => {
  const harness = createHarness();

  const result = await harness.flow.showOnboardingCompletionPanel(harness.ctx, "edit", {
    trigger: "skipped"
  });

  const [event] = harness.database.listAnalyticsEvents(1, "onboarding_completed");
  assert.equal(result.firstCompletion, true);
  assert.equal(result.initialMatchesCount, 0);
  assert.equal(result.firstResultsShown, false);
  assert.equal(harness.getFirstWeeklyPages(), 0);
  assert.match(harness.rendered[0] ?? "", /Настройка отложена/u);
  assert.equal(event?.properties.completion_trigger, "skipped");

  await harness.analytics.shutdown();
  harness.database.close();
});

test("failed first weekly delivery does not roll back onboarding completion", async () => {
  const harness = createHarness(false);

  const result = await harness.flow.showOnboardingCompletionPanel(harness.ctx, "edit", {
    trigger: "configured",
    rematchSummary
  });

  const [event] = harness.database.listAnalyticsEvents(1, "onboarding_completed");
  assert.equal(result.firstCompletion, true);
  assert.equal(result.firstResultsShown, false);
  assert.equal(harness.database.getUserSettings("888").onboardingCompleted, true);
  assert.equal(event?.properties.first_results_shown, false);

  await harness.analytics.shutdown();
  harness.database.close();
});
