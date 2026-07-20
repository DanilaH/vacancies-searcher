import { Bot, Context } from "grammy";

import { AppConfig, getSourceNameForMode } from "../config";
import { VacancyDatabase } from "../db/database";
import { RuntimeSettingsService } from "../runtime/runtimeSettings";
import { getSearchProfileHealth } from "../services/searchProfileHealth";
import { getEffectiveWeeklyPageSize, normalizeWeeklyOffset } from "../services/weeklyPageSize";
import { DEFAULT_WEEKLY_WINDOW_DAYS, normalizeWeeklyWindowDays } from "../services/weeklyWindow";
import {
  MatchedVacancyRecord,
  SourceName,
  SearchProfilePresetForecast,
  UserSearchProfile,
  UserVacancyRematchSummary,
  VacancyLanguageMode,
  VacancyRecord,
  VacancyUserStatus
} from "../types";
import {
  formatHhSearchSettingsPanel,
  formatPersonalFiltersPanel,
  formatSearchProfilesPanel,
  formatSearchProfilePresets,
  createHhSearchSettingsKeyboard,
  createSearchProfilePresetsKeyboard
} from "./admin";
import {
  createBlockedWeeklyKeyboard,
  createDiagnosticsKeyboard,
  createDiagnosticsKeyboardWithSuggestion,
  createMainKeyboard,
  createNotificationsKeyboard,
  createPersonalFiltersKeyboardWithRematch,
  createAddSearchProfileKeyboard,
  createSearchProfileDetailKeyboard,
  createSearchProfilesKeyboard,
  createApplicationStatusPageKeyboard,
  createMyVacanciesKeyboard,
  createStatusPageKeyboard,
  createVacancyRemindersPageKeyboard,
  createUserSettingsKeyboardWithStatuses,
  createWeeklyKeyboard,
  createWeeklyZeroStateKeyboard
} from "./keyboards";
import {
  formatBlockedWeeklyAccess,
  formatApplicationStatusPage,
  formatMyVacanciesPanel,
  formatNotificationPreferences,
  formatStartMessage,
  formatStatusVacancies,
  formatUserQuietDiagnostics,
  formatUserSettingsPanel,
  formatVacancyReminders,
  formatVacancyNotification,
  formatWeeklyVacancies
} from "./formatters";
import { BotPanelMode, replyOrEdit } from "./render";

export interface UserPanelsDeps {
  bot: Bot<Context>;
  config: AppConfig;
  database: VacancyDatabase;
  runtimeSettings: RuntimeSettingsService;
  sourceName: SourceName;
  userRematchWindowDays: number;
  userStatusPageSize: number;
  getCurrentUserId(ctx: Pick<Context, "from">): string | null;
  shouldShowAdmin(userId: string | number | undefined): boolean;
  shouldShowNotifications(userId: string | number | undefined): boolean;
  shouldShowWeeklyEntry(userId: string | number | undefined | null): boolean;
  getLatestRematchSummary(userId: string): UserVacancyRematchSummary | null;
  getPresetForecasts(userId: string, languageMode: VacancyLanguageMode): SearchProfilePresetForecast[];
}

function analyticsNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function analyticsString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function buildStatusActionText(status: Exclude<VacancyUserStatus, "inbox">, cleared: boolean): string {
  if (status === "saved") {
    return cleared ? "↩️ Убрано из сохранённых." : "💾 Добавлено в сохранённые.";
  }

  if (status === "applied") {
    return cleared ? "↩️ Отметка снята." : "✅ Отметил как отклик.";
  }

  return cleared ? "👁️ Вакансия возвращена в поток." : "🙈 Вакансия скрыта.";
}

