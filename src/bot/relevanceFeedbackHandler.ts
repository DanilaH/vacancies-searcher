import type * as grammy from "grammy";
import type { AnalyticsService } from "../analytics/analyticsService";
import type { VacancyDatabase } from "../db/database";
import type { AnalyticsProperties, VacancyRelevanceValue } from "../types";

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
