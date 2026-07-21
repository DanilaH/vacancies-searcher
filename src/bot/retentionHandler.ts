import * as grammy from "grammy";
import type { VacancyDatabase } from "../db/database";
import { buildWeeklyRetentionReport } from "../services/weeklyRetentionReport";
import * as loggerModule from "../logger";

export async function handleRetentionCommand(
  ctx: grammy.Context,
  database: VacancyDatabase
): Promise<void> {
  if (!database.hasOwnerAccess(ctx.from?.id)) {
    await ctx.reply("🔒 Этот раздел недоступен.");
    return;
  }
  try {
    const report = buildWeeklyRetentionReport(database);
    await ctx.reply(report);
  } catch (error) {
    loggerModule.logger.error({ err: error }, "Failed to build retention report");
    await ctx.reply("⚠️ Не удалось сформировать отчёт по ретенции.");
  }
}
