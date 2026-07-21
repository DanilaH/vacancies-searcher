import * as grammy from "grammy";
import type { VacancyDatabase } from "../db/database";
import { buildMatchingQualityReport } from "../services/matchingQualityReport";
import * as loggerModule from "../logger";

export async function handleQualityReportCommand(
  ctx: grammy.Context,
  database: VacancyDatabase
): Promise<void> {
  if (!database.hasOwnerAccess(ctx.from?.id)) {
    await ctx.reply("🔒 Этот раздел недоступен.");
    return;
  }
  try {
    const report = buildMatchingQualityReport(database);
    await ctx.reply(report);
  } catch (error) {
    loggerModule.logger.error({ err: error }, "Failed to build matching quality report");
    await ctx.reply("⚠️ Не удалось сформировать отчёт о качестве матчинга.");
  }
}
