import { normalizeForComparison, normalizeReadableText, normalizeWhitespace } from "../utils/text";

export type VacancyDetailConfidence = "explicit" | "inferred";
export type VacancyCardWarningCode =
  | "russia_not_allowed"
  | "remote_geo_restricted"
  | "conflicting_work_formats"
  | "unpaid";
export type VacancyCriticalUnknown = "salary" | "geography_or_russia" | "engagement";

export interface ExtractedVacancyDetail {
  value: string;
  confidence: VacancyDetailConfidence;
}

export interface ExtractedVacancyDetails {
  role?: ExtractedVacancyDetail;
  company?: ExtractedVacancyDetail;
  salary?: ExtractedVacancyDetail;
  grade?: ExtractedVacancyDetail;
  workFormat?: ExtractedVacancyDetail;
  geography?: ExtractedVacancyDetail;
  stack?: ExtractedVacancyDetail;
  employment?: ExtractedVacancyDetail;
  engagement?: ExtractedVacancyDetail;
  english?: ExtractedVacancyDetail;
  timeZone?: ExtractedVacancyDetail;
  russiaAccess?: ExtractedVacancyDetail;
}

export interface VacancyCardAnalysis {
  displayTitle: string;
  details: ExtractedVacancyDetails;
  reliableFactCount: number;
  warnings: VacancyCardWarningCode[];
  criticalUnknowns: VacancyCriticalUnknown[];
}

const MAX_DETAIL_LENGTH = 120;
const GENERIC_TITLES = new Set(["vacancy", "вакансия", "работа", "job", "jobs", "новая вакансия"]);
const GENERIC_HEADING_PATTERN =
  /^(?:что\s+(?:мы\s+)?предлагаем|требования|условия|обязанности|задачи|описание|description|requirements|responsibilities)\s*:?\s*$/iu;
const ROLE_SIGNALS =
  /\b(?:developer|engineer|designer|manager|analyst|specialist|lead|architect|artist|qa|devops|support|operator|marketer|buyer|smm|sales|legal|producer|director|chief|officer)\b|(?:редактор|разработчик|инженер|дизайнер|менеджер|аналитик|специалист|архитектор|художник|артист|оператор|маркетолог|байер|юрист|тестировщик|продюсер|директор|руководител)/iu;
const COMPANY_SUFFIX =
  /\b(?:llc|inc|ltd|corp|corporation|company|group|studio|agency|labs?|games?)\b|(?:ооо|оао|пао|зао|ип|банк|компания|студия|агентство)/iu;

const LABELS = {
  role: ["роль", "role", "позиция", "position", "должность", "вакансия"],
  company: ["компания", "о компании", "company", "employer", "работодатель"],
  salary: ["зарплата", "заработная плата", "зп", "salary", "вилка", "compensation", "оплата", "rate"],
  grade: ["грейд", "grade", "seniority", "уровень"],
  workFormat: ["формат работы", "work mode", "work format", "формат", "schedule", "график"],
  geography: ["география", "гео", "локация", "локация работы", "местоположение", "местоположение офиса", "location", "locations", "регион", "город"],
  stack: ["стек", "stack", "технологии", "technologies", "tech stack"],
  employment: ["занятость", "тип занятости", "employment", "job type", "тип"],
  engagement: ["оформление", "тип договора", "договор", "engagement", "contract type"],
  english: ["английский", "уровень английского", "english", "english level"],
  timeZone: ["таймзона", "часовой пояс", "timezone", "time zone", "working hours"],
  russiaAccess: ["работа из рф", "можно из рф", "рф", "russia"]
} satisfies Record<keyof ExtractedVacancyDetails, string[]>;

const STACK_SIGNALS = [
  "react", "react native", "typescript", "javascript", "next.js", "nextjs", "vue", "angular", "svelte",
  "node.js", "nodejs", "nestjs", "python", "django", "fastapi", "golang", "java", "spring", "kotlin",
  "swift", "flutter", "php", "laravel", "ruby", "rails", "c#", ".net", "unity", "unreal", "zbrush",
  "blender", "figma", "sql", "postgresql", "docker", "kubernetes", "aws"
];

