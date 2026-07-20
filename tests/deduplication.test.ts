import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import BetterSqlite3 from "better-sqlite3";

import { VacancyDatabase } from "../src/db/database";
import { createTestConfig } from "./helpers";

function createTempDatabaseConfig() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-tg-bot-db-"));
  return createTestConfig({
    databasePath: path.join(tempDir, "bot.db"),
    databaseUrl: `file:${path.join(tempDir, "bot.db")}`,
    appDataDir: tempDir,
    runtimeDir: path.join(tempDir, "runtime")
  });
}

test("deduplication persists across restart for source + channel + messageId", () => {
  const config = createTempDatabaseConfig();
  const item = {
    source: "telegram_web_preview" as const,
    channel: "job_react",
    messageId: "5355",
    date: "2026-05-27T10:00:00+00:00",
    text: "Senior React Engineer\nRemote\nTypeScript",
    url: "https://t.me/job_react/5355"
  };
  const filterResult = {
    matches: true,
    score: 90,
    matchedKeywords: ["react", "remote", "typescript"],
    blockedBy: [],
    summary: "remote: remote; react: react; typescript: typescript"
  };

  const firstDatabase = new VacancyDatabase(config);
  firstDatabase.initialize();
  const firstInsert = firstDatabase.recordMessage(item, filterResult, []);
  firstDatabase.close();

  const secondDatabase = new VacancyDatabase(config);
  secondDatabase.initialize();
  const secondInsert = secondDatabase.recordMessage(item, filterResult, []);
  secondDatabase.close();

  assert.equal(firstInsert.kind, "new_vacancy");
  assert.equal(secondInsert.kind, "duplicate_raw_message");
});

test("deduplication skips cross-posted vacancies by fingerprint", () => {
  const config = createTempDatabaseConfig();
  const filterResult = {
    matches: true,
    score: 90,
    matchedKeywords: ["react", "remote", "typescript"],
    blockedBy: [],
    summary: "remote: remote; react: react; typescript: typescript"
  };

  const database = new VacancyDatabase(config);
  database.initialize();

  const firstInsert = database.recordMessage(
    {
      source: "telegram_web_preview",
      channel: "job_react",
      messageId: "5355",
      date: "2026-05-27T10:00:00+00:00",
      text: "Senior React Engineer\nRemote\nTypeScript",
      url: "https://t.me/job_react/5355"
    },
    filterResult,
    []
  );

  const duplicateInsert = database.recordMessage(
    {
      source: "telegram_web_preview",
      channel: "rabotafrontend",
      messageId: "1900",
      date: "2026-05-27T11:00:00+00:00",
      text: "Senior React Engineer\nRemote\nTypeScript",
      url: "https://t.me/rabotafrontend/1900"
    },
    filterResult,
    []
  );

  database.close();

  assert.equal(firstInsert.kind, "new_vacancy");
  assert.equal(duplicateInsert.kind, "duplicate_fingerprint");
});

test("deduplication skips cross-posts with different channel promo footers", () => {
  const config = createTempDatabaseConfig();
  const filterResult = {
    matches: true,
    score: 90,
    matchedKeywords: ["react", "remote", "typescript"],
    blockedBy: [],
    summary: "matched"
  };
  const body = "Senior Frontend developer (React native) CDEK.Shopping\nКомпания: СДЭК\nRemote\nReact Native";
  const database = new VacancyDatabase(config);
  database.initialize();

  const first = database.recordMessage(
    {
      source: "telegram_web_preview",
      channel: "job_react",
      messageId: "5416",
      text: `${body}\n\nОткликнуться\n\nReact Jobв Telegram | в VK | в Max`,
      url: "https://t.me/job_react/5416"
    },
    filterResult,
    []
  );
  const duplicate = database.recordMessage(
    {
      source: "telegram_web_preview",
      channel: "frontend_rabota",
      messageId: "2914",
      text: `${body}\n\nОткликнуться (https://example.com/vacancy)\n\n| | ()\n\n@frontend_rabota`,
      url: "https://t.me/frontend_rabota/2914"
    },
    filterResult,
    []
  );

  assert.equal(first.kind, "new_vacancy");
  assert.equal(duplicate.kind, "duplicate_fingerprint");
  database.close();
});

