import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import BetterSqlite3 from "better-sqlite3";

import { createAnalyticsService } from "../src/analytics/analyticsService";
import { BotController } from "../src/bot/createBot";
import { VacancyDatabase } from "../src/db/database";
import { UserVacancyRematcher } from "../src/services/userVacancyRematcher";
import { VacancyFilter } from "../src/services/vacancyFilter";
import { VacancyIngestor } from "../src/services/vacancyIngestor";
import { MatchedVacancyRecord } from "../src/types";
import { createTestConfig } from "./helpers";

function createDatabase(prefix = "job-tg-bot-multiple-profiles-") {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const databasePath = path.join(tempDir, "bot.db");
  const config = createTestConfig({
    ownerUserId: "777",
    ownerChatId: "777",
    databasePath,
    databaseUrl: `file:${databasePath}`,
    appDataDir: tempDir,
    runtimeDir: path.join(tempDir, "runtime")
  });
  const database = new VacancyDatabase(config);
  database.initialize();
  return { config, database, databasePath };
}

function storeVacancy(database: VacancyDatabase, filter: VacancyFilter, messageId: string, text: string): void {
  database.recordMessage(
    {
      source: "telegram_web_preview",
      channel: "jobs",
      messageId,
      date: new Date().toISOString(),
      text,
      url: `https://t.me/jobs/${messageId}`
    },
    filter.evaluateBaseCandidate(text),
    []
  );
}

test("user can manage up to five independent search profiles", () => {
  const { config, database } = createDatabase();
  const first = database.getUserSearchProfile("777");
  const second = database.createUserSearchProfile("777", { name: "Подработка" });

  database.renameUserSearchProfile("777", second.id, "Подработка без опыта");
  database.setUserSearchProfileLanguageMode("777", second.id, "ru_only");
  database.setUserSearchProfileActive("777", second.id, false);
  database.createUserSearchProfile("777", { name: "Третий" });
  database.createUserSearchProfile("777", { name: "Четвёртый" });
  database.createUserSearchProfile("777", { name: "Пятый" });

  assert.equal(database.listUserSearchProfiles("777").length, 5);
  assert.throws(() => database.createUserSearchProfile("777", { name: "Шестой" }), /лимит/i);

  const updatedSecond = database.getUserSearchProfileById("777", second.id);
  assert.equal(updatedSecond?.name, "Подработка без опыта");
  assert.equal(updatedSecond?.vacancyLanguageMode, "ru_only");
  assert.equal(updatedSecond?.isActive, false);

  for (const profile of database.listUserSearchProfiles("777")) {
    database.deleteUserSearchProfile("777", profile.id);
  }
  assert.deepEqual(database.listUserSearchProfiles("777"), []);
  assert.equal(database.getUserHhSearchSettings("777").enabled, false);
  assert.deepEqual(database.listUserSearchProfiles("777"), []);
  assert.ok(first.id > 0);
  database.close();

  const restarted = new VacancyDatabase(config);
  restarted.initialize();
  assert.deepEqual(restarted.listUserSearchProfiles("777"), []);
  restarted.close();
});