const GRADE_SIGNALS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bintern(ship)?\b|стаж[её]р/iu, label: "Intern" },
  { pattern: /\bjunior\b|\bjun\b|джун/iu, label: "Junior" },
  { pattern: /\bmiddle\+\b|мидл\+/iu, label: "Middle+" },
  { pattern: /\bmiddle\b|мидл/iu, label: "Middle" },
  { pattern: /\bsenior\b|сеньор/iu, label: "Senior" },
  { pattern: /\blead\b|тимлид|team lead/iu, label: "Lead" }
];

const FORMAT_SIGNALS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bremote\b|удал[её]нн|удаленк|дистанцион/iu, label: "Remote" },
  { pattern: /\bhybrid\b|гибрид/iu, label: "Hybrid" },
  { pattern: /\bonsite\b|\bon-site\b|(?:^|[^\p{L}\p{N}])(?:офис|офисе|офисный|офисная|офисно)(?=$|[^\p{L}\p{N}])/iu, label: "Офис" }
];

const EMPLOYMENT_SIGNALS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bfull[- ]?time\b|фулл?тайм|полная занятость/iu, label: "Full-time" },
  { pattern: /\bpart[- ]?time\b|парттайм|частичная занятость|подработка/iu, label: "Part-time" },
  { pattern: /\binternship\b|стажировка/iu, label: "Internship" },
  { pattern: /\bfreelance\b|фриланс/iu, label: "Freelance" },
  { pattern: /\bproject-based\b|проектная работа|на проект/iu, label: "Project" }
];

const ENGAGEMENT_SIGNALS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /(?:^|[^\p{L}\p{N}])тк\s*рф(?=$|[^\p{L}\p{N}])|официальное (?:оформление|трудоустройство)/iu, label: "ТК РФ" },
  { pattern: /(?:^|[^\p{L}\p{N}])гпх(?=$|[^\p{L}\p{N}])|гражданско-?правов/iu, label: "ГПХ" },
  { pattern: /(?:^|[^\p{L}\p{N}])самозанят(?:ый|ая|ость|ого|ому)?(?=$|[^\p{L}\p{N}])/iu, label: "Самозанятость" },
  { pattern: /\b(?:b2b|contractor)\b/iu, label: "B2B" },
  { pattern: /(?:^|[^\p{L}\p{N}])ип(?=$|[^\p{L}\p{N}])|индивидуальн(?:ый|ого) предпринимател/iu, label: "ИП" }
];

const LOCATION_NAMES = [
  "Нижний Новгород", "Санкт-Петербург", "Москва", "СПб", "Казань", "Новосибирск", "Екатеринбург",
  "Алматы", "Астана", "Минск", "Беларусь", "Казахстан", "Республика Казахстан", "Армения", "Грузия",
  "Сербия", "Кипр", "Испания", "Европа", "Россия", "СНГ",
  "London", "Limassol", "Cyprus", "Serbia", "Belgrade", "Delhi", "Spain", "Europe", "EU"
];

function cleanValue(value: string): string {
  return normalizeWhitespace(value)
    .replace(/^[\s\-–—:|•]+/u, "")
    .replace(/[\s|•]+$/u, "")
    .slice(0, MAX_DETAIL_LENGTH)
    .trim();
}

function cleanTitleValue(value: string): string {
  return cleanValue(
    value
      .replace(/^[^\p{L}\p{N}]+/u, "")
      .replace(/^(?:ваканси[яи](?:\s+нет\s+на\s+hh)?|лучшее\s+на\s+hh)\s*:?\s*/iu, "")
      .replace(/[.!?]+$/u, "")
  );
}