test("fingerprint reconciliation merges legacy cross-post vacancies and preserves user data", () => {
  const config = createTempDatabaseConfig();
  const filterResult = {
    matches: true,
    score: 90,
    matchedKeywords: ["react", "remote", "typescript"],
    blockedBy: [],
    summary: "matched"
  };
  const body = "Senior Frontend Developer\nCompany: CDEK\nRemote\nReact Native";
  const canonicalText = `${body}\n\nApply\n\nReact Job in Telegram | in VK | in Max`;
  const duplicateText = `${body}\n\nApply: https://example.com/vacancy\n\n@frontend_rabota`;
  const database = new VacancyDatabase(config);
  database.initialize();
  database.registerPublicUserIfNeeded("777");

  const canonicalInsert = database.recordMessage(
    {
      source: "telegram_web_preview",
      channel: "job_react",
      messageId: "1",
      text: canonicalText,
      url: "https://t.me/job_react/1"
    },
    filterResult,
    []
  );
  assert.equal(canonicalInsert.kind, "new_vacancy");
  if (canonicalInsert.kind !== "new_vacancy") {
    database.close();
    return;
  }
  database.close();

  const legacyDb = new BetterSqlite3(config.databasePath);
  legacyDb.pragma("foreign_keys = ON");
  legacyDb.prepare("DELETE FROM app_state WHERE key = 'vacancy_fingerprint_version'").run();
  legacyDb
    .prepare(
      `
        INSERT INTO raw_messages (
          source_name, source_channel, source_message_id, message_date, text,
          normalized_text, url, canonical_url, fingerprint, imported_at
        ) VALUES (
          'telegram_web_preview', 'frontend_rabota', '2', CURRENT_TIMESTAMP, ?,
          ?, 'https://t.me/frontend_rabota/2', NULL, 'legacy-raw-fingerprint', CURRENT_TIMESTAMP
        )
      `
    )
    .run(duplicateText, duplicateText.toLocaleLowerCase("en-US"));
  const duplicateInsert = legacyDb
    .prepare(
      `
        INSERT INTO vacancies (
          source_name, source_channel, source_message_id, message_date, title, text,
          normalized_text, url, canonical_url, fingerprint, score, match_summary,
          matched_keywords_json, contacts_json, sent_to_owner_at, created_at, updated_at
        )
        SELECT
          'telegram_web_preview', 'frontend_rabota', '2', message_date, title, ?,
          normalized_text, 'https://t.me/frontend_rabota/2', NULL, 'legacy-vacancy-fingerprint',
          score, match_summary, matched_keywords_json, contacts_json, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        FROM vacancies
        WHERE id = ?
      `
    )
    .run(duplicateText, canonicalInsert.vacancy.id);
  const duplicateVacancyId = Number(duplicateInsert.lastInsertRowid);
  legacyDb
    .prepare(
      `
        INSERT INTO user_vacancy_matches (
          user_id, vacancy_id, score, match_summary, matched_keywords_json, delivered_at, created_at, updated_at
        ) VALUES ('777', ?, 95, 'legacy match', '["react"]', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `
    )
    .run(duplicateVacancyId);
  legacyDb
    .prepare(
      `
        INSERT INTO user_vacancy_states (user_id, vacancy_id, status, created_at, updated_at)
        VALUES ('777', ?, 'saved', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `
    )
    .run(duplicateVacancyId);
  legacyDb
    .prepare(
      `
        INSERT INTO user_vacancy_reminders (
          user_id, vacancy_id, remind_at, next_attempt_at, attempt_count,
          delivered_at, cancelled_at, last_error, created_at, updated_at
        ) VALUES (
          '777', ?, '2026-06-08T10:00:00.000Z', '2026-06-08T10:00:00.000Z', 0,
          NULL, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `
    )
    .run(duplicateVacancyId);
  legacyDb.close();

  const reconciledDatabase = new VacancyDatabase(config);
  reconciledDatabase.initialize();
  const duplicatePosts = reconciledDatabase.listVacancyDuplicatePosts(canonicalInsert.vacancy.id);
  reconciledDatabase.close();

  const verifiedDb = new BetterSqlite3(config.databasePath, { readonly: true });
  const vacancyCount = verifiedDb.prepare("SELECT COUNT(*) AS count FROM vacancies").get() as { count: number };
  const match = verifiedDb
    .prepare("SELECT vacancy_id FROM user_vacancy_matches WHERE user_id = '777'")
    .get() as { vacancy_id: number };
  const state = verifiedDb
    .prepare("SELECT vacancy_id, status FROM user_vacancy_states WHERE user_id = '777'")
    .get() as { vacancy_id: number; status: string };
  const reminder = verifiedDb
    .prepare("SELECT vacancy_id FROM user_vacancy_reminders WHERE user_id = '777'")
    .get() as { vacancy_id: number };
  const fingerprintVersion = verifiedDb
    .prepare("SELECT value FROM app_state WHERE key = 'vacancy_fingerprint_version'")
    .get() as { value: string };
  verifiedDb.close();

  assert.equal(vacancyCount.count, 1);
  assert.equal(match.vacancy_id, canonicalInsert.vacancy.id);
  assert.deepEqual(state, { vacancy_id: canonicalInsert.vacancy.id, status: "saved" });
  assert.equal(reminder.vacancy_id, canonicalInsert.vacancy.id);
  assert.equal(duplicatePosts.total, 1);
  assert.equal(duplicatePosts.items[0]?.url, "https://t.me/frontend_rabota/2");
  assert.equal(fingerprintVersion.value, "3");
});