test("rematch combines profiles without duplicate vacancies and supports profile feeds", () => {
  const { config, database } = createDatabase();
  const filter = new VacancyFilter(config);
  const rematcher = new UserVacancyRematcher(database, filter, undefined);
  const frontend = database.getUserSearchProfile("777");
  database.renameUserSearchProfile("777", frontend.id, "Frontend");
  database.replaceUserSearchProfile("777", {
    requiredContextKeywords: ["remote"],
    requiredPrimaryKeywords: ["frontend"],
    preferredKeywords: ["react"],
    excludeKeywords: []
  }, frontend.id);
  const sideJob = database.createUserSearchProfile("777", {
    name: "Подработка без опыта",
    requiredContextKeywords: ["remote"],
    requiredPrimaryKeywords: ["без опыта"],
    preferredKeywords: ["оператор"],
    excludeKeywords: []
  });

  storeVacancy(database, filter, "1", "Remote frontend React. Можно без опыта.");
  storeVacancy(database, filter, "2", "Remote frontend React senior.");
  storeVacancy(database, filter, "3", "Remote оператор чата, без опыта.");

  const summary = rematcher.rebuildForUser("777", 7);
  const combined = database.listUserWeeklyVacancies("777", 0, 10, 7);
  const frontendFeed = database.listUserWeeklyVacancies("777", 0, 10, 7, frontend.id);
  const sideJobFeed = database.listUserWeeklyVacancies("777", 0, 10, 7, sideJob.id);
  const shared = combined.items.find((vacancy) => vacancy.sourceMessageId === "1");

  assert.equal(combined.total, 3);
  assert.equal(frontendFeed.total, 2);
  assert.equal(sideJobFeed.total, 2);
  assert.equal(summary.profileDiagnostics.find((item) => item.profileId === frontend.id)?.matchedVacancies, 2);
  assert.equal(summary.profileDiagnostics.find((item) => item.profileId === sideJob.id)?.matchedVacancies, 2);
  assert.equal(summary.profileDiagnostics.find((item) => item.profileId === frontend.id)?.rejectionReasons.missing_primary, 1);
  assert.equal(summary.profileDiagnostics.find((item) => item.profileId === sideJob.id)?.rejectionReasons.missing_primary, 1);
  assert.deepEqual(shared?.matchedProfileNames, ["Frontend", "Подработка без опыта"]);

  database.setUserVacancyStatus("777", shared!.id, "saved");
  database.setUserSearchProfileActive("777", sideJob.id, false);
  rematcher.rebuildForUser("777", 7);

  assert.equal(database.listUserWeeklyVacancies("777", 0, 10, 7).total, 2);
  const saved = database.listUserVacanciesByStatus("777", "saved", 0, 10);
  assert.equal(saved.total, 1);
  assert.deepEqual(saved.items[0]?.matchedProfileNames, ["Frontend"]);
  database.close();
});

test("weekly profile stats separate visible and hidden matches per profile", () => {
  const { config, database } = createDatabase();
  const filter = new VacancyFilter(config);
  const rematcher = new UserVacancyRematcher(database, filter, undefined);
  const frontend = database.getUserSearchProfile("777");
  database.replaceUserSearchProfile("777", {
    requiredContextKeywords: ["remote"],
    requiredPrimaryKeywords: ["frontend"],
    preferredKeywords: [],
    excludeKeywords: []
  }, frontend.id);
  const react = database.createUserSearchProfile("777", {
    name: "React",
    requiredContextKeywords: ["remote"],
    requiredPrimaryKeywords: ["react"]
  });

  storeVacancy(database, filter, "stats-shared", "We are hiring a remote frontend React developer.");
  storeVacancy(database, filter, "stats-frontend", "We are hiring a remote frontend developer.");
  rematcher.rebuildForUser("777", 7);

  const shared = database.listUserWeeklyVacancies("777", 0, 10, 7).items
    .find((vacancy) => vacancy.sourceMessageId === "stats-shared");
  database.setUserVacancyStatus("777", shared!.id, "hidden");

  const stats = new Map(
    database.listUserSearchProfileWeeklyStats("777", 7).map((item) => [item.profileId, item])
  );
  assert.deepEqual(stats.get(frontend.id), {
    profileId: frontend.id,
    visibleMatches: 1,
    hiddenMatches: 1
  });
  assert.deepEqual(stats.get(react.id), {
    profileId: react.id,
    visibleMatches: 0,
    hiddenMatches: 1
  });
  database.close();
});

test("ingestor sends one notification when a vacancy matches multiple profiles", async () => {
  const { config, database } = createDatabase();
  const first = database.getUserSearchProfile("777");
  database.replaceUserSearchProfile("777", {
    requiredContextKeywords: ["remote"],
    requiredPrimaryKeywords: ["frontend"],
    preferredKeywords: [],
    excludeKeywords: []
  }, first.id);
  database.renameUserSearchProfile("777", first.id, "Frontend");
  database.createUserSearchProfile("777", {
    name: "Без опыта",
    requiredContextKeywords: ["remote"],
    requiredPrimaryKeywords: ["без опыта"],
    preferredKeywords: [],
    excludeKeywords: []
  });

  const deliveries: MatchedVacancyRecord[] = [];
  const bot: BotController = {
    async start() {},
    async stop() {},
    async notifyVacancy(vacancy) {
      deliveries.push(vacancy);
      return true;
    },
    async sendVacancyReminder() {
      return true;
    },
    async sendApplicationFollowUp() {
      return true;
    },
    async sendNoNewVacanciesNotification() {
      return true;
    },
    async sendStartupDiagnostic() {},
    async sendAdminAlert() {
            return true;
        },
        async sendOwnerReport() { return true; }
    };
  const analytics = createAnalyticsService(config, database);
  const ingestor = new VacancyIngestor(config, new VacancyFilter(config), database, bot, analytics);

  await ingestor.handle({
    source: "telegram_web_preview",
    channel: "jobs",
    messageId: "multi",
    date: new Date().toISOString(),
    text: "Remote frontend assistant, можно без опыта.",
    url: "https://t.me/jobs/multi"
  });

  assert.equal(deliveries.length, 1);
  assert.deepEqual(deliveries[0]?.matchedProfileNames, ["Frontend", "Без опыта"]);
  await analytics.shutdown();
  database.close();
});

