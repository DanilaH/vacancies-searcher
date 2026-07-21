import * as grammy from "grammy";
import type { VacancyDatabase } from "../db/database";
import { buildChannelReport } from "../services/channelReport";
import * as loggerModule from "../logger";

export async function handleChannelReportCommand(
  ctx: grammy.Context,
  database: VacancyDatabase
): Promise<void> {
  if (!database.hasOwnerAccess(ctx.from?.id)) {
    await ctx.reply("🔒 Этот раздел недоступен.");
    return;
  }
  try {
    const report = buildChannelReport(database);
    await ctx.reply(report);
  } catch (error) {
    loggerModule.logger.error({ err: error }, "Failed to build channel performance report");
    await ctx.reply("⚠️ Не удалось сформировать отчёт по источникам.");
  }
}
