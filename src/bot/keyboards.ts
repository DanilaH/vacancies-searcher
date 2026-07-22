import { InlineKeyboard } from "grammy";

import { listSearchProfilePresetGroups } from "../services/searchProfilePresets";
import { DEFAULT_WEEKLY_WINDOW_DAYS, normalizeWeeklyWindowDays, WEEKLY_WINDOW_DAYS_OPTIONS } from "../services/weeklyWindow";
import {
  HIDDEN_VACANCY_REASON_BUTTON_LABELS,
  HIDDEN_VACANCY_REASONS
} from "../services/hiddenVacancyReasons";
import {
  MatchedVacancyRecord,
  UserSearchProfileRecord,
  SearchProfilePresetForecast,
  UserFilterSuggestionCandidate,
  UserVacancyApplicationPage,
  UserVacancyApplicationRecord,
  UserStatusVacancyPage,
  UserWeeklyVacancyPage,
  DailyDigestPayload,
  VacancyLanguageMode,
  VacancyRelevanceValue,
  VacancyReminderPage,
  VacancyRecord,
  WeeklyVacancyPage
} from "../types";
import { vacancyLanguageModeFlags } from "./admin";
import type { VacancyNotificationView } from "./formatters";
import {
  appendVacancyCardOrigin,
  type VacancyCardOrigin,
  weeklyCallbackForVacancyCardOrigin
} from "./vacancyCardOrigin";

export function createMainKeyboard(showAdmin: boolean, showNotifications: boolean, showWeekly: boolean): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  if (showWeekly) {
    keyboard.text("🗂️ Подборка вакансий", "week:0");
  }

  if (showNotifications) {
    if (showWeekly) {
      keyboard.row();
    }

    keyboard
      .text("📌 Мои вакансии", "menu:vacancies")
      .row()
      .text("🎯 Мои поиски", "menu:filters")
      .text("⚙️ Настройки", "menu:settings");
  }

  if (showAdmin) {
    keyboard.row().text("⚙️ Настройки (админ)", "menu:admin");
  }

  return keyboard;
}

export function createBlockedWeeklyKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("🎯 Мои поиски", "menu:filters").row().text("🏠 Меню", "menu:home");
}

export function createOnboardingIntroKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("🚀 Продолжить", "onboarding:continue");
}

export function createWeeklyKeyboard(
  page: WeeklyVacancyPage | UserWeeklyVacancyPage,
  _showNotifications: boolean,
  profileId?: number,
  days = DEFAULT_WEEKLY_WINDOW_DAYS
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const windowDays = normalizeWeeklyWindowDays(days);
  const previousOffset = Math.max(0, page.offset - page.pageSize);
  const nextOffset = page.offset + page.pageSize;
  const callback = (offset: number, targetDays = windowDays): string => {
    const normalizedDays = normalizeWeeklyWindowDays(targetDays);
    if (normalizedDays === DEFAULT_WEEKLY_WINDOW_DAYS) {
      return profileId ? `week:profile:${profileId}:${offset}` : `week:${offset}`;
    }

    return profileId ? `week:profile:${profileId}:${normalizedDays}:${offset}` : `week:${normalizedDays}:${offset}`;
  };
  const vacancyOrigin: VacancyCardOrigin = { offset: page.offset, profileId, days: windowDays };

  page.items.forEach((vacancy, index) => {
    if (index > 0 && index % 5 === 0) {
      keyboard.row();
    }

    keyboard.text(
      String(page.offset + index + 1),
      appendVacancyCardOrigin(`vacancy:view:${vacancy.id}:compact`, vacancyOrigin)
    );
  });

  if (page.items.length > 0) {
    keyboard.row();
  }

  if (page.offset > 0) {
    keyboard.text("⬅️ Назад", callback(previousOffset));
  }
  if (nextOffset < page.total) {
    keyboard.text("➡️ Дальше", callback(nextOffset));
  }

  keyboard.row().text("🔄 Обновить", callback(page.offset));

  keyboard.row();
  for (const option of WEEKLY_WINDOW_DAYS_OPTIONS) {
    keyboard.text(option === windowDays ? `✅ ${option} дн.` : `${option} дн.`, callback(0, option));
  }

  if (profileId) {
    keyboard.row().text("↩️ К поиску", `filters:profile:${profileId}`);
  }

  return keyboard.row().text("🏠 Меню", "menu:home");
}

