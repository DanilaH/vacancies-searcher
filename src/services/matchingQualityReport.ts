import type { VacancyDatabase } from "../db/database";

function formatDate(d: Date): string {
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const year = d.getUTCFullYear();
  return `${day}.${month}.${year}`;
}

function pluralizeFeedback(n: number): string {
  if (n % 10 === 1 && n % 100 !== 11) return "ка";
  if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return "ки";
  return "ок";
}

export function buildMatchingQualityReport(
  database: VacancyDatabase,
  userId: string,
  days = 30
): string {
  const now = new Date();
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const stats = database.getMatchingQualityStats(userId, since.toISOString(), now.toISOString());

  const lines: string[] = [
    "📊 Качество матчинга за последние 30 дней",
    `Период: с ${formatDate(since)} по ${formatDate(now)}`,
    "",
    `Всего подобрано вакансий: ${stats.totalMatches}`,
    `Вакансий с обратной связью: ${stats.totalWithFeedback}`
  ];

  if (stats.totalWithFeedback > 0) {
    const coverage = Math.round((stats.totalWithFeedback / stats.totalMatches) * 100);
    const notRelevantPct = Math.round((stats.notRelevantCount / stats.totalWithFeedback) * 100);

    lines.push(`   Из них релевантных: ${stats.relevantCount}`);
    lines.push(`   Из них нерелевантных: ${stats.notRelevantCount}`);
    lines.push(`   Покрытие оценками: ${coverage}%`);
    lines.push(`   Доля нерелевантных: ${notRelevantPct}%`);

    if (stats.totalWithFeedback < 10) {
      lines.push(`   ⚠️ Мало данных: только ${stats.totalWithFeedback} ${pluralizeFeedback(stats.totalWithFeedback)}`);
    }
  } else {
    lines.push("   Недостаточно данных для расчёта процентов");
  }

  lines.push("");
  lines.push("Пропущенные релевантные вакансии пока не измеряются: для этого нужна контрольная выборка отклонённых кандидатов.");

  return lines.join("\n");
}
