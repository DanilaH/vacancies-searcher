import { normalizeWhitespace } from "../utils/text";

export const KEYWORD_MAX_LENGTH = 64;
export const KEYWORD_MAX_COUNT = 50;

function normalizeYo(value: string): string {
  return value.replace(/ё/gi, (match) => (match === "Ё" ? "Е" : "е"));
}

export function normalizeKeywordInput(value: string): string {
  return normalizeYo(normalizeWhitespace(value)).toLowerCase();
}

export type KeywordValidationResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

export function validateKeywordInput(rawValue: string, existingCount: number): KeywordValidationResult {
  const normalizedValue = normalizeKeywordInput(rawValue);

  if (!normalizedValue) {
    return {
      ok: false,
      error: "Ключевое слово не может быть пустым."
    };
  }

  if (normalizedValue.length > KEYWORD_MAX_LENGTH) {
    return {
      ok: false,
      error: `Ключевое слово слишком длинное. Максимум ${KEYWORD_MAX_LENGTH} символа(ов).`
    };
  }

  if (existingCount >= KEYWORD_MAX_COUNT) {
    return {
      ok: false,
      error: `Достигнут лимит личных ключевых слов: ${KEYWORD_MAX_COUNT}.`
    };
  }

  return {
    ok: true,
    value: normalizedValue
  };
}