export function createWeeklyZeroStateKeyboard(
  page: WeeklyVacancyPage | UserWeeklyVacancyPage,
  profileId?: number,
  profilesCount = 1,
  days = DEFAULT_WEEKLY_WINDOW_DAYS
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const windowDays = normalizeWeeklyWindowDays(days);
  const callback = (targetDays = windowDays): string => {
    const normalizedDays = normalizeWeeklyWindowDays(targetDays);
    if (normalizedDays === DEFAULT_WEEKLY_WINDOW_DAYS) {
      return profileId ? `week:profile:${profileId}:0` : "week:0";
    }

    return profileId ? `week:profile:${profileId}:${normalizedDays}:0` : `week:${normalizedDays}:0`;
  };

  for (const option of WEEKLY_WINDOW_DAYS_OPTIONS) {
    keyboard.text(option === windowDays ? `✅ ${option} дн.` : `${option} дн.`, callback(option));
  }
  keyboard.row();

  if ("hiddenMatchedTotal" in page && (page.hiddenMatchedTotal ?? 0) > 0) {
    keyboard.text("🙈 Открыть скрытые", "status:hidden:0").row();
  }

  if (profileId) {
    return keyboard
      .text("↩️ К поиску", `filters:profile:${profileId}`)
      .row()
      .text("🧩 Применить пресет", `filters:profile:${profileId}:presets`)
      .row()
      .text("🔄 Проверить снова", callback())
      .row()
      .text("🏠 Меню", "menu:home");
  }

  keyboard.text("🎯 Настроить поиски", "menu:filters").row();
  if (profilesCount < 5) {
    keyboard.text("🧩 Добавить поиск по пресету", "filters:add:presets").row();
  }

  return keyboard
    .text("🔄 Проверить снова", callback())
    .row()
    .text("🏠 Меню", "menu:home");
}

export function createNotificationsKeyboard(notifyOnEmptyCycle: boolean, dailyDigestEnabled = false): InlineKeyboard {
  return new InlineKeyboard()
    .text(
      notifyOnEmptyCycle ? "🔕 Не сообщать, если новых вакансий нет" : "🔔 Сообщать, если новых вакансий нет",
      "notifications:toggle_empty_cycle_notice"
    )
    .row()
    .text(
      dailyDigestEnabled ? "🌅 Выключить утренний дайджест" : "🌅 Включить утренний дайджест",
      "notifications:toggle_daily_digest"
    )
    .row()
    .text("↩️ К настройкам", "menu:settings");
}

export function createDailyDigestKeyboard(payload: DailyDigestPayload): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  if (payload.newVacanciesCount > 0) {
    keyboard.text("🔥 Вакансии", "week:0");
  }
  if (payload.savedWithoutActionCount > 0) {
    keyboard.text("💾 Сохранённые", "status:saved:0");
  }
  if (payload.dueApplicationFollowUpsCount > 0) {
    keyboard.text("⏰ Отклики", "status:applied:0");
  }

  return keyboard
    .row()
    .text("⚙️ Настройки", "menu:settings");
}

function appendWeeklyReturn(keyboard: InlineKeyboard, origin?: VacancyCardOrigin): InlineKeyboard {
  if (origin) {
    keyboard.row().text("↩️ К выдаче", weeklyCallbackForVacancyCardOrigin(origin));
  }
  return keyboard;
}

export function createWeeklyReturnKeyboard(origin?: VacancyCardOrigin): InlineKeyboard | undefined {
  return origin
    ? new InlineKeyboard().text("↩️ К выдаче", weeklyCallbackForVacancyCardOrigin(origin))
    : undefined;
}

