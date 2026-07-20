import { normalizeForComparison, normalizeReadableText } from "../utils/text";

export interface CandidatePostDetectionResult {
  isCandidatePost: boolean;
  reasons: string[];
  summary: string | null;
}

const STRONG_HEADING_KEYWORDS = [
  "\u0440\u0435\u0437\u044e\u043c\u0435",
  "resume",
  "cv"
];

const STRONG_PHRASES = [
  "open to work",
  "\u0438\u0449\u0443 \u0440\u0430\u0431\u043e\u0442\u0443",
  "\u0438\u0449\u0443 \u043d\u043e\u0432\u0443\u044e \u0440\u0430\u0431\u043e\u0442\u0443",
  "\u0438\u0449\u0443 \u043f\u043e\u0437\u0438\u0446\u0438\u044e",
  "\u0438\u0449\u0443 \u043f\u0440\u043e\u0435\u043a\u0442",
  "\u0438\u0449\u0443 \u0432\u0430\u043a\u0430\u043d\u0441\u0438\u044e",
  "\u0438\u0449\u0443 \u043a\u043e\u043c\u0430\u043d\u0434\u0443"
];

const WEAK_PHRASES = [
  "\u043e\u0431\u043e \u043c\u043d\u0435",
  "\u043c\u043e\u0439 \u0441\u0442\u0435\u043a",
  "\u043c\u043e\u0439 \u043e\u043f\u044b\u0442",
  "\u0440\u0430\u0441\u0441\u043c\u0430\u0442\u0440\u0438\u0432\u0430\u044e \u043f\u0440\u0435\u0434\u043b\u043e\u0436\u0435\u043d\u0438\u044f",
  "\u0433\u043e\u0442\u043e\u0432 \u043a \u043f\u0440\u0435\u0434\u043b\u043e\u0436\u0435\u043d\u0438\u044f\u043c",
  "\u0433\u043e\u0442\u043e\u0432 \u0440\u0430\u0441\u0441\u043c\u043e\u0442\u0440\u0435\u0442\u044c \u043f\u0440\u0435\u0434\u043b\u043e\u0436\u0435\u043d\u0438\u044f",
  "\u0433\u043e\u0442\u043e\u0432 \u043a \u0441\u043e\u0442\u0440\u0443\u0434\u043d\u0438\u0447\u0435\u0441\u0442\u0432\u0443",
  "\u0438\u0449\u0443 \u0432\u043e\u0437\u043c\u043e\u0436\u043d\u043e\u0441\u0442\u0438",
  "\u0438\u0449\u0443 \u0444\u0443\u043b\u043b\u0442\u0430\u0439\u043c",
  "\u0438\u0449\u0443 part-time",
  "\u0438\u0449\u0443 \u043f\u0430\u0440\u0442-\u0442\u0430\u0439\u043c"
];

const VACANCY_GUARD_PHRASES = [
  "\u0438\u0449\u0435\u043c",
  "\u043c\u044b \u0438\u0449\u0435\u043c",
  "\u0442\u0440\u0435\u0431\u0443\u0435\u0442\u0441\u044f",
  "\u0432\u0430\u043a\u0430\u043d\u0441\u0438\u044f",
  "\u0432\u0430\u043a\u0430\u043d\u0441\u0438\u0438",
  "\u043a\u043e\u043c\u043f\u0430\u043d\u0438\u044f",
  "\u043e\u0431\u044f\u0437\u0430\u043d\u043d\u043e\u0441\u0442\u0438",
  "\u0442\u0440\u0435\u0431\u043e\u0432\u0430\u043d\u0438\u044f",
  "\u0443\u0441\u043b\u043e\u0432\u0438\u044f",
  "\u043e\u0442\u043a\u043b\u0438\u043a",
  "\u043f\u0440\u0438\u0441\u044b\u043b\u0430\u0439\u0442\u0435 \u0440\u0435\u0437\u044e\u043c\u0435",
  "\u043c\u044b \u043f\u0440\u0435\u0434\u043b\u0430\u0433\u0430\u0435\u043c",
  "\u043d\u0430\u043c \u043d\u0443\u0436\u0435\u043d",
  "\u043d\u0430\u043c \u043d\u0443\u0436\u043d\u0430",
  "hiring",
  "we are hiring",
  "we're hiring",
  "requirements",
  "responsibilities",
  "company",
  "apply",
  "send your cv",
  "we offer",
  "job description"
];

