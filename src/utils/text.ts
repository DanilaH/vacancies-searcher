import crypto from "node:crypto";

function replaceYo(value: string): string {
  return value.replace(/ё/gi, (match) => (match === "Ё" ? "Е" : "е"));
}

export function normalizeWhitespace(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/[^\S\r\n]+/g, " ").trim();
}

export function normalizeLineBreaks(value: string): string {
  return value.replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ");
}

export function normalizeReadableText(value: string): string {
  const normalized = normalizeLineBreaks(value)
    .split("\n")
    .map((line) => normalizeWhitespace(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return normalized;
}

export function normalizeForComparison(value: string): string {
  const lowered = replaceYo(normalizeLineBreaks(value)).toLowerCase();
  const withoutLinks = lowered
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\bt\.me\/\S+/gi, " ");
  const withoutMentions = withoutLinks.replace(/@\w+/g, " ");

  return normalizeWhitespace(withoutMentions);
}

function isTrailingCrossPostBoilerplate(line: string): boolean {
  const normalized = normalizeForComparison(line);
  if (!normalized || !/[\p{L}\p{N}]/u.test(normalized)) {
    return true;
  }

  if (/^(?:откликнуться|отклик|подробнее|перейти к вакансии|apply|apply now|respond)(?:\s*[():\-–—|].*)?$/iu.test(normalized)) {
    return true;
  }

  if (/(?:job|jobs|work|vacanc(?:y|ies)).{0,24}(?:in\s+)?telegram.{0,24}(?:in\s+)?vk.{0,24}(?:in\s+)?max/iu.test(normalized)) {
    return true;
  }

  return /(?:job|jobs|работа|вакансии?).{0,24}в\s*telegram.{0,24}в\s*vk.{0,24}в\s*max/iu.test(normalized);
}

export function normalizeForFingerprint(value: string): string {
  const lines = normalizeReadableText(value)
    .split("\n")
    .map((line) => line.trim());

  while (lines.length > 0 && isTrailingCrossPostBoilerplate(lines.at(-1) ?? "")) {
    lines.pop();
  }

  return normalizeForComparison(lines.join("\n"));
}

export function createFingerprint(value: string): string {
  return crypto.createHash("sha256").update(normalizeForFingerprint(value)).digest("hex");
}

export function extractTitle(value: string, maxLength = 90): string {
  const firstMeaningfulLine =
    normalizeReadableText(value)
      .split("\n")
      .map((line) => normalizeWhitespace(line))
      .find((line) => line.length > 0) ?? "Vacancy";

  return shorten(firstMeaningfulLine, maxLength);
}

export function shorten(value: string, maxLength: number): string {
  const codePoints = Array.from(value);
  if (codePoints.length <= maxLength) {
    return value;
  }

  return `${codePoints.slice(0, Math.max(0, maxLength - 3)).join("").trimEnd()}...`;
}
