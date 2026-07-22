import { VacancyRecord } from "../types";

export const FUZZY_MATCH_THRESHOLD = 0.35;

export interface FuzzyMatchResult {
  score: number;
  isMatch: boolean;
  reasons: string[];
}

interface ExtractedFeatures {
  company: string | null;
  seniorityLabel: string | null;
  isRemote: boolean | null;
  location: string | null;
  cleanTitle: string;
  hasSalary: boolean;
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string | null;
}

const SENIORITY_PATTERNS: { label: string; patterns: RegExp[] }[] = [
  { label: "intern", patterns: [/intern/ui, /стаж[её]р/ui, /практик/ui] },
  { label: "junior", patterns: [/junior/ui, /j[аa]ni[oо]r/ui, /младш/ui, /jun/ui] },
  { label: "middle", patterns: [/middle/ui, /mid\b/ui] },
  { label: "senior", patterns: [/senior/ui, /sen\b/ui, /старш/ui, /ведущ/ui] },
  { label: "lead", patterns: [/lead/ui, /team.?lead/ui, /тим.?лид/ui, /head\b/ui, /director/ui, /руководител/ui, /лид/ui] }
];

const REMOTE_PATTERNS = [
  /remote/ui, /удален/ui, /wfh\b/ui, /home.?office/ui, /work.?from.?home/ui,
  /дистанцион/ui, /ремоут/ui, /фулри?мут/ui
];

const OFFICE_PATTERNS = [
  /office/ui, /офис/ui, /hybrid/ui, /гибрид/ui, /from.?office/ui
];

const COMPANY_PREFIX_PATTERNS = [
  /(?:компания|company|работодатель)\s*[:|]\s*([^\n,.!?]{2,50})/iu,
  /(?:в|у|для|к)\s+([А-ЯA-Z][а-яa-zё]{2,30}(?:[-\t ][А-ЯA-Z][а-яa-zё]{2,30})?)/u
];

const LOCATION_CITIES = [
  "moscow", "москв", "санкт-петербург", "spb", "питер", "saint petersburg",
  "казан", "новосибирск", "екатеринбург", "нижний новгород", "самара",
  "omsk", "омск", "краснодар", "ростов", "уфа", "владивосток", "habarovsk"
];

const SALARY_PATTERNS = [
  /(?:от\s*)?(\d{3,})\s*(?:до\s*(\d{3,}))?\s*(₽|руб|\$|usd|eur|€|k|тыс)/iu,
  /(?:from\s*)?(\d{3,})\s*(?:to\s*(\d{3,}))?\s*(₽|rub|usd|eur|€|k)/iu,
  /(\d{3,})\s*(?:-|–|—)\s*(\d{3,})\s*(₽|руб|\$|usd|eur|€|k|тыс)/iu
];

const EXCLUDE_TITLE_WORDS = new Set([
  "вакансия", "vacancy", "work", "job", "работа", "на работу",
  "требуется", "требуются", "нужен", "нужна", "нужны", "ищем",
  "открыта", "открыт", "открыты", "в компанию", "в команду",
  "hiring", "we are looking", "looking for", "join us",
  "прямой работодатель", "без посредников", "прямой эфир"
]);

function extractSeniority(text: string): string | null {
  const lower = text.toLowerCase();
  const found: string[] = [];
  for (const entry of SENIORITY_PATTERNS) {
    for (const pattern of entry.patterns) {
      if (pattern.test(lower)) {
        found.push(entry.label);
        break;
      }
    }
  }
  return found.length === 1 ? found[0]! : found.length > 1 ? found.join(",") : null;
}

function extractCompany(text: string, _title: string): string | null {
  for (const pattern of COMPANY_PREFIX_PATTERNS) {
    const match = pattern.exec(text);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return null;
}

function extractRemoteStatus(text: string): boolean | null {
  const lower = text.toLowerCase();
  const isRemote = REMOTE_PATTERNS.some((p) => p.test(lower));
  const isOffice = OFFICE_PATTERNS.some((p) => p.test(lower));
  if (isRemote && !isOffice) return true;
  if (isOffice && !isRemote) return false;
  return null;
}

function extractLocation(text: string): string | null {
  const lower = text.toLowerCase();
  for (const city of LOCATION_CITIES) {
    if (lower.includes(city)) return city;
  }
  return null;
}

function extractSalary(text: string): { min: number | null; max: number | null; currency: string | null; hasSalary: boolean } {
  const lower = text.toLowerCase();
  for (const pattern of SALARY_PATTERNS) {
    const match = pattern.exec(lower);
    if (match) {
      const min = match[1] ? parseInt(match[1].replace(/\D/g, ""), 10) : null;
      const max = match[2] ? parseInt(match[2].replace(/\D/g, ""), 10) : null;
      const currency = match[3] ?? null;
      const base = min ?? max ?? 0;
      return {
        min,
        max,
        currency,
        hasSalary: true
      };
    }
  }
  return { min: null, max: null, currency: null, hasSalary: false };
}

function cleanTitle(title: string): string {
  const noBrackets = title.replace(/[([{][^)\]}]*[)\]}]/gu, " ");
  const tokens = noBrackets
    .toLowerCase()
    .split(/[\s,.:;!?()\[\]{}|/–—\-]+/u)
    .filter((t) => t.length > 0 && !EXCLUDE_TITLE_WORDS.has(t));
  return tokens.join(" ");
}

