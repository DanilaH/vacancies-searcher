import { InlineKeyboard } from "grammy";

import type { VacancyDatabase } from "../db/database";

export const REPORT_PERIOD_OPTIONS = [7, 14, 30] as const;

export type ReportPeriod = (typeof REPORT_PERIOD_OPTIONS)[number];

const PERIOD_LABELS: Record<ReportPeriod, string> = {
  7: "7 дней",
  14: "14 дней",
  30: "30 дней"
};

export function buildWeeklyReport(database: VacancyDatabase, now = new Date(), period: ReportPeriod = 7): string {
  const until = now.toISOString();
  const since = new Date(now.getTime() - period * 24 * 60 * 60 * 1000).toISOString();

  const newUsers = database.countDistinctAnalyticsUserIdsSince("user_started", since, until);
  const onboardingCompleted = database.countDistinctAnalyticsUserIdsSince("onboarding_completed", since, until);
  const activeUsers = database.countAllDistinctAnalyticsUserIdsSince(since, until);
  const matched = database.countAnalyticsEventsSince("vacancy_matched", since, until);
  const notified = database.countAnalyticsEventsSince("vacancy_notified", since, until);
  const feedOpened = database.countAnalyticsEventsSince("weekly_feed_opened", since, until);
  const saved = database.countAnalyticsStatusChangesSince("saved", since, until);
  const applied = database.countAnalyticsEventsSince("vacancy_application_created", since, until);
  const hidden = database.countAnalyticsStatusChangesSince("hidden", since, until);

  const lines: string[] = [
    `📊 Отчёт за ${PERIOD_LABELS[period].toLowerCase()}`,
    "",
    `👥 Новые пользователи: ${newUsers}`,
    `✅ Завершили настройку: ${onboardingCompleted}`,
    `🟢 Активные пользователи: ${activeUsers}`,
    "",
    `🎯 Совпадений: ${matched}`,
    `📨 Уведомлений отправлено: ${notified}`,
    `🗂️ Открытий подборки: ${feedOpened}`,
    "",
    `💾 Сохранено: ${saved}`,
    `✅ Откликов: ${applied}`,
    `👎 Не подошло: ${hidden}`
  ];

  return lines.join("\n");
}

export function buildReportKeyboard(selectedPeriod: ReportPeriod): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const option of REPORT_PERIOD_OPTIONS) {
    const label = option === selectedPeriod ? `✅ ${PERIOD_LABELS[option]}` : PERIOD_LABELS[option];
    keyboard.text(label, `report:period:${option}`);
  }
  return keyboard;
}

interface MessageLike {
  reply_markup?: {
    inline_keyboard?: Array<Array<{ text: string; callback_data?: string }>>;
  };
}

export function isPeriodSelectedInMessage(msg: MessageLike, period: ReportPeriod): boolean {
  for (const row of msg.reply_markup?.inline_keyboard ?? []) {
    for (const btn of row) {
      if (btn.callback_data === `report:period:${period}` && btn.text.startsWith("✅")) {
        return true;
      }
    }
  }
  return false;
}