test("each search profile applies its own vacancy language mode", () => {
  const { config, database } = createDatabase();
  const filter = new VacancyFilter(config);
  const rematcher = new UserVacancyRematcher(database, filter, undefined);
  const russian = database.getUserSearchProfile("777");
  database.renameUserSearchProfile("777", russian.id, "Русский frontend");
  database.replaceUserSearchProfile("777", {
    requiredContextKeywords: ["remote", "удалённо"],
    requiredPrimaryKeywords: ["react"],
    preferredKeywords: [],
    excludeKeywords: []
  }, russian.id);
  database.setUserSearchProfileLanguageMode("777", russian.id, "ru_only");
  const english = database.createUserSearchProfile("777", {
    name: "English frontend",
    vacancyLanguageMode: "en_only",
    requiredContextKeywords: ["remote"],
    requiredPrimaryKeywords: ["react"]
  });

  storeVacancy(database, filter, "ru", "Удалённо. Ищем React разработчика в продуктовую команду.");
  storeVacancy(database, filter, "en", "Remote React developer. We are hiring for a product team.");
  rematcher.rebuildForUser("777", 7);

  assert.deepEqual(
    database.listUserWeeklyVacancies("777", 0, 10, 7, russian.id).items.map((item) => item.sourceMessageId),
    ["ru"]
  );
  assert.deepEqual(
    database.listUserWeeklyVacancies("777", 0, 10, 7, english.id).items.map((item) => item.sourceMessageId),
    ["en"]
  );
  database.close();
});

test("profile ids cannot be used to mutate another user's search", () => {
  const { config, database } = createDatabase();
  database.addOrActivateBotUser("888", "member", config.ownerUserId);
  const memberProfile = database.getUserSearchProfile("888");

  assert.equal(database.getUserSearchProfileById("777", memberProfile.id), null);
  assert.throws(
    () => database.setUserSearchProfileKeywords("777", "preferred", ["stolen"], memberProfile.id),
    /not found/i
  );
  assert.throws(
    () => database.renameUserSearchProfile("777", memberProfile.id, "Чужой поиск"),
    /не найден/i
  );
  database.close();
});

test("legacy single search profile migrates to Основной поиск with language", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-tg-bot-profile-migration-"));
  const databasePath = path.join(tempDir, "bot.db");
  const sqlite = new BetterSqlite3(databasePath);
  sqlite.exec(`
    CREATE TABLE bot_users (
      user_id TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      username TEXT,
      display_name TEXT,
      added_by_user_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO bot_users (user_id, role) VALUES ('777', 'owner');

    CREATE TABLE user_search_profiles (
      user_id TEXT PRIMARY KEY,
      required_context_keywords_json TEXT NOT NULL,
      required_primary_keywords_json TEXT NOT NULL,
      preferred_keywords_json TEXT NOT NULL,
      exclude_keywords_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO user_search_profiles VALUES ('777', '["remote"]', '["frontend"]', '["react"]', '[]', CURRENT_TIMESTAMP);
  `);
  sqlite.close();

  const config = createTestConfig({
    ownerUserId: "777",
    ownerChatId: "777",
    databasePath,
    databaseUrl: `file:${databasePath}`,
    appDataDir: tempDir,
    runtimeDir: path.join(tempDir, "runtime")
  });
  const database = new VacancyDatabase(config);
  database.initialize();
  const profiles = database.listUserSearchProfiles("777");

  assert.equal(profiles.length, 1);
  assert.equal(profiles[0]?.name, "Основной поиск");
  assert.deepEqual(profiles[0]?.requiredPrimaryKeywords, ["frontend"]);
  assert.equal(profiles[0]?.vacancyLanguageMode, "ru_en");
  database.close();
});
