import type { VacancyDatabase } from "../db/database";

function formatDate(d: Date): string {
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const year = d.getUTCFullYear();
  return `${day}.${month}.${year}`;
}

export function pluralizeFeedback(n: number): string {
  if (n % 10 === 1 && n % 100 !== 11) return "оценка";
  if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return "оценки";
  return "оценок";
}

export function buildMatchingQualityReport(
  database: VacancyDatabase,
  userId: string,
  days = 30,
  now?: Date
): string {
  const currentTime = now ?? new Date();
  const since = new Date(currentTime.getTime() - days * 24 * 60 * 60 * 1000);
  const stats = database.getMatchingQualityStats(userId, since.toISOString(), currentTime.toISOString());

  const lines: string[] = [
    "📊 Качество матчинга за последние 30 дней",
    `Период: с ${formatDate(since)} по ${formatDate(currentTime)}`,
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

  const audit = database.getAuditQualityMetrics(userId, since.toISOString(), currentTime.toISOString());

  lines.push("");
  lines.push("Проверка отклонённых вакансий");
  lines.push(`   Сохранено кандидатов: ${audit.totalCandidates}`);
  lines.push(`   Проверено владельцем: ${audit.reviewedCount}`);

  if (audit.totalCandidates > 0) {
    const coverage = Math.round((audit.reviewedCount / audit.totalCandidates) * 100);
    lines.push(`   Покрытие ручной проверкой: ${coverage}%`);
  } else {
    lines.push("   Покрытие ручной проверкой: —");
  }

  if (audit.reviewedCount > 0) {
    lines.push(`   Пропущено релевантных: ${audit.missedRelevantCount}`);
    lines.push(`   Корректно отклонено: ${audit.correctRejectionCount}`);

    const missedPct = Math.round((audit.missedRelevantCount / audit.reviewedCount) * 100);
    lines.push(`   Доля пропусков среди проверенных: ${missedPct}%`);

    if (audit.reviewedCount < 10) {
      lines.push("   ⚠️ Мало данных");
    }
  } else {
    lines.push("   Недостаточно данных");
  }

  lines.push(`   Метрика рассчитана только по вручную проверенной audit-выборке и не является полным false-negative rate.`);

  return lines.join("\n");
}
