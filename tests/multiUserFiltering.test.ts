import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createAnalyticsService } from "../src/analytics/analyticsService";
import { BotController } from "../src/bot/createBot";
import { VacancyDatabase } from "../src/db/database";
import { VacancyFilter } from "../src/services/vacancyFilter";
import { VacancyIngestor } from "../src/services/vacancyIngestor";
import { MatchedVacancyRecord } from "../src/types";
import { createTestConfig } from "./helpers";

function createTempDatabaseConfig() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-tg-bot-multi-user-"));
  return createTestConfig({
    ownerUserId: "777",
    ownerChatId: "777",
    databasePath: path.join(tempDir, "bot.db"),
    databaseUrl: `file:${path.join(tempDir, "bot.db")}`,
    appDataDir: tempDir,
    runtimeDir: path.join(tempDir, "runtime")
  });
}

function createBotMock(deliveries: string[]): BotController {
  return {
    async start() {},
    async stop() {},
    async notifyVacancy(vacancy: MatchedVacancyRecord): Promise<boolean> {
      deliveries.push(vacancy.userId);
      return true;
    },
    async sendVacancyReminder(): Promise<boolean> {
      return true;
    },
    async sendApplicationFollowUp(): Promise<boolean> {
      return true;
    },
    async sendNoNewVacanciesNotification(): Promise<boolean> {
      return true;
    },
    async sendStartupDiagnostic(): Promise<void> {},
    async sendAdminAlert(): Promise<boolean> {
      return true;
    }
  };
}

function recentMessageDate(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
}

test("personal filters let one user match a vacancy while another user blocks it", async () => {
  const config = createTempDatabaseConfig();
  const database = new VacancyDatabase(config);
  database.initialize();
  database.setUserSearchProfileKeywords("777", "required_context", ["remote"]);
  database.setUserSearchProfileKeywords("777", "required_primary", ["react"]);
  database.setUserSearchProfileKeywords("777", "preferred", ["typescript", "senior"]);
  database.addOrActivateBotUser("888", "member", config.ownerUserId);
  database.setUserSearchProfileKeywords("888", "exclude", ["redux"]);

  const deliveries: string[] = [];
  const filter = new VacancyFilter(config);
  const bot = createBotMock(deliveries);
  const analytics = createAnalyticsService(config, database);
  const ingestor = new VacancyIngestor(config, filter, database, bot, analytics);

  const matchedUserIds = await ingestor.handle({
    source: "telegram_web_preview",
    channel: "job_react",
    messageId: "9001",
    date: recentMessageDate(),
    text: "Senior React engineer\nRemote\nTypeScript\nRedux",
    url: "https://t.me/job_react/9001"
  });

  const ownerWeekly = database.listUserWeeklyVacancies("777", 0, 10, 7);
  const memberWeekly = database.listUserWeeklyVacancies("888", 0, 10, 7);
  await analytics.shutdown();
  database.close();

  assert.deepEqual(matchedUserIds, ["777"]);
  assert.deepEqual(deliveries, ["777"]);
  assert.equal(ownerWeekly.total, 1);
  assert.equal(memberWeekly.total, 0);
});

test("hh duplicate raw vacancies can still create matches for newly eligible users", async () => {
  const config = createTempDatabaseConfig();
  const database = new VacancyDatabase(config);
  database.initialize();
  database.setUserSearchProfileKeywords("777", "required_context", ["remote"]);
  database.setUserSearchProfileKeywords("777", "required_primary", ["react"]);
  database.addOrActivateBotUser("888", "member", config.ownerUserId);
  database.setUserSearchProfileKeywords("888", "required_context", ["remote"]);
  database.setUserSearchProfileKeywords("888", "required_primary", ["react"]);
  database.updateUserHhSearchSettings("777", { enabled: true, text: "react remote" });
  database.updateUserHhSearchSettings("888", { enabled: true, text: "react remote" });

  const deliveries: string[] = [];
  const filter = new VacancyFilter(config);
  const bot = createBotMock(deliveries);
  const analytics = createAnalyticsService(config, database);
  const ingestor = new VacancyIngestor(config, filter, database, bot, analytics);
  const rawItem = {
    source: "hh_api" as const,
    channel: "hh.ru • Acme, Москва",
    messageId: "123",
    date: recentMessageDate(),
    text: "Frontend React Engineer\nRemote\nTypeScript",
    url: "https://hh.ru/vacancy/123",
    sourceQueryKey: "react-remote"
  };

  const firstMatchedUserIds = await ingestor.handle({
    ...rawItem,
    eligibleUserIds: ["777"]
  });
  const secondMatchedUserIds = await ingestor.handle({
    ...rawItem,
    eligibleUserIds: ["888"]
  });

  const ownerWeekly = database.listUserWeeklyVacancies("777", 0, 10, 7);
  const memberWeekly = database.listUserWeeklyVacancies("888", 0, 10, 7);
  await analytics.shutdown();
  database.close();

  assert.deepEqual(firstMatchedUserIds, ["777"]);
  assert.deepEqual(secondMatchedUserIds, ["888"]);
  assert.deepEqual(deliveries, ["777", "888"]);
  assert.equal(ownerWeekly.total, 1);
  assert.equal(memberWeekly.total, 1);
});
