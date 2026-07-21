import type { VacancyDatabase } from "../db/database";

const REPORT_WINDOW_DAYS = 7;

function sinceIso(): string {
  return new Date(Date.now() - REPORT_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

export function buildWeeklyReport(database: VacancyDatabase): string {
  const since = sinceIso();

  const newUsers = database.countAnalyticsEventsSince("user_started", since);
  const onboardingCompleted = database.countAnalyticsEventsSince("onboarding_completed", since);
  const activeUsers = database.countDistinctAnalyticsUsersSince(since);
  const matched = database.countAnalyticsEventsSince("vacancy_matched", since);
  const notified = database.countAnalyticsEventsSince("vacancy_notified", since);
  const feedOpened = database.countAnalyticsEventsSince("weekly_feed_opened", since);
  const saved = database.countAnalyticsStatusChangesSince("saved", since);
  const applied = database.countAnalyticsEventsSince("vacancy_application_created", since);
  const hidden = database.countAnalyticsStatusChangesSince("hidden", since);

  const lines: string[] = [
    "📊 Отчёт за 7 дней",
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
