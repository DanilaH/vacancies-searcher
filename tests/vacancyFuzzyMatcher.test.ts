import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeFuzzyMatch,
  FUZZY_MATCH_THRESHOLD,
  shouldConsiderFuzzyMatch
} from "../src/services/vacancyFuzzyMatcher";
import type { SourceName, VacancyRecord } from "../src/types";

function makeVacancy(overrides: Partial<VacancyRecord> & { id: number; title: string }): VacancyRecord {
  return {
    sourceName: "telegram_mtproto" as SourceName,
    sourceChannel: "channel1",
    sourceMessageId: "msg1",
    messageDate: new Date("2026-07-20T12:00:00Z").toISOString(),
    text: overrides.title,
    normalizedText: overrides.title.toLowerCase(),
    url: "https://t.me/channel1/msg1",
    canonicalUrl: null,
    fingerprint: "abc",
    score: 50,
    matchSummary: "test",
    matchedKeywords: [],
    contacts: [],
    sentToOwnerAt: null,
    createdAt: new Date("2026-07-20T12:00:00Z").toISOString(),
    ...overrides
  };
}

const SAMPLE_TITLE = "Senior Python Developer (Django) в IT-компанию";
const SAMPLE_SIMILAR = "Senior Python Developer (Django) в IT-компанию — релокация";
const DIFFERENT_ROLE = "Senior Golang Developer (Kubernetes)";
const DIFFERENT_SENIORITY = "Junior Python Developer (Django)";
const DIFFERENT_COMPANY_TITLE = "Senior Python Developer (Django) в Яндекс";
const SAME_DAY = new Date("2026-07-20T14:00:00Z").toISOString();
const THREE_DAYS_LATER = new Date("2026-07-23T12:00:00Z").toISOString();
const MONTH_LATER = new Date("2026-08-22T12:00:00Z").toISOString();

describe("shouldConsiderFuzzyMatch", () => {
  it("returns true for similar titles within 30 days", () => {
    const a = makeVacancy({ id: 1, title: SAMPLE_TITLE });
    const b = makeVacancy({ id: 2, title: SAMPLE_SIMILAR, messageDate: THREE_DAYS_LATER });
    assert.equal(shouldConsiderFuzzyMatch(a, b), true);
  });

  it("returns false for very different titles", () => {
    const a = makeVacancy({ id: 1, title: "Senior Python Developer (Django)" });
    const b = makeVacancy({ id: 2, title: "Frontend Designer (Figma)" });
    assert.equal(shouldConsiderFuzzyMatch(a, b), false);
  });

  it("returns false for vacancies more than 30 days apart", () => {
    const a = makeVacancy({ id: 1, title: SAMPLE_TITLE });
    const b = makeVacancy({ id: 2, title: SAMPLE_SIMILAR, messageDate: MONTH_LATER });
    assert.equal(shouldConsiderFuzzyMatch(a, b), false);
  });

  it("returns false when title consists only of excluded words", () => {
    const a = makeVacancy({ id: 1, title: "Вакансия" });
    const b = makeVacancy({ id: 2, title: "Вакансия", messageDate: SAME_DAY });
    assert.equal(shouldConsiderFuzzyMatch(a, b), false);
  });
});

