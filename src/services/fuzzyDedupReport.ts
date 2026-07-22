import type { VacancyDatabase } from "../db/database";

function formatDate(d: Date): string {
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const year = d.getUTCFullYear();
  return `${day}.${month}.${year}`;
}

function formatScore(n: number | null): string {
  if (n === null) return "—";
  return n.toFixed(3);
}

function formatPct(n: number, total: number): string {
  if (total === 0) return "—";
  return `${((n / total) * 100).toFixed(1)}%`;
}

export function buildFuzzyDedupReport(database: VacancyDatabase, days = 30, now?: Date): string {
  const currentTime = now ?? new Date();
  const since = new Date(currentTime.getTime() - days * 24 * 60 * 60 * 1000);
  const stats = database.getFuzzyDedupStats(since.toISOString());

  const lines: string[] = [
    "🔗 Fuzzy-дубликаты за последние 30 дней",
    `Период: с ${formatDate(since)} по ${formatDate(currentTime)}`,
    ""
  ];

  if (stats.totalLinks === 0) {
    lines.push("Нет данных о fuzzy-связях за выбранный период.");
    return lines.join("\n");
  }

  lines.push(`Всего связей: ${stats.totalLinks}`);
  lines.push(`Уникальных групп: ${stats.totalGroups}`);
  lines.push("");
  lines.push(`Средний score: ${formatScore(stats.averageScore)}`);
  lines.push(`Мин. score: ${formatScore(stats.minScore)}`);
  lines.push(`Макс. score: ${formatScore(stats.maxScore)}`);
  lines.push("");

  lines.push("Распределение по score:");
  for (const bucket of stats.scoreBuckets) {
    lines.push(`   ${bucket.label}: ${bucket.count} (${formatPct(bucket.count, stats.totalLinks)})`);
  }
  lines.push("");

  lines.push("Размер групп:");
  for (const group of stats.groupSizeDistribution) {
    const label = group.sizeLabel === "4+" ? "4+" : group.sizeLabel;
    lines.push(`   ${label} вакансии(й): ${group.count}`);
  }
  lines.push("");

  if (stats.topSourceChannelPairs.length > 0) {
    lines.push("Топ источников по числу связей:");
    for (let i = 0; i < stats.topSourceChannelPairs.length; i++) {
      const pair = stats.topSourceChannelPairs[i]!;
      lines.push(`   ${i + 1}. ${pair.sourceName}/${pair.sourceChannel}: ${pair.linkCount}`);
    }
    lines.push("");
  }

  if (stats.lastMatchDate) {
    const lastDate = new Date(stats.lastMatchDate + "Z");
    lines.push(`Последнее совпадение: ${formatDate(lastDate)}`);
  }

  return lines.join("\n");
}