function extractFeatures(vacancy: VacancyRecord): ExtractedFeatures {
  const text = `${vacancy.title}\n${vacancy.text}`;
  const title = vacancy.title;
  return {
    company: extractCompany(text, title),
    seniorityLabel: extractSeniority(text),
    isRemote: extractRemoteStatus(text),
    location: extractLocation(text),
    cleanTitle: cleanTitle(title),
    hasSalary: extractSalary(text).hasSalary,
    salaryMin: extractSalary(text).min,
    salaryMax: extractSalary(text).max,
    currency: extractSalary(text).currency
  };
}

function charDiceCoefficient(a: string, b: string): number {
  const bigramsA = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const bigram = a.substring(i, i + 2);
    bigramsA.set(bigram, (bigramsA.get(bigram) ?? 0) + 1);
  }
  let intersection = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const bigram = b.substring(i, i + 2);
    const count = bigramsA.get(bigram) ?? 0;
    if (count > 0) {
      bigramsA.set(bigram, count - 1);
      intersection++;
    }
  }
  const totalBigrams = (a.length - 1) + (b.length - 1);
  return totalBigrams === 0 ? 0 : (2 * intersection) / totalBigrams;
}

function wordBigramDiceCoefficient(a: string, b: string): number {
  const wordsA = a.split(/\s+/u).filter((w) => w.length > 1);
  const wordsB = b.split(/\s+/u).filter((w) => w.length > 1);
  if (wordsA.length < 2 || wordsB.length < 2) {
    return 0;
  }
  const bigramsA = new Set<string>();
  for (let i = 0; i < wordsA.length - 1; i++) {
    bigramsA.add(`${wordsA[i]!} ${wordsA[i + 1]!}`);
  }
  let intersection = 0;
  for (let i = 0; i < wordsB.length - 1; i++) {
    if (bigramsA.has(`${wordsB[i]!} ${wordsB[i + 1]!}`)) {
      intersection++;
    }
  }
  const totalBigrams = (wordsA.length - 1) + (wordsB.length - 1);
  return totalBigrams === 0 ? 0 : (2 * intersection) / totalBigrams;
}

function titleWordOverlapRatio(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/u).filter((w) => w.length > 2));
  const wordsB = new Set(b.toLowerCase().split(/\s+/u).filter((w) => w.length > 2));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let overlap = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) overlap++;
  }
  return overlap / Math.min(wordsA.size, wordsB.size);
}

export function shouldConsiderFuzzyMatch(a: VacancyRecord, b: VacancyRecord): boolean {
  const daysA = Date.parse(a.messageDate);
  const daysB = Date.parse(b.messageDate);
  if (isNaN(daysA) || isNaN(daysB)) return false;
  const dayDiff = Math.abs(daysA - daysB) / (1000 * 60 * 60 * 24);
  if (dayDiff > 30) return false;
  const titleA = cleanTitle(a.title);
  const titleB = cleanTitle(b.title);
  if (titleA.length < 3 || titleB.length < 3) return false;
  const overlap = titleWordOverlapRatio(titleA, titleB);
  if (overlap < 0.25) return false;
  return true;
}

