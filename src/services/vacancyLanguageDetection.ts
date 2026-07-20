import { DetectedVacancyLanguage, VacancyLanguageMode } from "../types";
import { normalizeForComparison } from "../utils/text";

const ENGLISH_CONTEXT_WORDS = new Set([
  "remote",
  "onsite",
  "hybrid",
  "developer",
  "engineer",
  "designer",
  "manager",
  "product",
  "experience",
  "role",
  "team",
  "hiring",
  "position",
  "opportunity",
  "fulltime",
  "full-time",
  "parttime",
  "part-time",
  "contract",
  "salary",
  "english"
]);

export interface VacancyLanguageDetectionResult {
  language: DetectedVacancyLanguage;
  russianTokenCount: number;
  englishTokenCount: number;
}

function collectRussianTokens(text: string): string[] {
  return text.match(/[\p{sc=Cyrillic}]{2,}/gu) ?? [];
}

function collectEnglishTokens(text: string): string[] {
  return text.match(/[a-z][a-z0-9+#.-]{2,}/g) ?? [];
}

export function detectVacancyLanguage(text: string): VacancyLanguageDetectionResult {
  const normalized = normalizeForComparison(text);
  if (!normalized) {
    return {
      language: "unknown",
      russianTokenCount: 0,
      englishTokenCount: 0
    };
  }

  const russianTokens = collectRussianTokens(normalized);
  const englishTokens = collectEnglishTokens(normalized);
  const englishContextMatches = englishTokens.filter((token) => ENGLISH_CONTEXT_WORDS.has(token));

  const hasRussian = russianTokens.length > 0;
  const hasEnglish = englishContextMatches.length > 0 || englishTokens.length >= 5;

  let language: DetectedVacancyLanguage = "unknown";
  if (hasRussian && hasEnglish) {
    language = "mixed";
  } else if (hasRussian) {
    language = "russian";
  } else if (hasEnglish) {
    language = "english";
  }

  return {
    language,
    russianTokenCount: russianTokens.length,
    englishTokenCount: englishTokens.length
  };
}

export function matchesVacancyLanguageMode(
  language: DetectedVacancyLanguage,
  mode: VacancyLanguageMode
): boolean {
  if (mode === "ru_en") {
    return true;
  }

  if (mode === "ru_only") {
    return language === "russian" || language === "mixed";
  }

  return language === "english";
}