export interface UserPanels {
  showNotificationsPanel(ctx: Context, mode?: BotPanelMode): Promise<void>;
  showUserSettingsPanel(ctx: Context, mode?: BotPanelMode): Promise<void>;
  showMyVacanciesPanel(ctx: Context, mode?: BotPanelMode): Promise<void>;
  showUserQuietDiagnosticsPanel(ctx: Context, mode?: BotPanelMode): Promise<void>;
  showPersonalFiltersPanel(ctx: Context, mode?: BotPanelMode): Promise<void>;
  showSearchProfileDetailPanel(ctx: Context, profileId: number, mode?: BotPanelMode): Promise<void>;
  showAddSearchProfilePanel(ctx: Context, mode?: BotPanelMode): Promise<void>;
  showHhSearchSettingsPanel(ctx: Context, mode?: BotPanelMode): Promise<void>;
  showSearchProfilePresetsPanel(ctx: Context, mode?: BotPanelMode, targetProfileId?: number | "new"): Promise<void>;
  sendWeeklyPage(userId: string, chatId: string | number, offset?: number, showAdmin?: boolean, days?: number): Promise<void>;
  showBlockedWeeklyAccessPanel(ctx: Context, userId: string, mode?: BotPanelMode): Promise<void>;
  showStatusPage(
    ctx: Context,
    userId: string,
    status: Exclude<VacancyUserStatus, "inbox">,
    offset?: number,
    mode?: BotPanelMode
  ): Promise<void>;
  showVacancyRemindersPage(ctx: Context, userId: string, offset?: number, mode?: BotPanelMode): Promise<void>;
  buildVacancyMessageRecord(userId: string, vacancyId: number, statusOverride?: VacancyUserStatus): MatchedVacancyRecord | null;
  enrichVacancyDuplicatePosts<T extends VacancyRecord>(vacancy: T): T;
  showStartPanel(ctx: Context, mode?: BotPanelMode): Promise<void>;
}