export function createHiddenVacancyReceiptKeyboard(vacancyId: number, origin?: VacancyCardOrigin): InlineKeyboard {
  const keyboard = new InlineKeyboard().text("↩️ Вернуть в подборку", appendVacancyCardOrigin(`vacancy:status:${vacancyId}:hidden:compact`, origin));

  return origin
    ? keyboard.text("↩️ К выдаче", weeklyCallbackForVacancyCardOrigin(origin))
    : keyboard.text("🏠 Меню", "menu:home");
}

export function createHiddenReasonKeyboard(vacancyId: number, origin?: VacancyCardOrigin): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  HIDDEN_VACANCY_REASONS.forEach((reason, index) => {
    if (index > 0 && index % 2 === 0) {
      keyboard.row();
    }
    keyboard.text(
      HIDDEN_VACANCY_REASON_BUTTON_LABELS[reason],
      appendVacancyCardOrigin(`hidden_reason:set:${vacancyId}:${reason}`, origin)
    );
  });

  keyboard
    .row()
    .text("Пропустить", appendVacancyCardOrigin(`hidden_reason:skip:${vacancyId}`, origin));

  if (!origin) {
    keyboard
      .row()
      .text("↩️ Вернуть в подборку", `vacancy:status:${vacancyId}:hidden:compact`)
      .text("🏠 Меню", "menu:home");
  }

  return keyboard;
}

export function createDiagnosticsKeyboard(
  showWeekly: boolean,
  filterSuggestion?: UserFilterSuggestionCandidate | null
): InlineKeyboard {
  const keyboard = new InlineKeyboard()
    .text("🎯 Мои поиски", "menu:filters")
    .text("⚙️ Настройки", "menu:settings");

  if (showWeekly) {
    keyboard.row().text("🗂️ Подборка вакансий", "week:0");
  }

  return keyboard
    .row()
    .text("🏠 Меню", "menu:home");
}

export function createDiagnosticsKeyboardWithSuggestion(
  showWeekly: boolean,
  filterSuggestion: UserFilterSuggestionCandidate
): InlineKeyboard {
  return createDiagnosticsKeyboard(showWeekly)
    .row()
    .text("🎯 Открыть фильтры", `filter_suggestion:open:${filterSuggestion.suggestionKey}`)
    .text("Не предлагать", `filter_suggestion:dismiss:${filterSuggestion.suggestionKey}`)
    .row()
    .text("Позже", `filter_suggestion:later:${filterSuggestion.suggestionKey}`);
}

export function createVacancyKeyboardWithActions(
  vacancy: VacancyRecord | MatchedVacancyRecord,
  _showNotifications: boolean,
  view: VacancyNotificationView = "compact",
  origin?: VacancyCardOrigin,
  relevanceValue?: VacancyRelevanceValue
): InlineKeyboard {
  const keyboard = new InlineKeyboard()
    .url("🔗 Открыть пост", vacancy.url)
    .row()
    .text(
      view === "compact" ? "📄 Полный текст" : "↩️ Свернуть",
      appendVacancyCardOrigin(`vacancy:view:${vacancy.id}:${view === "compact" ? "full" : "compact"}`, origin)
    )
    .text(
      "userStatus" in vacancy && vacancy.userStatus === "applied" ? "⏰ Follow-up" : "⏰ Напомнить",
      appendVacancyCardOrigin(
        "userStatus" in vacancy && vacancy.userStatus === "applied"
          ? `application:followup:${vacancy.id}:${view}`
          : `vacancy:remind:${vacancy.id}:${view}`,
        origin
      )
    );

  if ("userStatus" in vacancy) {
    keyboard
      .row()
      .text(vacancy.userStatus === "saved" ? "💾 Убрать из сохранённых" : "💾 Сохранить", appendVacancyCardOrigin(`vacancy:status:${vacancy.id}:saved:${view}`, origin))
      .text(vacancy.userStatus === "applied" ? "✅ Снять отметку" : "✅ Откликнулся", appendVacancyCardOrigin(`vacancy:status:${vacancy.id}:applied:${view}`, origin));

    if (vacancy.userStatus === "applied") {
      keyboard.row().text("↩️ К откликам", "status:applied:0");
    }

    if (vacancy.userStatus !== "hidden") {
      keyboard
        .row()
        .text(relevanceValue === "relevant" ? "👍 Релевантна ✅" : "👍 Релевантна", appendVacancyCardOrigin(`vacancy:relevance:${vacancy.id}:relevant:${view}`, origin))
        .text(relevanceValue === "not_relevant" ? "👎 Не подходит ✅" : "👎 Не подходит", appendVacancyCardOrigin(`vacancy:status:${vacancy.id}:hidden:${view}`, origin));
    }
    else {
      keyboard
        .row()
        .text("↩️ Вернуть в подборку", appendVacancyCardOrigin(`vacancy:status:${vacancy.id}:hidden:${view}`, origin));
    }
  }

  return appendWeeklyReturn(keyboard, origin);
}