export function computeFuzzyMatch(a: VacancyRecord, b: VacancyRecord): FuzzyMatchResult {
  const fa = extractFeatures(a);
  const fb = extractFeatures(b);

  const reasons: string[] = [];

  const charSim = charDiceCoefficient(fa.cleanTitle, fb.cleanTitle);
  const wordSim = wordBigramDiceCoefficient(fa.cleanTitle, fb.cleanTitle);
  const titleSim = wordSim * 0.6 + charSim * 0.4;
  if (titleSim < 0.15) {
    return { score: 0, isMatch: false, reasons: ["Low title similarity"] };
  }
  const minWordCount = Math.min(
    fa.cleanTitle.split(/\s+/u).filter((w) => w.length > 1).length,
    fb.cleanTitle.split(/\s+/u).filter((w) => w.length > 1).length
  );
  if (minWordCount >= 2 && wordSim === 0) {
    return { score: 0, isMatch: false, reasons: ["No matching word pairs in title"] };
  }

  if (fa.company && fb.company && fa.company !== fb.company) {
    return { score: 0, isMatch: false, reasons: ["Different companies"] };
  }
  if (fa.company && fb.company && fa.company === fb.company) {
    reasons.push("Same company");
  }

  const sa = fa.seniorityLabel;
  const sb = fb.seniorityLabel;
  let seniorityScore = 0;
  if (sa && sb) {
    if (sa === sb) {
      seniorityScore = 0.15;
      reasons.push(`Seniority: ${sa}`);
    } else {
      return { score: 0, isMatch: false, reasons: [`Different seniority: ${sa} vs ${sb}`] };
    }
  } else {
    seniorityScore = 0.08;
  }

  const daysA = Date.parse(a.messageDate);
  const daysB = Date.parse(b.messageDate);
  const dayDiff = Math.abs(daysA - daysB) / (1000 * 60 * 60 * 24);
  let timeScore = 0;
  if (dayDiff <= 1) {
    timeScore = 0.15;
    reasons.push("Same day");
  } else if (dayDiff <= 3) {
    timeScore = 0.12;
    reasons.push("Within 3 days");
  } else if (dayDiff <= 7) {
    timeScore = 0.08;
    reasons.push("Within a week");
  } else if (dayDiff <= 14) {
    timeScore = 0.05;
  }

  let locationScore = 0;
  if (fa.isRemote === true && fb.isRemote === true) {
    locationScore = 0.05;
    reasons.push("Both remote");
  } else if (fa.isRemote === false && fb.isRemote === false) {
    locationScore = 0.03;
    reasons.push("Both office");
  } else if (fa.isRemote !== null && fb.isRemote !== null && fa.isRemote !== fb.isRemote) {
    return { score: 0, isMatch: false, reasons: ["Remote/office conflict"] };
  } else {
    locationScore = 0.01;
  }

  if (fa.location && fb.location && fa.location !== fb.location) {
    return { score: 0, isMatch: false, reasons: [`Different locations: ${fa.location} vs ${fb.location}`] };
  }
  if (fa.location && fb.location && fa.location === fb.location) {
    locationScore = Math.max(locationScore, 0.08);
    reasons.push(`Location: ${fa.location}`);
  }

  let salaryScore = 0;
  if (fa.hasSalary && fb.hasSalary) {
    if (fa.currency !== fb.currency) {
      return { score: 0, isMatch: false, reasons: [`Different salary currency: ${fa.currency} vs ${fb.currency}`] };
    }
    const faRange = (fa.salaryMax ?? fa.salaryMin ?? 0) - (fa.salaryMin ?? 0);
    const fbRange = (fb.salaryMax ?? fb.salaryMin ?? 0) - (fb.salaryMin ?? 0);
    const faMid = ((fa.salaryMin ?? 0) + (fa.salaryMax ?? fa.salaryMin ?? 0)) / 2;
    const fbMid = ((fb.salaryMin ?? 0) + (fb.salaryMax ?? fb.salaryMin ?? 0)) / 2;
    if (faMid > 0 && fbMid > 0) {
      const ratio = Math.min(faMid, fbMid) / Math.max(faMid, fbMid);
      if (ratio < 0.5) {
        return { score: 0, isMatch: false, reasons: ["Salary differs by more than 2x"] };
      }
      if (ratio >= 0.8) {
        salaryScore = 0.10;
        reasons.push("Similar salary");
      } else {
        salaryScore = 0.05;
      }
    }
  } else if (fa.hasSalary !== fb.hasSalary) {
    salaryScore = 0.02;
  }

  const companyBonus = fa.company && fb.company && fa.company === fb.company ? 0.10 : 0;
  const titleScore = titleSim * 0.45;

  const score = Math.min(1, Math.max(0, titleScore + seniorityScore + timeScore + locationScore + salaryScore + companyBonus));

  reasons.push(`Title similarity: ${titleSim.toFixed(3)}`);

  return {
    score: parseFloat(score.toFixed(4)),
    isMatch: score >= FUZZY_MATCH_THRESHOLD,
    reasons
  };
}