function stripLeadingDecorators(value: string): string {
  return value.replace(/^[^\p{L}\p{N}]+/u, "").trimStart();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function uniqueValues(values: string[]): string[] {
  const unique = new Map<string, string>();
  for (const value of values.map(cleanValue).filter(Boolean)) {
    unique.set(normalizeForComparison(value), value);
  }
  return [...unique.values()];
}

function explicitField(lines: string[], labels: string[]): ExtractedVacancyDetail | undefined {
  const escapedLabels = labels.map(escapeRegExp);
  const pattern = new RegExp(`^(?:${escapedLabels.join("|")})\\s*[:—–-]\\s*(.+)$`, "iu");
  const values = uniqueValues(lines.map((line) => stripLeadingDecorators(line).match(pattern)?.[1] ?? "").filter(Boolean));
  return values.length === 1 ? { value: values[0]!, confidence: "explicit" } : undefined;
}

function singleInferred(values: string[]): ExtractedVacancyDetail | undefined {
  const unique = uniqueValues(values);
  return unique.length === 1 ? { value: unique[0]!, confidence: "inferred" } : undefined;
}

function isUsefulTitle(value: string): boolean {
  const normalized = normalizeForComparison(value);
  if (!normalized || GENERIC_TITLES.has(normalized) || /^https?:\/\//iu.test(value) || /^\[?ссылка\]?$/iu.test(normalized)) {
    return false;
  }
  if (
    GENERIC_HEADING_PATTERN.test(value)
    || /^#[^\s]+(?:\s+#[^\s]+)*$/u.test(value)
    || /^(?:вакансия|vacancy)#/iu.test(value)
    || (value.match(/#/gu)?.length ?? 0) >= 2
    || (!ROLE_SIGNALS.test(value) && value.split(/\s+/u).length > 8 && /[.!?]$/u.test(value))
  ) {
    return false;
  }
  return true;
}

function inferTitleFromText(lines: string[]): string | undefined {
  for (const line of lines) {
    const cleaned = cleanTitleValue(line);
    const match = cleaned.match(/ищ(?:ем|ет|ут)\s+(?:в\s+(?:свою\s+)?команду\s+)?(.{2,90})/iu);
    const candidate = cleanTitleValue((match?.[1] ?? "").replace(/^(?:сильн[\p{L}]*|опытн[\p{L}]*)\s+/iu, ""));
    if (candidate && isUsefulTitle(candidate) && ROLE_SIGNALS.test(candidate)) {
      return candidate;
    }
    if (
      isUsefulTitle(cleaned)
      && ROLE_SIGNALS.test(cleaned)
      && !COMPANY_SUFFIX.test(cleaned)
      && !/^(?:мы\s+)?ищ(?:ем|ет|ут)(?=$|[^\p{L}\p{N}])/iu.test(cleaned)
    ) {
      return cleaned;
    }
  }

  return lines
    .map(cleanTitleValue)
    .find((line) => isUsefulTitle(line) && ROLE_SIGNALS.test(line));
}

function splitTitleCompany(value: string): { role: string; company?: string } {
  const patterns = [
    /^(.*?)\s*,\s*(?:digital[-\s]?агентств[оа]|агентств[оа]|студи[яи]|компани[яи])\s+([\p{Lu}\d][\p{L}\p{N} .&_-]{1,50})$/u,
    /^(.*?)\s+в\s+(?:сеть\s+\p{L}+|компани[юи]|студи[юи]|агентств[оа])\s+([\p{Lu}\d][\p{L}\p{N} .&_-]{1,70}(?:\s*\([^)]{2,60}\))?)$/iu,
    /^(.*?)\s+(?:в|at)\s+([\p{L}\p{N}][\p{L}\p{N} .&_-]{1,70}(?:\s*\([^)]{2,60}\))?)$/iu,
    /^(.*?)\s+[—–-]\s+([\p{L}\p{N}][\p{L}\p{N} .&_-]{1,50})$/u
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    const role = cleanValue(match?.[1] ?? "");
    const company = cleanValue((match?.[2] ?? "").replace(/\s*\(([^)]{2,60})\)\s*$/u, (full, inner: string) =>
      isLocationOrWorkFormatSegment(inner) ? "" : full
    ));
    if (
      role
      && company
      && ROLE_SIGNALS.test(role)
      && !isBadCompanyCandidate(company)
      && (COMPANY_SUFFIX.test(company) || company.split(/\s+/u).length <= 4)
    ) {
      return { role, company };
    }
  }
  return { role: value };
}

function isBadCompanyCandidate(value: string): boolean {
  return /^(?:и|или|а|но|для|по|с|со|в|во|на)\s+/iu.test(value)
    || /^(?:лс|личку|директ|direct|telegram|телеграм|резюме|отклик|ссылка)$/iu.test(value)
    || /(?:рассматриваются\s+кандидаты|признан[аы]?\s+экстремист|запрещен[аы]?)/iu.test(value);
}