export function createApplicationFollowUpPromptKeyboard(
  vacancyId: number,
  view: VacancyNotificationView,
  origin?: VacancyCardOrigin,
  showDebugMinute = false
): InlineKeyboard {
  const keyboard = new InlineKeyboard()
    .text("📅 Через 3 дня", appendVacancyCardOrigin(`application:followup:set:${vacancyId}:three_days:${view}`, origin))
    .text("🗓 Через неделю", appendVacancyCardOrigin(`application:followup:set:${vacancyId}:week:${view}`, origin));

  if (showDebugMinute) {
    keyboard.row().text("🧪 Через 1 минуту", appendVacancyCardOrigin(`application:followup:set:${vacancyId}:one_minute:${view}`, origin));
  }

  keyboard
    .row()
    .text("📝 Добавить заметку", appendVacancyCardOrigin(`application:note:${vacancyId}:${view}`, origin))
    .text("Без напоминания", appendVacancyCardOrigin(`application:followup:skip:${vacancyId}:${view}`, origin))
    .row()
    .text("↩️ К вакансии", appendVacancyCardOrigin(`vacancy:view:${vacancyId}:${view}`, origin))
    .text("↩️ К откликам", "status:applied:0");

  return appendWeeklyReturn(keyboard, origin);
}

export function createApplicationFollowUpDeliveryKeyboard(vacancyId: number, url: string, showDebugMinute = false): InlineKeyboard {
  const keyboard = new InlineKeyboard()
    .text("📅 Через 3 дня", `application:followup:set:${vacancyId}:three_days:compact`)
    .text("🗓 Через неделю", `application:followup:set:${vacancyId}:week:compact`);

  if (showDebugMinute) {
    keyboard.row().text("🧪 Через 1 минуту", `application:followup:set:${vacancyId}:one_minute:compact`);
  }

  return keyboard
    .row()
    .text("✅ Уже ответили", `application:responded:${vacancyId}`)
    .text("📦 Закрыть follow-up", `application:closed:${vacancyId}`)
    .row()
    .url("🔗 Открыть пост", url);
}

export function createApplicationStatusPageKeyboard(page: UserVacancyApplicationPage): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  page.items.forEach((application, index) => {
    if (index > 0 && index % 5 === 0) {
      keyboard.row();
    }
    keyboard.text(String(page.offset + index + 1), `application:detail:${application.id}:${page.offset}`);
  });

  if (page.items.length > 0) {
    keyboard.row();
  }

  const previousOffset = Math.max(0, page.offset - page.pageSize);
  const nextOffset = page.offset + page.pageSize;
  if (page.offset > 0) {
    keyboard.text("⬅️ Назад", `status:applied:${previousOffset}`);
  }
  if (nextOffset < page.total) {
    keyboard.text("➡️ Дальше", `status:applied:${nextOffset}`);
  }

  return keyboard
    .row()
    .text("🔄 Обновить", `status:applied:${page.offset}`)
    .row()
    .text("↩️ Мои вакансии", "menu:vacancies");
}

