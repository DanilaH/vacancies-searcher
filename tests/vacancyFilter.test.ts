import test from "node:test";
import assert from "node:assert/strict";

import { VacancyFilter } from "../src/services/vacancyFilter";
import { getSearchProfilePreset } from "../src/services/searchProfilePresets";
import { createTestConfig } from "./helpers";

const defaultProfile = {
  userId: "777",
  requiredContextKeywords: ["remote", "удаленно"],
  requiredPrimaryKeywords: ["react", "frontend"],
  preferredKeywords: ["typescript", "senior"],
  excludeKeywords: ["junior"],
  updatedAt: "2026-05-29T00:00:00.000Z"
};

test("VacancyFilter stores broad candidates before per-user matching", () => {
  const filter = new VacancyFilter(createTestConfig());
  const result = filter.evaluateBaseCandidate("Office Python Developer");

  assert.equal(result.matches, true);
  assert.equal(result.score, 0);
});

test("VacancyFilter blocks obvious resume posts in base candidate stage", () => {
  const filter = new VacancyFilter(createTestConfig());
  const result = filter.evaluateBaseCandidate(
    "Резюме Senior Frontend Developer\nУдаленно\nTypeScript, React"
  );

  assert.equal(result.matches, false);
  assert.match(result.summary, /candidate\/resume post/i);
});

test("VacancyFilter blocks achievement-style resume cards in base candidate stage", () => {
  const filter = new VacancyFilter(createTestConfig());
  const result = filter.evaluateBaseCandidate(
    [
      "🔥 Senior Frontend Developer от 340 000₽, удаленно, г. Москва, фуллтайм и проектная",
      "⭐ Оптимизировал рендеринг списков товаров: время сократилось на 43%",
      "⭐ Вносил вклад в Feature-Sliced Design и документацию Effector.",
      "⭐ Вел архитектурные решения для micro-frontend модулей."
    ].join("\n")
  );

  assert.equal(result.matches, false);
  assert.match(result.summary, /candidate\/resume post/i);
});

test("VacancyFilter matches a user profile with required and preferred signals", () => {
  const filter = new VacancyFilter(createTestConfig());
  const result = filter.evaluateForProfile(
    "Senior React Engineer\nRemote-first\nTypeScript required",
    defaultProfile
  );

  assert.equal(result.matches, true);
  assert.equal(result.blockedBy.length, 0);
  assert.ok(result.matchedKeywords.includes("react"));
  assert.ok(result.matchedKeywords.includes("remote"));
  assert.ok(result.matchedKeywords.includes("typescript"));
});

test("VacancyFilter does not match React profile from reactivation words", () => {
  const filter = new VacancyFilter(createTestConfig());
  const profile = {
    ...defaultProfile,
    requiredContextKeywords: ["remote", "\u0443\u0434\u0430\u043b\u0435\u043d\u043a\u0430"],
    requiredPrimaryKeywords: ["react", "\u0440\u0435\u0430\u043a\u0442"]
  };
  const result = filter.evaluateForProfile(
    [
      "Cross-sell Manager (reactivation)",
      "Work mode: Remote",
      "International iGaming company is looking for Cross-sell / Reactivation Manager.",
      "\u0420\u0430\u0437\u0440\u0430\u0431\u043e\u0442\u043a\u0430 \u0441\u0442\u0440\u0430\u0442\u0435\u0433\u0438\u0439 \u043f\u043e \u0440\u0435\u0430\u043a\u0442\u0438\u0432\u0430\u0446\u0438\u0438 \u043a\u043b\u0438\u0435\u043d\u0442\u043e\u0432.",
      "\u0423\u0441\u043b\u043e\u0432\u0438\u044f: \u043f\u043e\u043b\u043d\u0430\u044f \u0443\u0434\u0430\u043b\u0435\u043d\u043a\u0430."
    ].join("\n"),
    profile
  );

  assert.equal(result.matches, false);
  assert.deepEqual(result.matchedKeywords, ["remote", "\u0443\u0434\u0430\u043b\u0435\u043d\u043a\u0430"]);
  assert.match(result.summary, /required profile signals/i);
});