function inferCompany(text: string): ExtractedVacancyDetail | undefined {
  const values: string[] = [];
  for (const pattern of [
    /в\s+компани(?:ю|и)\s+["«]?([\p{L}\p{N}][\p{L}\p{N} .&_-]{1,50})/giu,
    /(?:digital[-\s]?агентств[оа]|агентств[оа]|студи[яи]|компани[яи])\s+["«]?([\p{Lu}\d][\p{L}\p{N} .&_-]{1,50})(?=[,.\n(«]|$)/giu,
    /([\p{L}\p{N}][\p{L}\p{N} .&_-]{1,50})\s+[—–-]\s+(?:digital[-\s]?агентств[оа]|агентств[оа]|студи[яи]|компани[яи])(?=[,.\n\s]|$)/giu,
    /\bat\s+([A-Z][A-Za-z0-9 .&_-]{1,40})(?=[,.\n]|$)/gu
  ]) {
    for (const match of text.matchAll(pattern)) {
      const value = match[1] ?? "";
      const context = text.slice(Math.max(0, match.index - 40), match.index + match[0].length + 40);
      if (isBadCompanyCandidate(value) || /принадлежит\s+компани|признан[аы]?\s+экстремист|запрещен[аы]?|рассматриваются\s+кандидаты/iu.test(context)) {
        continue;
      }
      values.push(value);
    }
  }
  return singleInferred(values);
}

function extractCompanyNameFromIntro(line: string): string | undefined {
  const patterns = [
    /^["«]?([\p{Lu}\d][\p{L}\p{N} .&_-]{1,50})\s+[—–-]\s+(?:это\b|популярн|международн|ведущ|digital|онлайн|сервис|платформ|продукт|компани|студи)/iu,
    /^(?:компани[яи]|студи[яи]|агентств[оа])\s+["«]?([\p{Lu}\d][\p{L}\p{N} .&_-]{1,50})(?=[,.\n(«]|$)/iu
  ];
  for (const pattern of patterns) {
    const value = cleanValue(line.match(pattern)?.[1] ?? "");
    if (value && !ROLE_SIGNALS.test(value) && value.split(/\s+/u).length <= 5) {
      return value;
    }
  }
  return undefined;
}

function inferCompanyFromSections(lines: string[]): ExtractedVacancyDetail | undefined {
  const values: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = stripLeadingDecorators(lines[index] ?? "").replace(/[:：]\s*$/u, "").trim();
    if (!/^(?:о\s+компании|компания|company)$/iu.test(line)) {
      continue;
    }

    for (const nextLine of lines.slice(index + 1, index + 4)) {
      const value = extractCompanyNameFromIntro(stripLeadingDecorators(nextLine));
      if (value) {
        values.push(value);
        break;
      }
    }
  }
  return singleInferred(values);
}

function inferShortCardCompany(lines: string[], titleCandidate: string | undefined): ExtractedVacancyDetail | undefined {
  const titleNormalized = normalizeForComparison(titleCandidate ?? "");
  const earlyLines = lines.slice(0, 6).map((line) => cleanValue(stripLeadingDecorators(line))).filter(Boolean);
  const salaryLineIndex = earlyLines.findIndex((line) => inferSalary(line));
  if (salaryLineIndex < 0) {
    return undefined;
  }

  const values = earlyLines.slice(salaryLineIndex + 1)
    .filter((line) =>
      !/^https?:\/\//iu.test(line)
      && normalizeForComparison(line) !== titleNormalized
      && line.length <= 80
      && !/[.!?]$/u.test(line)
      && !(ROLE_SIGNALS.test(line) && !COMPANY_SUFFIX.test(line))
      && !/(?:без\s+опыта|удал[её]н|гибрид|офис|full[- ]?time|part[- ]?time)/iu.test(line)
    );

  return singleInferred(values);
}

function inferSalary(text: string): ExtractedVacancyDetail | undefined {
  const values: string[] = [];
  const claimedRanges: Array<{ start: number; end: number }> = [];
  const salaryContext = /зарплат|заработн|зп\b|вилк|оплат|услови|salary|compensation|rate/iu.test(text);
  if (
    salaryContext
    && /(?:после\s+собеседования|по\s+договор[её]нности|обсужда(?:ется|емо|емая)|договорная|competitive\s+salary)/iu.test(text)
  ) {
    values.push("по договоренности");
  }

  const shortAmountPattern = /\d{2,4}\s?к(?:\s?(?:₽|руб\.?))?(?=$|[^\p{L}\p{N}])|\d{1,3}(?:[ .]\d{3})\s*(?:\/\s*мес|в месяц|за месяц)/giu;
  for (const match of text.matchAll(shortAmountPattern)) {
    const value = match[0];
    const context = text.slice(Math.max(0, match.index - 40), match.index + value.length + 40);
    if (/компенсац(?:ия|ии)\s+за\s+(?:интернет|связь|обед|питание|проезд)/iu.test(context)) {
      continue;
    }
    if (salaryContext) {
      values.push(value);
    }
  }

  const rangePattern =
    /(?:от|from)\s+\d[\d\s.,]*\s+(?:до|to)\s+\d[\d\s.,]*\s?(?:usd|eur|rub|руб(?:\.|лей|ля|ль)?|₽|\$|€)(?:\s*(?:gross|net|на руки|в месяц|\/\s*month|per month))?/giu;
  for (const match of text.matchAll(rangePattern)) {
    const value = match[0];
    const context = text.slice(Math.max(0, match.index - 40), match.index + value.length + 40);
    if (/компенсац(?:ия|ии)\s+за\s+(?:интернет|связь|обед|питание|проезд)/iu.test(context)) {
      continue;
    }
    values.push(value);
    claimedRanges.push({ start: match.index, end: match.index + value.length });
  }

  const pattern =
    /(?:[$€₽]\s?\d[\d\s.,]*(?:\s?[-–—]\s?[$€₽]?\s?\d[\d\s.,]*)?|\d[\d\s.,]*\s?(?:[-–—]\s?\d[\d\s.,]*\s?)?(?:usd|eur|rub|руб(?:\.|лей|ля|ль)?|₽|\$|€)(?:\s*(?:gross|net|на руки|в месяц|\/\s*month|per month))?)/giu;
  for (const match of text.matchAll(pattern)) {
    if (claimedRanges.some((range) => match.index >= range.start && match.index < range.end)) {
      continue;
    }
    const value = match[0];
    const before = text.slice(Math.max(0, match.index - 24), match.index);
    const context = text.slice(Math.max(0, match.index - 40), match.index + value.length + 40);
    const hasRange = /[-–—]/u.test(value);
    const hasPeriod = /gross|net|на руки|в месяц|month/iu.test(value);
    const hasAmountPrefix = /(?:^|[^\p{L}\p{N}])(?:от|до|from|up to)\s*$/iu.test(before);
    const hasCurrency = /(?:[$€₽]|usd|eur|rub|руб)/iu.test(value);
    if (/компенсац(?:ия|ии)\s+за\s+(?:интернет|связь|обед|питание|проезд)/iu.test(context)) {
      continue;
    }
    if (salaryContext || hasRange || hasPeriod || (hasCurrency && hasAmountPrefix)) {
      const prefix = cleanValue(before.match(/(?:^|[^\p{L}\p{N}])((?:от|до|from|up to)\s*)$/iu)?.[1] ?? "");
      values.push(prefix ? `${prefix} ${value}` : value);
    }
  }
  return singleInferred(values);
}

function inferFromSignals(
  normalizedText: string,
  signals: Array<{ pattern: RegExp; label: string }>
): ExtractedVacancyDetail | undefined {
  return singleInferred(signals.filter(({ pattern }) => pattern.test(normalizedText)).map(({ label }) => label));
}

function inferWorkFormat(normalizedText: string): ExtractedVacancyDetail | undefined {
  const hasRemote = FORMAT_SIGNALS[0]!.pattern.test(normalizedText);
  const hasHybrid = FORMAT_SIGNALS[1]!.pattern.test(normalizedText);
  const hasOffice = FORMAT_SIGNALS[2]!.pattern.test(normalizedText);
  if (hasRemote && hasHybrid && !hasOffice) {
    return { value: "Remote/Hybrid", confidence: "inferred" };
  }
  return singleInferred([
    hasRemote ? "Remote" : "",
    hasHybrid ? "Hybrid" : "",
    hasOffice ? "Офис" : ""
  ].filter(Boolean));
}

function locationPattern(name: string): RegExp {
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])(${escapeRegExp(name)})(?=$|[^\\p{L}\\p{N}])`, "iu");
}

function cleanLocationCandidate(value: string): string {
  return cleanValue(
    value
      .replace(/#/gu, " ")
      .replace(/\b(?:remote|hybrid|onsite|on-site)\b/giu, " ")
      .replace(/удал[её]нн\w*|удаленк\w*|гибрид\w*|офис\w*/giu, " ")
  );
}

function inferGeography(title: string, lines: string[]): ExtractedVacancyDetail | undefined {
  const values: string[] = [];
  const segments = [
    title,
    ...[...title.matchAll(/\(([^)]{2,60})\)/gu)].map((match) => match[1] ?? ""),
    ...title.split(/[|/]/u),
    ...lines.slice(0, 10),
    ...lines.slice(0, 10).flatMap((line) => line.split(/[|/]/u))
  ];

  for (const segment of segments.map((value) => cleanLocationCandidate(stripLeadingDecorators(value))).filter(Boolean)) {
    if (segment.length > 90) continue;
    for (const location of LOCATION_NAMES) {
      if (locationPattern(location).test(segment)) {
        values.push(location);
      }
    }
  }
  return singleInferred(values);
}

function isLocationOrWorkFormatSegment(value: string): boolean {
  const cleaned = cleanLocationCandidate(value);
  if (!cleaned) return false;
  const hasLocation = LOCATION_NAMES.some((location) => locationPattern(location).test(cleaned));
  const normalized = normalizeForComparison(cleaned);
  const workOnly = /^(?:remote|hybrid|onsite|on-site|удал[её]нн\w*|удаленк\w*|гибрид\w*|офис\w*)$/iu.test(normalized);
  return hasLocation || workOnly;
}

function removeLocationSegmentsFromTitle(value: string): string {
  if (!/[|]/u.test(value)) {
    return value;
  }
  const segments = value.split("|").map(cleanTitleValue).filter(Boolean);
  const roleSegments = segments.filter((segment) => !isLocationOrWorkFormatSegment(segment));
  return roleSegments.length > 0 ? roleSegments.join(" | ") : value;
}

function inferStack(normalizedText: string): ExtractedVacancyDetail | undefined {
  const matches = STACK_SIGNALS.filter((signal) =>
    new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRegExp(signal)}(?=$|[^\\p{L}\\p{N}])`, "iu").test(normalizedText)
  );
  return matches.length > 0
    ? { value: uniqueValues(matches).slice(0, 8).join(", "), confidence: "inferred" }
    : undefined;
}

