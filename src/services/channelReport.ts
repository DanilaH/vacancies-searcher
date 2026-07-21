import type { VacancyDatabase } from "../db/database";

const MAX_CHANNEL_LABEL_LENGTH = 30;

export function buildChannelReport(database: VacancyDatabase, now = new Date()): string {
  const until = now.toISOString();
  const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const rows = database.listChannelPerformance(since, until, 10);

  if (rows.length === 0) {
    return "📊 Нет данных о производительности источников за последние 30 дней.";
  }

  const lines: string[] = ["📊 Производительность источников за 30 дней", ""];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const label = truncateLabel(formatSourceLabel(row.sourceName, row.sourceChannel), MAX_CHANNEL_LABEL_LENGTH);
    const noiseRate = formatNoiseRate(row.hiddenCount, row.savedCount, row.applicationCount);

    lines.push(`${i + 1}. ${label}`);
    lines.push(`   🆕 Вакансий: ${row.vacancyCount}`);
    lines.push(`   🎯 Совпадений: ${row.matchCount}`);
    lines.push(`   💾 Сохранено: ${row.savedCount}`);
    lines.push(`   👎 Не подошло: ${row.hiddenCount}${noiseRate}`);
    lines.push(`   ✅ Откликов: ${row.applicationCount}`);
    lines.push("");
  }

  return lines.join("\n");
}

function formatSourceLabel(sourceName: string, sourceChannel: string): string {
  if (sourceName === "telegram_web_preview") {
    return `@${sourceChannel}`;
  }
  const shortSource = shortenSourceName(sourceName);
  return `@${sourceChannel} (${shortSource})`;
}

function shortenSourceName(name: string): string {
  const map: Record<string, string> = {
    telegram_mtproto: "tg_mtp",
    telegram_web_preview: "tg_web",
    hh_api: "hh",
    company_careers: "career"
  };
  return map[name] ?? name;
}

function truncateLabel(label: string, maxLen: number): string {
  if (label.length <= maxLen) {
    return label;
  }
  return label.slice(0, maxLen - 1) + "…";
}

function formatNoiseRate(hidden: number, saved: number, applied: number): string {
  const totalFeedback = saved + applied + hidden;
  if (totalFeedback === 0) {
    return " (нет отзывов)";
  }
  const pct = (hidden / totalFeedback) * 100;
  return ` (${pct.toFixed(1)}%)`;
}