describe("computeFuzzyMatch", () => {
  it("matches same vacancy cross-posted with minor text changes", () => {
    const a = makeVacancy({
      id: 1,
      title: "Senior Python Developer (Django) в IT-компанию",
      text: "Senior Python Developer (Django) в IT-компанию\nТребования: опыт от 3 лет\nЗарплата: от 3000 до 5000 USD\nУдаленно"
    });
    const b = makeVacancy({
      id: 2,
      title: "Senior Python Developer (Django) в IT-компанию — релокация",
      text: "Senior Python Developer (Django) в IT-компанию — релокация\nОпыт от 3 лет\nЗарплата: 3000-5000 USD\nRemote",
      messageDate: SAME_DAY
    });
    const result = computeFuzzyMatch(a, b);
    assert.equal(result.isMatch, true, `Expected match but got score ${result.score}: ${result.reasons.join(", ")}`);
    assert.ok(result.score >= FUZZY_MATCH_THRESHOLD, `Score ${result.score} below threshold`);
  });

  it("returns false for different roles with same seniority", () => {
    const a = makeVacancy({
      id: 1,
      title: "Senior Python Developer (Django)",
      text: "Senior Python Developer (Django)"
    });
    const b = makeVacancy({
      id: 2,
      title: "Senior Golang Developer (Kubernetes)",
      text: "Senior Golang Developer (Kubernetes)"
    });
    const result = computeFuzzyMatch(a, b);
    assert.equal(result.isMatch, false, `Expected no match but got score ${result.score}: ${result.reasons.join(", ")}`);
    assert.ok(result.score < FUZZY_MATCH_THRESHOLD);
  });

  it("rejects vacancies with different seniority levels", () => {
    const a = makeVacancy({
      id: 1,
      title: "Junior Python Developer",
      text: "Junior Python Developer"
    });
    const b = makeVacancy({
      id: 2,
      title: "Senior Python Developer",
      text: "Senior Python Developer"
    });
    const result = computeFuzzyMatch(a, b);
    assert.equal(result.isMatch, false, `Should reject different seniority`);
    assert.ok(result.reasons.some((r) => r.includes("seniority") || r.includes("Senior")), `Expected seniority reason but got: ${result.reasons.join(", ")}`);
  });

  it("returns false for different companies", () => {
    const a = makeVacancy({
      id: 1,
      title: "Python Developer в Яндекс",
      text: "Python Developer в Яндекс"
    });
    const b = makeVacancy({
      id: 2,
      title: "Python Developer в Google",
      text: "Python Developer в Google"
    });
    const result = computeFuzzyMatch(a, b);
    assert.equal(result.isMatch, false, `Should reject different companies`);
  });

  it("handles remote/office conflict", () => {
    const a = makeVacancy({
      id: 1,
      title: "Python Developer",
      text: "Python Developer. Office in Moscow"
    });
    const b = makeVacancy({
      id: 2,
      title: "Python Developer",
      text: "Python Developer. Remote"
    });
    const result = computeFuzzyMatch(a, b);
    assert.equal(result.isMatch, false, `Should reject remote/office conflict`);
  });

  it("handles conflicting salary ranges", () => {
    const a = makeVacancy({
      id: 1,
      title: "Python Developer",
      text: "Python Developer. Salary: 3000-5000 USD"
    });
    const b = makeVacancy({
      id: 2,
      title: "Python Developer",
      text: "Python Developer. Salary: 1000-1500 USD"
    });
    const result = computeFuzzyMatch(a, b);
    assert.equal(result.isMatch, false, `Should reject conflicting salary`);
  });

  it("matches when both are remote", () => {
    const a = makeVacancy({
      id: 1,
      title: "Python Developer",
      text: "Python Developer. Remote. Salary: 3000-5000 USD"
    });
    const b = makeVacancy({
      id: 2,
      title: "Python Developer (remote)",
      text: "Python Developer (remote). Fully remote. Salary: 4000-6000 USD",
      messageDate: THREE_DAYS_LATER
    });
    const result = computeFuzzyMatch(a, b);
    assert.equal(result.isMatch, true, `Expected match but got score ${result.score}: ${result.reasons.join(", ")}`);
    assert.ok(result.score >= FUZZY_MATCH_THRESHOLD);
  });

  it("matches cross-post with repeated text and added boilerplate", () => {
    const base = "Senior Python Developer (Django, FastAPI)\nОпыт от 3 лет\nЗарплата: 5000-7000 USD\nУдаленно";
    const crossPost = "Senior Python Developer (Django, FastAPI)\nОпыт от 3 лет\nЗарплата: 5000-7000 USD\nУдаленно\n\nОткликнуться: https://t.me/bot\nПодробнее: https://example.com";
    const a = makeVacancy({
      id: 1,
      title: "Senior Python Developer (Django, FastAPI)",
      text: base,
      messageDate: SAME_DAY
    });
    const b = makeVacancy({
      id: 2,
      title: "Senior Python Developer (Django, FastAPI)",
      text: crossPost,
      messageDate: SAME_DAY
    });
    const result = computeFuzzyMatch(a, b);
    assert.equal(result.isMatch, true, `Expected match but got score ${result.score}: ${result.reasons.join(", ")}`);
    assert.ok(result.score >= FUZZY_MATCH_THRESHOLD);
  });

  it("does not match unrelated vacancies", () => {
    const a = makeVacancy({
      id: 1,
      title: "Требуется уборщица в офис",
      text: "Требуется уборщица в офис. Зарплата 50000 руб"
    });
    const b = makeVacancy({
      id: 2,
      title: "Senior Golang Developer (Kubernetes)",
      text: "Senior Golang Developer (Kubernetes). Remote"
    });
    const result = computeFuzzyMatch(a, b);
    assert.equal(result.isMatch, false);
  });

  it("scores above threshold for same role same company", () => {
    const a = makeVacancy({
      id: 1,
      title: "Python Developer в Яндекс",
      text: "Python Developer в Яндекс. Remote. Salary: 5000 USD"
    });
    const b = makeVacancy({
      id: 2,
      title: "Python Developer в Яндекс (Middle+)",
      text: "Python Developer в Яндекс. Удаленно. Зарплата: 5000 USD",
      messageDate: SAME_DAY
    });
    const result = computeFuzzyMatch(a, b);
    assert.equal(result.isMatch, true, `Expected match but got score ${result.score}: ${result.reasons.join(", ")}`);
    assert.ok(result.score >= FUZZY_MATCH_THRESHOLD);
  });

  it("rejects generic title only with no confirmatory signals", () => {
    const a = makeVacancy({
      id: 1,
      title: "Python Developer",
      text: "Python Developer"
    });
    const b = makeVacancy({
      id: 2,
      title: "Python Developer",
      text: "Python Developer",
      messageDate: SAME_DAY
    });
    const result = computeFuzzyMatch(a, b);
    assert.equal(result.isMatch, false, `Expected no match for title-only: score ${result.score}`);
    assert.ok(result.reasons.some((r) => r.includes("Title match") || r.includes("signal")));
  });

  it("rejects different professions at same company", () => {
    const a = makeVacancy({
      id: 1,
      title: "Java Developer в Яндекс",
      text: "Java Developer в Яндекс",
      messageDate: SAME_DAY
    });
    const b = makeVacancy({
      id: 2,
      title: "Python Developer в Яндекс",
      text: "Python Developer в Яндекс",
      messageDate: SAME_DAY
    });
    const result = computeFuzzyMatch(a, b);
    assert.equal(result.isMatch, false, `Should reject different roles at same company: score ${result.score}`);
  });

  it("rejects same-company vacancies with conflicting salary", () => {
    const a = makeVacancy({
      id: 1,
      title: "Java Developer в Яндекс",
      text: "Java Developer в Яндекс. Salary: 5000-7000 USD",
      messageDate: SAME_DAY
    });
    const b = makeVacancy({
      id: 2,
      title: "Python Developer в Яндекс",
      text: "Python Developer в Яндекс. Salary: 1000-2000 USD",
      messageDate: SAME_DAY
    });
    const result = computeFuzzyMatch(a, b);
    assert.equal(result.isMatch, false, `Should reject conflicting salary at same company: score ${result.score}`);
  });

  it("rejects same-company vacancies with different seniority", () => {
    const a = makeVacancy({
      id: 1,
      title: "Junior Python Developer в Яндекс",
      text: "Junior Python Developer в Яндекс",
      messageDate: SAME_DAY
    });
    const b = makeVacancy({
      id: 2,
      title: "Senior Python Developer в Яндекс",
      text: "Senior Python Developer в Яндекс",
      messageDate: SAME_DAY
    });
    const result = computeFuzzyMatch(a, b);
    assert.equal(result.isMatch, false, `Should reject different seniority at same company`);
  });
});