function inferEnglish(text: string): ExtractedVacancyDetail | undefined {
  const explicitLevel = text.match(/(?:english|английск(?:ий|ого|им)?)(?:\s+\w+){0,4}\s+\b([abc][12])\b/iu)?.[1];
  if (explicitLevel) {
    return { value: `English ${explicitLevel.toUpperCase()}`, confidence: "inferred" };
  }
  return /\benglish\b|английск/iu.test(text) ? { value: "English", confidence: "inferred" } : undefined;
}

function inferTimeZone(text: string): ExtractedVacancyDetail | undefined {
  const matches = uniqueValues(
    [...text.matchAll(/(?:UTC|GMT|CET|EET|EST|PST)\s*[+-]?\d{1,2}(?:\s*[±+-]\s*\d+\s*час[аов]*)?|(?:^|[^\p{L}\p{N}])МСК(?:\s*[+-]\s*\d{1,2})?(?=$|[^\p{L}\p{N}])/giu)].map((match) => cleanValue(match[0]))
  );
  return matches.length === 1 ? { value: matches[0]!.toUpperCase(), confidence: "inferred" } : undefined;
}

function inferRussiaAccess(text: string): ExtractedVacancyDetail | undefined {
  if (/кроме\s+рф|не\s+из\s+рф|рф\s+не\s+рассматр|без\s+рф|не\s+росси|no\s+russia/iu.test(text)) {
    return { value: "Из РФ нельзя", confidence: "explicit" };
  }
  if (/можно\s+из\s+рф|работа\s+из\s+рф|удал[её]нно\s+(?:по|из|для)\s+рф|россия\s+разрешена/iu.test(text)) {
    return { value: "Можно из РФ", confidence: "explicit" };
  }
  return undefined;
}

