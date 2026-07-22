import * as grammy from "grammy";
import type { VacancyDatabase } from "../db/database";
import { buildFuzzyDedupReport } from "../services/fuzzyDedupReport";
import * as loggerModule from "../logger";

export async function handleFuzzyDedupReportCommand(
  ctx: grammy.Context,
  database: VacancyDatabase
): Promise<void> {
  if (!database.hasOwnerAccess(ctx.from?.id)) {
    await ctx.reply("🔒 Этот раздел недоступен.");
    return;
  }
  try {
    const report = buildFuzzyDedupReport(database);
    await ctx.reply(report);
  } catch (error) {
    loggerModule.logger.error({ err: error }, "Failed to build fuzzy dedup report");
    await ctx.reply("⚠️ Не удалось сформировать отчёт по fuzzy-дубликатам.");
  }
}