export function createApplicationDetailKeyboard(
  application: UserVacancyApplicationRecord,
  offset: number,
  showDebugMinute = false
): InlineKeyboard {
  const keyboard = new InlineKeyboard()
    .url("🔗 Открыть пост", application.url)
    .row()
    .text("⏰ Follow-up", `application:followup:${application.id}:compact`)
    .text("📝 Заметка", `application:note:${application.id}:detail:${offset}`);

  if (showDebugMinute) {
    keyboard.row().text("🧪 Через 1 минуту", `application:followup:set:${application.id}:one_minute:compact`);
  }

  return keyboard
    .row()
    .text("✅ Уже ответили", `application:responded:${application.id}:detail:${offset}`)
    .text("📦 Закрыть follow-up", `application:closed:${application.id}:detail:${offset}`)
    .row()
    .text("↩️ Снять отклик", `application:clear:${application.id}:${offset}`)
    .text("↩️ К откликам", `status:applied:${offset}`);
}

export function createVacancyReminderKeyboard(
  vacancyId: number,
  view: VacancyNotificationView,
  hasActiveReminder: boolean,
  origin?: VacancyCardOrigin
): InlineKeyboard {
  const keyboard = new InlineKeyboard()
    .text("🌙 Вечером", appendVacancyCardOrigin(`vacancy:remind:set:${vacancyId}:evening:${view}`, origin))
    .text("☀️ Завтра", appendVacancyCardOrigin(`vacancy:remind:set:${vacancyId}:tomorrow:${view}`, origin))
    .row()
    .text("📅 Через 3 дня", appendVacancyCardOrigin(`vacancy:remind:set:${vacancyId}:three_days:${view}`, origin));

  if (hasActiveReminder) {
    keyboard.row().text("🚫 Отменить напоминание", appendVacancyCardOrigin(`vacancy:remind:cancel:${vacancyId}:${view}`, origin));
  }

  keyboard
    .row()
    .text("↩️ К вакансии", appendVacancyCardOrigin(`vacancy:view:${vacancyId}:${view}`, origin))
    .row()
    .text("🏠 Меню", "menu:home");

  return appendWeeklyReturn(keyboard, origin);
}

export function createUserSettingsKeyboardWithStatuses(
  weeklyPageSize?: number,
  notifyOnEmptyCycle = false,
  dailyDigestEnabled = false
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  if (weeklyPageSize !== undefined) {
    keyboard.text(`📄 В недельной выдаче: ${weeklyPageSize}`, "settings:weekly_page_size").row();
  }

  return keyboard
    .text(
      dailyDigestEnabled ? "🌅 Выключить утренний дайджест" : "🌅 Включить утренний дайджест",
      "notifications:toggle_daily_digest"
    )
    .row()
    .text(
      notifyOnEmptyCycle ? "🔕 Не сообщать, если новых вакансий нет" : "🔔 Сообщать, если новых вакансий нет",
      "notifications:toggle_empty_cycle_notice"
    )
    .row()
    .text("🩺 Почему бот молчит?", "menu:diagnostics")
    .row()
    .text("↩️ Меню", "menu:home");
}

export function createMyVacanciesKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("💾 Сохранённые", "status:saved:0")
    .text("✅ Отклики", "status:applied:0")
    .row()
    .text("🙈 Скрытые", "status:hidden:0")
    .text("⏰ Напоминания", "reminders:page:0")
    .row()
    .text("↩️ Меню", "menu:home");
}

export function createVacancyRemindersPageKeyboard(page: VacancyReminderPage): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  page.items.forEach((reminder, index) => {
    keyboard
      .row()
      .url(`🔗 ${page.offset + index + 1}`, reminder.url)
      .text("🚫 Отменить", `reminders:cancel:${reminder.id}:${page.offset}`);
  });

  const previousOffset = Math.max(0, page.offset - page.pageSize);
  const nextOffset = page.offset + page.pageSize;
  if (page.offset > 0) {
    keyboard.text("⬅️ Назад", `reminders:page:${previousOffset}`);
  }
  if (nextOffset < page.total) {
    keyboard.text("➡️ Дальше", `reminders:page:${nextOffset}`);
  }

  return keyboard
    .row()
    .text("🔄 Обновить", `reminders:page:${page.offset}`)
    .row()
    .text("↩️ Мои вакансии", "menu:vacancies");
}

