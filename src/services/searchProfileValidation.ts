import { SearchProfileSectionKey } from "../types";
import { normalizeForComparison } from "../utils/text";

const MAX_KEYWORDS_PER_SECTION = 20;
const MAX_KEYWORD_LENGTH = 60;
const CLEAR_TOKENS = new Set(["-", "clear", "none", "нет", "пусто"]);

function sectionLabel(section: SearchProfileSectionKey): string {
  switch (section) {
    case "required_context":
      return "блока «Условия и формат»";
    case "required_primary":
      return "блока «Основной профиль»";
    case "preferred":
      return "желательных слов";
    case "exclude":
      return "стоп-слов";
  }
}

export function validateSearchProfileKeywordsInput(
  section: SearchProfileSectionKey,
  rawInput: string
): { ok: true; keywords: string[] } | { ok: false; error: string } {
  const trimmed = rawInput.trim();

  if (!trimmed) {
    return {
      ok: false,
      error: `⚠️ Для ${sectionLabel(section)} пришли список слов через запятую. Чтобы очистить блок, отправь один символ: -`
    };
  }

  const normalizedWhole = normalizeForComparison(trimmed);
  if (CLEAR_TOKENS.has(normalizedWhole)) {
    return {
      ok: true,
      keywords: []
    };
  }

  const parts = trimmed
    .split(/[\n,;]+/u)
    .map((part) => normalizeForComparison(part))
    .filter(Boolean);

  if (parts.length === 0) {
    return {
      ok: false,
      error: `⚠️ Не удалось распознать слова для ${sectionLabel(section)}.`
    };
  }

  const uniqueKeywords = [...new Set(parts)];

  if (uniqueKeywords.length > MAX_KEYWORDS_PER_SECTION) {
    return {
      ok: false,
      error: `⚠️ Слишком много слов. Для одного блока можно сохранить не больше ${MAX_KEYWORDS_PER_SECTION}.`
    };
  }

  const tooLongKeyword = uniqueKeywords.find((keyword) => keyword.length > MAX_KEYWORD_LENGTH);
  if (tooLongKeyword) {
    return {
      ok: false,
      error: `⚠️ Слово «${tooLongKeyword.slice(0, 20)}...» слишком длинное. Ограничение: ${MAX_KEYWORD_LENGTH} символов.`
    };
  }

  return {
    ok: true,
    keywords: uniqueKeywords
  };
}
