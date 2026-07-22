import type * as grammy from "grammy";

import type { AnalyticsService } from "../analytics/analyticsService";
import type { VacancyDatabase } from "../db/database";
import type { BotPanelMode } from "./render";

export interface ToggleResult {
  previousValue: boolean;
  newValue: boolean;
}

export async function handleInstantVacancyToggle(
  ctx: grammy.Context,
  database: VacancyDatabase,
  analytics: AnalyticsService,
  currentUserId: string
): Promise<ToggleResult> {
  const currentSettings = database.getUserSettings(currentUserId);
  const newValue = !currentSettings.instantVacancyNotificationsEnabled;
  database.setInstantVacancyNotificationsEnabled(currentUserId, newValue);

  await ctx.answerCallbackQuery({
    text: newValue
      ? "🔔 Уведомления о новых вакансиях включены."
      : "🔕 Уведомления о новых вакансиях выключены."
  });

  await analytics.capture({
    eventName: "instant_vacancy_notifications_toggled",
    userId: currentUserId,
    properties: {
      new_value: newValue,
      source: "user_settings"
    }
  });

  return { previousValue: currentSettings.instantVacancyNotificationsEnabled, newValue };
}

export async function handleInstantVacancyToggleCallback(
  ctx: grammy.Context,
  database: VacancyDatabase,
  analytics: AnalyticsService,
  showNotificationsPanel?: (ctx: grammy.Context, mode: BotPanelMode) => Promise<void>,
): Promise<void> {
  const currentUserId = ctx.from?.id !== undefined && ctx.from?.id !== null ? String(ctx.from.id) : null;
  if (!currentUserId) {
    await ctx.answerCallbackQuery({ text: "⚠️ Не удалось определить пользователя." });
    return;
  }
  await handleInstantVacancyToggle(ctx, database, analytics, currentUserId);
  await showNotificationsPanel?.(ctx, "edit");
}
