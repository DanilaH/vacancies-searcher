import type * as grammy from "grammy";
import type { AnalyticsService } from "../analytics/analyticsService";
import type { VacancyDatabase } from "../db/database";
import type { AnalyticsProperties, VacancyRelevanceValue, VacancyUserStatus } from "../types";

export interface ProcessRelevanceFeedbackEvent {
  eventName: "vacancy_relevance_feedback";
  userId: string;
  properties: AnalyticsProperties;
}

export type ProcessResult =
  | { kind: "recorded"; event: ProcessRelevanceFeedbackEvent }
  | { kind: "unchanged" }
  | { kind: "forbidden" };

export function processRelevanceFeedback(
  database: VacancyDatabase,
  userId: string,
  vacancyId: number,
  value: VacancyRelevanceValue
): ProcessResult {
  if (!database.hasUserVacancyMatch(userId, vacancyId)) {
    return { kind: "forbidden" };
  }

  const existing = database.getVacancyRelevanceFeedback(userId, vacancyId);
  if (existing === value) {
    return { kind: "unchanged" };
  }

  const vacancy = database.getVacancy(vacancyId);

  database.upsertVacancyRelevanceFeedback(userId, vacancyId, value);

  return {
    kind: "recorded",
    event: {
      eventName: "vacancy_relevance_feedback",
      userId,
      properties: {
        vacancy_id: vacancyId,
        value,
        source_name: vacancy?.sourceName ?? "unknown",
        source_channel: vacancy?.sourceChannel ?? "unknown"
      }
    }
  };
}

export async function handleVacancyRelevanceCallback(
  ctx: grammy.Context,
  database: VacancyDatabase,
  analytics: AnalyticsService,
  currentUserId: string,
  vacancyId: number,
  value: "relevant"
): Promise<ProcessResult["kind"]> {
  const result = processRelevanceFeedback(database, currentUserId, vacancyId, value);

  if (result.kind === "unchanged") {
    await ctx.answerCallbackQuery({ text: "👍 Уже отмечено как релевантное." });
  } else if (result.kind === "forbidden") {
    await ctx.answerCallbackQuery({ text: "Вакансия недоступна" });
  } else {
    await analytics.capture(result.event);
    await ctx.answerCallbackQuery({ text: "👍 Отмечено как релевантное." });
  }

  return result.kind;
}

export interface VacancyHideUI {
  dismissOrRestoreWeekly(ctx: grammy.Context): Promise<void>;
  showReasonPrompt(ctx: grammy.Context, userId: string): Promise<void>;
}

export async function handleVacancyHideCallback(
  ctx: grammy.Context,
  database: VacancyDatabase,
  analytics: AnalyticsService,
  currentUserId: string,
  vacancyId: number,
  previousStatus: VacancyUserStatus,
  ui: VacancyHideUI
): Promise<"forbidden" | "hidden"> {
  const feedbackResult = processRelevanceFeedback(database, currentUserId, vacancyId, "not_relevant");
  if (feedbackResult.kind === "forbidden") {
    await ctx.answerCallbackQuery({ text: "Вакансия недоступна" });
    return "forbidden";
  }

  database.setUserVacancyStatus(currentUserId, vacancyId, "hidden");

  const activeReminder = database.getActiveUserVacancyReminder(currentUserId, vacancyId);
  if (activeReminder) {
    await analytics.capture({
      eventName: "vacancy_reminder_cancelled",
      userId: currentUserId,
      properties: {
        vacancy_id: vacancyId,
        trigger: "status_hidden"
      }
    });
  }

  const vacancy = database.getVacancy(vacancyId);
  await analytics.capture({
    eventName: "vacancy_status_changed",
    userId: currentUserId,
    properties: {
      vacancy_id: vacancyId,
      source_name: vacancy?.sourceName ?? "unknown",
      source_channel: vacancy?.sourceChannel ?? "unknown",
      previous_status: previousStatus,
      next_status: "hidden"
    }
  });

  if (feedbackResult.kind === "recorded") {
    await analytics.capture(feedbackResult.event);
  }

  await ctx.answerCallbackQuery({ text: "👎 Скрыто." });

  await ui.dismissOrRestoreWeekly(ctx);
  await ui.showReasonPrompt(ctx, currentUserId);

  return "hidden";
}
