import test from "node:test";
import assert from "node:assert/strict";

import { detectCandidatePost } from "../src/services/candidatePostDetection";

test("detectCandidatePost blocks resume headings", () => {
  const result = detectCandidatePost("Резюме Senior Frontend Developer\nУдаленно");

  assert.equal(result.isCandidatePost, true);
  assert.match(result.summary ?? "", /candidate\/resume post/i);
});

test("detectCandidatePost blocks resume headings with emoji prefix", () => {
  const result = detectCandidatePost("🔥 Resume Senior Full Stack Developer\nУдалённо\nReact, Vue.js");

  assert.equal(result.isCandidatePost, true);
  assert.match(result.summary ?? "", /candidate\/resume post/i);
});

test("detectCandidatePost blocks strong self-promo phrases", () => {
  const result = detectCandidatePost("Senior Frontend Developer\nИщу работу, открыт к предложениям");

  assert.equal(result.isCandidatePost, true);
});

test("detectCandidatePost ignores ordinary vacancy posts", () => {
  const result = detectCandidatePost("Senior React Engineer\nRemote\nНужен опыт с TypeScript и Next.js");

  assert.equal(result.isCandidatePost, false);
});

test("detectCandidatePost blocks achievement-style resume cards without resume heading", () => {
  const result = detectCandidatePost(
    [
      "🔥 Senior Frontend Developer от 340 000₽, удаленно, г. Москва, фуллтайм и проектная",
      "⭐ Оптимизировал рендеринг списков товаров через виртуализацию: время отрисовки страницы сократилось на 43%, CPU улучшился на 56%",
      "⭐ Вносил вклад в Feature-Sliced Design, Svelte 5 и документацию Effector.",
      "⭐ Вел архитектурные решения для micro-frontend модулей в сценариях поиска товаров."
    ].join("\n")
  );

  assert.equal(result.isCandidatePost, true);
  assert.ok(result.reasons.includes("achievement_phrases"));
  assert.ok(result.reasons.includes("achievement_metrics"));
});

test("detectCandidatePost blocks english achievement-style candidate cards", () => {
  const result = detectCandidatePost(
    [
      "Senior Frontend Developer, remote",
      "⭐ Built design system components used by 50+ developers",
      "⭐ Optimized rendering and reduced page load by 43%",
      "⭐ Mentored 5 junior engineers"
    ].join("\n")
  );

  assert.equal(result.isCandidatePost, true);
});

test("detectCandidatePost keeps real vacancies with hiring guards even if achievements are mentioned", () => {
  const result = detectCandidatePost(
    [
      "Ищем Senior Frontend Developer",
      "Компания: Acme",
      "Обязанности: развивать интерфейс и улучшать производительность.",
      "Требования: React, TypeScript, опыт оптимизации рендеринга на 40% будет плюсом.",
      "Условия: удаленно, фуллтайм."
    ].join("\n")
  );

  assert.equal(result.isCandidatePost, false);
});

test("detectCandidatePost keeps concise vacancies without self-promo structure", () => {
  const result = detectCandidatePost(
    "Senior Frontend Developer от 340 000₽\nУдаленно, Москва\nReact, TypeScript, frontend"
  );

  assert.equal(result.isCandidatePost, false);
});
