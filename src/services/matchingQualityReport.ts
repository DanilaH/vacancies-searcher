import type { VacancyDatabase } from "../db/database";

function formatDate(d: Date): string {
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const year = d.getUTCFullYear();
  return `${day}.${month}.${year}`;
}

export function buildMatchingQualityReport(
  database: VacancyDatabase,
  days = 30
): string {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const stats = database.getMatchingQualityStats(since.toISOString());

  const lines: string[] = [
    "📊 Качество матчинга за последние 30 дней",
    `Период: с ${formatDate(since)} по ${formatDate(new Date())}`,
    "",
    `Всего подобрано вакансий: ${stats.totalMatches}`,
    `Вакансий с обратной связью: ${stats.totalWithFeedback}`,
    `   Из них релевантных: ${stats.relevantCount}`,
    `   Из них нерелевантных: ${stats.notRelevantCount}`
  ];

  if (stats.totalWithFeedback > 0) {
    const relevantPct = Math.round((stats.relevantCount / stats.totalWithFeedback) * 100);
    lines.push(`   Доля релевантных: ${relevantPct}%`);
  } else {
    lines.push(`   Доля релевантных: —`);
  }

  return lines.join("\n");
}
