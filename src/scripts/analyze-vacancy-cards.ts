import path from "node:path";

import BetterSqlite3 from "better-sqlite3";

import {
  analyzeVacancyCard,
  ExtractedVacancyDetails,
  VacancyCardWarningCode,
  VacancyCriticalUnknown
} from "../services/vacancyDetailsExtractor";
import { normalizeForComparison, normalizeReadableText } from "../utils/text";

type VacancyTextRow = {
  title: string;
  text: string;
};

const SUPPORTED_LABELS = new Set([
  "роль", "role", "позиция", "position", "должность", "вакансия",
  "компания", "company", "employer", "работодатель",
  "зарплата", "заработная плата", "зп", "salary", "вилка", "compensation", "оплата", "rate",
  "грейд", "grade", "seniority", "уровень",
  "формат работы", "work mode", "work format", "формат", "schedule", "график",
  "география", "локация", "локация работы", "location", "locations", "регион", "город",
  "стек", "stack", "технологии", "technologies", "tech stack",
  "занятость", "тип занятости", "employment", "job type",
  "оформление", "тип договора", "договор", "engagement", "contract type",
  "английский", "уровень английского", "english", "english level",
  "таймзона", "часовой пояс", "timezone", "time zone", "working hours",
  "работа из рф", "можно из рф", "рф", "russia"
]);

const DETAIL_FIELDS: Array<keyof ExtractedVacancyDetails> = [
  "role", "company", "salary", "grade", "workFormat", "geography", "stack",
  "employment", "engagement", "english", "timeZone", "russiaAccess"
];

function readOption(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function percentage(value: number, total: number): string {
  return `${value} (${total === 0 ? "0.0" : ((value / total) * 100).toFixed(1)}%)`;
}

function sortedEntries(map: Map<string, number>, limit?: number): Array<[string, number]> {
  const entries = [...map.entries()].sort((left, right) => right[1] - left[1]);
  return limit ? entries.slice(0, limit) : entries;
}

const days = Math.max(1, Number.parseInt(readOption("days", "7"), 10) || 7);
const databasePath = path.resolve(readOption("database", path.join("data", "bot.db")));
const database = new BetterSqlite3(databasePath, { readonly: true, fileMustExist: true });
const rows = database
  .prepare("SELECT title, text FROM vacancies WHERE datetime(message_date) >= datetime('now', ?)")
  .all(`-${days} days`) as VacancyTextRow[];

const fieldCoverage = new Map<string, number>();
const explicitCoverage = new Map<string, number>();
const inferredCoverage = new Map<string, number>();
const warnings = new Map<VacancyCardWarningCode, number>();
const unknowns = new Map<VacancyCriticalUnknown, number>();
const unsupportedLabels = new Map<string, number>();
let weeklyFallbackCards = 0;
let detailFallbackCards = 0;

for (const row of rows) {
  const analysis = analyzeVacancyCard(row.title, row.text);
  if (analysis.reliableFactCount < 2) weeklyFallbackCards += 1;
  if (analysis.reliableFactCount < 3) detailFallbackCards += 1;

  for (const field of DETAIL_FIELDS) {
    const detail = analysis.details[field];
    if (!detail) continue;
    increment(fieldCoverage, field);
    increment(detail.confidence === "explicit" ? explicitCoverage : inferredCoverage, field);
  }
  for (const warning of analysis.warnings) increment(warnings, warning);
  for (const unknown of analysis.criticalUnknowns) increment(unknowns, unknown);

  for (const line of normalizeReadableText(row.text).split("\n").map((value) => value.trim()).filter(Boolean)) {
    const match = line.match(/^[^\p{L}\p{N}]*([\p{L}][\p{L} .\/-]{1,35})\s*[:—–-]\s*/u);
    const label = normalizeForComparison(match?.[1] ?? "");
    if (label && !SUPPORTED_LABELS.has(label) && label !== "https") {
      increment(unsupportedLabels, label);
    }
  }
}

console.log(`Vacancy card analysis: ${rows.length} vacancies over ${days} days`);
console.log(`Database: ${databasePath}`);
console.log("");
console.log("Field coverage:");
for (const field of DETAIL_FIELDS) {
  const total = fieldCoverage.get(field) ?? 0;
  console.log(
    `- ${field}: ${percentage(total, rows.length)}; explicit ${explicitCoverage.get(field) ?? 0}; inferred ${inferredCoverage.get(field) ?? 0}`
  );
}
console.log("");
console.log(`Weekly fallback cards: ${percentage(weeklyFallbackCards, rows.length)}`);
console.log(`Detail fallback cards: ${percentage(detailFallbackCards, rows.length)}`);
console.log("");
console.log("Critical unknowns:");
for (const [unknown, count] of sortedEntries(unknowns)) console.log(`- ${unknown}: ${percentage(count, rows.length)}`);
console.log("");
console.log("Warnings:");
if (warnings.size === 0) console.log("- none");
for (const [warning, count] of sortedEntries(warnings)) console.log(`- ${warning}: ${percentage(count, rows.length)}`);
console.log("");
console.log("Frequent unsupported labels:");
for (const [label, count] of sortedEntries(unsupportedLabels, 25)) console.log(`- ${label}: ${count}`);

database.close();
