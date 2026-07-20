import test from "node:test";
import assert from "node:assert/strict";

import { detectVacancyLanguage, matchesVacancyLanguageMode } from "../src/services/vacancyLanguageDetection";

test("detectVacancyLanguage classifies russian vacancy text", () => {
  const result = detectVacancyLanguage("Удалённо, фултайм, продуктовая команда, оформление по ТК.");

  assert.equal(result.language, "russian");
  assert.ok(result.russianTokenCount > 0);
});

test("detectVacancyLanguage classifies english vacancy text", () => {
  const result = detectVacancyLanguage("Remote backend engineer with product experience and strong team ownership.");

  assert.equal(result.language, "english");
  assert.ok(result.englishTokenCount > 0);
});

test("detectVacancyLanguage classifies mixed vacancy text with russian priority inputs", () => {
  const result = detectVacancyLanguage("Удалённо, strong product team, remote backend engineer.");

  assert.equal(result.language, "mixed");
});

test("detectVacancyLanguage falls back to unknown for short noisy text", () => {
  const result = detectVacancyLanguage("JS TS SQL");

  assert.equal(result.language, "unknown");
});

test("matchesVacancyLanguageMode applies russian-priority mixed rules", () => {
  assert.equal(matchesVacancyLanguageMode("mixed", "ru_only"), true);
  assert.equal(matchesVacancyLanguageMode("mixed", "en_only"), false);
  assert.equal(matchesVacancyLanguageMode("unknown", "ru_en"), true);
  assert.equal(matchesVacancyLanguageMode("unknown", "ru_only"), false);
});