export function extractVacancyDetails(title: string, text: string): ExtractedVacancyDetails {
  const readableText = normalizeReadableText(text);
  const lines = readableText.split("\n").map((line) => line.trim()).filter(Boolean);
  const combinedText = normalizeReadableText([title, readableText].filter(Boolean).join("\n"));
  const normalizedText = normalizeForComparison(combinedText);
  const explicitRole = explicitField(lines, LABELS.role);
  const explicitRoleValue = explicitRole ? cleanTitleValue(explicitRole.value) : "";
  const cleanedExplicitRole = explicitRole && isUsefulTitle(explicitRoleValue)
    ? { ...explicitRole, value: explicitRoleValue }
    : undefined;
  const cleanedTitle = cleanTitleValue(title);
  const textTitleCandidate = inferTitleFromText(lines);
  const rawTitleCandidate = cleanedExplicitRole?.value
    ?? (isUsefulTitle(cleanedTitle) && ROLE_SIGNALS.test(cleanedTitle) ? cleanedTitle : textTitleCandidate)
    ?? (isUsefulTitle(cleanedTitle) ? cleanedTitle : undefined);
  const titleCandidate = rawTitleCandidate ? removeLocationSegmentsFromTitle(rawTitleCandidate) : undefined;
  const splitTitle = titleCandidate ? splitTitleCompany(titleCandidate) : null;

  return {
    role: cleanedExplicitRole ?? (splitTitle?.role ? { value: splitTitle.role, confidence: "inferred" } : undefined),
    company: explicitField(lines, LABELS.company)
      ?? (splitTitle?.company ? { value: splitTitle.company, confidence: "inferred" } : undefined)
      ?? inferCompanyFromSections(lines)
      ?? inferShortCardCompany(lines, splitTitle?.role ?? titleCandidate)
      ?? inferCompany(combinedText),
    salary: explicitField(lines, LABELS.salary) ?? inferSalary(combinedText),
    grade: explicitField(lines, LABELS.grade) ?? inferFromSignals(normalizedText, GRADE_SIGNALS),
    workFormat: explicitField(lines, LABELS.workFormat) ?? inferWorkFormat(normalizedText),
    geography: explicitField(lines, LABELS.geography) ?? inferGeography(title, lines),
    stack: explicitField(lines, LABELS.stack) ?? inferStack(normalizedText),
    employment: explicitField(lines, LABELS.employment) ?? inferFromSignals(normalizedText, EMPLOYMENT_SIGNALS),
    engagement: explicitField(lines, LABELS.engagement) ?? inferFromSignals(normalizedText, ENGAGEMENT_SIGNALS),
    english: explicitField(lines, LABELS.english) ?? inferEnglish(combinedText),
    timeZone: explicitField(lines, LABELS.timeZone) ?? inferTimeZone(combinedText),
    russiaAccess: explicitField(lines, LABELS.russiaAccess) ?? inferRussiaAccess(combinedText)
  };
}

