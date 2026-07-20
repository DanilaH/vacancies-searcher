import { AppConfig } from "../config";
import { FilterResult, UserSearchProfile, VacancyLanguageMode } from "../types";
import { normalizeForComparison } from "../utils/text";
import { detectCandidatePost } from "./candidatePostDetection";
import { detectVacancyLanguage, matchesVacancyLanguageMode } from "./vacancyLanguageDetection";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsKeyword(haystack: string, keyword: string): boolean {
  const normalizedKeyword = normalizeForComparison(keyword);
  if (!normalizedKeyword) {
    return false;
  }

  if (/^[\p{L}\p{N}]+$/u.test(normalizedKeyword)) {
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(normalizedKeyword)}($|[^\\p{L}\\p{N}])`, "iu");
    return pattern.test(haystack);
  }

  if (/^[\p{L}\p{N}+.-]+$/u.test(normalizedKeyword)) {
    const pattern = new RegExp(
      `(^|[^\\p{L}\\p{N}+.-])${escapeRegExp(normalizedKeyword)}($|[^\\p{L}\\p{N}+.-])`,
      "iu"
    );

    return pattern.test(haystack);
  }

  return haystack.includes(normalizedKeyword);
}

function collectHits(text: string, keywords: string[]): string[] {
  return keywords.filter((keyword) => containsKeyword(text, keyword));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export class VacancyFilter {
  constructor(private readonly _config: AppConfig) {}

  evaluateBaseCandidate(text: string): FilterResult {
    const candidatePost = detectCandidatePost(text);
    if (candidatePost.isCandidatePost) {
      return {
        matches: false,
        score: 0,
        matchedKeywords: [],
        blockedBy: candidatePost.reasons,
        summary: candidatePost.summary ?? "Filtered as a candidate/resume post.",
        rejectionReasons: ["candidate_post"]
      };
    }

    return {
      matches: true,
      score: 0,
      matchedKeywords: [],
      blockedBy: [],
      summary: "Stored as a vacancy candidate for per-user matching."
    };
  }

  evaluateForProfile(text: string, profile: UserSearchProfile, vacancyLanguageMode: VacancyLanguageMode = "ru_en"): FilterResult {
    const candidatePost = detectCandidatePost(text);
    if (candidatePost.isCandidatePost) {
      return {
        matches: false,
        score: 0,
        matchedKeywords: [],
        blockedBy: candidatePost.reasons,
        summary: candidatePost.summary ?? "Filtered as a candidate/resume post.",
        rejectionReasons: ["candidate_post"]
      };
    }

    const detectedLanguage = detectVacancyLanguage(text);
    if (!matchesVacancyLanguageMode(detectedLanguage.language, vacancyLanguageMode)) {
      return {
        matches: false,
        score: 0,
        matchedKeywords: [],
        blockedBy: [],
        summary: `Filtered by vacancy language mode: ${vacancyLanguageMode} (${detectedLanguage.language}).`,
        rejectionReasons: ["language"]
      };
    }

    const normalized = normalizeForComparison(text);

    const contextHits = collectHits(normalized, profile.requiredContextKeywords);
    const primaryHits = collectHits(normalized, profile.requiredPrimaryKeywords);
    const preferredHits = collectHits(normalized, profile.preferredKeywords);
    const excludeHits = unique(collectHits(normalized, profile.excludeKeywords));

    if (excludeHits.length > 0) {
      return {
        matches: false,
        score: 0,
        matchedKeywords: [],
        blockedBy: excludeHits,
        summary: `Filtered by stop-words: ${excludeHits.join(", ")}`,
        rejectionReasons: ["stop_words"]
      };
    }

    const missingSignals: string[] = [];
    if (profile.requiredContextKeywords.length > 0 && contextHits.length === 0) {
      missingSignals.push("условия");
    }
    if (profile.requiredPrimaryKeywords.length > 0 && primaryHits.length === 0) {
      missingSignals.push("основной профиль");
    }

    const matchedKeywords = unique([...contextHits, ...primaryHits, ...preferredHits]);

    if (missingSignals.length > 0) {
      return {
        matches: false,
        score: 0,
        matchedKeywords,
        blockedBy: [],
        summary: `Missing required profile signals: ${missingSignals.join(", ")}`,
        rejectionReasons: [
          ...(profile.requiredContextKeywords.length > 0 && contextHits.length === 0 ? ["missing_context" as const] : []),
          ...(profile.requiredPrimaryKeywords.length > 0 && primaryHits.length === 0 ? ["missing_primary" as const] : [])
        ]
      };
    }

    const hasAnyActiveProfileSignals =
      profile.requiredContextKeywords.length > 0 ||
      profile.requiredPrimaryKeywords.length > 0 ||
      profile.preferredKeywords.length > 0;

    if (!hasAnyActiveProfileSignals) {
      return {
        matches: false,
        score: 0,
        matchedKeywords: [],
        blockedBy: [],
        summary: "Search profile is empty.",
        rejectionReasons: ["preferred_signals"]
      };
    }

    if (
      profile.requiredContextKeywords.length === 0 &&
      profile.requiredPrimaryKeywords.length === 0 &&
      preferredHits.length === 0
    ) {
      return {
        matches: false,
        score: 0,
        matchedKeywords: [],
        blockedBy: [],
        summary: "No preferred profile signals matched.",
        rejectionReasons: ["preferred_signals"]
      };
    }

    const reasons: string[] = [];
    let score = 50;

    if (contextHits.length > 0) {
      reasons.push(`conditions: ${contextHits.join(", ")}`);
      score += 20;
    }

    if (primaryHits.length > 0) {
      reasons.push(`primary: ${primaryHits.join(", ")}`);
      score += 20;
    }

    if (preferredHits.length > 0) {
      reasons.push(`preferred: ${preferredHits.join(", ")}`);
      score += Math.min(10, preferredHits.length * 5);
    }

    return {
      matches: true,
      score,
      matchedKeywords,
      blockedBy: [],
      summary: reasons.length > 0 ? reasons.join("; ") : "Matched preferred profile signals."
    };
  }
}