test("VacancyFilter blocks personal stop-words from the search profile", () => {
  const filter = new VacancyFilter(createTestConfig());
  const result = filter.evaluateForProfile("Junior React Developer\nRemote", defaultProfile);

  assert.equal(result.matches, false);
  assert.match(result.summary, /stop-words/i);
  assert.deepEqual(result.rejectionReasons, ["stop_words"]);
});

test("VacancyFilter blocks resume posts even if profile keywords match", () => {
  const filter = new VacancyFilter(createTestConfig());
  const result = filter.evaluateForProfile(
    "Резюме Senior Frontend Developer\nУдаленно\nReact\nTypeScript",
    defaultProfile
  );

  assert.equal(result.matches, false);
  assert.match(result.summary, /candidate\/resume post/i);
  assert.deepEqual(result.rejectionReasons, ["candidate_post"]);
});

test("VacancyFilter lets russian-only mode pass mixed posts", () => {
  const filter = new VacancyFilter(createTestConfig());
  const result = filter.evaluateForProfile(
    "Удалённо\nSenior React Engineer\nTypeScript\nProduct team",
    defaultProfile,
    "ru_only"
  );

  assert.equal(result.matches, true);
});

test("VacancyFilter blocks mixed posts in english-only mode", () => {
  const filter = new VacancyFilter(createTestConfig());
  const result = filter.evaluateForProfile(
    "Удалённо\nSenior React Engineer\nTypeScript\nProduct team",
    defaultProfile,
    "en_only"
  );

  assert.equal(result.matches, false);
  assert.match(result.summary, /vacancy language mode/i);
  assert.deepEqual(result.rejectionReasons, ["language"]);
});

test("VacancyFilter lets english-only mode pass english vacancy posts", () => {
  const filter = new VacancyFilter(createTestConfig());
  const englishProfile = {
    ...defaultProfile,
    requiredContextKeywords: ["remote"],
    requiredPrimaryKeywords: ["react", "engineer"]
  };
  const result = filter.evaluateForProfile(
    "Remote senior React engineer\nTypeScript\nProduct team",
    englishProfile,
    "en_only"
  );

  assert.equal(result.matches, true);
});

test("VacancyFilter rejects vacancies that miss required profile blocks", () => {
  const filter = new VacancyFilter(createTestConfig());
  const result = filter.evaluateForProfile("Senior React Engineer\nOffice only", defaultProfile);

  assert.equal(result.matches, false);
  assert.match(result.summary, /required profile signals/i);
  assert.deepEqual(result.rejectionReasons, ["missing_context"]);
});

test("remote no-experience preset matches remote work in any profession when experience is explicitly optional", () => {
  const filter = new VacancyFilter(createTestConfig());
  const preset = getSearchProfilePreset("remote_no_experience")!;
  const result = filter.evaluateForProfile(
    [
      "Оператор чата",
      "Формат работы: удалённо",
      "Работа — общение с фанами моделей и продажа контента.",
      "Опыт не обязателен, всему научим."
    ].join("\n"),
    {
      userId: "777",
      ...preset,
      updatedAt: "2026-06-05T00:00:00.000Z"
    }
  );

  assert.equal(result.matches, true);
  assert.ok(result.matchedKeywords.includes("удалённо"));
  assert.ok(result.matchedKeywords.includes("опыт не обязателен"));
});

test("remote no-experience preset rejects remote vacancies without an explicit no-experience signal", () => {
  const filter = new VacancyFilter(createTestConfig());
  const preset = getSearchProfilePreset("remote_no_experience")!;
  const result = filter.evaluateForProfile(
    "Удалённо. Требуется менеджер проектов с опытом работы от 3 лет.",
    {
      userId: "777",
      ...preset,
      updatedAt: "2026-06-05T00:00:00.000Z"
    }
  );

  assert.equal(result.matches, false);
});
