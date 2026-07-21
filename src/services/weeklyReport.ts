import type { VacancyDatabase } from "../db/database";

const REPORT_WINDOW_DAYS = 7;

export function buildWeeklyReport(database: VacancyDatabase, now = new Date()): string {
  const until = now.toISOString();
  const since = new Date(now.getTime() - REPORT_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

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
