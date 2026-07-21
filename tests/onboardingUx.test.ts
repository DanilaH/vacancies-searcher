import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  formatOnboardingCompletionMessage,
  formatOnboardingIntroMessage,
  formatOnboardingLanguageMessage,
  formatOnboardingSetupChoiceMessage,
  formatStartMessage
} from "../src/bot/formatters";
import { VacancyDatabase } from "../src/db/database";
import { createTestConfig } from "./helpers";

function createTempDatabaseConfig() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-tg-bot-onboarding-ux-"));
  return createTestConfig({
    ownerUserId: "777",
    ownerChatId: "777",
    databasePath: path.join(tempDir, "bot.db"),
    databaseUrl: `file:${path.join(tempDir, "bot.db")}`,
    appDataDir: tempDir,
    runtimeDir: path.join(tempDir, "runtime")
  });
}

test("start message explains the current main menu map", () => {
  const formatted = formatStartMessage(createTempDatabaseConfig());

  assert.match(formatted, /Подборка вакансий/u);
  assert.match(formatted, /Мои поиски/u);
  assert.match(formatted, /Мои вакансии/u);
  assert.match(formatted, /Настройки/u);
  assert.match(formatted, /дайджест/u);
});

test("intro onboarding message explains bot value before setup", () => {
  const formatted = formatOnboardingIntroMessage();

  assert.match(formatted, /персональную подборку вакансий/i);
  assert.match(formatted, /других подключённых источников/i);
  assert.match(formatted, /подборку вакансий за неделю/i);
  assert.match(formatted, /около минуты/i);
});

test("setup choice message explains preset and manual paths", () => {
  const formatted = formatOnboardingSetupChoiceMessage();

  assert.match(formatted, /пресет — быстрый старт/i);
  assert.match(formatted, /ручная настройка — если хочешь точнее/i);
  assert.match(formatted, /Мои поиски/);
  assert.match(formatted, /до пяти отдельных поисков/i);
});

test("language message marks the final onboarding step", () => {
  const formatted = formatOnboardingLanguageMessage("en_only");

  assert.match(formatted, /Финальный шаг/i);
  assert.match(formatted, /текущего поиска/i);
  assert.match(formatted, /только английский/i);
});

test("configured completion shows immediate matches and current features", () => {
  const formatted = formatOnboardingCompletionMessage(
    {
      status: "ready",
      summary: "Профиль готов к поиску.",
      guidance: "Поиск активен.",
      missingRequiredSections: [],
      isSearchActive: true
    },
    "ru_en",
    {
      trigger: "configured",
      initialMatchesCount: 12
    }
  );

  assert.match(formatted, /Уже найдено вакансий за последние 7 дней: 12/i);
  assert.match(formatted, /следующим сообщением/i);
  assert.match(formatted, /до пяти отдельных поисков/i);
  assert.match(formatted, /сохраняй интересное/i);
  assert.match(formatted, /Мои вакансии/i);
  assert.match(formatted, /поставить напоминание/i);
});

test("configured completion uses honest zero state", () => {
  const formatted = formatOnboardingCompletionMessage(
    {
      status: "ready",
      summary: "Профиль готов к поиску.",
      guidance: "Поиск активен.",
      missingRequiredSections: [],
      isSearchActive: true
    },
    "ru_only",
    {
      trigger: "configured",
      initialMatchesCount: 0
    }
  );

  assert.match(formatted, /точных совпадений пока нет/i);
  assert.match(formatted, /придут автоматически/i);
});

test("configured completion does not call an incomplete profile active", () => {
  const formatted = formatOnboardingCompletionMessage(
    {
      status: "empty",
      summary: "Профиль поиска пока не настроен.",
      guidance: "Добавь обязательные блоки.",
      missingRequiredSections: ["required_context", "required_primary"],
      isSearchActive: false
    },
    "ru_en",
    {
      trigger: "configured",
      initialMatchesCount: 0
    }
  );

  assert.match(formatted, /Поиск пока не активен/i);
  assert.doesNotMatch(formatted, /Поиск активен, но точных совпадений/i);
});

test("skipped completion stays calm and does not promise results", () => {
  const formatted = formatOnboardingCompletionMessage(
    {
      status: "weak",
      summary: "Профиль настроен частично.",
      guidance: "Для более точного поиска заполни блок «Основной профиль».",
      missingRequiredSections: ["required_primary"],
      isSearchActive: true
    },
    "ru_only",
    {
      trigger: "skipped",
      initialMatchesCount: 99
    }
  );

  assert.match(formatted, /Настройка отложена/i);
  assert.match(formatted, /Мои поиски/i);
  assert.doesNotMatch(formatted, /Уже найдено/i);
});

test("database persists onboarding intro step after restart", () => {
  const config = createTempDatabaseConfig();

  const firstDatabase = new VacancyDatabase(config);
  firstDatabase.initialize();
  firstDatabase.addOrActivateBotUser("888", "member", "777");
  firstDatabase.setOnboardingStep("888", "intro");
  firstDatabase.close();

  const secondDatabase = new VacancyDatabase(config);
  secondDatabase.initialize();
  const settings = secondDatabase.getUserSettings("888");
  secondDatabase.close();

  assert.equal(settings.onboardingStep, "intro");
  assert.equal(settings.onboardingCompleted, false);
});
