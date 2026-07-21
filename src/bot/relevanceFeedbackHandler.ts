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
  | { kind: "vacancy_not_found" };

export function processRelevanceFeedback(
  database: VacancyDatabase,
  userId: string,
  vacancyId: number,
  value: VacancyRelevanceValue
): ProcessResult {
  const existing = database.getVacancyRelevanceFeedback(userId, vacancyId);
  if (existing === value) {
    return { kind: "unchanged" };
  }

  const vacancy = database.getVacancy(vacancyId);
  if (!vacancy) {
    return { kind: "vacancy_not_found" };
  }

  database.upsertVacancyRelevanceFeedback(userId, vacancyId, value);

  return {
    kind: "recorded",
    event: {
      eventName: "vacancy_relevance_feedback",
      userId,
      properties: {
        vacancy_id: vacancyId,
        value,
        source_name: vacancy.sourceName,
        source_channel: vacancy.sourceChannel
      }
    }
  };
}