export function createUserPanels(deps: UserPanelsDeps): UserPanels {
  const {
    bot,
    config,
    database,
    runtimeSettings,
    userRematchWindowDays,
    userStatusPageSize,
    getCurrentUserId,
    shouldShowAdmin,
    shouldShowNotifications,
    shouldShowWeeklyEntry,
    getLatestRematchSummary,
    getPresetForecasts
  } = deps;
  const sourceName = deps.sourceName ?? getSourceNameForMode(config.telegramSourceMode);

  function emptyProfile(userId: string): UserSearchProfile {
    return {
      userId,
      requiredContextKeywords: [],
      requiredPrimaryKeywords: [],
      preferredKeywords: [],
      excludeKeywords: [],
      updatedAt: new Date(0).toISOString()
    };
  }

  function buildStartProfileNotice(currentUserId: string | null): string | null {
    if (!currentUserId) {
      return null;
    }

    const healthReports = database
      .listUserSearchProfiles(currentUserId, true)
      .map((profile) => getSearchProfileHealth(profile));
    if (healthReports.some((health) => health.isSearchActive)) {
      return null;
    }

    if (healthReports.some((health) => health.status === "weak")) {
      return [
        "🟡 Профиль настроен частично.",
        "Заполни обязательные блоки в разделе «Мои фильтры», чтобы открыть подборку вакансий за неделю."
      ].join("\n");
    }

    return [
      "🔴 Поиск пока неактивен.",
      "Заполни профиль в разделе «Мои фильтры» или выбери готовый пресет, чтобы открыть подборку и получать подходящие вакансии."
    ].join("\n");
  }

  async function showNotificationsPanel(ctx: Context, mode: BotPanelMode = "reply"): Promise<void> {
    const currentUserId = getCurrentUserId(ctx);
    const settings = currentUserId ? database.getUserSettings(currentUserId) : null;
    await replyOrEdit(ctx, mode, formatNotificationPreferences(settings?.notifyOnEmptyCycle ?? false, settings?.dailyDigestEnabled ?? false), {
      reply_markup: createNotificationsKeyboard(settings?.notifyOnEmptyCycle ?? false, settings?.dailyDigestEnabled ?? false)
    });
  }

  async function showUserSettingsPanel(ctx: Context, mode: BotPanelMode = "reply"): Promise<void> {
    const currentUserId = getCurrentUserId(ctx);
    const settings = currentUserId ? database.getUserSettings(currentUserId) : null;
    const weeklyPageSize = getEffectiveWeeklyPageSize(settings, runtimeSettings.getSnapshot().weeklyPageSize);
    await replyOrEdit(ctx, mode, formatUserSettingsPanel(settings?.notifyOnEmptyCycle ?? false, weeklyPageSize, settings?.dailyDigestEnabled ?? false), {
      reply_markup: createUserSettingsKeyboardWithStatuses(
        weeklyPageSize,
        settings?.notifyOnEmptyCycle ?? false,
        settings?.dailyDigestEnabled ?? false
      )
    });
  }

  async function showMyVacanciesPanel(ctx: Context, mode: BotPanelMode = "reply"): Promise<void> {
    await replyOrEdit(ctx, mode, formatMyVacanciesPanel(), {
      reply_markup: createMyVacanciesKeyboard()
    });
  }

  async function showUserQuietDiagnosticsPanel(ctx: Context, mode: BotPanelMode = "reply"): Promise<void> {
    const currentUserId = getCurrentUserId(ctx);
    if (!currentUserId) {
      return;
    }

    const activeProfile = database.listUserSearchProfiles(currentUserId, true)[0] ?? null;
    const profile = activeProfile ?? emptyProfile(currentUserId);
    const settings = database.getUserSettings(currentUserId);
    const hhSettings = database.getUserHhSearchSettings(currentUserId);
    const filterSuggestion = database.getHiddenVacancyFilterSuggestionCandidate(currentUserId, 7);
    if (filterSuggestion) {
      database.markUserFilterSuggestionShown(currentUserId, filterSuggestion.suggestionKey);
    }
    const latestPollEvent = database.listAnalyticsEvents(1, "poll_cycle_completed")[0] ?? null;
    const latestPollCycle = latestPollEvent
      ? {
          sourceName: analyticsString(latestPollEvent.properties.source_name) ?? "unknown",
          fetchedItemsCount: analyticsNumber(latestPollEvent.properties.fetched_items_count),
          newVacanciesCount: analyticsNumber(latestPollEvent.properties.new_vacancies_count),
          checkedAtIso: latestPollEvent.occurredAt
        }
      : null;

    const text = formatUserQuietDiagnostics(
      {
        profile,
        health: getSearchProfileHealth(profile),
        onboardingCompleted: settings.onboardingCompleted,
        botPaused: database.isBotPaused(config.ownerUserId),
        notifyOnEmptyCycle: settings.notifyOnEmptyCycle,
        dailyDigestEnabled: settings.dailyDigestEnabled,
        latestDailyDigestDelivery: database.getLatestDailyDigestDelivery(currentUserId),
        hiddenFeedbackSummary: database.countHiddenVacancyFeedbackSummary(currentUserId, 7),
        filterSuggestion,
        vacancyLanguageMode: activeProfile?.vacancyLanguageMode ?? settings.vacancyLanguageMode,
        weeklyMatchesCount: database.listUserWeeklyVacancies(currentUserId, 0, 1, userRematchWindowDays).total,
        telegramActiveChannelsCount: database.countActiveChannels(sourceName),
        hhSourceEnabled: config.hhSourceEnabled,
        hhUserEnabled: hhSettings.enabled,
        hhUserQuery: hhSettings.text,
        companyCareersSourceEnabled: config.companyCareersSourceEnabled,
        companyCareerSourcesCount: database.countActiveCompanyCareerSources(),
        latestPollCycle
      },
      config
    );

    await replyOrEdit(ctx, mode, text, {
      reply_markup: filterSuggestion
        ? createDiagnosticsKeyboardWithSuggestion(settings.onboardingCompleted, filterSuggestion)
        : createDiagnosticsKeyboard(settings.onboardingCompleted)
    });
  }

  async function showPersonalFiltersPanel(ctx: Context, mode: BotPanelMode = "reply"): Promise<void> {
    const currentUserId = getCurrentUserId(ctx);
    if (!currentUserId) {
      return;
    }

    const profiles = database.listUserSearchProfiles(currentUserId);
    const statsByProfile = new Map(
      database.listUserSearchProfileWeeklyStats(currentUserId, userRematchWindowDays)
        .map((stats) => [stats.profileId, stats])
    );
    const text = formatSearchProfilesPanel(
      profiles.map((profile) => ({
        profile,
        health: getSearchProfileHealth(profile),
        weeklyStats: statsByProfile.get(profile.id)
      }))
    );

    await replyOrEdit(ctx, mode, text, {
      reply_markup: createSearchProfilesKeyboard(profiles)
    });
  }

  async function showSearchProfileDetailPanel(
    ctx: Context,
    profileId: number,
    mode: BotPanelMode = "reply"
  ): Promise<void> {
    const currentUserId = getCurrentUserId(ctx);
    if (!currentUserId) {
      return;
    }

    const profile = database.getUserSearchProfileById(currentUserId, profileId);
    if (!profile) {
      await showPersonalFiltersPanel(ctx, mode);
      return;
    }

    await replyOrEdit(
      ctx,
      mode,
      formatPersonalFiltersPanel(profile, getSearchProfileHealth(profile), profile.vacancyLanguageMode),
      { reply_markup: createSearchProfileDetailKeyboard(profile) }
    );
  }

  async function showAddSearchProfilePanel(ctx: Context, mode: BotPanelMode = "reply"): Promise<void> {
    await replyOrEdit(
      ctx,
      mode,
      [
        "➕ Новый поиск",
        "",
        "Можно начать с готового пресета или создать пустой профиль и настроить его вручную."
      ].join("\n"),
      { reply_markup: createAddSearchProfileKeyboard() }
    );
  }

  async function showHhSearchSettingsPanel(ctx: Context, mode: BotPanelMode = "reply"): Promise<void> {
    const currentUserId = getCurrentUserId(ctx);
    if (!currentUserId) {
      return;
    }

    const settings = database.getUserHhSearchSettings(currentUserId);
    await replyOrEdit(ctx, mode, formatHhSearchSettingsPanel(settings, config.hhSourceEnabled), {
      reply_markup: createHhSearchSettingsKeyboard(settings)
    });
  }

  async function showSearchProfilePresetsPanel(
    ctx: Context,
    mode: BotPanelMode = "reply",
    targetProfileId?: number | "new"
  ): Promise<void> {
    const currentUserId = getCurrentUserId(ctx);
    if (!currentUserId) {
      return;
    }
    const targetProfile = typeof targetProfileId === "number"
      ? database.getUserSearchProfileById(currentUserId, targetProfileId)
      : null;
    const languageMode = targetProfile?.vacancyLanguageMode ?? database.getUserSettings(currentUserId).vacancyLanguageMode;
    const forecasts = getPresetForecasts(currentUserId, languageMode);

    await replyOrEdit(ctx, mode, formatSearchProfilePresets(), {
      reply_markup: createSearchProfilePresetsKeyboard(targetProfileId, forecasts)
    });
  }

  async function sendWeeklyPage(
    userId: string,
    chatId: string | number,
    offset = 0,
    showAdmin = false,
    days = DEFAULT_WEEKLY_WINDOW_DAYS
  ): Promise<void> {
    const windowDays = normalizeWeeklyWindowDays(days);
    const weeklyPageSize = getEffectiveWeeklyPageSize(database.getUserSettings(userId), runtimeSettings.getSnapshot().weeklyPageSize);
    let page = database.listUserWeeklyVacancies(userId, normalizeWeeklyOffset(offset, weeklyPageSize), weeklyPageSize, windowDays);
    if (page.total > 0 && page.offset >= page.total) {
      page = database.listUserWeeklyVacancies(userId, normalizeWeeklyOffset(page.offset, weeklyPageSize, page.total), weeklyPageSize, windowDays);
    }
    const activeProfiles = database.listUserSearchProfiles(userId, true);
    const text = formatWeeklyVacancies(page, config, undefined, {
      activeProfiles,
      rematchSummary: getLatestRematchSummary(userId),
      days: windowDays
    });
    const showNotifications = shouldShowNotifications(userId);

    await bot.api.sendMessage(chatId, text, {
      reply_markup: page.total > 0
        ? createWeeklyKeyboard(page, showNotifications, undefined, windowDays)
        : createWeeklyZeroStateKeyboard(page, undefined, database.listUserSearchProfiles(userId).length, windowDays)
    });
  }

  async function showBlockedWeeklyAccessPanel(
    ctx: Context,
    userId: string,
    mode: BotPanelMode = "reply"
  ): Promise<void> {
    const profile = database.listUserSearchProfiles(userId, true)[0] ?? emptyProfile(userId);
    const health = getSearchProfileHealth(profile);
    await replyOrEdit(ctx, mode, formatBlockedWeeklyAccess(profile, health), {
      reply_markup: createBlockedWeeklyKeyboard()
    });
  }

  async function showStatusPage(
    ctx: Context,
    userId: string,
    status: Exclude<VacancyUserStatus, "inbox">,
    offset = 0,
    mode: BotPanelMode = "edit"
  ): Promise<void> {
    if (status === "applied") {
      let page = database.listUserVacancyApplications(userId, offset, userStatusPageSize);

      if (page.total > 0 && page.offset >= page.total) {
        const lastOffset = Math.floor((page.total - 1) / page.pageSize) * page.pageSize;
        page = database.listUserVacancyApplications(userId, lastOffset, userStatusPageSize);
      }

      await replyOrEdit(ctx, mode, formatApplicationStatusPage(page, config), {
        reply_markup: page.total > 0 ? createApplicationStatusPageKeyboard(page) : createMyVacanciesKeyboard()
      });
      return;
    }

    let page = database.listUserVacanciesByStatus(userId, status, offset, userStatusPageSize);

    if (page.total > 0 && page.offset >= page.total) {
      const lastOffset = Math.floor((page.total - 1) / page.pageSize) * page.pageSize;
      page = database.listUserVacanciesByStatus(userId, status, lastOffset, userStatusPageSize);
    }

    await replyOrEdit(ctx, mode, formatStatusVacancies(page, config), {
      reply_markup: page.total > 0 ? createStatusPageKeyboard(page) : createMyVacanciesKeyboard()
    });
  }

  async function showVacancyRemindersPage(
    ctx: Context,
    userId: string,
    offset = 0,
    mode: BotPanelMode = "edit"
  ): Promise<void> {
    let page = database.listUserVacancyReminders(userId, offset, userStatusPageSize);

    if (page.total > 0 && page.offset >= page.total) {
      const lastOffset = Math.floor((page.total - 1) / page.pageSize) * page.pageSize;
      page = database.listUserVacancyReminders(userId, lastOffset, userStatusPageSize);
    }

    await replyOrEdit(ctx, mode, formatVacancyReminders(page, config), {
      reply_markup: page.total > 0 ? createVacancyRemindersPageKeyboard(page) : createMyVacanciesKeyboard()
    });
  }

  function buildVacancyMessageRecord(
    userId: string,
    vacancyId: number,
    statusOverride?: VacancyUserStatus
  ): MatchedVacancyRecord | null {
    const matchedVacancy = database.getUserMatchedVacancy(userId, vacancyId);
    const application = database.getUserVacancyApplication(userId, vacancyId);
    const hiddenReason = database.getUserVacancyHiddenReason(userId, vacancyId)?.reason ?? null;
    if (matchedVacancy) {
      if (statusOverride === undefined || matchedVacancy.userStatus === statusOverride) {
        return {
          ...matchedVacancy,
          hiddenReason: matchedVacancy.userStatus === "hidden" ? hiddenReason : null,
          application
        };
      }

      return {
        ...matchedVacancy,
        userStatus: statusOverride,
        hiddenReason: statusOverride === "hidden" ? hiddenReason : null,
        application
      };
    }

    const vacancy = database.getVacancy(vacancyId);
    if (!vacancy) {
      return null;
    }

    return {
      ...vacancy,
      userId,
      deliveredAt: null,
      matchedAt: vacancy.createdAt,
      userStatus: statusOverride ?? database.getUserVacancyStatus(userId, vacancyId),
      statusUpdatedAt: null,
      hiddenReason: (statusOverride ?? database.getUserVacancyStatus(userId, vacancyId)) === "hidden" ? hiddenReason : null,
      application
    };
  }

  function enrichVacancyDuplicatePosts<T extends VacancyRecord>(vacancy: T): T {
    const duplicatePosts = database.listVacancyDuplicatePosts(vacancy.id, 5);
    if (duplicatePosts.total === 0) {
      return vacancy;
    }

    return {
      ...vacancy,
      duplicatePosts: duplicatePosts.items,
      duplicatePostsTotal: duplicatePosts.total
    };
  }

  async function showStartPanel(ctx: Context, mode: BotPanelMode = "reply"): Promise<void> {
    const currentUserId = getCurrentUserId(ctx);
    const startNotice = buildStartProfileNotice(currentUserId);
    const text = startNotice ? [formatStartMessage(config), startNotice].join("\n\n") : formatStartMessage(config);
    const replyMarkup = createMainKeyboard(
      shouldShowAdmin(ctx.from?.id),
      shouldShowNotifications(ctx.from?.id),
      shouldShowWeeklyEntry(currentUserId)
    );

    await replyOrEdit(ctx, mode, text, {
      reply_markup: replyMarkup
    });
  }

  return {
    showNotificationsPanel,
    showUserSettingsPanel,
    showMyVacanciesPanel,
    showUserQuietDiagnosticsPanel,
    showPersonalFiltersPanel,
    showSearchProfileDetailPanel,
    showAddSearchProfilePanel,
    showHhSearchSettingsPanel,
    showSearchProfilePresetsPanel,
    sendWeeklyPage,
    showBlockedWeeklyAccessPanel,
    showStatusPage,
    showVacancyRemindersPage,
    buildVacancyMessageRecord,
    enrichVacancyDuplicatePosts,
    showStartPanel
  };
}