const ACHIEVEMENT_PHRASE_PATTERNS = [
  /оптимизировал[аи]?/u,
  /разработал[аи]?/u,
  /внедрил[аи]?/u,
  /снизил[аи]?/u,
  /увеличил[аи]?/u,
  /улучшил[аи]?/u,
  /создал[аи]?/u,
  /реализовал[аи]?/u,
  /настроил[аи]?/u,
  /переписал[аи]?/u,
  /руководил[аи]?/u,
  /провел[аи]?/u,
  /проводил[аи]?/u,
  /вел[аи]?/u,
  /менторил[аи]?/u,
  /вносил[аи]? вклад/u,
  /внес(ла)? вклад/u,
  /\bbuilt\b/u,
  /\bimplemented\b/u,
  /\boptimized\b/u,
  /\breduced\b/u,
  /\bincreased\b/u,
  /\bimproved\b/u,
  /\bmentored\b/u,
  /\bdeveloped\b/u,
  /\bcreated\b/u,
  /\bmigrated\b/u,
  /\brefactored\b/u,
  /\bled\b/u,
  /\bshipped\b/u
];

const METRIC_PATTERNS = [
  /\d+\s*%/u,
  /(?:^|[^\d])\d+\+/u,
  /\b\d+\s*[xх]\b/u,
  /\bс\s+\S+\s+до\s+\S+/u,
  /\bfrom\s+\S+\s+to\s+\S+/u
];

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function collectPhraseHits(text: string, phrases: string[]): string[] {
  return phrases.filter((phrase) => text.includes(phrase));
}

function collectLeadingWordTokens(value: string, limit = 3): string[] {
  const matches = value.match(/[\p{L}][\p{L}\p{N}+.#-]*/gu) ?? [];
  return matches.slice(0, limit).map((token) => token.toLowerCase());
}

function isBulletLikeLine(value: string): boolean {
  return /^[\s>*•\-–—⭐✅🔥📌]+/u.test(value);
}

function hasAchievementPhrase(value: string): boolean {
  return ACHIEVEMENT_PHRASE_PATTERNS.some((pattern) => pattern.test(value));
}

function hasMetric(value: string): boolean {
  return METRIC_PATTERNS.some((pattern) => pattern.test(value));
}

function collectBalancedCandidateReasons(readableText: string, normalized: string): string[] {
  const vacancyGuardHits = collectPhraseHits(normalized, VACANCY_GUARD_PHRASES);
  if (vacancyGuardHits.length > 0) {
    return [];
  }

  const lines = readableText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const normalizedLines = lines.map((line) => normalizeForComparison(line));
  const achievementLines = normalizedLines.filter(hasAchievementPhrase);
  const metricLines = normalizedLines.filter((line, index) =>
    hasMetric(line) && (hasAchievementPhrase(line) || isBulletLikeLine(lines[index] ?? ""))
  );
  const bulletAchievementLines = normalizedLines.filter((line, index) =>
    isBulletLikeLine(lines[index] ?? "") && hasAchievementPhrase(line)
  );
  const reasons: string[] = [];

  if (achievementLines.length >= 2) {
    reasons.push("achievement_phrases");
  }

  if (metricLines.length >= 1) {
    reasons.push("achievement_metrics");
  }

  if (bulletAchievementLines.length >= 2 || achievementLines.length >= 3) {
    reasons.push("self_promo_structure");
  }

  return reasons.length >= 2 ? reasons : [];
}

export function detectCandidatePost(text: string): CandidatePostDetectionResult {
  const readableText = normalizeReadableText(text);
  const normalized = normalizeForComparison(text);
  const firstLine = readableText.split("\n").map((line) => line.trim()).find(Boolean) ?? "";
  const leadingWordTokens = collectLeadingWordTokens(firstLine);

  const strongHeadingHit = STRONG_HEADING_KEYWORDS.find((keyword) => leadingWordTokens.includes(keyword));
  if (strongHeadingHit) {
    return {
      isCandidatePost: true,
      reasons: [strongHeadingHit || "\u0440\u0435\u0437\u044e\u043c\u0435"],
      summary: "Filtered as a candidate/resume post."
    };
  }

  const strongPhraseHits = collectPhraseHits(normalized, STRONG_PHRASES);
  if (strongPhraseHits.length > 0) {
    return {
      isCandidatePost: true,
      reasons: unique(strongPhraseHits),
      summary: "Filtered as a candidate/resume post."
    };
  }

  const weakPhraseHits = collectPhraseHits(normalized, WEAK_PHRASES);
  if (weakPhraseHits.length >= 2) {
    return {
      isCandidatePost: true,
      reasons: unique(weakPhraseHits),
      summary: "Filtered as a candidate/resume post."
    };
  }

  const balancedCandidateReasons = collectBalancedCandidateReasons(readableText, normalized);
  if (balancedCandidateReasons.length >= 2) {
    return {
      isCandidatePost: true,
      reasons: balancedCandidateReasons,
      summary: "Filtered as a candidate/resume post."
    };
  }

  return {
    isCandidatePost: false,
    reasons: [],
    summary: null
  };
}
