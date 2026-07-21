import * as grammy from "grammy";
import type { VacancyDatabase } from "../db/database";
import { formatVacancyNotification } from "./formatters";
import * as loggerModule from "../logger";
import type { AppConfig } from "../config";
import type { VacancyRecord, RejectedMatchAuditRecord } from "../types";

type AuditVacancy = RejectedMatchAuditRecord & VacancyRecord;

const CB_PREFIX = "qualityaudit:verdict:";
const VERDICT_MISSED_RELEVANT = "missed_relevant";
const VERDICT_CORRECT_REJECTION = "correct_rejection";

function buildVerdictKeyboard(vacancyId: number): grammy.InlineKeyboard {
  return new grammy.InlineKeyboard()
    .text("✅ Подходит мне", `${CB_PREFIX}${vacancyId}:${VERDICT_MISSED_RELEVANT}`)
    .text("❌ Не подходит", `${CB_PREFIX}${vacancyId}:${VERDICT_CORRECT_REJECTION}`);
}

function formatAuditCard(audit: AuditVacancy, config: AppConfig, index: number, total: number): string {
  const header = [
    `📋 Аудит отклонённых: ${index}/${total}`,
    `🏷️ Решение: ${audit.resolution}${audit.score != null ? ` (оценка: ${audit.score})` : ""}${audit.reason ? `\n📌 Причина: ${audit.reason}` : ""}`,
    `🕐 Отклонено: ${audit.decidedAt}`,
    ""
  ].join("\n");

  return `${header}${formatVacancyNotification(audit, config)}`;
}

function formatAuditCardDone(): string {
  return "✅ Все записи аудита отклонённых вакансий проверены!";
}

export async function handleQualityAuditCommand(
  ctx: grammy.Context,
  database: VacancyDatabase,
  config: AppConfig
): Promise<void> {
  const userId = String(ctx.from?.id);
  if (!database.hasOwnerAccess(ctx.from?.id)) {
    await ctx.reply("🔒 Команда доступна только владельцу.");
    return;
  }
  try {
    const total = database.countUnreviewedRejectedAudit(userId);
    if (total === 0) {
      await ctx.reply(formatAuditCardDone());
      return;
    }
    const audit = database.getOldestUnreviewedAuditWithVacancy(userId);
    if (!audit) {
      await ctx.reply(formatAuditCardDone());
      return;
    }
    await ctx.reply(formatAuditCard(audit, config, 1, total), {
      reply_markup: buildVerdictKeyboard(audit.id)
    });
  } catch (error) {
    loggerModule.logger.error({ err: error }, "Failed to handle quality audit command");
    await ctx.reply("⚠️ Не удалось загрузить запись аудита.");
  }
}

export async function handleAuditVerdictCallback(
  ctx: grammy.CallbackQueryContext<grammy.Context>,
  database: VacancyDatabase,
  config: AppConfig
): Promise<void> {
  if (!ctx.match) {
    await ctx.answerCallbackQuery({ text: "⚠️ Некорректные данные." });
    return;
  }
  if (!database.hasOwnerAccess(ctx.from?.id)) {
    await ctx.answerCallbackQuery({ text: "🔒 Этот раздел недоступен." });
    return;
  }

  const match = ctx.match as RegExpExecArray;
  const vacancyId = Number(match[1]);
  const verdict = match[2] as string;
  const userId = String(ctx.from!.id);

  const updated = database.setAuditVerdict(userId, vacancyId, verdict);
  if (!updated) {
    await ctx.answerCallbackQuery({ text: "⚠️ Запись уже проверена." });
    await ctx.editMessageReplyMarkup({ reply_markup: undefined });
    return;
  }

  try {
    if (ctx.callbackQuery.message && "reply_markup" in ctx.callbackQuery.message) {
      await ctx.editMessageReplyMarkup({ reply_markup: undefined });
    }
  } catch {
    // best-effort — may fail if message was already edited
  }

  await ctx.answerCallbackQuery({
    text: verdict === VERDICT_MISSED_RELEVANT ? "✅ Отмечено как пропущенная релевантная" : "❌ Отмечено как корректное отклонение"
  });

  const total = database.countUnreviewedRejectedAudit(userId);
  if (total === 0) {
    await ctx.reply(formatAuditCardDone());
    return;
  }
  const audit = database.getOldestUnreviewedAuditWithVacancy(userId);
  if (!audit) {
    await ctx.reply(formatAuditCardDone());
    return;
  }
  await ctx.reply(formatAuditCard(audit, config, 1, total), {
    reply_markup: buildVerdictKeyboard(audit.id)
  });
}
