import * as grammy from "grammy";
import type { VacancyDatabase } from "../db/database";
import { formatVacancyNotification } from "./formatters";
import * as loggerModule from "../logger";
import type { AppConfig } from "../config";
import type { RejectedAuditVacancyRecord, VacancyRecord } from "../types";

const VERDICT_MISSED_RELEVANT = "missed_relevant";
const VERDICT_CORRECT_REJECTION = "correct_rejection";
export type AuditVerdict = typeof VERDICT_MISSED_RELEVANT | typeof VERDICT_CORRECT_REJECTION;

const VALID_VERDICTS = new Set<string>([VERDICT_MISSED_RELEVANT, VERDICT_CORRECT_REJECTION]);

export function isValidAuditVerdict(value: string): value is AuditVerdict {
  return VALID_VERDICTS.has(value);
}

const CB_VERDICT_PREFIX = "qualityaudit:verdict:";

function buildVerdictKeyboard(vacancyId: number): grammy.InlineKeyboard {
  return new grammy.InlineKeyboard()
    .text("✅ Подходит мне", `${CB_VERDICT_PREFIX}${vacancyId}:${VERDICT_MISSED_RELEVANT}`)
    .text("❌ Не подходит", `${CB_VERDICT_PREFIX}${vacancyId}:${VERDICT_CORRECT_REJECTION}`);
}

function formatAuditCard(audit: RejectedAuditVacancyRecord, config: AppConfig, index: number, total: number): string {
  const header = [
    `📋 Аудит отклонённых: ${index}/${total}`,
    `🏷️ Решение: ${audit.resolution}${audit.score != null ? ` (оценка: ${audit.score})` : ""}${audit.reason ? `\n📌 Причина: ${audit.reason}` : ""}`,
    `🕐 Отклонено: ${audit.decidedAt}`,
    ""
  ].join("\n");

  return `${header}${formatVacancyNotification(audit as VacancyRecord, config)}`;
}

function formatAuditCardDone(): string {
  return "✅ Все записи аудита отклонённых вакансий проверены!";
}

export async function handleQualityAuditCommand(
  ctx: grammy.Context,
  database: VacancyDatabase,
  config: AppConfig
): Promise<void> {
  if (!database.hasOwnerAccess(ctx.from?.id)) {
    await ctx.reply("🔒 Команда доступна только владельцу.");
    return;
  }
  try {
    const userId = String(ctx.from!.id);
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
  try {
    await handleAuditVerdictCallbackInner(ctx, database, config);
  } catch (error) {
    loggerModule.logger.error({ err: error }, "Failed to handle audit verdict callback");
    try {
      await ctx.answerCallbackQuery({ text: "⚠️ Не удалось сохранить оценку." });
    } catch {
      // best-effort if answering fails too
    }
  }
}

async function handleAuditVerdictCallbackInner(
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
  const verdictRaw = match[2] as string;

  if (!isValidAuditVerdict(verdictRaw)) {
    await ctx.answerCallbackQuery({ text: "⚠️ Некорректное значение оценки." });
    return;
  }
  const verdict: AuditVerdict = verdictRaw;

  const userId = String(ctx.from!.id);
  const updated = database.setAuditVerdict(userId, vacancyId, verdict);
  if (!updated) {
    await ctx.answerCallbackQuery({ text: "⚠️ Запись уже проверена." });
    try {
      if (ctx.callbackQuery.message && "reply_markup" in ctx.callbackQuery.message) {
        await ctx.editMessageReplyMarkup({ reply_markup: undefined });
      }
    } catch {
      // best-effort
    }
    return;
  }

  // Disable buttons on the old card
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

export async function handleMalformedAuditCallback(ctx: grammy.Context): Promise<void> {
  await ctx.answerCallbackQuery({ text: "⚠️ Некорректный запрос аудита." });
}