test("listVacancyDuplicatePosts returns cross-post sources without canonical post", () => {
  const config = createTempDatabaseConfig();
  const filterResult = {
    matches: true,
    score: 90,
    matchedKeywords: ["react", "remote", "typescript"],
    blockedBy: [],
    summary: "remote: remote; react: react; typescript: typescript"
  };
  const text = "Senior React Engineer\nRemote\nTypeScript";
  const database = new VacancyDatabase(config);
  database.initialize();

  const firstInsert = database.recordMessage(
    {
      source: "telegram_web_preview",
      channel: "job_react",
      messageId: "5355",
      date: "2026-05-27T10:00:00.000Z",
      text,
      url: "https://t.me/job_react/5355"
    },
    filterResult,
    []
  );

  assert.equal(firstInsert.kind, "new_vacancy");
  if (firstInsert.kind !== "new_vacancy") {
    database.close();
    return;
  }

  for (let index = 0; index < 6; index += 1) {
    const messageId = String(1900 + index);
    const insert = database.recordMessage(
      {
        source: "telegram_web_preview",
        channel: `crosspost_${index}`,
        messageId,
        date: `2026-05-27T1${index + 1}:00:00.000Z`,
        text,
        url: `https://t.me/crosspost_${index}/${messageId}`
      },
      filterResult,
      []
    );

    assert.equal(insert.kind, "duplicate_fingerprint");
  }

  const duplicatePosts = database.listVacancyDuplicatePosts(firstInsert.vacancy.id, 5);
  database.close();

  assert.equal(duplicatePosts.total, 6);
  assert.equal(duplicatePosts.items.length, 5);
  assert.deepEqual(
    duplicatePosts.items.map((post) => post.sourceMessageId),
    ["1905", "1904", "1903", "1902", "1901"]
  );
  assert.ok(!duplicatePosts.items.some((post) => post.sourceChannel === "job_react" && post.sourceMessageId === "5355"));
  assert.equal(duplicatePosts.items[0]?.url, "https://t.me/crosspost_5/1905");
});