export function analyzeVacancyCard(title: string, text: string): VacancyCardAnalysis {
  const details = extractVacancyDetails(title, text);
  const normalizedText = normalizeForComparison([title, text].join("\n"));
  const warnings: VacancyCardWarningCode[] = [];
  const hasRemote = FORMAT_SIGNALS[0]!.pattern.test(normalizedText);
  const hasHybridOrOffice = FORMAT_SIGNALS.slice(1).some(({ pattern }) => pattern.test(normalizedText));
  const geographyValue = normalizeForComparison(details.geography?.value ?? "");
  const meaningfulExplicitGeography = Boolean(
    geographyValue
    && !/^(?:remote|удал[её]нно|anywhere|worldwide)(?:$|[.,])/iu.test(geographyValue)
    && !/оформлен/iu.test(geographyValue)
  );
  const geoRestricted =
    /только\s+(?:из|для)|кроме\s+\p{L}+|гражданств|удал[её]нно\s+(?:по|из|для)\s+\p{L}+/iu.test(normalizedText)
    || meaningfulExplicitGeography;

  if (details.russiaAccess?.value === "Из РФ нельзя") {
    warnings.push("russia_not_allowed");
  }
  if (hasRemote && geoRestricted) {
    warnings.push("remote_geo_restricted");
  }
  if (hasRemote && hasHybridOrOffice) {
    warnings.push("conflicting_work_formats");
  }
  if (/без\s+оплат|неоплачиваем|unpaid/iu.test(normalizedText)) {
    warnings.push("unpaid");
  }

  const reliableFactCount = Object.entries(details)
    .filter(([key, detail]) => key !== "role" && Boolean(detail))
    .length;
  const criticalUnknowns: VacancyCriticalUnknown[] = [];
  if (!details.salary) criticalUnknowns.push("salary");
  if (!details.geography && !details.russiaAccess) criticalUnknowns.push("geography_or_russia");
  if (!details.engagement) criticalUnknowns.push("engagement");

  return {
    displayTitle: details.role?.value ?? (cleanTitleValue(title) || "Без названия"),
    details,
    reliableFactCount,
    warnings,
    criticalUnknowns
  };
}