export function createStatusPageKeyboard(page: UserStatusVacancyPage): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const clearLabel =
    page.status === "hidden"
      ? "👁️ Вернуть"
      : page.status === "saved"
        ? "↩️ Убрать"
        : "↩️ Снять";

  page.items.forEach((vacancy, index) => {
    keyboard
      .row()
      .url(`🔗 ${page.offset + index + 1}`, vacancy.url)
      .text(clearLabel, `status:clear:${vacancy.id}:${page.status}:${page.offset}`);
  });

  const previousOffset = Math.max(0, page.offset - page.pageSize);
  const nextOffset = page.offset + page.pageSize;

  if (page.offset > 0) {
    keyboard.text("⬅️ Назад", `status:${page.status}:${previousOffset}`);
  }
  if (nextOffset < page.total) {
    keyboard.text("➡️ Дальше", `status:${page.status}:${nextOffset}`);
  }

  keyboard
    .row()
    .text("🔄 Обновить", `status:${page.status}:${page.offset}`)
    .row()
    .text("↩️ Мои вакансии", "menu:vacancies");

  return keyboard;
}

export function createUserSettingsKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🔔 Уведомления", "menu:notifications")
    .text("🩺 Диагностика", "menu:diagnostics")
    .row()
    .text("🏠 Меню", "menu:home");
}

export function createLanguageToggleLabel(mode: VacancyLanguageMode): string {
  return `Переключить язык вакансий (${vacancyLanguageModeFlags(mode)})`;
}

export function createPersonalFiltersKeyboardWithRematch(vacancyLanguageMode: VacancyLanguageMode): InlineKeyboard {
  return new InlineKeyboard()
    .text("🎯 Условия и формат", "filters:edit_required_context")
    .row()
    .text("🧩 Основной профиль", "filters:edit_required_primary")
    .row()
    .text("⭐ Желательные сигналы", "filters:edit_preferred")
    .text("🚫 Стоп-слова", "filters:edit_exclude")
    .row()
    .text(createLanguageToggleLabel(vacancyLanguageMode), "filters:toggle_language")
    .row()
    .text("🧩 Пресеты", "menu:filter_presets")
    .row()
    .text("🔄 Пересобрать подборку", "filters:rematch")
    .row()
    .text("↩️ Сбросить профиль", "filters:reset_profile")
    .row()
    .text("🏠 Меню", "menu:home");
}

export function createSearchProfilesKeyboard(profiles: UserSearchProfileRecord[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  for (const profile of profiles) {
    keyboard.text(`${profile.isActive ? "🟢" : "⏸️"} ${profile.name}`, `filters:profile:${profile.id}`).row();
  }

  if (profiles.length < 5) {
    keyboard.text("➕ Добавить поиск", "filters:add").row();
  }

  return keyboard.text("🏠 Меню", "menu:home");
}

export function createSearchProfileDetailKeyboard(profile: UserSearchProfileRecord): InlineKeyboard {
  return new InlineKeyboard()
    .text("🗂️ Вакансии", `week:profile:${profile.id}:0`)
    .row()
    .text("🔄 Пересобрать", `filters:profile:${profile.id}:rematch`)
    .text(profile.isActive ? "⏸️ Пауза" : "▶️ Возобновить", `filters:profile:${profile.id}:toggle`)
    .row()
    .text("🎯 Условия и формат", `filters:profile:${profile.id}:edit:required_context`)
    .row()
    .text("🧩 Основной профиль", `filters:profile:${profile.id}:edit:required_primary`)
    .row()
    .text("⭐ Желательные сигналы", `filters:profile:${profile.id}:edit:preferred`)
    .text("🚫 Стоп-слова", `filters:profile:${profile.id}:edit:exclude`)
    .row()
    .text(createLanguageToggleLabel(profile.vacancyLanguageMode), `filters:profile:${profile.id}:language`)
    .row()
    .text("🧩 Применить пресет", `filters:profile:${profile.id}:presets`)
    .text("✏️ Переименовать", `filters:profile:${profile.id}:rename`)
    .row()
    .text("↩️ Очистить фильтры", `filters:profile:${profile.id}:reset`)
    .text("🗑️ Удалить", `filters:profile:${profile.id}:delete`)
    .row()
    .text("🎯 Все поиски", "menu:filters")
    .row()
    .text("🏠 Меню", "menu:home");
}

export function createAddSearchProfileKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🧩 Выбрать пресет", "filters:add:presets")
    .row()
    .text("✍️ Создать вручную", "filters:add:manual")
    .row()
    .text("🎯 Все поиски", "menu:filters")
    .row()
    .text("🏠 Меню", "menu:home");
}