test("different canonical URLs keep separate vacancies even when source text is identical", () => {
  const config = createTempDatabaseConfig();
  const filterResult = {
    matches: true,
    score: 90,
    matchedKeywords: ["frontend", "remote"],
    blockedBy: [],
    summary: "matched"
  };
  const database = new VacancyDatabase(config);
  database.initialize();
  const text = "Senior Frontend Developer\nEmployment: Full-time\nLocations: Estonia";

  const first = database.recordMessage(
    {
      source: "telegram_web_preview",
      channel: "findmyremote_frontend",
      messageId: "887:child:first",
      text,
      url: "https://t.me/findmyremote_frontend/887",
      canonicalUrl: "https://findmyremote.ai/companies/acme/jobs/frontend-1"
    },
    filterResult,
    []
  );
  const second = database.recordMessage(
    {
      source: "telegram_web_preview",
      channel: "findmyremote_frontend",
      messageId: "887:child:second",
      text,
      url: "https://t.me/findmyremote_frontend/887",
      canonicalUrl: "https://findmyremote.ai/companies/acme/jobs/frontend-2"
    },
    filterResult,
    []
  );
  const duplicatePosts = first.kind === "new_vacancy"
    ? database.listVacancyDuplicatePosts(first.vacancy.id)
    : null;

  database.close();
  assert.equal(first.kind, "new_vacancy");
  assert.equal(second.kind, "new_vacancy");
  assert.equal(duplicatePosts?.total, 0);

  const legacyDb = new BetterSqlite3(config.databasePath);
  legacyDb.prepare("DELETE FROM app_state WHERE key = 'vacancy_fingerprint_version'").run();
  legacyDb.close();
  const reconciled = new VacancyDatabase(config);
  reconciled.initialize();
  assert.equal(reconciled.listVacanciesSince(365).length, 2);
  reconciled.close();
});

test("deduplication links Telegram reposts and company source items by canonical URL", () => {
  const config = createTempDatabaseConfig();
  const filterResult = {
    matches: true,
    score: 90,
    matchedKeywords: ["frontend", "remote"],
    blockedBy: [],
    summary: "matched"
  };
  const canonicalUrl = "https://www.aviasales.ru/about/vacancies/4263584";
  const database = new VacancyDatabase(config);
  database.initialize();

  const telegramInsert = database.recordMessage(
    {
      source: "telegram_web_preview",
      channel: "job_react",
      messageId: "9001",
      date: "2026-06-03T10:00:00.000Z",
      text: `Frontend Developer\nRemote\n${canonicalUrl}`,
      url: "https://t.me/job_react/9001",
      canonicalUrl
    },
    filterResult,
    []
  );

  assert.equal(telegramInsert.kind, "new_vacancy");
  if (telegramInsert.kind !== "new_vacancy") {
    database.close();
    return;
  }

  const companyInsert = database.recordMessage(
    {
      source: "company_careers",
      channel: "Aviasales",
      messageId: "1:4263584",
      date: "2026-06-03T11:00:00.000Z",
      text: "Frontend Developer\nCompany: Aviasales\nRemote product team",
      url: canonicalUrl,
      canonicalUrl
    },
    filterResult,
    []
  );

  const duplicatePosts = database.listVacancyDuplicatePosts(telegramInsert.vacancy.id, 5);
  database.close();

  assert.equal(companyInsert.kind, "duplicate_canonical_url");
  assert.equal(duplicatePosts.total, 1);
  assert.equal(duplicatePosts.items[0]?.sourceName, "company_careers");
  assert.equal(duplicatePosts.items[0]?.sourceChannel, "Aviasales");
  assert.equal(duplicatePosts.items[0]?.url, canonicalUrl);
});
