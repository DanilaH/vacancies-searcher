import type * as grammy from "grammy";

import type { AnalyticsService } from "../analytics/analyticsService";
import type { VacancyDatabase } from "../db/database";
import type { BotPanelMode } from "./render";

export interface ToggleResult {
  previousValue: boolean;
  newValue: boolean;
}

export async function handleNotificationQuietHoursToggle(
  ctx: grammy.Context,
  database: VacancyDatabase,
  analytics: AnalyticsService,
  currentUserId: string
): Promise<ToggleResult> {
  const currentSettings = database.getUserSettings(currentUserId);
  const newValue = !currentSettings.notificationQuietHoursEnabled;
  database.setNotificationQuietHoursEnabled(currentUserId, newValue);

  await ctx.answerCallbackQuery({
    text: newValue
      ? "🌙 Ночная пауза 23:00–08:00 включена."
      : "🌙 Ночная пауза 23:00–08:00 выключена."
  });

  await analytics.capture({
    eventName: "notification_quiet_hours_toggled",
    userId: currentUserId,
    properties: {
      new_value: newValue,
      source: "user_settings"
    }
  });

  return { previousValue: currentSettings.notificationQuietHoursEnabled, newValue };
}

export async function handleNotificationQuietHoursToggleCallback(
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
  await handleNotificationQuietHoursToggle(ctx, database, analytics, currentUserId);
  await showNotificationsPanel?.(ctx, "edit");
}