export function createSearchProfileDeleteConfirmationKeyboard(profileId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("🗑️ Да, удалить поиск", `filters:profile:${profileId}:confirm_delete`)
    .row()
    .text("↩️ Отмена", `filters:profile:${profileId}`)
    .row()
    .text("🏠 Меню", "menu:home");
}

export function createSearchProfileResetConfirmationKeyboard(profileId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("🗑️ Да, очистить фильтры", `filters:profile:${profileId}:confirm_reset`)
    .row()
    .text("↩️ Отмена", `filters:profile:${profileId}`)
    .row()
    .text("🏠 Меню", "menu:home");
}

export function createPersonalFiltersResetConfirmationKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🗑️ Да, сбросить профиль", "filters:confirm_reset_profile")
    .row()
    .text("↩️ Отмена", "menu:filters")
    .row()
    .text("🏠 Меню", "menu:home");
}

export function createOnboardingWelcomeKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🧩 Выбрать пресет", "onboarding:preset_menu")
    .row()
    .text("✍️ Настроить вручную", "onboarding:manual_start")
    .row()
    .text("⏭️ Настрою позже", "onboarding:skip");
}

export function createOnboardingPresetKeyboard(forecasts: SearchProfilePresetForecast[] = []): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const forecastByPreset = new Map(forecasts.map((forecast) => [forecast.presetId, forecast]));
  const labelForPreset = (presetId: string, label: string): string => {
    const forecast = forecastByPreset.get(presetId as SearchProfilePresetForecast["presetId"]);
    if (!forecast) {
      return label;
    }
    return forecast.matchesCount === 0 ? `${label} · мало данных` : `${label} · ~${forecast.matchesCount}`;
  };

  for (const group of listSearchProfilePresetGroups()) {
    keyboard.text(`— ${group.label} —`, "noop").row();
    for (let index = 0; index < group.presets.length; index += 2) {
      const left = group.presets[index];
      const right = group.presets[index + 1];
      keyboard.text(labelForPreset(left.id, left.label), `filters:preset:${left.id}`);
      if (right) {
        keyboard.text(labelForPreset(right.id, right.label), `filters:preset:${right.id}`);
      }
      keyboard.row();
    }
  }

  return keyboard
    .text("✍️ Настроить вручную", "onboarding:manual_start")
    .text("↩️ Назад", "onboarding:welcome")
    .row()
    .text("⏭️ Настрою позже", "onboarding:skip");
}

export function createOnboardingInputKeyboard(allowSkipStep: boolean): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  if (allowSkipStep) {
    keyboard.text("⏭️ Пропустить шаг", "onboarding:skip_step").row();
  }

  return keyboard.text("⏸️ Завершить позже", "onboarding:skip");
}

export function createOnboardingLanguageKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🌐 Русский и английский", "onboarding:language:ru_en")
    .row()
    .text("🇷🇺 Только русский", "onboarding:language:ru_only")
    .row()
    .text("🇬🇧 Только английский", "onboarding:language:en_only");
}

export function createOnboardingCompletionKeyboard(showAdmin: boolean, showWeekly: boolean): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  if (showWeekly) {
    keyboard.text("🗂️ Подборка вакансий", "week:0").row();
  }

  keyboard.text("🎯 Мои поиски", "menu:filters");

  if (showAdmin) {
    keyboard.row().text("⚙️ Настройки (админ)", "menu:admin");
  }

  return keyboard.row().text("🏠 Меню", "menu:home");
}

export function createRematchSummaryKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🗂️ Подборка вакансий", "week:0")
    .row()
    .text("🎯 Мои поиски", "menu:filters")
    .row()
    .text("🏠 Меню", "menu:home");
}
