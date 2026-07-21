import fs from "node:fs";
import * as grammy from "grammy";

import type { AnalyticsService } from "../analytics/analyticsService";
import * as configModule from "../config";
import type { AppConfig } from "../config";
import type { VacancyDatabase } from "../db/database";
import * as loggerModule from "../logger";
import type { RuntimeSettingsService } from "../runtime/runtimeSettings";
import * as channelProbe from "../services/channelProbe";
import * as searchProfileHealth from "../services/searchProfileHealth";
import * as searchProfilePresets from "../services/searchProfilePresets";
import * as channelDiscovery from "../services/channelDiscovery";
import type { ChannelDiscoveryService } from "../services/channelDiscovery";
import * as channelDiscoveryProfiles from "../services/channelDiscoveryProfiles";
import * as companyCareerUrls from "../services/companyCareerUrls";
import * as channelValidation from "../services/channelValidation";
import * as hhSearchValidation from "../services/hhSearchValidation";
import * as runtimeSettingValidation from "../services/runtimeSettingValidation";
import * as searchProfileValidation from "../services/searchProfileValidation";
import { getEffectiveWeeklyPageSize, nextWeeklyPageSize, normalizeWeeklyOffset } from "../services/weeklyPageSize";
import { DEFAULT_WEEKLY_WINDOW_DAYS, normalizeWeeklyWindowDays } from "../services/weeklyWindow";
import { calculateApplicationFollowUpAt } from "../services/applicationFollowUpSchedule";
import {
    formatDigestScheduledFor,
    getLocalDigestDateParts,
    resolveDailyDigestTimeMinutes
} from "../services/dailyDigestSchedule";
import { hasActionableDailyDigest } from "../services/dailyDigestScheduler";
import {
    FILTER_SUGGESTION_LABELS,
    HIDDEN_VACANCY_REASON_LABELS,
    parseHiddenVacancyReason
} from "../services/hiddenVacancyReasons";
import { ActionCooldown } from "../services/actionCooldown";
import { handleChannelReportCommand } from "./channelReportHandler";
import { processRelevanceFeedback } from "./relevanceFeedbackHandler";
import { buildWeeklyReport, buildReportKeyboard, isPeriodSelectedInMessage, REPORT_PERIOD_OPTIONS, type ReportPeriod } from "../services/weeklyReport";
import { SearchProfilePresetForecastService } from "../services/searchProfilePresetForecast";
import { ExternalVacancyEnricher } from "../services/externalVacancyEnricher";
import { VacancyFilter } from "../services/vacancyFilter";
import { calculateVacancyReminderAt } from "../services/vacancyReminderSchedule";
import type { UserVacancyRematcher } from "../services/userVacancyRematcher";
import * as companyCareersSource from "../sources/companyCareersSource";
import * as adminUi from "./admin";
import * as access from "./access";
import * as keyboards from "./keyboards";
import * as formatters from "./formatters";
import * as inputFlowsModule from "./inputFlows";
import * as onboardingFlowModule from "./onboardingFlow";
import * as userPanelsModule from "./userPanels";
import * as vacancyCardOrigin from "./vacancyCardOrigin";
import { disableTextLinkPreviews } from "./linkPreview";

import type {
    BotUser,
    ChannelDiscoveryProfileId,
    ChannelDiscoveryRun,
    DailyDigestDueRecord,
    FilterSuggestionKey,
    MatchedVacancyRecord,
    OnboardingStep,
    PendingInputAction,
    RuntimeSettingKey,
    SearchProfileHealth,
    SearchProfilePresetId,
    SearchProfileSectionKey,
    UserVacancyApplicationRecord,
    UserVacancyRematchSummary,
    UserWeeklyVacancyPage,
    VacancyLanguageMode,
    VacancyApplicationFollowUpPreset,
    VacancyApplicationFollowUpRecord,
    VacancyReminderPreset,
    VacancyReminderRecord,
    VacancyRecord,
    VacancyUserStatus
} from "../types";
import type { EmptyCycleNotificationPayload, StartupDiagnosticPayload } from "./formatters";
import type { BotPanelMode } from "./render";

export interface BotController {
    start(): Promise<void>;
    stop(): Promise<void>;
    notifyVacancy(vacancy: MatchedVacancyRecord): Promise<boolean>;
    sendVacancyReminder(reminder: VacancyReminderRecord): Promise<boolean>;
    sendApplicationFollowUp?(followUp: VacancyApplicationFollowUpRecord): Promise<boolean>;
    sendDailyDigest?(digest: DailyDigestDueRecord): Promise<boolean>;
    sendNoNewVacanciesNotification(userId: string, payload: EmptyCycleNotificationPayload): Promise<boolean>;
    sendStartupDiagnostic(payload: StartupDiagnosticPayload): Promise<void>;
    sendAdminAlert(text: string): Promise<boolean>;
    sendOwnerReport(text: string): Promise<boolean>;
}
const ADMIN_CHANNELS_PAGE_SIZE = 8;
const COMPANY_CAREER_SOURCES_PAGE_SIZE = 6;
const TRUSTED_VACANCY_SERVICES_PAGE_SIZE = 6;
const CHANNEL_DISCOVERY_PAGE_SIZE = 5;
const USER_REMATCH_WINDOW_DAYS = 7;
const USER_REMATCH_COOLDOWN_MS = 60_000;
const CHANNEL_DISCOVERY_COOLDOWN_MS = 5 * 60_000;
const MANUAL_BACKUP_COOLDOWN_MS = 10 * 60_000;
const CHANNEL_BATCH_ADD_COOLDOWN_MS = 2 * 60_000;
const COMPANY_SOURCE_CHECK_COOLDOWN_MS = 60_000;
const USER_STATUS_PAGE_SIZE = 5;
const TELEGRAM_SAFE_CHANNEL_LIST_LENGTH = 4_000;
type VacancyActionStatus = Exclude<VacancyUserStatus, "inbox">;
type ManageableUserResult =
    | { ok: true; user: BotUser }
    | { ok: false; message: string };
const PUBLIC_BOT_COMMANDS = [
    { command: "start", description: "Открыть главное меню" },
    { command: "week", description: "Показать вакансии за 7 дней" }
];
const ADMIN_BOT_COMMANDS = [
    ...PUBLIC_BOT_COMMANDS,
    { command: "admin", description: "Открыть управление ботом" }
];
const OWNER_BOT_COMMANDS = [
    ...ADMIN_BOT_COMMANDS,
    { command: "backup", description: "Отправить резервную копию базы" },
    { command: "report", description: "Аналитика за 7 дней" },
    { command: "channelreport", description: "Производительность источников" }
];

export async function dismissHiddenVacancyCardMessage(
    ctx: Pick<grammy.Context, "deleteMessage" | "editMessageText">,
    fallbackReplyMarkup?: grammy.InlineKeyboard
): Promise<void> {
    try {
        await ctx.deleteMessage();
    }
    catch {
        await ctx.editMessageText("👎 Больше не показываю эту вакансию.", { reply_markup: fallbackReplyMarkup });
    }
}

function nextVacancyLanguageMode(mode: VacancyLanguageMode): VacancyLanguageMode {
    if (mode === "ru_en") {
        return "ru_only";
    }
    if (mode === "ru_only") {
        return "en_only";
    }
    return "ru_en";
}
function parseRuntimeSettingKey(value: string | undefined): RuntimeSettingKey | null {
    if (!value) {
        return null;
    }
    const allowedKeys = new Set([
        "CHECK_INTERVAL_SECONDS",
        "INITIAL_BACKFILL_DAYS",
        "WEEKLY_PAGE_SIZE",
        "WEB_PREVIEW_MAX_PAGES_PER_CHANNEL",
        "WEB_PREVIEW_CHANNEL_DELAY_MS",
        "WEB_PREVIEW_RETRY_COUNT",
        "WEB_PREVIEW_REQUEST_TIMEOUT_MS",
        "WEB_PREVIEW_MAX_ITEMS_PER_CHANNEL"
    ]);
    return allowedKeys.has(value) ? (value as RuntimeSettingKey) : null;
}
function parseVacancyActionStatus(value: string | undefined): VacancyActionStatus | null {
    return value === "saved" || value === "applied" || value === "hidden" ? value : null;
}
function parseVacancyLanguageMode(value: string | undefined): VacancyLanguageMode | null {
    return value === "ru_en" || value === "ru_only" || value === "en_only" ? value : null;
}
function parseVacancyNotificationView(value: string | undefined): formatters.VacancyNotificationView {
    return value === "full" ? "full" : "compact";
}
function parseVacancyReminderPreset(value: string | undefined): VacancyReminderPreset | null {
    return value === "evening" || value === "tomorrow" || value === "three_days" ? value : null;
}
function parseVacancyApplicationFollowUpPreset(value: string | undefined): VacancyApplicationFollowUpPreset | null {
    return value === "one_minute" || value === "three_days" || value === "week" ? value : null;
}
function parseSearchProfilePresetId(value: string | undefined): SearchProfilePresetId | null {
    return searchProfilePresets.listSearchProfilePresets().find((preset) => preset.id === value)?.id ?? null;
}
function parseChannelDiscoveryProfileId(value: string | undefined): ChannelDiscoveryProfileId | null {
    if (value === "custom") {
        return value;
    }
    return channelDiscoveryProfiles.listChannelDiscoveryProfiles().find((profile) => profile.id === value)?.id ?? null;
}
function parseManageableRole(value: string | undefined): "member" | "admin" | null {
    return value === "member" || value === "admin" ? value : null;
}
export function createBotController(
    config: AppConfig,
    database: VacancyDatabase,
    runtimeSettings: RuntimeSettingsService,
    analytics: AnalyticsService,
    rematcher: UserVacancyRematcher
): BotController {
    const bot = new grammy.Bot(config.botToken);
    bot.api.config.use(disableTextLinkPreviews);
    const ownerNotificationChatId = configModule.getOwnerNotificationChatId(config);
    const sourceName = configModule.getSourceNameForMode(config.telegramSourceMode);
    const channelDiscoveryService = new channelDiscovery.ChannelDiscoveryService(config, database);
    const presetForecastService = new SearchProfilePresetForecastService(database, new VacancyFilter(config));
    const externalVacancyEnricher = new ExternalVacancyEnricher(config, database);
    const heavyActionCooldown = new ActionCooldown();
    const latestRematchSummaries = new Map<string, UserVacancyRematchSummary>();
    function getCurrentUserId(ctx: Pick<grammy.Context, "from">): string | null {
        return ctx.from?.id !== undefined && ctx.from?.id !== null ? String(ctx.from.id) : null;
    }
    function shouldShowAdmin(userId: string | number | undefined | null): boolean {
        return database.hasAdminAccess(userId);
    }
    function shouldShowOwnerControls(userId: string | number | undefined | null): boolean {
        return database.hasOwnerAccess(userId);
    }
    function shouldShowNotifications(userId: string | number | undefined | null): boolean {
        return Boolean(database.getBotUser(userId)?.isActive);
    }
    function shouldShowWeeklyEntry(userId: string | number | undefined | null): boolean {
        const currentUserId = userId !== undefined && userId !== null ? String(userId) : null;
        if (!currentUserId) {
            return false;
        }
        return database.getUserSettings(currentUserId).onboardingCompleted;
    }
    async function sendAdminAlertMessage(text: string, failureLogMessage: string): Promise<boolean> {
        if (!ownerNotificationChatId) {
            return false;
        }
        try {
            await bot.api.sendMessage(ownerNotificationChatId, text, {
                reply_markup: keyboards.createMainKeyboard(Boolean(config.ownerUserId && database.hasAdminAccess(config.ownerUserId)), true, shouldShowWeeklyEntry(config.ownerUserId))
            });
            return true;
        }
        catch (error) {
            loggerModule.logger.warn({
                err: error,
                ownerChatId: ownerNotificationChatId
            }, failureLogMessage);
            return false;
        }
    }
    async function sendPublicUserRegistrationAlert(ctx: grammy.Context, user: BotUser): Promise<void> {
        await sendAdminAlertMessage(formatters.formatPublicUserRegistrationAlert({
            user,
            telegramUsername: ctx.from?.username ?? null,
            telegramFirstName: ctx.from?.first_name ?? null,
            telegramLastName: ctx.from?.last_name ?? null,
            registeredAtIso: user.createdAt
        }, config), "Failed to send public user registration alert.");
    }
    function isWeeklyProfileReady(userId: string): boolean {
        return database
            .listUserSearchProfiles(userId, true)
            .some((profile) => searchProfileHealth.getSearchProfileHealth(profile).isSearchActive);
    }
    function buildUserAnalyticsProperties(userId: string): Record<string, string | boolean | number | null> {
        const user = database.getBotUser(userId);
        const settings = database.getUserSettings(userId);
        const profiles = database.listUserSearchProfiles(userId, true);
        const healthReports = profiles.map((profile) => searchProfileHealth.getSearchProfileHealth(profile));
        const profileHealth = healthReports.some((health) => health.status === "ready")
            ? "ready"
            : healthReports.some((health) => health.status === "weak")
                ? "weak"
                : "empty";
        return {
            role: user?.role ?? null,
            user_active: user?.isActive ?? false,
            profile_health: profileHealth,
            search_active: healthReports.some((health) => health.isSearchActive),
            search_profiles_count: profiles.length,
            onboarding_completed: settings.onboardingCompleted,
            vacancy_language_mode: settings.vacancyLanguageMode
        };
    }
    async function sendImmediateDailyDigestAfterEnable(ctx: grammy.Context, userId: string): Promise<void> {
        const settings = database.getUserSettings(userId);
        const now = new Date();
        const local = getLocalDigestDateParts(now, config.timeZone);
        const scheduledMinutes = resolveDailyDigestTimeMinutes(settings.dailyDigestTimeMinutes);
        const scheduledFor = formatDigestScheduledFor(local.date, scheduledMinutes, config.timeZone);
        const payload = database.buildDailyDigestPayload(userId, local.date, scheduledFor, now);

        if (!hasActionableDailyDigest(payload)) {
            await ctx.reply(
                "🌅 Утренний дайджест включён.\nСейчас действий для дайджеста нет. Если они появятся позже, бот пришлёт их по расписанию."
            );
            return;
        }

        try {
            await ctx.reply(formatters.formatDailyDigestNotification(payload), {
                reply_markup: keyboards.createDailyDigestKeyboard(payload)
            });
        }
        catch (error) {
            loggerModule.logger.warn({ err: error, userId }, "Failed to send immediate daily digest after enabling.");
            await analytics.capture({
                eventName: "daily_digest_failed",
                userId,
                properties: {
                    ...buildUserAnalyticsProperties(userId),
                    digest_date: payload.digestDate,
                    scheduled_for: payload.scheduledFor,
                    error_message: error instanceof Error ? error.message : String(error),
                    attempt_count: 0,
                    trigger: "enabled_immediately"
                }
            });
            return;
        }

        database.markDailyDigestDelivered(userId, payload.digestDate, payload.scheduledFor, now.toISOString());
        await analytics.capture({
            eventName: "daily_digest_sent",
            userId,
            properties: {
                ...buildUserAnalyticsProperties(userId),
                digest_date: payload.digestDate,
                scheduled_for: payload.scheduledFor,
                new_vacancies_count: payload.newVacanciesCount,
                saved_without_action_count: payload.savedWithoutActionCount,
                due_application_followups_count: payload.dueApplicationFollowUpsCount,
                hidden_last_day_count: payload.hiddenLastDayCount,
                attempt_count: 0,
                trigger: "enabled_immediately"
            }
        });
    }
    async function identifyCurrentUser(ctx: grammy.Context): Promise<void> {
        const currentUserId = getCurrentUserId(ctx);
        if (!currentUserId) {
            return;
        }
        const user = database.getBotUser(currentUserId);
        await analytics.identify({
            distinctId: currentUserId,
            userId: currentUserId,
            properties: {
                ...buildUserAnalyticsProperties(currentUserId),
                telegram_username: ctx.from?.username ?? null,
                telegram_first_name: ctx.from?.first_name ?? null,
                telegram_last_name: ctx.from?.last_name ?? null
            }
        });
    }
    async function refreshCommandScopes(): Promise<void> {
        await bot.api.setMyCommands([...PUBLIC_BOT_COMMANDS]);
        for (const user of database.listAllUsers()) {
            const scope = {
                type: "chat" as const,
                chat_id: user.userId
            };
            try {
                if (user.isActive && user.role === "owner") {
                    await bot.api.setMyCommands([...OWNER_BOT_COMMANDS], { scope });
                }
                else if (user.isActive && user.role === "admin") {
                    await bot.api.setMyCommands([...ADMIN_BOT_COMMANDS], { scope });
                }
                else {
                    await bot.api.deleteMyCommands({ scope });
                }
            }
            catch (error) {
                loggerModule.logger.warn({
                    err: error,
                    userId: user.userId,
                    role: user.role,
                    isActive: user.isActive
                }, "Failed to refresh bot command scope for a specific chat.");
            }
        }
    }
    async function trackProfileReadyTransition(userId: string, beforeStatus: SearchProfileHealth, trigger: "preset" | "manual_update" | "reset", extraProperties?: Record<string, string | boolean | number | null>): Promise<void> {
        const profileId = typeof extraProperties?.profile_id === "number" ? extraProperties.profile_id : null;
        const targetProfile = profileId
            ? database.getUserSearchProfileById(userId, profileId)
            : database.listUserSearchProfiles(userId)[0] ?? null;
        if (!targetProfile) {
            return;
        }
        const afterHealth = searchProfileHealth.getSearchProfileHealth(targetProfile);
        if (beforeStatus === "ready" || afterHealth.status !== "ready") {
            return;
        }
        await analytics.capture({
            eventName: "profile_ready",
            userId,
            properties: {
                ...buildUserAnalyticsProperties(userId),
                trigger,
                previous_profile_health: beforeStatus,
                ...(extraProperties ?? {})
            }
        });
    }
    const userPanels = userPanelsModule.createUserPanels({
        bot,
        config,
        database,
        runtimeSettings,
        sourceName,
        userRematchWindowDays: USER_REMATCH_WINDOW_DAYS,
        userStatusPageSize: USER_STATUS_PAGE_SIZE,
        getCurrentUserId,
        shouldShowAdmin,
        shouldShowNotifications,
        shouldShowWeeklyEntry,
        getLatestRematchSummary: (userId) => latestRematchSummaries.get(userId) ?? null,
        getPresetForecasts: (userId, languageMode) => presetForecastService.evaluate(userId, languageMode)
    });
    const onboardingFlow = onboardingFlowModule.createOnboardingFlow({
        database,
        analytics,
        getCurrentUserId,
        shouldShowAdmin,
        buildUserAnalyticsProperties,
        getPresetForecasts: (userId, languageMode) => presetForecastService.evaluate(userId, languageMode),
        sendFirstWeeklyPage: async (ctx, userId, resultsTotal) => {
            const chatId = ctx.chat?.id;
            if (!chatId) {
                return false;
            }
            try {
                await userPanels.sendWeeklyPage(userId, chatId, 0, shouldShowAdmin(ctx.from?.id));
                await analytics.capture({
                    eventName: "weekly_feed_opened",
                    userId,
                    properties: {
                        ...buildUserAnalyticsProperties(userId),
                        entrypoint: "onboarding_completion",
                        offset: 0,
                        results_total: resultsTotal
                    }
                });
                return true;
            }
            catch (error) {
                loggerModule.logger.error({ err: error, userId }, "Failed to send first weekly page after onboarding.");
                return false;
            }
        },
        showStartPanel
    });
    const inputFlows = inputFlowsModule.createInputFlows({
        config,
        database,
        runtimeSettings,
        analytics,
        startChannelDiscovery,
        tryAcquireChannelBatchAdd: () =>
            heavyActionCooldown.tryAcquire("channel-batch-add", CHANNEL_BATCH_ADD_COOLDOWN_MS),
        sourceName,
        getCurrentUserId,
        parseRuntimeSettingKey,
        buildUserAnalyticsProperties,
        trackProfileReadyTransition,
        rebuildUserVacancyFeed,
        refreshCommandScopes,
        summarizeProbeError,
        probeTelegramWebPreviewChannel: channelProbe.probeTelegramWebPreviewChannel,
        getProfileKeywordsForSection: onboardingFlow.getProfileKeywordsForSection,
        showOnboardingCompletionPanel,
        showOnboardingLanguagePanel,
        showOnboardingManualStep,
        showPersonalFiltersPanel,
        showSearchProfileDetailPanel,
        showHhSearchSettingsPanel,
        showChannelDiscoveryRun,
        showCompanyCareerSourcesPage,
        showTrustedVacancyServicesPage,
        showChannelsPage,
        showUsersPage,
        showRuntimeSettingDetails,
        showVacancyCardById,
        showApplicationDetailById: showApplicationDetail
    });
    async function ensureAdminAccess(ctx: grammy.Context): Promise<boolean> {
        if (database.hasAdminAccess(ctx.from?.id)) {
            return true;
        }
        if (ctx.callbackQuery) {
            await ctx.answerCallbackQuery({
                text: "🔒 Этот раздел доступен только администратору."
            });
        }
        else {
            await ctx.reply("🔒 Этот раздел доступен только администратору.");
        }
        return false;
    }
    async function ensureOwnerAccess(ctx: grammy.Context): Promise<boolean> {
        if (database.hasOwnerAccess(ctx.from?.id)) {
            return true;
        }
        const message = "🔒 Этот раздел недоступен.";
        if (ctx.callbackQuery) {
            await ctx.answerCallbackQuery({ text: message });
        }
        else {
            await ctx.reply(message);
        }
        return false;
    }
    function getManageableUser(targetUserId: string, actorUserId: string | null): ManageableUserResult {
        const targetUser = database.getBotUser(targetUserId);
        if (!targetUser) {
            return {
                ok: false,
                message: "👤 Пользователь не найден."
            };
        }
        if (!actorUserId) {
            return {
                ok: false,
                message: "⚠️ Не удалось определить администратора."
            };
        }
        if (targetUser.role === "owner") {
            return {
                ok: false,
                message: "👑 Владельца нельзя менять из этого раздела."
            };
        }
        if (targetUser.userId === actorUserId) {
            return {
                ok: false,
                message: "🔒 Нельзя менять свою роль или доступ через этот экран."
            };
        }
        return {
            ok: true,
            user: targetUser
        };
    }
    function buildAdminState() {
        const settings = config.ownerUserId ? database.getUserSettings(config.ownerUserId) : null;
        return {
            botPaused: settings?.botPaused ?? false,
            sourceMode: config.telegramSourceMode,
            aiEnabled: settings?.aiEnabled ?? false,
            filterMode: settings?.filterMode ?? "keywords",
            activeChannelsCount: database.countActiveChannels(sourceName),
            includeKeywordsCount: 0,
            excludeKeywordsCount: 0,
            pendingInputAction: settings?.pendingInputAction ?? null
        };
    }
    async function showNotificationsPanel(ctx: grammy.Context, mode: BotPanelMode = "reply"): Promise<void> {
        await userPanels.showNotificationsPanel(ctx, mode);
    }
    async function showUserSettingsPanel(ctx: grammy.Context, mode: BotPanelMode = "reply"): Promise<void> {
        await userPanels.showUserSettingsPanel(ctx, mode);
    }
    async function showMyVacanciesPanel(ctx: grammy.Context, mode: BotPanelMode = "reply"): Promise<void> {
        await userPanels.showMyVacanciesPanel(ctx, mode);
    }
    async function showUserQuietDiagnosticsPanel(ctx: grammy.Context, mode: BotPanelMode = "reply"): Promise<void> {
        await userPanels.showUserQuietDiagnosticsPanel(ctx, mode);
    }
    async function showPersonalFiltersPanel(ctx: grammy.Context, mode: BotPanelMode = "reply"): Promise<void> {
        await userPanels.showPersonalFiltersPanel(ctx, mode);
    }
    async function showSearchProfileDetailPanel(ctx: grammy.Context, profileId: number, mode: BotPanelMode = "reply"): Promise<void> {
        await userPanels.showSearchProfileDetailPanel(ctx, profileId, mode);
    }
    async function showAddSearchProfilePanel(ctx: grammy.Context, mode: BotPanelMode = "reply"): Promise<void> {
        await userPanels.showAddSearchProfilePanel(ctx, mode);
    }
    async function showHhSearchSettingsPanel(ctx: grammy.Context, mode: BotPanelMode = "reply"): Promise<void> {
        await userPanels.showHhSearchSettingsPanel(ctx, mode);
    }
    async function showSearchProfilePresetsPanel(ctx: grammy.Context, mode: BotPanelMode = "reply", targetProfileId?: number | "new"): Promise<void> {
        await userPanels.showSearchProfilePresetsPanel(ctx, mode, targetProfileId);
    }
    async function showAdminPanel(ctx: grammy.Context, mode: BotPanelMode = "reply"): Promise<void> {
        const adminState = buildAdminState();
        const text = adminUi.formatAdminPanel(adminState);
        const replyMarkup = adminUi.createAdminKeyboard(adminState, shouldShowOwnerControls(ctx.from?.id));
        if (mode === "edit" && ctx.callbackQuery) {
            await ctx.editMessageText(text, {
                reply_markup: replyMarkup
            });
            return;
        }
        await ctx.reply(text, {
            reply_markup: replyMarkup
        });
    }
    async function showChannelsPage(ctx: grammy.Context, offset = 0, mode: BotPanelMode = "edit"): Promise<void> {
        const page = database.listChannelsPage(sourceName, offset, ADMIN_CHANNELS_PAGE_SIZE);
        const text = adminUi.formatChannelsPage(page);
        const replyMarkup = adminUi.createChannelsKeyboard(page, shouldShowOwnerControls(ctx.from?.id));
        if (mode === "edit" && ctx.callbackQuery) {
            await ctx.editMessageText(text, {
                reply_markup: replyMarkup
            });
            return;
        }
        await ctx.reply(text, {
            reply_markup: replyMarkup
        });
    }
    async function showCompanyCareerSourcesPage(ctx: grammy.Context, offset = 0, mode: BotPanelMode = "edit"): Promise<void> {
        const page = database.listCompanyCareerSourcesPage(offset, COMPANY_CAREER_SOURCES_PAGE_SIZE);
        const text = adminUi.formatCompanyCareerSourcesPage(page, config.companyCareersSourceEnabled);
        const replyMarkup = adminUi.createCompanyCareerSourcesKeyboard(page);
        if (mode === "edit" && ctx.callbackQuery) {
            await ctx.editMessageText(text, {
                reply_markup: replyMarkup
            });
            return;
        }
        await ctx.reply(text, {
            reply_markup: replyMarkup
        });
    }
    async function showCompanyCareerSourceDetails(ctx: grammy.Context, sourceId: number, offset: number, mode: BotPanelMode = "edit"): Promise<void> {
        const source = database.getCompanyCareerSourceById(sourceId);
        if (!source) {
            if (ctx.callbackQuery) {
                await ctx.answerCallbackQuery({ text: "Company source not found." });
            }
            return;
        }
        const text = adminUi.formatCompanyCareerSourceDetails(source, config.companyCareersSourceEnabled);
        const replyMarkup = adminUi.createCompanyCareerSourceDetailsKeyboard(source, offset);
        if (mode === "edit" && ctx.callbackQuery) {
            await ctx.editMessageText(text, {
                reply_markup: replyMarkup
            });
            return;
        }
        await ctx.reply(text, {
            reply_markup: replyMarkup
        });
    }
    async function showUsersPage(ctx: grammy.Context, mode: BotPanelMode = "edit"): Promise<void> {
        const users = database.listAllUsers();
        const currentUserId = getCurrentUserId(ctx) ?? undefined;
        const text = adminUi.formatUsersPage(users);
        const replyMarkup = adminUi.createUsersKeyboard(users, currentUserId);
        if (mode === "edit" && ctx.callbackQuery) {
            await ctx.editMessageText(text, {
                reply_markup: replyMarkup
            });
            return;
        }
        await ctx.reply(text, {
            reply_markup: replyMarkup
        });
    }
    async function showUserDetails(ctx: grammy.Context, userId: string, mode: BotPanelMode = "edit"): Promise<void> {
        const user = database.getBotUser(userId);
        if (!user) {
            if (ctx.callbackQuery) {
                await ctx.answerCallbackQuery({ text: "👤 Пользователь не найден." });
            }
            return;
        }
        const currentUserId = getCurrentUserId(ctx) ?? undefined;
        const text = adminUi.formatUserDetails(user);
        const replyMarkup = adminUi.createUserDetailsKeyboard(user, currentUserId);
        if (mode === "edit" && ctx.callbackQuery) {
            await ctx.editMessageText(text, {
                reply_markup: replyMarkup
            });
            return;
        }
        await ctx.reply(text, {
            reply_markup: replyMarkup
        });
    }
    async function showChannelDetails(ctx: grammy.Context, channelId: number, offset: number, confirmRemoval = false, mode: BotPanelMode = "edit"): Promise<void> {
        const channel = database.getChannelById(channelId);
        if (!channel || channel.sourceName !== sourceName) {
            if (ctx.callbackQuery) {
                await ctx.answerCallbackQuery({ text: "📭 Канал не найден." });
            }
            return;
        }
        const text = adminUi.formatChannelDetails(channel);
        const replyMarkup = adminUi.createChannelDetailsKeyboard(channel, offset, confirmRemoval);
        if (mode === "edit" && ctx.callbackQuery) {
            await ctx.editMessageText(text, {
                reply_markup: replyMarkup
            });
            return;
        }
        await ctx.reply(text, {
            reply_markup: replyMarkup
        });
    }
    async function showChannelDiscoveryModeMenu(ctx: grammy.Context, mode: BotPanelMode = "edit"): Promise<void> {
        const text = adminUi.formatChannelDiscoveryModeMenuWithProviders(channelDiscoveryService.getProviderAvailability());
        const replyMarkup = adminUi.createChannelDiscoveryModeKeyboard();
        if (mode === "edit" && ctx.callbackQuery) {
            await ctx.editMessageText(text, { reply_markup: replyMarkup });
            return;
        }
        await ctx.reply(text, { reply_markup: replyMarkup });
    }
    async function showTrustedVacancyServicesPage(ctx: grammy.Context, offset = 0, mode: BotPanelMode = "edit"): Promise<void> {
        const page = database.listTrustedVacancyServicesPage(offset, TRUSTED_VACANCY_SERVICES_PAGE_SIZE);
        const text = adminUi.formatTrustedVacancyServicesPage(page);
        const replyMarkup = adminUi.createTrustedVacancyServicesKeyboard(page);
        if (mode === "edit" && ctx.callbackQuery) {
            await ctx.editMessageText(text, { reply_markup: replyMarkup });
            return;
        }
        await ctx.reply(text, { reply_markup: replyMarkup });
    }
    async function showTrustedVacancyServiceDetails(ctx: grammy.Context, serviceId: number, offset: number, mode: BotPanelMode = "edit"): Promise<void> {
        const service = database.getTrustedVacancyServiceById(serviceId);
        if (!service) {
            if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: "Trusted service not found." });
            return;
        }
        const text = adminUi.formatTrustedVacancyServiceDetails(service);
        const replyMarkup = adminUi.createTrustedVacancyServiceDetailsKeyboard(service, offset);
        if (mode === "edit" && ctx.callbackQuery) {
            await ctx.editMessageText(text, { reply_markup: replyMarkup });
            return;
        }
        await ctx.reply(text, { reply_markup: replyMarkup });
    }
    async function showChannelDiscoveryProfileMenu(
        ctx: grammy.Context,
        mode: BotPanelMode = "edit",
        discoveryMode: "auto" | "seeds" = "auto"
    ): Promise<void> {
        const text = adminUi.formatChannelDiscoveryProfileMenu();
        const replyMarkup = adminUi.createChannelDiscoveryProfileKeyboard(discoveryMode);
        if (mode === "edit" && ctx.callbackQuery) {
            await ctx.editMessageText(text, {
                reply_markup: replyMarkup
            });
            return;
        }
        await ctx.reply(text, {
            reply_markup: replyMarkup
        });
    }
    async function beginChannelDiscoveryCustomInput(ctx: grammy.Context): Promise<void> {
        await inputFlows.beginChannelDiscoveryCustomInput(ctx);
    }
    async function beginChannelDiscoverySeedInput(
        ctx: grammy.Context,
        profileId: Exclude<ChannelDiscoveryProfileId, "custom">
    ): Promise<void> {
        await inputFlows.beginChannelDiscoverySeedInput(ctx, profileId);
    }
    async function beginCompanyCareerSourceInput(ctx: grammy.Context): Promise<void> {
        await inputFlows.beginCompanyCareerSourceInput(ctx);
    }
    async function beginTrustedVacancyServiceInput(ctx: grammy.Context): Promise<void> {
        await inputFlows.beginTrustedVacancyServiceInput(ctx);
    }
    async function showChannelDiscoveryRun(ctx: grammy.Context, runId: number, offset = 0, mode: BotPanelMode = "edit"): Promise<void> {
        const run = database.getChannelDiscoveryRun(runId);
        if (!run) {
            if (ctx.callbackQuery) {
                await ctx.answerCallbackQuery({ text: "🔎 Discovery run not found." });
            }
            return;
        }
        let page = database.listChannelDiscoveryCandidatesPage(run.id, offset, CHANNEL_DISCOVERY_PAGE_SIZE);
        if (page.total > 0 && page.offset >= page.total) {
            const lastOffset = Math.floor((page.total - 1) / page.pageSize) * page.pageSize;
            page = database.listChannelDiscoveryCandidatesPage(run.id, lastOffset, CHANNEL_DISCOVERY_PAGE_SIZE);
        }
        const text = adminUi.formatChannelDiscoveryRunPage(run, page);
        const replyMarkup = adminUi.createChannelDiscoveryRunKeyboard(run, page);
        if (mode === "edit" && ctx.callbackQuery) {
            try {
                await ctx.editMessageText(text, {
                    reply_markup: replyMarkup
                });
            }
            catch (error) {
                if (!(error instanceof grammy.GrammyError) || !error.description.includes("message is not modified")) {
                    throw error;
                }
            }
            return;
        }
        await ctx.reply(text, {
            reply_markup: replyMarkup
        });
    }
    async function showPendingChannelDiscoveryCandidates(ctx: grammy.Context, offset = 0, mode: BotPanelMode = "edit"): Promise<void> {
        const page = database.listPendingChannelDiscoveryCandidatesPage(offset, CHANNEL_DISCOVERY_PAGE_SIZE);
        const text = adminUi.formatPendingChannelDiscoveryCandidates(page);
        const replyMarkup = adminUi.createPendingChannelDiscoveryCandidatesKeyboard(page);
        if (mode === "edit" && ctx.callbackQuery) {
            await ctx.editMessageText(text, { reply_markup: replyMarkup });
            return;
        }
        await ctx.reply(text, { reply_markup: replyMarkup });
    }
    async function showSettingsPage(ctx: grammy.Context, mode: BotPanelMode = "edit"): Promise<void> {
        const values = runtimeSettings.listValues();
        const text = adminUi.formatSettingsPage(values);
        const replyMarkup = adminUi.createSettingsKeyboard(values);
        if (mode === "edit" && ctx.callbackQuery) {
            await ctx.editMessageText(text, {
                parse_mode: "HTML",
                reply_markup: replyMarkup
            });
            return;
        }
        await ctx.reply(text, {
            parse_mode: "HTML",
            reply_markup: replyMarkup
        });
    }
    async function showRuntimeSettingDetails(ctx: grammy.Context, key: RuntimeSettingKey, mode: BotPanelMode = "edit"): Promise<void> {
        const setting = runtimeSettings.getValue(key);
        const text = adminUi.formatRuntimeSettingDetails(setting);
        const replyMarkup = adminUi.createRuntimeSettingDetailsKeyboard(setting);
        if (mode === "edit" && ctx.callbackQuery) {
            await ctx.editMessageText(text, {
                parse_mode: "HTML",
                reply_markup: replyMarkup
            });
            return;
        }
        await ctx.reply(text, {
            parse_mode: "HTML",
            reply_markup: replyMarkup
        });
    }
    async function sendWeeklyPage(userId: string, chatId: string | number, offset = 0, showAdmin = false, days = DEFAULT_WEEKLY_WINDOW_DAYS): Promise<void> {
        await userPanels.sendWeeklyPage(userId, chatId, offset, showAdmin, normalizeWeeklyWindowDays(days));
    }
    async function showWeeklyPageForOrigin(
        ctx: grammy.Context,
        userId: string,
        origin: vacancyCardOrigin.VacancyCardOrigin,
        mode: BotPanelMode = "edit"
    ): Promise<boolean> {
        const weeklyPageSize = getEffectiveWeeklyPageSize(
            database.getUserSettings(userId),
            runtimeSettings.getSnapshot().weeklyPageSize
        );
        const profile = origin.profileId
            ? database.getUserSearchProfileById(userId, origin.profileId)
            : null;
        if (origin.profileId && (!profile || !profile.isActive || !searchProfileHealth.getSearchProfileHealth(profile).isSearchActive)) {
            return false;
        }

        const windowDays = normalizeWeeklyWindowDays(origin.days);
        let offset = normalizeWeeklyOffset(origin.offset, weeklyPageSize);
        let page = database.listUserWeeklyVacancies(userId, offset, weeklyPageSize, windowDays, origin.profileId ?? null);
        if (page.total > 0 && page.offset >= page.total) {
            offset = normalizeWeeklyOffset(page.offset, weeklyPageSize, page.total);
            page = database.listUserWeeklyVacancies(userId, offset, weeklyPageSize, windowDays, origin.profileId ?? null);
        }

        const text = formatters.formatWeeklyVacancies(page, config, profile?.name, {
            activeProfiles: database.listUserSearchProfiles(userId, true),
            profileId: origin.profileId,
            rematchSummary: latestRematchSummaries.get(userId) ?? null,
            days: windowDays
        });
        const replyMarkup = page.total > 0
            ? keyboards.createWeeklyKeyboard(page, shouldShowNotifications(ctx.from?.id), origin.profileId, windowDays)
            : keyboards.createWeeklyZeroStateKeyboard(page, origin.profileId, database.listUserSearchProfiles(userId).length, windowDays);

        if (mode === "edit" && ctx.callbackQuery) {
            await ctx.editMessageText(text, { reply_markup: replyMarkup });
            return true;
        }

        await ctx.reply(text, { reply_markup: replyMarkup });
        return true;
    }
    async function showBlockedWeeklyAccessPanel(ctx: grammy.Context, userId: string, mode: BotPanelMode = "reply"): Promise<void> {
        await userPanels.showBlockedWeeklyAccessPanel(ctx, userId, mode);
    }
    async function ensureWeeklyAccess(ctx: grammy.Context, userId: string, mode: BotPanelMode): Promise<boolean> {
        const settings = database.getUserSettings(userId);
        if (!settings.onboardingCompleted) {
            if (ctx.callbackQuery) {
                await ctx.answerCallbackQuery({ text: "🧭 Сначала завершим настройку." });
            }
            await showOnboardingFlow(ctx, mode);
            return false;
        }
        if (!isWeeklyProfileReady(userId)) {
            if (ctx.callbackQuery) {
                await ctx.answerCallbackQuery({ text: "🎯 Сначала заполни поисковый профиль." });
            }
            await showBlockedWeeklyAccessPanel(ctx, userId, mode);
            return false;
        }
        return true;
    }
    function buildStatusActionText(status: VacancyActionStatus, cleared: boolean): string {
        return userPanelsModule.buildStatusActionText(status, cleared);
    }
    function buildBackupFileName(): string {
        return `vacancy-bot-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.db`;
    }
    function summarizeProbeError(error: string): string {
        const normalized = error.replace(/\s+/g, " ").trim();
        return normalized.length <= 100 ? normalized : `${normalized.slice(0, 97)}...`;
    }
    async function showStatusPage(ctx: grammy.Context, userId: string, status: Exclude<VacancyUserStatus, "inbox">, offset = 0, mode: BotPanelMode = "edit"): Promise<void> {
        await userPanels.showStatusPage(ctx, userId, status, offset, mode);
    }
    async function showVacancyRemindersPage(ctx: grammy.Context, userId: string, offset = 0, mode: BotPanelMode = "edit"): Promise<void> {
        await userPanels.showVacancyRemindersPage(ctx, userId, offset, mode);
    }
    function buildVacancyMessageRecord(userId: string, vacancyId: number, statusOverride?: VacancyUserStatus): MatchedVacancyRecord | null {
        return userPanels.buildVacancyMessageRecord(userId, vacancyId, statusOverride);
    }
    function buildVacancyActionsKeyboard(
        vacancy: VacancyRecord | MatchedVacancyRecord,
        showNotifications: boolean,
        view: formatters.VacancyNotificationView = "compact",
        origin?: vacancyCardOrigin.VacancyCardOrigin,
        forUserId?: string
    ): grammy.InlineKeyboard {
        const relevanceValue = forUserId
            ? database.getVacancyRelevanceFeedback(forUserId, vacancy.id)
            : null;
        return keyboards.createVacancyKeyboardWithActions(vacancy, showNotifications, view, origin, relevanceValue ?? undefined);
    }
    function buildApplicationDetailRecord(userId: string, vacancyId: number): UserVacancyApplicationRecord | null {
        if (database.getUserVacancyStatus(userId, vacancyId) !== "applied") {
            return null;
        }
        const vacancyRecord = buildVacancyMessageRecord(userId, vacancyId, "applied");
        if (!vacancyRecord) {
            return null;
        }
        const application = database.getUserVacancyApplication(userId, vacancyId)
            ?? database.upsertUserVacancyApplication(userId, vacancyId);
        const matchedVacancy = database.getUserMatchedVacancy(userId, vacancyId);
        return {
            ...vacancyRecord,
            userStatus: "applied",
            statusUpdatedAt: vacancyRecord.statusUpdatedAt ?? application.applicationUpdatedAt,
            isCurrentlyMatched: Boolean(matchedVacancy),
            matchedAt: vacancyRecord.matchedAt,
            matchedProfileIds: vacancyRecord.matchedProfileIds,
            matchedProfileNames: vacancyRecord.matchedProfileNames,
            application
        };
    }
    function enrichVacancyDuplicatePosts<T extends VacancyRecord>(vacancy: T): T {
        return userPanels.enrichVacancyDuplicatePosts(vacancy);
    }
    async function showVacancyCardById(
        ctx: grammy.Context,
        userId: string,
        vacancyId: number,
        view: formatters.VacancyNotificationView = "compact",
        origin?: vacancyCardOrigin.VacancyCardOrigin,
        mode: BotPanelMode = "edit"
    ): Promise<void> {
        const vacancyRecord = buildVacancyMessageRecord(userId, vacancyId);
        if (!vacancyRecord) {
            if (ctx.callbackQuery) {
                await ctx.answerCallbackQuery({ text: "⚠️ Вакансия больше недоступна." });
            }
            return;
        }
        const vacancyWithDuplicates = enrichVacancyDuplicatePosts(vacancyRecord);
        const text = formatters.formatVacancyNotification(vacancyWithDuplicates, config, view);
        const replyMarkup = buildVacancyActionsKeyboard(vacancyWithDuplicates, shouldShowNotifications(userId), view, origin, userId);
        if (mode === "edit" && ctx.callbackQuery) {
            await ctx.editMessageText(text, { reply_markup: replyMarkup });
            return;
        }
        await ctx.reply(text, { reply_markup: replyMarkup });
    }
    async function showApplicationDetail(
        ctx: grammy.Context,
        userId: string,
        vacancyId: number,
        offset = 0,
        mode: BotPanelMode = "edit"
    ): Promise<void> {
        const application = buildApplicationDetailRecord(userId, vacancyId);
        if (!application) {
            if (ctx.callbackQuery) {
                await ctx.answerCallbackQuery({ text: "ℹ️ Отклик уже не активен." });
            }
            await showStatusPage(ctx, userId, "applied", offset, mode);
            return;
        }
        const applicationWithDuplicates = enrichVacancyDuplicatePosts(application);
        const text = formatters.formatApplicationDetail(applicationWithDuplicates, config);
        const replyMarkup = keyboards.createApplicationDetailKeyboard(applicationWithDuplicates, offset, database.hasAdminAccess(userId));
        if (mode === "edit" && ctx.callbackQuery) {
            await ctx.editMessageText(text, { reply_markup: replyMarkup });
            return;
        }
        await ctx.reply(text, { reply_markup: replyMarkup });
    }
    async function showApplicationFollowUpPrompt(
        ctx: grammy.Context,
        userId: string,
        vacancyId: number,
        view: formatters.VacancyNotificationView = "compact",
        origin?: vacancyCardOrigin.VacancyCardOrigin,
        mode: BotPanelMode = "edit"
    ): Promise<void> {
        const vacancyRecord = buildVacancyMessageRecord(userId, vacancyId, "applied");
        if (!vacancyRecord) {
            if (ctx.callbackQuery) {
                await ctx.answerCallbackQuery({ text: "⚠️ Вакансия больше недоступна." });
            }
            return;
        }
        const vacancyWithDuplicates = enrichVacancyDuplicatePosts(vacancyRecord);
        const text = [
            formatters.formatVacancyNotification(vacancyWithDuplicates, config, view),
            "",
            "✅ Отклик отмечен.",
            "Напомнить проверить ответ?"
        ].join("\n");
        const replyMarkup = keyboards.createApplicationFollowUpPromptKeyboard(vacancyId, view, origin, database.hasAdminAccess(userId));
        if (mode === "edit" && ctx.callbackQuery) {
            await ctx.editMessageText(text, { reply_markup: replyMarkup });
            return;
        }
        await ctx.reply(text, { reply_markup: replyMarkup });
    }
    function scheduleApplicationFollowUp(
        userId: string,
        vacancyId: number,
        preset: VacancyApplicationFollowUpPreset
    ): string {
        const followUpAt = calculateApplicationFollowUpAt(preset).toISOString();
        database.scheduleUserVacancyApplicationFollowUp(userId, vacancyId, followUpAt);
        return followUpAt;
    }
    async function sendBackupSnapshot(ctx: grammy.Context): Promise<void> {
        if (!(await ensureOwnerAccess(ctx))) {
            return;
        }
        const chatId = ctx.chat?.id;
        if (!chatId) {
            await ctx.reply("Не удалось определить чат для отправки резервной копии.");
            return;
        }
        const cooldownKey = "backup";
        const attempt = heavyActionCooldown.tryAcquire(cooldownKey, MANUAL_BACKUP_COOLDOWN_MS);
        if (!attempt.allowed) {
            const notice = `⏳ Это действие недавно запускалось. Попробуй снова через ${attempt.retryAfterSeconds} сек.`;
            if (ctx.callbackQuery) {
                await ctx.answerCallbackQuery({ text: notice });
            }
            else {
                await ctx.reply(notice);
            }
            return;
        }
        if (ctx.callbackQuery) {
            await ctx.answerCallbackQuery({ text: "⏳ Готовлю резервную копию..." });
        }
        const backupFileName = buildBackupFileName();
        let snapshotPath: string | null = null;
        try {
            const snapshot = database.createBackupSnapshot(backupFileName);
            snapshotPath = snapshot.path;
            const stats = database.getStats();
            const activeUsers = database.listActiveUsers().length;
            const activeChannels = database.countActiveChannels(sourceName);
            await bot.api.sendDocument(chatId, new grammy.InputFile(snapshot.path, backupFileName), {
                caption: formatters.formatBackupExportCaption({
                    createdAt: snapshot.createdAt,
                    fileName: backupFileName,
                    sizeBytes: snapshot.sizeBytes,
                    activeChannels,
                    totalVacancies: stats.totalVacancies,
                    activeUsers
                })
            });
            await ctx.reply("✅ Резервная копия отправлена.");
        }
        catch (error) {
            heavyActionCooldown.release(cooldownKey);
            loggerModule.logger.error({ err: error }, "Failed to create or send backup snapshot.");
            await ctx.reply("⚠️ Не удалось подготовить резервную копию.");
            return;
        }
        finally {
            if (snapshotPath && fs.existsSync(snapshotPath)) {
                fs.unlinkSync(snapshotPath);
            }
        }
    }
    async function rebuildUserVacancyFeed(userId: string, options?: { notifyUser?: boolean; ctx?: grammy.Context }): Promise<UserVacancyRematchSummary> {
        const summary = rematcher.rebuildForUser(userId, USER_REMATCH_WINDOW_DAYS);
        latestRematchSummaries.set(userId, summary);
        if (options?.notifyUser && options.ctx) {
            await options.ctx.reply(formatters.formatUserVacancyRematchSummary(summary), {
                reply_markup: keyboards.createRematchSummaryKeyboard()
            });
        }
        return summary;
    }
    async function runManualUserVacancyRematch(ctx: grammy.Context, userId: string): Promise<boolean> {
        const attempt = heavyActionCooldown.tryAcquire(`user-rematch:${userId}`, USER_REMATCH_COOLDOWN_MS);
        if (!attempt.allowed) {
            await ctx.answerCallbackQuery({
                text: `⏳ Подборка недавно пересобиралась. Попробуй через ${attempt.retryAfterSeconds} сек.`
            });
            return false;
        }
        await ctx.answerCallbackQuery({ text: "⌛ Пересобираю подборку..." });
        await rebuildUserVacancyFeed(userId, {
            notifyUser: true,
            ctx
        });
        return true;
    }
    function startChannelDiscovery(
        userId: string | undefined,
        input: channelDiscovery.ChannelDiscoveryRunInput
    ): { run: ChannelDiscoveryRun | null; started: boolean; notice: string } {
        const runningRun = database.getRunningChannelDiscoveryRun();
        if (runningRun) {
            return {
                run: runningRun,
                started: false,
                notice: "🔎 Поиск каналов уже выполняется. Показываю текущий запуск."
            };
        }
        const attempt = heavyActionCooldown.tryAcquire("channel-discovery", CHANNEL_DISCOVERY_COOLDOWN_MS);
        if (!attempt.allowed) {
            return {
                run: null,
                started: false,
                notice: `⏳ Новый поиск каналов можно запустить через ${attempt.retryAfterSeconds} сек.`
            };
        }
        return {
            run: channelDiscoveryService.startDiscovery(userId, input),
            started: true,
            notice: "🔎 Поиск каналов запущен."
        };
    }
    async function refreshWeeklyFeed(userId: string, offset: number, days = USER_REMATCH_WINDOW_DAYS): Promise<UserVacancyRematchSummary | null> {
        if (offset !== 0) {
            return latestRematchSummaries.get(userId) ?? null;
        }
        const attempt = heavyActionCooldown.tryAcquire(`user-rematch:${userId}`, USER_REMATCH_COOLDOWN_MS);
        if (!attempt.allowed) {
            return latestRematchSummaries.get(userId) ?? null;
        }
        const summary = rematcher.rebuildForUser(userId, normalizeWeeklyWindowDays(days));
        latestRematchSummaries.set(userId, summary);
        return summary;
    }
    function buildWeeklyZeroStateAnalytics(
        page: UserWeeklyVacancyPage,
        summary: UserVacancyRematchSummary | null,
        profileId?: number
    ): Record<string, string | number | string[] | null> {
        if (page.total > 0) {
            return {};
        }
        return {
            zero_state_kind: formatters.getWeeklyZeroStateKind(page, summary, profileId),
            evaluated_vacancies: formatters.getWeeklyEvaluatedVacancies(summary, profileId),
            top_reason_codes: formatters.getWeeklyTopRejectionReasons(summary, profileId)
        };
    }
    async function showStartPanel(ctx: grammy.Context, mode: BotPanelMode = "reply"): Promise<void> {
        await userPanels.showStartPanel(ctx, mode);
    }
    async function showOnboardingIntroPanel(ctx: grammy.Context, mode: BotPanelMode = "reply"): Promise<void> {
        await onboardingFlow.showOnboardingIntroPanel(ctx, mode);
    }
    async function showOnboardingWelcomePanel(ctx: grammy.Context, mode: BotPanelMode = "reply"): Promise<void> {
        await onboardingFlow.showOnboardingWelcomePanel(ctx, mode);
    }
    async function showOnboardingPresetPanel(ctx: grammy.Context, mode: BotPanelMode = "reply"): Promise<void> {
        await onboardingFlow.showOnboardingPresetPanel(ctx, mode);
    }
    async function showOnboardingLanguagePanel(ctx: grammy.Context, mode: BotPanelMode = "reply"): Promise<void> {
        await onboardingFlow.showOnboardingLanguagePanel(ctx, mode);
    }
    async function showOnboardingCompletionPanel(
        ctx: grammy.Context,
        mode: BotPanelMode = "reply",
        options?: onboardingFlowModule.OnboardingCompletionOptions
    ): Promise<onboardingFlowModule.OnboardingCompletionResult> {
        return onboardingFlow.showOnboardingCompletionPanel(ctx, mode, options);
    }
    async function showOnboardingManualStep(ctx: grammy.Context, step: OnboardingStep, mode: BotPanelMode = "reply"): Promise<void> {
        await onboardingFlow.showOnboardingManualStep(ctx, step, mode);
    }
    async function showOnboardingFlow(ctx: grammy.Context, mode: BotPanelMode = "reply"): Promise<void> {
        await onboardingFlow.showOnboardingFlow(ctx, mode);
    }
    async function beginSearchProfileInput(ctx: grammy.Context, section: SearchProfileSectionKey, options?: Parameters<inputFlowsModule.InputFlows["beginSearchProfileInput"]>[2]): Promise<void> {
        await inputFlows.beginSearchProfileInput(ctx, section, options);
    }
    async function beginHhInput(ctx: grammy.Context, action: Extract<PendingInputAction, "set_hh_text" | "set_hh_area" | "set_hh_salary" | "set_hh_period">): Promise<void> {
        await inputFlows.beginHhInput(ctx, action);
    }
    async function beginChannelInput(ctx: grammy.Context): Promise<void> {
        await inputFlows.beginChannelInput(ctx);
    }
    async function beginRuntimeSettingInput(ctx: grammy.Context, key: RuntimeSettingKey): Promise<void> {
        await inputFlows.beginRuntimeSettingInput(ctx, key);
    }
    async function beginUserInput(ctx: grammy.Context): Promise<void> {
        await inputFlows.beginUserInput(ctx);
    }
    bot.use(access.createPublicAccessMiddleware(database, {
        onPublicUserRegistered: sendPublicUserRegistrationAlert
    }));
    bot.command("start", async (ctx) => {
        const currentUserId = getCurrentUserId(ctx);
        if (!currentUserId) {
            await showStartPanel(ctx, "reply");
            return;
        }
        await identifyCurrentUser(ctx);
        const settings = database.getUserSettings(currentUserId);
        await analytics.capture({
            eventName: "user_started",
            userId: currentUserId,
            properties: {
                ...buildUserAnalyticsProperties(currentUserId),
                entrypoint: "command"
            }
        });
        if (!settings.onboardingCompleted) {
            if (!settings.onboardingStep) {
                await analytics.capture({
                    eventName: "onboarding_started",
                    userId: currentUserId,
                    properties: {
                        ...buildUserAnalyticsProperties(currentUserId),
                        entrypoint: "command"
                    }
                });
            }
            await showOnboardingFlow(ctx, "reply");
            return;
        }
        await showStartPanel(ctx, "reply");
    });
    bot.command("week", async (ctx) => {
        const currentUserId = getCurrentUserId(ctx);
        if (!currentUserId) {
            return;
        }
        if (!(await ensureWeeklyAccess(ctx, currentUserId, "reply"))) {
            return;
        }
        const summary = await refreshWeeklyFeed(currentUserId, 0);
        const weeklyPageSize = getEffectiveWeeklyPageSize(
            database.getUserSettings(currentUserId),
            runtimeSettings.getSnapshot().weeklyPageSize
        );
        const previewPage = database.listUserWeeklyVacancies(currentUserId, 0, weeklyPageSize, DEFAULT_WEEKLY_WINDOW_DAYS);
        await analytics.capture({
            eventName: "weekly_feed_opened",
            userId: currentUserId,
            properties: {
                ...buildUserAnalyticsProperties(currentUserId),
                entrypoint: "command",
                window_days: DEFAULT_WEEKLY_WINDOW_DAYS,
                offset: 0,
                results_total: previewPage.total,
                ...buildWeeklyZeroStateAnalytics(previewPage, summary)
            }
        });
        await sendWeeklyPage(currentUserId, ctx.chat.id, 0, shouldShowAdmin(ctx.from?.id));
    });
    bot.command("admin", async (ctx) => {
        if (!(await ensureAdminAccess(ctx))) {
            return;
        }
        await showAdminPanel(ctx, "reply");
    });
    bot.command("backup", async (ctx) => {
        await sendBackupSnapshot(ctx);
    });
    bot.command("report", async (ctx) => {
        if (!(await ensureOwnerAccess(ctx))) {
            return;
        }
        const chatId = ctx.chat?.id;
        if (!chatId) {
            await ctx.reply("Не удалось определить чат для отправки отчёта.");
            return;
        }
        try {
            const period: ReportPeriod = 7;
            const report = buildWeeklyReport(database, undefined, period);
            const keyboard = buildReportKeyboard(period);
            await ctx.reply(report, { reply_markup: keyboard });
        } catch (error) {
            loggerModule.logger.error({ err: error }, "Failed to build weekly report");
            await ctx.reply("⚠️ Не удалось сформировать отчёт.");
        }
    });
    bot.command("channelreport", async (ctx) => {
        await handleChannelReportCommand(ctx, database);
    });
    bot.callbackQuery(/^report:period:(\d+)$/, async (ctx) => {
        if (!(await ensureOwnerAccess(ctx))) {
            return;
        }
        const periodValue = Number.parseInt(ctx.match?.[1] ?? "0", 10);
        if (!REPORT_PERIOD_OPTIONS.includes(periodValue as ReportPeriod)) {
            await ctx.answerCallbackQuery({ text: "⚠️ Некорректный период." });
            return;
        }
        const period = periodValue as ReportPeriod;
        const msg = ctx.callbackQuery.message;
        if (msg && "reply_markup" in msg && isPeriodSelectedInMessage(msg, period)) {
            await ctx.answerCallbackQuery();
            return;
        }
        try {
            const report = buildWeeklyReport(database, undefined, period);
            const keyboard = buildReportKeyboard(period);
            await ctx.editMessageText(report, { reply_markup: keyboard });
            await ctx.answerCallbackQuery();
        } catch (error) {
            loggerModule.logger.error({ err: error }, "Failed to rebuild report for period");
            await ctx.answerCallbackQuery({ text: "⚠️ Не удалось обновить отчёт." });
        }
    });
    bot.callbackQuery("menu:home", async (ctx) => {
        await ctx.answerCallbackQuery();
        const currentUserId = getCurrentUserId(ctx);
        if (currentUserId && !database.getUserSettings(currentUserId).onboardingCompleted) {
            await showOnboardingFlow(ctx, "edit");
            return;
        }
        await showStartPanel(ctx, "edit");
    });
    bot.callbackQuery("onboarding:continue", async (ctx) => {
        await ctx.answerCallbackQuery();
        await showOnboardingWelcomePanel(ctx, "edit");
    });
    bot.callbackQuery("menu:admin", async (ctx) => {
        if (!(await ensureAdminAccess(ctx))) {
            return;
        }
        await ctx.answerCallbackQuery();
        await showAdminPanel(ctx, "edit");
    });
    bot.callbackQuery("menu:settings", async (ctx) => {
        await ctx.answerCallbackQuery();
        await showUserSettingsPanel(ctx, "edit");
    });
    bot.callbackQuery("menu:vacancies", async (ctx) => {
        await ctx.answerCallbackQuery();
        await showMyVacanciesPanel(ctx, "edit");
    });
    bot.callbackQuery("noop", async (ctx) => {
        await ctx.answerCallbackQuery();
    });
    bot.callbackQuery("menu:notifications", async (ctx) => {
        await ctx.answerCallbackQuery();
        await showNotificationsPanel(ctx, "edit");
    });
    bot.callbackQuery("menu:diagnostics", async (ctx) => {
        await ctx.answerCallbackQuery();
        await showUserQuietDiagnosticsPanel(ctx, "edit");
    });
    bot.callbackQuery("menu:filters", async (ctx) => {
        const currentUserId = getCurrentUserId(ctx);
        if (currentUserId) {
            database.clearPendingInputAction(currentUserId);
        }
        await ctx.answerCallbackQuery();
        await showPersonalFiltersPanel(ctx, "edit");
    });
    bot.callbackQuery("filters:add", async (ctx) => {
        await ctx.answerCallbackQuery();
        await showAddSearchProfilePanel(ctx, "edit");
    });
    bot.callbackQuery("filters:add:presets", async (ctx) => {
        await ctx.answerCallbackQuery();
        await showSearchProfilePresetsPanel(ctx, "edit", "new");
    });
    bot.callbackQuery("filters:add:manual", async (ctx) => {
        const currentUserId = getCurrentUserId(ctx);
        if (!currentUserId) {
            await ctx.answerCallbackQuery({ text: "⚠️ Не удалось определить пользователя." });
            return;
        }
        try {
            const profile = database.createUserSearchProfile(currentUserId, { name: "Мой поиск" });
            await analytics.capture({
                eventName: "profile_created",
                userId: currentUserId,
                properties: { ...buildUserAnalyticsProperties(currentUserId), profile_id: profile.id, profile_name: profile.name, source: "manual" }
            });
            await ctx.answerCallbackQuery({ text: `✅ Создан поиск «${profile.name}».` });
            await showSearchProfileDetailPanel(ctx, profile.id, "edit");
        }
        catch (error) {
            await ctx.answerCallbackQuery({ text: error instanceof Error ? error.message : "Не удалось создать поиск." });
        }
    });
    bot.callbackQuery(/^filters:profile:(\d+)$/, async (ctx) => {
        const currentUserId = getCurrentUserId(ctx);
        const profileId = Number.parseInt(ctx.match?.[1] ?? "0", 10);
        if (!currentUserId || !database.getUserSearchProfileById(currentUserId, profileId)) {
            await ctx.answerCallbackQuery({ text: "⚠️ Поиск не найден." });
            await showPersonalFiltersPanel(ctx, "edit");
            return;
        }
        database.clearPendingInputAction(currentUserId);
        await ctx.answerCallbackQuery();
        await showSearchProfileDetailPanel(ctx, profileId, "edit");
    });
    bot.callbackQuery(/^filters:profile:(\d+):edit:(required_context|required_primary|preferred|exclude)$/, async (ctx) => {
        const currentUserId = getCurrentUserId(ctx);
        const profileId = Number.parseInt(ctx.match?.[1] ?? "0", 10);
        const section = ctx.match?.[2] as SearchProfileSectionKey | undefined;
        if (!currentUserId || !section || !database.getUserSearchProfileById(currentUserId, profileId)) {
            await ctx.answerCallbackQuery({ text: "⚠️ Поиск не найден." });
            return;
        }
        await beginSearchProfileInput(ctx, section, {
            profileId,
            backTarget: `filters:profile:${profileId}`
        });
    });
    bot.callbackQuery(/^filters:profile:(\d+):language$/, async (ctx) => {
        const currentUserId = getCurrentUserId(ctx);
        const profileId = Number.parseInt(ctx.match?.[1] ?? "0", 10);
        const profile = currentUserId ? database.getUserSearchProfileById(currentUserId, profileId) : null;
        if (!currentUserId || !profile) {
            await ctx.answerCallbackQuery({ text: "⚠️ Поиск не найден." });
            return;
        }
        const nextMode = nextVacancyLanguageMode(profile.vacancyLanguageMode);
        database.setUserSearchProfileLanguageMode(currentUserId, profileId, nextMode);
        await rebuildUserVacancyFeed(currentUserId);
        await ctx.answerCallbackQuery({ text: `${adminUi.vacancyLanguageModeFlags(nextMode)} Язык обновлён.` });
        await showSearchProfileDetailPanel(ctx, profileId, "edit");
    });
    bot.callbackQuery(/^filters:profile:(\d+):presets$/, async (ctx) => {
        const currentUserId = getCurrentUserId(ctx);
        const profileId = Number.parseInt(ctx.match?.[1] ?? "0", 10);
        if (!currentUserId || !database.getUserSearchProfileById(currentUserId, profileId)) {
            await ctx.answerCallbackQuery({ text: "⚠️ Поиск не найден." });
            return;
        }
        await ctx.answerCallbackQuery();
        await showSearchProfilePresetsPanel(ctx, "edit", profileId);
    });
    bot.callbackQuery(/^filters:profile:(\d+):rename$/, async (ctx) => {
        const currentUserId = getCurrentUserId(ctx);
        const profileId = Number.parseInt(ctx.match?.[1] ?? "0", 10);
        const profile = currentUserId ? database.getUserSearchProfileById(currentUserId, profileId) : null;
        if (!currentUserId || !profile) {
            await ctx.answerCallbackQuery({ text: "⚠️ Поиск не найден." });
            return;
        }
        database.setPendingInputAction(currentUserId, "rename_search_profile", String(profileId));
        await ctx.answerCallbackQuery({ text: "⌛ Жду новое название." });
        await ctx.reply(`✏️ Новое название для поиска «${profile.name}»\n\nОтправь название длиной до 40 символов.`, {
            reply_markup: adminUi.createPendingInputKeyboard(`filters:profile:${profileId}`)
        });
    });
    bot.callbackQuery(/^filters:profile:(\d+):toggle$/, async (ctx) => {
        const currentUserId = getCurrentUserId(ctx);
        const profileId = Number.parseInt(ctx.match?.[1] ?? "0", 10);
        const profile = currentUserId ? database.getUserSearchProfileById(currentUserId, profileId) : null;
        if (!currentUserId || !profile) {
            await ctx.answerCallbackQuery({ text: "⚠️ Поиск не найден." });
            return;
        }
        const updated = database.setUserSearchProfileActive(currentUserId, profileId, !profile.isActive);
        await rebuildUserVacancyFeed(currentUserId);
        await analytics.capture({
            eventName: "profile_paused",
            userId: currentUserId,
            properties: { ...buildUserAnalyticsProperties(currentUserId), profile_id: profileId, profile_name: profile.name, is_active: updated.isActive }
        });
        await ctx.answerCallbackQuery({ text: updated.isActive ? "▶️ Поиск возобновлён." : "⏸️ Поиск поставлен на паузу." });
        await showSearchProfileDetailPanel(ctx, profileId, "edit");
    });
    bot.callbackQuery(/^filters:profile:(\d+):rematch$/, async (ctx) => {
        const currentUserId = getCurrentUserId(ctx);
        const profileId = Number.parseInt(ctx.match?.[1] ?? "0", 10);
        if (!currentUserId || !database.getUserSearchProfileById(currentUserId, profileId)) {
            await ctx.answerCallbackQuery({ text: "⚠️ Поиск не найден." });
            return;
        }
        if (!(await runManualUserVacancyRematch(ctx, currentUserId))) {
            return;
        }
        await showSearchProfileDetailPanel(ctx, profileId, "edit");
    });
    bot.callbackQuery(/^filters:profile:(\d+):reset$/, async (ctx) => {
        const currentUserId = getCurrentUserId(ctx);
        const profileId = Number.parseInt(ctx.match?.[1] ?? "0", 10);
        if (!currentUserId || !database.getUserSearchProfileById(currentUserId, profileId)) {
            await ctx.answerCallbackQuery({ text: "⚠️ Поиск не найден." });
            return;
        }
        await ctx.answerCallbackQuery();
        await ctx.editMessageText("⚠️ Очистить все фильтры этого поиска?", {
            reply_markup: keyboards.createSearchProfileResetConfirmationKeyboard(profileId)
        });
    });
    bot.callbackQuery(/^filters:profile:(\d+):confirm_reset$/, async (ctx) => {
        const currentUserId = getCurrentUserId(ctx);
        const profileId = Number.parseInt(ctx.match?.[1] ?? "0", 10);
        if (!currentUserId || !database.getUserSearchProfileById(currentUserId, profileId)) {
            await ctx.answerCallbackQuery({ text: "⚠️ Поиск не найден." });
            return;
        }
        database.resetUserSearchProfile(currentUserId, profileId);
        await rebuildUserVacancyFeed(currentUserId);
        await ctx.answerCallbackQuery({ text: "↩️ Фильтры поиска очищены." });
        await showSearchProfileDetailPanel(ctx, profileId, "edit");
    });
    bot.callbackQuery(/^filters:profile:(\d+):delete$/, async (ctx) => {
        const currentUserId = getCurrentUserId(ctx);
        const profileId = Number.parseInt(ctx.match?.[1] ?? "0", 10);
        const profile = currentUserId ? database.getUserSearchProfileById(currentUserId, profileId) : null;
        if (!currentUserId || !profile) {
            await ctx.answerCallbackQuery({ text: "⚠️ Поиск не найден." });
            return;
        }
        await ctx.answerCallbackQuery();
        await ctx.editMessageText(`🗑️ Удалить поиск «${profile.name}»?\n\nСохранённые вакансии и статусы не пропадут.`, {
            reply_markup: keyboards.createSearchProfileDeleteConfirmationKeyboard(profileId)
        });
    });
    bot.callbackQuery(/^filters:profile:(\d+):confirm_delete$/, async (ctx) => {
        const currentUserId = getCurrentUserId(ctx);
        const profileId = Number.parseInt(ctx.match?.[1] ?? "0", 10);
        const profile = currentUserId ? database.getUserSearchProfileById(currentUserId, profileId) : null;
        if (!currentUserId || !profile) {
            await ctx.answerCallbackQuery({ text: "⚠️ Поиск не найден." });
            return;
        }
        database.deleteUserSearchProfile(currentUserId, profileId);
        await rebuildUserVacancyFeed(currentUserId);
        await analytics.capture({
            eventName: "profile_deleted",
            userId: currentUserId,
            properties: { ...buildUserAnalyticsProperties(currentUserId), profile_id: profileId, profile_name: profile.name }
        });
        await ctx.answerCallbackQuery({ text: "🗑️ Поиск удалён." });
        await showPersonalFiltersPanel(ctx, "edit");
    });
    bot.callbackQuery("filters:hh", async (ctx) => {
        await ctx.answerCallbackQuery();
        await showHhSearchSettingsPanel(ctx, "edit");
    });
    bot.callbackQuery("menu:filter_presets", async (ctx) => {
        await ctx.answerCallbackQuery();
        await showSearchProfilePresetsPanel(ctx, "edit");
    });
    bot.callbackQuery(/^status:(saved|applied|hidden):(\d+)$/, async (ctx) => {
        const currentUserId = getCurrentUserId(ctx);
        const status = parseVacancyActionStatus(ctx.match?.[1]);
        const offset = Number.parseInt(ctx.match?.[2] ?? "0", 10);
        if (!currentUserId || !status) {
            await ctx.answerCallbackQuery({ text: "⚠️ Не удалось открыть список." });
            return;
        }
        await ctx.answerCallbackQuery();
        await showStatusPage(ctx, currentUserId, status, offset, "edit");
    });
    bot.callbackQuery(/^status:clear:(\d+):(saved|applied|hidden):(\d+)$/, async (ctx) => {
        const currentUserId = getCurrentUserId(ctx);
        const vacancyId = Number.parseInt(ctx.match?.[1] ?? "0", 10);
        const status = parseVacancyActionStatus(ctx.match?.[2]);
        const offset = Number.parseInt(ctx.match?.[3] ?? "0", 10);
        if (!currentUserId || !status || !vacancyId) {
            await ctx.answerCallbackQuery({ text: "⚠️ Не удалось обновить статус." });
            return;
        }
        const previousStatus = database.getUserVacancyStatus(currentUserId, vacancyId);
        if (previousStatus !== status) {
            await ctx.answerCallbackQuery({ text: "ℹ️ У вакансии уже другой статус." });
            await showStatusPage(ctx, currentUserId, status, offset, "edit");
            return;
        }
        database.clearUserVacancyStatus(currentUserId, vacancyId);
        if (status === "applied") {
            const cancelled = database.cancelUserVacancyApplicationFollowUp(currentUserId, vacancyId);
            database.closeUserVacancyApplication(currentUserId, vacancyId);
            if (cancelled) {
                await analytics.capture({
                    eventName: "vacancy_application_followup_cancelled",
                    userId: currentUserId,
                    properties: {
                        ...buildUserAnalyticsProperties(currentUserId),
                        vacancy_id: vacancyId,
                        trigger: "status_clear"
                    }
                });
            }
        }
        const vacancy = database.getVacancy(vacancyId);
        if (vacancy) {
            await analytics.capture({
                eventName: "vacancy_status_changed",
                userId: currentUserId,
                properties: {
                    ...buildUserAnalyticsProperties(currentUserId),
                    vacancy_id: vacancyId,
                    source_name: vacancy.sourceName,
                    source_channel: vacancy.sourceChannel,
                    previous_status: previousStatus,
                    next_status: "inbox"
                }
            });
        }
        await ctx.answerCallbackQuery({ text: buildStatusActionText(status, true) });
        await showStatusPage(ctx, currentUserId, status, offset, "edit");
    });
    bot.callbackQuery(/^application:detail:(\d+):(\d+)$/, async (ctx) => {
        const currentUserId = getCurrentUserId(ctx);
        const vacancyId = Number.parseInt(ctx.match?.[1] ?? "0", 10);
        const offset = Number.parseInt(ctx.match?.[2] ?? "0", 10);
        if (!currentUserId || !vacancyId) {
            await ctx.answerCallbackQuery({ text: "⚠️ Не удалось открыть отклик." });
            return;
        }
        await ctx.answerCallbackQuery();
        await showApplicationDetail(ctx, currentUserId, vacancyId, offset, "edit");
    });
    bot.callbackQuery(/^application:clear:(\d+):(\d+)$/, async (ctx) => {
        const currentUserId = getCurrentUserId(ctx);
        const vacancyId = Number.parseInt(ctx.match?.[1] ?? "0", 10);
        const offset = Number.parseInt(ctx.match?.[2] ?? "0", 10);
        if (!currentUserId || !vacancyId) {
            await ctx.answerCallbackQuery({ text: "⚠️ Не удалось снять отклик." });
            return;
        }
        const previousStatus = database.getUserVacancyStatus(currentUserId, vacancyId);
        database.clearUserVacancyStatus(currentUserId, vacancyId);
        const cancelled = database.cancelUserVacancyApplicationFollowUp(currentUserId, vacancyId);
        database.closeUserVacancyApplication(currentUserId, vacancyId);
        if (cancelled) {
            await analytics.capture({
                eventName: "vacancy_application_followup_cancelled",
                userId: currentUserId,
                properties: {
                    ...buildUserAnalyticsProperties(currentUserId),
                    vacancy_id: vacancyId,
                    trigger: "application_detail_clear"
                }
            });
        }
        const vacancy = database.getVacancy(vacancyId);
        if (vacancy) {
            await analytics.capture({
                eventName: "vacancy_status_changed",
                userId: currentUserId,
                properties: {
                    ...buildUserAnalyticsProperties(currentUserId),
                    vacancy_id: vacancyId,
                    source_name: vacancy.sourceName,
                    source_channel: vacancy.sourceChannel,
                    previous_status: previousStatus,
                    next_status: "inbox"
                }
            });
        }
        await ctx.answerCallbackQuery({ text: buildStatusActionText("applied", true) });
        await showStatusPage(ctx, currentUserId, "applied", offset, "edit");
    });
    bot.callbackQuery(/^reminders:page:(\d+)$/, async (ctx) => {
        const currentUserId = getCurrentUserId(ctx);
        const offset = Number.parseInt(ctx.match?.[1] ?? "0", 10);
        if (!currentUserId) {
            return;
        }
        await ctx.answerCallbackQuery();
        await showVacancyRemindersPage(ctx, currentUserId, offset, "edit");
    });
    bot.callbackQuery(/^reminders:cancel:(\d+):(\d+)$/, async (ctx) => {
        const currentUserId = getCurrentUserId(ctx);
        const vacancyId = Number.parseInt(ctx.match?.[1] ?? "0", 10);
        const offset = Number.parseInt(ctx.match?.[2] ?? "0", 10);
        if (!currentUserId || !vacancyId) {
            return;
        }
        const cancelled = database.cancelUserVacancyReminder(currentUserId, vacancyId);
        await ctx.answerCallbackQuery({ text: cancelled ? "🚫 Напоминание отменено." : "ℹ️ Напоминание уже неактивно." });
        if (cancelled) {
            await analytics.capture({
                eventName: "vacancy_reminder_cancelled",
                userId: currentUserId,
                properties: {
                    ...buildUserAnalyticsProperties(currentUserId),
                    vacancy_id: vacancyId,
                    trigger: "reminders_list"
                }
            });
        }
        await showVacancyRemindersPage(ctx, currentUserId, offset, "edit");
    });
    bot.callbackQuery(/^vacancy:status:(\d+):(saved|applied|hidden)(?::(compact|full))?(?::(w[0-9a-z]+|p[0-9a-z]+\.[0-9a-z]+))?$/, async (ctx) => {
        const currentUserId = getCurrentUserId(ctx);
        const vacancyId = Number.parseInt(ctx.match?.[1] ?? "0", 10);
        const requestedStatus = parseVacancyActionStatus(ctx.match?.[2]);
        const view = parseVacancyNotificationView(ctx.match?.[3]);
        const origin = vacancyCardOrigin.parseVacancyCardOrigin(ctx.match?.[4]);
        if (!currentUserId || !requestedStatus || !vacancyId) {
            await ctx.answerCallbackQuery({ text: "⚠️ Не удалось обновить статус." });
            return;
        }
        const previousStatus = database.getUserVacancyStatus(currentUserId, vacancyId);
        const nextStatus: VacancyUserStatus = previousStatus === requestedStatus ? "inbox" : requestedStatus;
        const activeReminder = database.getActiveUserVacancyReminder(currentUserId, vacancyId);
        if (nextStatus === "inbox") {
            database.clearUserVacancyStatus(currentUserId, vacancyId);
            if (requestedStatus === "applied") {
                const cancelled = database.cancelUserVacancyApplicationFollowUp(currentUserId, vacancyId);
                database.closeUserVacancyApplication(currentUserId, vacancyId);
                if (cancelled) {
                    await analytics.capture({
                        eventName: "vacancy_application_followup_cancelled",
                        userId: currentUserId,
                        properties: {
                            ...buildUserAnalyticsProperties(currentUserId),
                            vacancy_id: vacancyId,
                            trigger: "status_inbox"
                        }
                    });
                }
            }
        }
        else {
            database.setUserVacancyStatus(currentUserId, vacancyId, nextStatus);
            if (nextStatus === "applied") {
                const existingApplication = database.getUserVacancyApplication(currentUserId, vacancyId);
                database.upsertUserVacancyApplication(currentUserId, vacancyId);
                if (!existingApplication) {
                    await analytics.capture({
                        eventName: "vacancy_application_created",
                        userId: currentUserId,
                        properties: {
                            ...buildUserAnalyticsProperties(currentUserId),
                            vacancy_id: vacancyId
                        }
                    });
                }
            }
        }
        if (activeReminder && (nextStatus === "applied" || nextStatus === "hidden")) {
            await analytics.capture({
                eventName: "vacancy_reminder_cancelled",
                userId: currentUserId,
                properties: {
                    ...buildUserAnalyticsProperties(currentUserId),
                    vacancy_id: vacancyId,
                    trigger: `status_${nextStatus}`
                }
            });
        }
        const vacancy = database.getVacancy(vacancyId);
        if (vacancy) {
            await analytics.capture({
                eventName: "vacancy_status_changed",
                userId: currentUserId,
                properties: {
                    ...buildUserAnalyticsProperties(currentUserId),
                    vacancy_id: vacancyId,
                    source_name: vacancy.sourceName,
                    source_channel: vacancy.sourceChannel,
                    previous_status: previousStatus,
                    next_status: nextStatus
                }
            });
        }
        await ctx.answerCallbackQuery({
            text: buildStatusActionText(requestedStatus, nextStatus === "inbox")
        });
        if (nextStatus === "hidden") {
            const result = processRelevanceFeedback(database, currentUserId, vacancyId, "not_relevant");
            if (result.kind === "recorded") {
                await analytics.capture(result.event);
            }
            const restoredWeekly = origin
                ? await showWeeklyPageForOrigin(ctx, currentUserId, origin, "edit")
                : false;
            if (!restoredWeekly) {
                await dismissHiddenVacancyCardMessage(ctx, keyboards.createHiddenVacancyReceiptKeyboard(vacancyId, origin ?? undefined));
            }
            await ctx.reply("👎 Больше не показываю эту вакансию.\nПочему не подходит?", {
                reply_markup: keyboards.createHiddenReasonKeyboard(vacancyId, origin)
            });
            await analytics.capture({
                eventName: "vacancy_hidden_reason_prompt_shown",
                userId: currentUserId,
                properties: {
                    ...buildUserAnalyticsProperties(currentUserId),
                    vacancy_id: vacancyId
                }
            });
            return;
        }
        if (nextStatus === "applied") {
            await showApplicationFollowUpPrompt(ctx, currentUserId, vacancyId, view, origin, "edit");
            return;
        }
        const vacancyRecord = buildVacancyMessageRecord(currentUserId, vacancyId, nextStatus);
        if (!vacancyRecord) {
            return;
        }
        const vacancyWithDuplicates = enrichVacancyDuplicatePosts(vacancyRecord);
        await ctx.editMessageText(formatters.formatVacancyNotification(vacancyWithDuplicates, config, view), {
            reply_markup: buildVacancyActionsKeyboard(vacancyWithDuplicates, shouldShowNotifications(currentUserId), view, origin, currentUserId)
        });
    });
    bot.callbackQuery(/^vacancy:relevance:(\d+):(relevant)(?::(compact|full))?(?::(w[0-9a-z]+|p[0-9a-z]+\.[0-9a-z]+))?$/, async (ctx) => {
        const currentUserId = getCurrentUserId(ctx);
        const vacancyId = Number.parseInt(ctx.match?.[1] ?? "0", 10);
        const value = ctx.match?.[2] as "relevant" | undefined;
        const view = parseVacancyNotificationView(ctx.match?.[3]);
        const origin = vacancyCardOrigin.parseVacancyCardOrigin(ctx.match?.[4]);
        if (!currentUserId || !vacancyId || !value) {
            await ctx.answerCallbackQuery({ text: "⚠️ Не удалось сохранить оценку." });
            return;
        }
        const result = processRelevanceFeedback(database, currentUserId, vacancyId, value);
        if (result.kind === "unchanged") {
            await ctx.answerCallbackQuery({ text: "👍 Уже отмечено как релевантное." });
            return;
        }
        if (result.kind === "vacancy_not_found") {
            await ctx.answerCallbackQuery({ text: "⚠️ Вакансия больше недоступна." });
            return;
        }
        await analytics.capture(result.event);
        await ctx.answerCallbackQuery({ text: "👍 Отмечено как релевантное." });
        const vacancyRecord = buildVacancyMessageRecord(currentUserId, vacancyId);
        if (!vacancyRecord) {
            return;
        }
        const vacancyWithDuplicates = enrichVacancyDuplicatePosts(vacancyRecord);
        const keyboard = buildVacancyActionsKeyboard(vacancyWithDuplicates, shouldShowNotifications(currentUserId), view, origin, currentUserId);
        try {
            await ctx.editMessageReplyMarkup({ reply_markup: keyboard });
        } catch {
            await ctx.editMessageText(formatters.formatVacancyNotification(vacancyWithDuplicates, config, view), {
                reply_markup: keyboard
            });
        }
    });
    bot.callbackQuery(/^hidden_reason:set:(\d+):([a-z_]+)(?::(w[0-9a-z]+|p[0-9a-z]+\.[0-9a-z]+))?$/, async (ctx) => {
        const currentUserId = getCurrentUserId(ctx);
        const vacancyId = Number.parseInt(ctx.match?.[1] ?? "0", 10);
        const reason = parseHiddenVacancyReason(ctx.match?.[2]);
        const origin = vacancyCardOrigin.parseVacancyCardOrigin(ctx.match?.[3]);
        if (!currentUserId || !vacancyId || !reason) {
            await ctx.answerCallbackQuery({ text: "⚠️ Не удалось сохранить причину." });
            return;
        }
        if (database.getUserVacancyStatus(currentUserId, vacancyId) !== "hidden") {
            await ctx.answerCallbackQuery({ text: "ℹ️ Вакансия уже не скрыта." });
            await ctx.editMessageText("🙈 Вакансия уже не скрыта.", { reply_markup: keyboards.createWeeklyReturnKeyboard(origin) });
            return;
        }
        database.setUserVacancyHiddenReason(currentUserId, vacancyId, reason);
        await ctx.answerCallbackQuery({ text: "🙈 Причина сохранена." });
        await ctx.editMessageText(`🙈 Скрыто: ${HIDDEN_VACANCY_REASON_LABELS[reason]}.`, {
            reply_markup: origin ? undefined : keyboards.createHiddenVacancyReceiptKeyboard(vacancyId)
        });
        await analytics.capture({
            eventName: "vacancy_hidden_reason_set",
            userId: currentUserId,
            properties: {
                ...buildUserAnalyticsProperties(currentUserId),
                vacancy_id: vacancyId,
                reason
            }
        });
    });
    bot.callbackQuery(/^hidden_reason:skip:(\d+)(?::(w[0-9a-z]+|p[0-9a-z]+\.[0-9a-z]+))?$/, async (ctx) => {
        const currentUserId = getCurrentUserId(ctx);
        const vacancyId = Number.parseInt(ctx.match?.[1] ?? "0", 10);
        const origin = vacancyCardOrigin.parseVacancyCardOrigin(ctx.match?.[2]);
        if (!currentUserId || !vacancyId) {
            await ctx.answerCallbackQuery({ text: "⚠️ Не удалось обновить сообщение." });
            return;
        }
        await ctx.answerCallbackQuery({ text: "Ок, без причины." });
        await ctx.editMessageText("👎 Больше не показываю эту вакансию.", {
            reply_markup: origin ? undefined : keyboards.createHiddenVacancyReceiptKeyboard(vacancyId)
        });
        await analytics.capture({
            eventName: "vacancy_hidden_reason_skipped",
            userId: currentUserId,
            properties: {
                ...buildUserAnalyticsProperties(currentUserId),
                vacancy_id: vacancyId
            }
        });
    });
    bot.callbackQuery(/^filter_suggestion:(open|dismiss|later):(hidden_[a-z_]+)$/, async (ctx) => {
        const currentUserId = getCurrentUserId(ctx);
        const action = ctx.match?.[1];
        const suggestionKey = ctx.match?.[2] as FilterSuggestionKey | undefined;
        if (!currentUserId || !suggestionKey || !(suggestionKey in FILTER_SUGGESTION_LABELS)) {
            await ctx.answerCallbackQuery({ text: "⚠️ Не удалось обработать подсказку." });
            return;
        }
        if (action === "dismiss") {
            database.dismissUserFilterSuggestion(currentUserId, suggestionKey);
            await ctx.answerCallbackQuery({ text: "Больше не буду часто предлагать это." });
            await showUserQuietDiagnosticsPanel(ctx, "edit");
            return;
        }
        if (action === "open") {
            await ctx.answerCallbackQuery({ text: "Открываю фильтры." });
            await showPersonalFiltersPanel(ctx, "edit");
            return;
        }
        await ctx.answerCallbackQuery({ text: "Ок, вернёмся позже." });
        await showUserQuietDiagnosticsPanel(ctx, "edit");
    });
    bot.callbackQuery(/^vacancy:view:(\d+):(compact|full)(?::(w[0-9a-z]+|p[0-9a-z]+\.[0-9a-z]+))?$/, async (ctx) => {
        const currentUserId = getCurrentUserId(ctx);
        const vacancyId = Number.parseInt(ctx.match?.[1] ?? "0", 10);
        const view = parseVacancyNotificationView(ctx.match?.[2]);
        const origin = vacancyCardOrigin.parseVacancyCardOrigin(ctx.match?.[3]);
        if (!currentUserId || !vacancyId) {
            await ctx.answerCallbackQuery({ text: "⚠️ Не удалось открыть вакансию." });
            return;
        }
        const vacancyRecord = buildVacancyMessageRecord(currentUserId, vacancyId);
        if (!vacancyRecord) {
            await ctx.answerCallbackQuery({ text: "⚠️ Вакансия больше недоступна." });
            return;
        }
        const vacancyWithDuplicates = enrichVacancyDuplicatePosts(vacancyRecord);
        await ctx.answerCallbackQuery({
            text: view === "full" ? "📄 Показываю полный текст." : "↩️ Карточка свёрнута."
        });
        await ctx.editMessageText(formatters.formatVacancyNotification(vacancyWithDuplicates, config, view), {
            reply_markup: buildVacancyActionsKeyboard(vacancyWithDuplicates, shouldShowNotifications(currentUserId), view, origin, currentUserId)
        });
    });
    bot.callbackQuery(/^vacancy:remind:(\d+):(compact|full)(?::(w[0-9a-z]+|p[0-9a-z]+\.[0-9a-z]+))?$/, async (ctx) => {
        const currentUserId = getCurrentUserId(ctx);
        const vacancyId = Number.parseInt(ctx.match?.[1] ?? "0", 10);
        const view = parseVacancyNotificationView(ctx.match?.[2]);
        const origin = vacancyCardOrigin.parseVacancyCardOrigin(ctx.match?.[3]);
        if (!currentUserId || !vacancyId) {
            return;
        }
        const status = database.getUserVacancyStatus(currentUserId, vacancyId);
        if (status === "applied" || status === "hidden") {
            await ctx.answerCallbackQuery({ text: "ℹ️ Для откликнутой или скрытой вакансии напоминание недоступно." });
            return;
        }
        const vacancyRecord = buildVacancyMessageRecord(currentUserId, vacancyId);
        if (!vacancyRecord) {
            await ctx.answerCallbackQuery({ text: "⚠️ Вакансия больше недоступна." });
            return;
        }
        const vacancyWithDuplicates = enrichVacancyDuplicatePosts(vacancyRecord);
        const reminder = database.getActiveUserVacancyReminder(currentUserId, vacancyId);
        await ctx.answerCallbackQuery({ text: reminder ? "⏰ Можно перенести или отменить напоминание." : "⏰ Когда напомнить?" });
        await ctx.editMessageText(formatters.formatVacancyNotification(vacancyWithDuplicates, config, view), {
            reply_markup: keyboards.createVacancyReminderKeyboard(vacancyId, view, Boolean(reminder), origin)
        });
    });
    bot.callbackQuery(/^vacancy:remind:set:(\d+):(evening|tomorrow|three_days):(compact|full)(?::(w[0-9a-z]+|p[0-9a-z]+\.[0-9a-z]+))?$/, async (ctx) => {
        const currentUserId = getCurrentUserId(ctx);
        const vacancyId = Number.parseInt(ctx.match?.[1] ?? "0", 10);
        const preset = parseVacancyReminderPreset(ctx.match?.[2]);
        const view = parseVacancyNotificationView(ctx.match?.[3]);
        const origin = vacancyCardOrigin.parseVacancyCardOrigin(ctx.match?.[4]);
        if (!currentUserId || !vacancyId || !preset) {
            return;
        }
        const remindAt = calculateVacancyReminderAt(preset, new Date(), config.timeZone).toISOString();
        const reminder = database.scheduleUserVacancyReminder(currentUserId, vacancyId, remindAt);
        if (!reminder) {
            await ctx.answerCallbackQuery({ text: "ℹ️ Для откликнутой или скрытой вакансии напоминание недоступно." });
            return;
        }
        await analytics.capture({
            eventName: "vacancy_reminder_scheduled",
            userId: currentUserId,
            properties: {
                ...buildUserAnalyticsProperties(currentUserId),
                vacancy_id: vacancyId,
                preset,
                remind_at: remindAt
            }
        });
        const vacancyRecord = buildVacancyMessageRecord(currentUserId, vacancyId, "saved");
        await ctx.answerCallbackQuery({ text: `⏰ Напомню ${new Intl.DateTimeFormat("ru-RU", { timeZone: config.timeZone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(remindAt))}.` });
        if (!vacancyRecord) {
            return;
        }
        const vacancyWithDuplicates = enrichVacancyDuplicatePosts(vacancyRecord);
        await ctx.editMessageText(formatters.formatVacancyNotification(vacancyWithDuplicates, config, view), {
            reply_markup: buildVacancyActionsKeyboard(vacancyWithDuplicates, shouldShowNotifications(currentUserId), view, origin, currentUserId)
        });
    });
    bot.callbackQuery(/^vacancy:remind:cancel:(\d+):(compact|full)(?::(w[0-9a-z]+|p[0-9a-z]+\.[0-9a-z]+))?$/, async (ctx) => {
        const currentUserId = getCurrentUserId(ctx);
        const vacancyId = Number.parseInt(ctx.match?.[1] ?? "0", 10);
        const view = parseVacancyNotificationView(ctx.match?.[2]);
        const origin = vacancyCardOrigin.parseVacancyCardOrigin(ctx.match?.[3]);
        if (!currentUserId || !vacancyId) {
            return;
        }
        const cancelled = database.cancelUserVacancyReminder(currentUserId, vacancyId);
        await ctx.answerCallbackQuery({ text: cancelled ? "🚫 Напоминание отменено." : "ℹ️ Напоминание уже неактивно." });
        if (cancelled) {
            await analytics.capture({
                eventName: "vacancy_reminder_cancelled",
                userId: currentUserId,
                properties: {
                    ...buildUserAnalyticsProperties(currentUserId),
                    vacancy_id: vacancyId,
                    trigger: "vacancy_card"
                }
            });
        }
        const vacancyRecord = buildVacancyMessageRecord(currentUserId, vacancyId);
        if (!vacancyRecord) {
            return;
        }
        const vacancyWithDuplicates = enrichVacancyDuplicatePosts(vacancyRecord);
        await ctx.editMessageText(formatters.formatVacancyNotification(vacancyWithDuplicates, config, view), {
            reply_markup: buildVacancyActionsKeyboard(vacancyWithDuplicates, shouldShowNotifications(currentUserId), view, origin, currentUserId)
        });
    });
    bot.callbackQuery(/^application:followup:(\d+):(compact|full)(?::(w[0-9a-z]+|p[0-9a-z]+\.[0-9a-z]+))?$/, async (ctx) => {
        const currentUserId = getCurrentUserId(ctx);
        const vacancyId = Number.parseInt(ctx.match?.[1] ?? "0", 10);
        const view = parseVacancyNotificationView(ctx.match?.[2]);
        const origin = vacancyCardOrigin.parseVacancyCardOrigin(ctx.match?.[3]);
        if (!currentUserId || !vacancyId) {
            return;
        }
        if (database.getUserVacancyStatus(currentUserId, vacancyId) !== "applied") {
            await ctx.answerCallbackQuery({ text: "ℹ️ Сначала отметь вакансию как отклик." });
            return;
        }
        if (!database.getUserVacancyApplication(currentUserId, vacancyId)) {
            database.upsertUserVacancyApplication(currentUserId, vacancyId);
        }
        await ctx.answerCallbackQuery({ text: "⏰ Настройки follow-up." });
        await showApplicationFollowUpPrompt(ctx, currentUserId, vacancyId, view, origin, "edit");
    });
    bot.callbackQuery(/^application:followup:set:(\d+):(one_minute|three_days|week):(compact|full)(?::(w[0-9a-z]+|p[0-9a-z]+\.[0-9a-z]+))?$/, async (ctx) => {
        const currentUserId = getCurrentUserId(ctx);
        const vacancyId = Number.parseInt(ctx.match?.[1] ?? "0", 10);
        const preset = parseVacancyApplicationFollowUpPreset(ctx.match?.[2]);
        const view = parseVacancyNotificationView(ctx.match?.[3]);
        const origin = vacancyCardOrigin.parseVacancyCardOrigin(ctx.match?.[4]);
        if (!currentUserId || !vacancyId || !preset) {
            return;
        }
        if (database.getUserVacancyStatus(currentUserId, vacancyId) !== "applied") {
            await ctx.answerCallbackQuery({ text: "ℹ️ Сначала отметь вакансию как отклик." });
            return;
        }
        if (preset === "one_minute" && !database.hasAdminAccess(currentUserId)) {
            await ctx.answerCallbackQuery({ text: "ℹ️ Быстрая проверка доступна только админам." });
            return;
        }
        const followUpAt = scheduleApplicationFollowUp(currentUserId, vacancyId, preset);
        await analytics.capture({
            eventName: "vacancy_application_followup_scheduled",
            userId: currentUserId,
            properties: {
                ...buildUserAnalyticsProperties(currentUserId),
                vacancy_id: vacancyId,
                preset,
                follow_up_at: followUpAt
            }
        });
        await ctx.answerCallbackQuery({
            text: `⏰ Напомню ${new Intl.DateTimeFormat("ru-RU", { timeZone: config.timeZone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(followUpAt))}.`
        });
        await showVacancyCardById(ctx, currentUserId, vacancyId, view, origin, "edit");
    });
    bot.callbackQuery(/^application:followup:skip:(\d+):(compact|full)(?::(w[0-9a-z]+|p[0-9a-z]+\.[0-9a-z]+))?$/, async (ctx) => {
        const currentUserId = getCurrentUserId(ctx);
        const vacancyId = Number.parseInt(ctx.match?.[1] ?? "0", 10);
        const view = parseVacancyNotificationView(ctx.match?.[2]);
        const origin = vacancyCardOrigin.parseVacancyCardOrigin(ctx.match?.[3]);
        if (!currentUserId || !vacancyId) {
            return;
        }
        const cancelled = database.cancelUserVacancyApplicationFollowUp(currentUserId, vacancyId);
        if (cancelled) {
            await analytics.capture({
                eventName: "vacancy_application_followup_cancelled",
                userId: currentUserId,
                properties: {
                    ...buildUserAnalyticsProperties(currentUserId),
                    vacancy_id: vacancyId,
                    trigger: "skip_prompt"
                }
            });
        }
        await ctx.answerCallbackQuery({ text: "Ок, без follow-up." });
        await showVacancyCardById(ctx, currentUserId, vacancyId, view, origin, "edit");
    });
    bot.callbackQuery(/^application:note:(\d+):detail:(\d+)$/, async (ctx) => {
        const currentUserId = getCurrentUserId(ctx);
        const vacancyId = Number.parseInt(ctx.match?.[1] ?? "0", 10);
        const offset = Number.parseInt(ctx.match?.[2] ?? "0", 10);
        if (!currentUserId || !vacancyId) {
            return;
        }
        database.setPendingInputAction(currentUserId, "set_application_note", JSON.stringify({ vacancyId, view: "compact", returnTo: "application_detail", offset }));
        await ctx.answerCallbackQuery({ text: "⌛ Жду заметку." });
        await ctx.editMessageText(
            [
                "📝 Заметка к отклику",
                "",
                "Отправь короткий комментарий до 500 символов.",
                "Чтобы очистить заметку, отправь `-`, `clear` или `очистить`."
            ].join("\n"),
            { reply_markup: adminUi.createPendingInputKeyboard(`application:detail:${vacancyId}:${offset}`) }
        );
    });
    bot.callbackQuery(/^application:note:(\d+):(compact|full)(?::(w[0-9a-z]+|p[0-9a-z]+\.[0-9a-z]+))?$/, async (ctx) => {
        const currentUserId = getCurrentUserId(ctx);
        const vacancyId = Number.parseInt(ctx.match?.[1] ?? "0", 10);
        const view = parseVacancyNotificationView(ctx.match?.[2]);
        const origin = ctx.match?.[3];
        if (!currentUserId || !vacancyId) {
            return;
        }
        database.setPendingInputAction(currentUserId, "set_application_note", JSON.stringify({ vacancyId, view, origin }));
        await ctx.answerCallbackQuery({ text: "⌛ Жду заметку." });
        await ctx.editMessageText(
            [
                "📝 Заметка к отклику",
                "",
                "Отправь короткий комментарий до 500 символов.",
                "Чтобы очистить заметку, отправь `-`, `clear` или `очистить`."
            ].join("\n"),
            { reply_markup: adminUi.createPendingInputKeyboard(`vacancy:view:${vacancyId}:${view}${origin ? `:${origin}` : ""}`) }
        );
    });
    bot.callbackQuery(/^application:responded:(\d+)(?::detail:(\d+))?$/, async (ctx) => {
        const currentUserId = getCurrentUserId(ctx);
        const vacancyId = Number.parseInt(ctx.match?.[1] ?? "0", 10);
        const offset = ctx.match?.[2] ? Number.parseInt(ctx.match[2], 10) : null;
        if (!currentUserId || !vacancyId) {
            return;
        }
        database.markUserVacancyApplicationResponded(currentUserId, vacancyId);
        await analytics.capture({
            eventName: "vacancy_application_followup_cancelled",
            userId: currentUserId,
            properties: {
                ...buildUserAnalyticsProperties(currentUserId),
                vacancy_id: vacancyId,
                trigger: "responded"
            }
        });
        await ctx.answerCallbackQuery({ text: "✅ Отмечено: ответили." });
        if (offset !== null) {
            await showApplicationDetail(ctx, currentUserId, vacancyId, offset, "edit");
            return;
        }
        await showVacancyCardById(ctx, currentUserId, vacancyId, "compact", undefined, "edit");
    });
    bot.callbackQuery(/^application:closed:(\d+)(?::detail:(\d+))?$/, async (ctx) => {
        const currentUserId = getCurrentUserId(ctx);
        const vacancyId = Number.parseInt(ctx.match?.[1] ?? "0", 10);
        const offset = ctx.match?.[2] ? Number.parseInt(ctx.match[2], 10) : null;
        if (!currentUserId || !vacancyId) {
            return;
        }
        database.closeUserVacancyApplication(currentUserId, vacancyId);
        await analytics.capture({
            eventName: "vacancy_application_followup_cancelled",
            userId: currentUserId,
            properties: {
                ...buildUserAnalyticsProperties(currentUserId),
                vacancy_id: vacancyId,
                trigger: "closed"
            }
        });
        await ctx.answerCallbackQuery({ text: "📦 Follow-up закрыт." });
        if (offset !== null) {
            await showApplicationDetail(ctx, currentUserId, vacancyId, offset, "edit");
            return;
        }
        await showVacancyCardById(ctx, currentUserId, vacancyId, "compact", undefined, "edit");
    });
    bot.callbackQuery("onboarding:welcome", async (ctx) => {
        await ctx.answerCallbackQuery();
        await showOnboardingWelcomePanel(ctx, "edit");
    });
    bot.callbackQuery("onboarding:preset_menu", async (ctx) => {
        await ctx.answerCallbackQuery();
        await showOnboardingPresetPanel(ctx, "edit");
    });
    bot.callbackQuery("onboarding:manual_start", async (ctx) => {
        const currentUserId = getCurrentUserId(ctx);
        await ctx.answerCallbackQuery();
        if (currentUserId) {
            await analytics.capture({
                eventName: "manual_profile_setup_started",
                userId: currentUserId,
                properties: {
                    ...buildUserAnalyticsProperties(currentUserId),
                    entrypoint: "callback"
                }
            });
        }
        await showOnboardingManualStep(ctx, "manual_required_context", "edit");
    });
    bot.callbackQuery("onboarding:skip", async (ctx) => {
        const currentUserId = getCurrentUserId(ctx);
        if (currentUserId && database.getUserSettings(currentUserId).onboardingCompleted) {
            await ctx.answerCallbackQuery({ text: "✅ Настройка уже завершена." });
            await showStartPanel(ctx, "edit");
            return;
        }
        await ctx.answerCallbackQuery();
        if (currentUserId) {
            await analytics.capture({
                eventName: "onboarding_skipped",
                userId: currentUserId,
                properties: {
                    ...buildUserAnalyticsProperties(currentUserId),
                    current_step: database.getUserSettings(currentUserId).onboardingStep
                }
            });
        }
        await showOnboardingCompletionPanel(ctx, "edit", { trigger: "skipped" });
    });
    bot.callbackQuery("onboarding:skip_step", async (ctx) => {
        const currentUserId = getCurrentUserId(ctx);
        if (!currentUserId) {
            await ctx.answerCallbackQuery({ text: "⚠️ Не удалось определить пользователя." });
            return;
        }
        const currentStep = database.getUserSettings(currentUserId).onboardingStep;
        if (!currentStep) {
            await ctx.answerCallbackQuery();
            await showOnboardingIntroPanel(ctx, "edit");
            return;
        }
        if (!onboardingFlowModule.canSkipOnboardingStep(currentStep)) {
            await ctx.answerCallbackQuery({
                text: "🧭 Этот шаг лучше заполнить или завершить настройку позже."
            });
            const section = onboardingFlowModule.onboardingStepToSection(currentStep);
            if (section) {
                await showOnboardingManualStep(ctx, currentStep, "edit");
            }
            else {
                await showOnboardingFlow(ctx, "edit");
            }
            return;
        }
        await ctx.answerCallbackQuery();
        const nextStep = onboardingFlowModule.nextOnboardingStep(currentStep);
        database.clearPendingInputAction(currentUserId);
        if (!nextStep) {
            await showOnboardingCompletionPanel(ctx, "edit", { trigger: "skipped" });
            return;
        }
        if (nextStep === "language") {
            await showOnboardingLanguagePanel(ctx, "edit");
            return;
        }
        await showOnboardingManualStep(ctx, nextStep, "edit");
    });
    bot.callbackQuery(/^onboarding:language:(ru_en|ru_only|en_only)$/, async (ctx) => {
        const currentUserId = getCurrentUserId(ctx);
        const nextMode = parseVacancyLanguageMode(ctx.match?.[1]);
        if (!currentUserId || !nextMode) {
            await ctx.answerCallbackQuery({ text: "⚠️ Не удалось сохранить язык вакансий." });
            return;
        }
        if (database.getUserSettings(currentUserId).onboardingCompleted) {
            await ctx.answerCallbackQuery({ text: "✅ Настройка уже завершена." });
            await showStartPanel(ctx, "edit");
            return;
        }
        database.setVacancyLanguageMode(currentUserId, nextMode);
        const rematchSummary = await rebuildUserVacancyFeed(currentUserId);
        await ctx.answerCallbackQuery({
            text: `${adminUi.vacancyLanguageModeFlags(nextMode)} Выбрано: ${adminUi.vacancyLanguageModeLabel(nextMode)}`
        });
        await showOnboardingCompletionPanel(ctx, "edit", {
            trigger: "configured",
            rematchSummary
        });
    });
    bot.callbackQuery("filters:edit_required_context", async (ctx) => {
        await beginSearchProfileInput(ctx, "required_context");
    });
    bot.callbackQuery("filters:edit_required_primary", async (ctx) => {
        await beginSearchProfileInput(ctx, "required_primary");
    });
    bot.callbackQuery("filters:edit_preferred", async (ctx) => {
        await beginSearchProfileInput(ctx, "preferred");
    });
    bot.callbackQuery("filters:edit_exclude", async (ctx) => {
        await beginSearchProfileInput(ctx, "exclude");
    });
    bot.callbackQuery("filters:toggle_language", async (ctx) => {
        const currentUserId = getCurrentUserId(ctx);
        if (!currentUserId) {
            await ctx.answerCallbackQuery({ text: "⚠️ Не удалось определить пользователя." });
            return;
        }
        const currentSettings = database.getUserSettings(currentUserId);
        const nextMode = nextVacancyLanguageMode(currentSettings.vacancyLanguageMode);
        database.setVacancyLanguageMode(currentUserId, nextMode);
        await rebuildUserVacancyFeed(currentUserId);
        await ctx.answerCallbackQuery({
            text: `${adminUi.vacancyLanguageModeFlags(nextMode)} Язык вакансий: ${adminUi.vacancyLanguageModeLabel(nextMode)}`
        });
        await showPersonalFiltersPanel(ctx, "edit");
    });
    bot.callbackQuery("filters:reset_profile", async (ctx) => {
        const currentUserId = getCurrentUserId(ctx);
        if (!currentUserId) {
            await ctx.answerCallbackQuery({ text: "⚠️ Не удалось определить пользователя." });
            return;
        }
        await ctx.answerCallbackQuery();
        await ctx.editMessageText([
            "⚠️ Сбросить поисковый профиль?",
            "",
            "Будут очищены условия, основной профиль, желательные сигналы и стоп-слова.",
            "Текущая подборка перестанет работать, пока профиль не будет настроен заново."
        ].join("\n"), {
            reply_markup: keyboards.createPersonalFiltersResetConfirmationKeyboard()
        });
    });
    bot.callbackQuery("filters:confirm_reset_profile", async (ctx) => {
        const currentUserId = getCurrentUserId(ctx);
        if (!currentUserId) {
            await ctx.answerCallbackQuery({ text: "⚠️ Не удалось определить пользователя." });
            return;
        }
        database.resetUserSearchProfile(currentUserId);
        database.clearPendingInputAction(currentUserId);
        await ctx.answerCallbackQuery({ text: "↩️ Профиль поиска очищен." });
        await rebuildUserVacancyFeed(currentUserId);
        await showPersonalFiltersPanel(ctx, "edit");
    });
    bot.callbackQuery("filters:rematch", async (ctx) => {
        const currentUserId = getCurrentUserId(ctx);
        if (!currentUserId) {
            await ctx.answerCallbackQuery({ text: "⚠️ Не удалось определить пользователя." });
            return;
        }
        if (!(await runManualUserVacancyRematch(ctx, currentUserId))) {
            return;
        }
        await showPersonalFiltersPanel(ctx, "edit");
    });
    bot.callbackQuery("filters:hh:toggle", async (ctx) => {
        const currentUserId = getCurrentUserId(ctx);
        if (!currentUserId) {
            await ctx.answerCallbackQuery({ text: "⚠️ Не удалось определить пользователя." });
            return;
        }
        const settings = database.getUserHhSearchSettings(currentUserId);
        if (!settings.enabled && settings.text.trim().length === 0) {
            await beginHhInput(ctx, "set_hh_text");
            return;
        }
        const nextSettings = database.updateUserHhSearchSettings(currentUserId, { enabled: !settings.enabled });
        await rebuildUserVacancyFeed(currentUserId);
        await ctx.answerCallbackQuery({
            text: nextSettings.enabled ? "▶️ hh.ru включён." : "⏸️ hh.ru выключен."
        });
        await showHhSearchSettingsPanel(ctx, "edit");
    });
    bot.callbackQuery("filters:hh:edit_text", async (ctx) => {
        await beginHhInput(ctx, "set_hh_text");
    });
    bot.callbackQuery("filters:hh:edit_area", async (ctx) => {
        await beginHhInput(ctx, "set_hh_area");
    });
    bot.callbackQuery("filters:hh:edit_salary", async (ctx) => {
        await beginHhInput(ctx, "set_hh_salary");
    });
    bot.callbackQuery("filters:hh:edit_period", async (ctx) => {
        await beginHhInput(ctx, "set_hh_period");
    });
    bot.callbackQuery("filters:hh:cycle_experience", async (ctx) => {
        const currentUserId = getCurrentUserId(ctx);
        if (!currentUserId) {
            await ctx.answerCallbackQuery({ text: "⚠️ Не удалось определить пользователя." });
            return;
        }
        const settings = database.getUserHhSearchSettings(currentUserId);
        const nextSettings = database.updateUserHhSearchSettings(currentUserId, {
            experience: hhSearchValidation.nextHhExperience(settings.experience)
        });
        await rebuildUserVacancyFeed(currentUserId);
        await ctx.answerCallbackQuery({ text: `🧭 Опыт: ${nextSettings.experience}` });
        await showHhSearchSettingsPanel(ctx, "edit");
    });
    bot.callbackQuery("filters:hh:cycle_schedule", async (ctx) => {
        const currentUserId = getCurrentUserId(ctx);
        if (!currentUserId) {
            await ctx.answerCallbackQuery({ text: "⚠️ Не удалось определить пользователя." });
            return;
        }
        const settings = database.getUserHhSearchSettings(currentUserId);
        const nextSettings = database.updateUserHhSearchSettings(currentUserId, {
            schedule: hhSearchValidation.nextHhSchedule(settings.schedule)
        });
        await rebuildUserVacancyFeed(currentUserId);
        await ctx.answerCallbackQuery({ text: `🏡 График: ${nextSettings.schedule}` });
        await showHhSearchSettingsPanel(ctx, "edit");
    });
    bot.callbackQuery("filters:hh:cycle_employment", async (ctx) => {
        const currentUserId = getCurrentUserId(ctx);
        if (!currentUserId) {
            await ctx.answerCallbackQuery({ text: "⚠️ Не удалось определить пользователя." });
            return;
        }
        const settings = database.getUserHhSearchSettings(currentUserId);
        const nextSettings = database.updateUserHhSearchSettings(currentUserId, {
            employment: hhSearchValidation.nextHhEmployment(settings.employment)
        });
        await rebuildUserVacancyFeed(currentUserId);
        await ctx.answerCallbackQuery({ text: `💼 Занятость: ${nextSettings.employment}` });
        await showHhSearchSettingsPanel(ctx, "edit");
    });
    bot.callbackQuery("filters:hh:rematch", async (ctx) => {
        const currentUserId = getCurrentUserId(ctx);
        if (!currentUserId) {
            await ctx.answerCallbackQuery({ text: "⚠️ Не удалось определить пользователя." });
            return;
        }
        if (!(await runManualUserVacancyRematch(ctx, currentUserId))) {
            return;
        }
        await showHhSearchSettingsPanel(ctx, "edit");
    });
    bot.callbackQuery(/^filters:preset_new:([a-z0-9_]+)$/, async (ctx) => {
        const currentUserId = getCurrentUserId(ctx);
        const presetId = parseSearchProfilePresetId(ctx.match?.[1]);
        const preset = presetId ? searchProfilePresets.getSearchProfilePreset(presetId) : null;
        if (!currentUserId || !preset) {
            await ctx.answerCallbackQuery({ text: "⚠️ Пресет не найден." });
            return;
        }
        try {
            const profile = database.createUserSearchProfile(currentUserId, {
                name: preset.label,
                requiredContextKeywords: preset.requiredContextKeywords,
                requiredPrimaryKeywords: preset.requiredPrimaryKeywords,
                preferredKeywords: preset.preferredKeywords,
                excludeKeywords: preset.excludeKeywords
            });
            await rebuildUserVacancyFeed(currentUserId);
            await analytics.capture({
                eventName: "profile_created",
                userId: currentUserId,
                properties: { ...buildUserAnalyticsProperties(currentUserId), profile_id: profile.id, profile_name: profile.name, source: "preset", preset_id: presetId }
            });
            await analytics.capture({
                eventName: "preset_selected",
                userId: currentUserId,
                properties: { ...buildUserAnalyticsProperties(currentUserId), profile_id: profile.id, profile_name: profile.name, preset_id: presetId, onboarding_flow: false }
            });
            await ctx.answerCallbackQuery({ text: `✅ Создан поиск «${profile.name}».` });
            await showSearchProfileDetailPanel(ctx, profile.id, "edit");
        }
        catch (error) {
            await ctx.answerCallbackQuery({ text: error instanceof Error ? error.message : "Не удалось создать поиск." });
        }
    });
    bot.callbackQuery(/^filters:profile:(\d+):preset:([a-z0-9_]+)$/, async (ctx) => {
        const currentUserId = getCurrentUserId(ctx);
        const profileId = Number.parseInt(ctx.match?.[1] ?? "0", 10);
        const presetId = parseSearchProfilePresetId(ctx.match?.[2]);
        const profile = currentUserId ? database.getUserSearchProfileById(currentUserId, profileId) : null;
        const preset = presetId ? searchProfilePresets.getSearchProfilePreset(presetId) : null;
        if (!currentUserId || !profile || !preset) {
            await ctx.answerCallbackQuery({ text: "⚠️ Поиск или пресет не найден." });
            return;
        }
        const beforeHealth = searchProfileHealth.getSearchProfileHealth(profile);
        database.replaceUserSearchProfile(currentUserId, {
            requiredContextKeywords: preset.requiredContextKeywords,
            requiredPrimaryKeywords: preset.requiredPrimaryKeywords,
            preferredKeywords: preset.preferredKeywords,
            excludeKeywords: preset.excludeKeywords
        }, profileId);
        await rebuildUserVacancyFeed(currentUserId);
        await analytics.capture({
            eventName: "preset_selected",
            userId: currentUserId,
            properties: { ...buildUserAnalyticsProperties(currentUserId), profile_id: profileId, profile_name: profile.name, preset_id: presetId, onboarding_flow: false }
        });
        await trackProfileReadyTransition(currentUserId, beforeHealth.status, "preset", {
            profile_id: profileId,
            profile_name: profile.name,
            preset_id: presetId
        });
        await ctx.answerCallbackQuery({ text: `✅ Пресет применён к «${profile.name}».` });
        await showSearchProfileDetailPanel(ctx, profileId, "edit");
    });
    bot.callbackQuery(/^filters:preset:([a-z0-9_]+)$/, async (ctx) => {
        const currentUserId = getCurrentUserId(ctx);
        const presetId = parseSearchProfilePresetId(ctx.match?.[1]);
        if (!currentUserId || !presetId) {
            await ctx.answerCallbackQuery({ text: "⚠️ Не удалось определить пользователя или пресет." });
            return;
        }
        const preset = searchProfilePresets.getSearchProfilePreset(presetId);
        if (!preset) {
            await ctx.answerCallbackQuery({ text: "❓ Такой пресет не найден." });
            return;
        }
        const currentSettings = database.getUserSettings(currentUserId);
        if (currentSettings.onboardingCompleted) {
            try {
                const profile = database.createUserSearchProfile(currentUserId, {
                    name: preset.label,
                    requiredContextKeywords: preset.requiredContextKeywords,
                    requiredPrimaryKeywords: preset.requiredPrimaryKeywords,
                    preferredKeywords: preset.preferredKeywords,
                    excludeKeywords: preset.excludeKeywords
                });
                await rebuildUserVacancyFeed(currentUserId);
                await analytics.capture({
                    eventName: "profile_created",
                    userId: currentUserId,
                    properties: { ...buildUserAnalyticsProperties(currentUserId), profile_id: profile.id, profile_name: profile.name, source: "preset", preset_id: presetId }
                });
                await analytics.capture({
                    eventName: "preset_selected",
                    userId: currentUserId,
                    properties: { ...buildUserAnalyticsProperties(currentUserId), profile_id: profile.id, profile_name: profile.name, preset_id: presetId, onboarding_flow: false }
                });
                await ctx.answerCallbackQuery({ text: `✅ Создан поиск «${profile.name}».` });
                await showSearchProfileDetailPanel(ctx, profile.id, "edit");
            }
            catch (error) {
                await ctx.answerCallbackQuery({ text: error instanceof Error ? error.message : "Не удалось создать поиск." });
            }
            return;
        }
        const onboardingProfile = database.getUserSearchProfile(currentUserId);
        const beforeHealth = searchProfileHealth.getSearchProfileHealth(onboardingProfile);
        database.replaceUserSearchProfile(currentUserId, {
            requiredContextKeywords: preset.requiredContextKeywords,
            requiredPrimaryKeywords: preset.requiredPrimaryKeywords,
            preferredKeywords: preset.preferredKeywords,
            excludeKeywords: preset.excludeKeywords
        }, onboardingProfile.id);
        database.renameUserSearchProfile(currentUserId, onboardingProfile.id, preset.label);
        database.clearPendingInputAction(currentUserId);
        await analytics.capture({
            eventName: "preset_selected",
            userId: currentUserId,
            properties: {
                ...buildUserAnalyticsProperties(currentUserId),
                preset_id: presetId,
                profile_id: onboardingProfile.id,
                profile_name: preset.label,
                onboarding_flow: !database.getUserSettings(currentUserId).onboardingCompleted,
                previous_profile_health: beforeHealth.status
            }
        });
        await trackProfileReadyTransition(currentUserId, beforeHealth.status, "preset", {
            preset_id: presetId,
            profile_id: onboardingProfile.id,
            profile_name: preset.label
        });
        const finishOnboardingAfterPreset = !currentSettings.onboardingCompleted && currentSettings.onboardingStep === "preset";
        if (finishOnboardingAfterPreset) {
            await ctx.answerCallbackQuery({ text: `✅ Применён пресет ${adminUi.presetAppliedLabel(presetId)}.` });
            await showOnboardingLanguagePanel(ctx, "edit");
            return;
        }
        await rebuildUserVacancyFeed(currentUserId);
        await ctx.answerCallbackQuery({ text: `✅ Применён пресет ${adminUi.presetAppliedLabel(presetId)}.` });
        await showPersonalFiltersPanel(ctx, "edit");
    });
    bot.callbackQuery(/^week:profile:(\d+):(?:(\d+):)?(\d+)$/, async (ctx) => {
        const currentUserId = getCurrentUserId(ctx);
        const profileId = Number.parseInt(ctx.match?.[1] ?? "0", 10);
        const windowDays = normalizeWeeklyWindowDays(ctx.match?.[2] ? Number.parseInt(ctx.match[2], 10) : DEFAULT_WEEKLY_WINDOW_DAYS);
        const requestedOffset = Number.parseInt(ctx.match?.[3] ?? "0", 10);
        const profile = currentUserId ? database.getUserSearchProfileById(currentUserId, profileId) : null;
        if (!currentUserId || !profile) {
            await ctx.answerCallbackQuery({ text: "⚠️ Поиск не найден." });
            return;
        }
        const weeklyPageSize = getEffectiveWeeklyPageSize(
            database.getUserSettings(currentUserId),
            runtimeSettings.getSnapshot().weeklyPageSize
        );
        let offset = normalizeWeeklyOffset(requestedOffset, weeklyPageSize);
        if (!profile.isActive || !searchProfileHealth.getSearchProfileHealth(profile).isSearchActive) {
            await ctx.answerCallbackQuery({ text: "🎯 Сначала активируй и заполни этот поиск." });
            await showSearchProfileDetailPanel(ctx, profileId, "edit");
            return;
        }
        const summary = await refreshWeeklyFeed(currentUserId, offset, windowDays);
        const page = database.listUserWeeklyVacancies(
            currentUserId,
            offset,
            weeklyPageSize,
            windowDays,
            profileId
        );
        if (page.total > 0 && page.offset >= page.total) {
            offset = normalizeWeeklyOffset(page.offset, weeklyPageSize, page.total);
        }
        const normalizedPage = page.total > 0 && page.offset !== offset
            ? database.listUserWeeklyVacancies(currentUserId, offset, weeklyPageSize, windowDays, profileId)
            : page;
        await ctx.answerCallbackQuery();
        if (offset === 0) {
            await analytics.capture({
                eventName: "weekly_feed_opened",
                userId: currentUserId,
                properties: {
                    ...buildUserAnalyticsProperties(currentUserId),
                    entrypoint: "profile_callback",
                    profile_id: profileId,
                    window_days: windowDays,
                    offset,
                    results_total: normalizedPage.total,
                    ...buildWeeklyZeroStateAnalytics(normalizedPage, summary, profileId)
                }
            });
        }
        await ctx.editMessageText(formatters.formatWeeklyVacancies(normalizedPage, config, profile.name, {
            activeProfiles: database.listUserSearchProfiles(currentUserId, true),
            profileId,
            rematchSummary: summary,
            days: windowDays
        }), {
            reply_markup: normalizedPage.total > 0
                ? keyboards.createWeeklyKeyboard(normalizedPage, shouldShowNotifications(ctx.from?.id), profileId, windowDays)
                : keyboards.createWeeklyZeroStateKeyboard(normalizedPage, profileId, database.listUserSearchProfiles(currentUserId).length, windowDays)
        });
    });
    bot.callbackQuery(/^week:(?:(\d+):)?(\d+)$/, async (ctx) => {
        const currentUserId = getCurrentUserId(ctx);
        if (!currentUserId) {
            return;
        }
        if (!(await ensureWeeklyAccess(ctx, currentUserId, "edit"))) {
            return;
        }
        const windowDays = normalizeWeeklyWindowDays(ctx.match?.[1] ? Number.parseInt(ctx.match[1], 10) : DEFAULT_WEEKLY_WINDOW_DAYS);
        const requestedOffset = Number.parseInt(ctx.match?.[2] ?? "0", 10);
        const weeklyPageSize = getEffectiveWeeklyPageSize(
            database.getUserSettings(currentUserId),
            runtimeSettings.getSnapshot().weeklyPageSize
        );
        let offset = normalizeWeeklyOffset(requestedOffset, weeklyPageSize);
        const summary = await refreshWeeklyFeed(currentUserId, offset, windowDays);
        const page = database.listUserWeeklyVacancies(currentUserId, offset, weeklyPageSize, windowDays);
        if (page.total > 0 && page.offset >= page.total) {
            offset = normalizeWeeklyOffset(page.offset, weeklyPageSize, page.total);
        }
        const normalizedPage = page.total > 0 && page.offset !== offset
            ? database.listUserWeeklyVacancies(currentUserId, offset, weeklyPageSize, windowDays)
            : page;
        const text = formatters.formatWeeklyVacancies(normalizedPage, config, undefined, {
            activeProfiles: database.listUserSearchProfiles(currentUserId, true),
            rematchSummary: summary,
            days: windowDays
        });
        if (offset === 0) {
            await analytics.capture({
                eventName: "weekly_feed_opened",
                userId: currentUserId,
                properties: {
                    ...buildUserAnalyticsProperties(currentUserId),
                    entrypoint: "callback",
                    window_days: windowDays,
                    offset,
                    results_total: normalizedPage.total,
                    ...buildWeeklyZeroStateAnalytics(normalizedPage, summary)
                }
            });
        }
        await ctx.answerCallbackQuery();
        await ctx.editMessageText(text, {
            reply_markup: normalizedPage.total > 0
                ? keyboards.createWeeklyKeyboard(normalizedPage, shouldShowNotifications(ctx.from?.id), undefined, windowDays)
                : keyboards.createWeeklyZeroStateKeyboard(normalizedPage, undefined, database.listUserSearchProfiles(currentUserId).length, windowDays)
        });
    });
    bot.callbackQuery("admin:refresh", async (ctx) => {
        if (!(await ensureAdminAccess(ctx))) {
            return;
        }
        await ctx.answerCallbackQuery();
        await showAdminPanel(ctx, "edit");
    });
    bot.callbackQuery("notifications:toggle_empty_cycle_notice", async (ctx) => {
        const currentUserId = getCurrentUserId(ctx);
        if (!currentUserId) {
            await ctx.answerCallbackQuery({ text: "⚠️ Не удалось определить пользователя." });
            return;
        }
        const currentSettings = database.getUserSettings(currentUserId);
        database.setNotifyOnEmptyCycle(currentUserId, !currentSettings.notifyOnEmptyCycle);
        await ctx.answerCallbackQuery({
            text: !currentSettings.notifyOnEmptyCycle
                ? "🔔 Буду сообщать, если новых вакансий нет."
                : "🔕 Не буду сообщать о пустой проверке."
        });
        await showUserSettingsPanel(ctx, "edit");
    });
    bot.callbackQuery("notifications:toggle_daily_digest", async (ctx) => {
        const currentUserId = getCurrentUserId(ctx);
        if (!currentUserId) {
            await ctx.answerCallbackQuery({ text: "⚠️ Не удалось определить пользователя." });
            return;
        }
        const currentSettings = database.getUserSettings(currentUserId);
        database.setDailyDigestEnabled(currentUserId, !currentSettings.dailyDigestEnabled);
        await ctx.answerCallbackQuery({
            text: !currentSettings.dailyDigestEnabled
                ? "🌅 Утренний дайджест включён."
                : "🌅 Утренний дайджест выключен."
        });
        await showUserSettingsPanel(ctx, "edit");
        if (!currentSettings.dailyDigestEnabled) {
            await sendImmediateDailyDigestAfterEnable(ctx, currentUserId);
        }
    });
    bot.callbackQuery("settings:weekly_page_size", async (ctx) => {
        const currentUserId = getCurrentUserId(ctx);
        if (!currentUserId) {
            await ctx.answerCallbackQuery({ text: "⚠️ Не удалось определить пользователя." });
            return;
        }
        const currentSettings = database.getUserSettings(currentUserId);
        const currentWeeklyPageSize = getEffectiveWeeklyPageSize(currentSettings, runtimeSettings.getSnapshot().weeklyPageSize);
        const nextPageSize = nextWeeklyPageSize(currentWeeklyPageSize);
        database.setUserWeeklyPageSize(currentUserId, nextPageSize);
        await ctx.answerCallbackQuery({ text: `🗂️ Теперь показываю ${nextPageSize} на странице.` });
        await showUserSettingsPanel(ctx, "edit");
    });
    bot.callbackQuery("admin:settings", async (ctx) => {
        if (!(await ensureAdminAccess(ctx))) {
            return;
        }
        await ctx.answerCallbackQuery();
        await showSettingsPage(ctx, "edit");
    });
    bot.callbackQuery("admin:users", async (ctx) => {
        if (!(await ensureOwnerAccess(ctx))) {
            return;
        }
        await ctx.answerCallbackQuery();
        await showUsersPage(ctx, "edit");
    });
    bot.callbackQuery("admin:backup", async (ctx) => {
        if (!(await ensureOwnerAccess(ctx))) {
            return;
        }
        await sendBackupSnapshot(ctx);
    });
    bot.callbackQuery("admin:cancel_input", async (ctx) => {
        const currentUserId = getCurrentUserId(ctx);
        if (!currentUserId) {
            await ctx.answerCallbackQuery({ text: "⚠️ Не удалось определить пользователя." });
            return;
        }
        const pendingSettings = database.getUserSettings(currentUserId);
        const pendingAction = pendingSettings.pendingInputAction;
        const pendingProfileId = Number.parseInt(pendingSettings.pendingInputPayload ?? "", 10);
        database.clearPendingInputAction(currentUserId);
        await ctx.answerCallbackQuery({ text: "❌ Ввод отменён." });
        if (pendingAction === "add_include_keyword" ||
            pendingAction === "add_exclude_keyword" ||
            pendingAction === "set_profile_required_context" ||
            pendingAction === "set_profile_required_primary" ||
            pendingAction === "set_profile_preferred" ||
            pendingAction === "set_profile_exclude" ||
            pendingAction === "rename_search_profile") {
            if (Number.isInteger(pendingProfileId) && database.getUserSearchProfileById(currentUserId, pendingProfileId)) {
                await showSearchProfileDetailPanel(ctx, pendingProfileId, "edit");
                return;
            }
            await showPersonalFiltersPanel(ctx, "edit");
            return;
        }
        if (pendingAction === "set_hh_text" ||
            pendingAction === "set_hh_area" ||
            pendingAction === "set_hh_salary" ||
            pendingAction === "set_hh_period") {
            await showHhSearchSettingsPanel(ctx, "edit");
            return;
        }
        if (
            (pendingAction === "run_channel_discovery_custom" || pendingAction === "run_channel_discovery_seeds") &&
            (await ensureOwnerAccess(ctx))
        ) {
            await showChannelDiscoveryModeMenu(ctx, "edit");
            return;
        }
        if (pendingAction === "add_company_career_source" && (await ensureOwnerAccess(ctx))) {
            await showCompanyCareerSourcesPage(ctx, 0, "edit");
            return;
        }
        if (await ensureAdminAccess(ctx)) {
            await showAdminPanel(ctx, "edit");
        }
    });
    bot.callbackQuery(/^settings:view:([A-Z_]+)$/, async (ctx) => {
        if (!(await ensureAdminAccess(ctx))) {
            return;
        }
        const key = parseRuntimeSettingKey(ctx.match?.[1]);
        if (!key) {
            await ctx.answerCallbackQuery({ text: "❓ Неизвестная настройка." });
            return;
        }
        await ctx.answerCallbackQuery();
        await showRuntimeSettingDetails(ctx, key, "edit");
    });
    bot.callbackQuery(/^settings:set:([A-Z_]+)$/, async (ctx) => {
        if (!(await ensureAdminAccess(ctx))) {
            return;
        }
        const key = parseRuntimeSettingKey(ctx.match?.[1]);
        if (!key) {
            await ctx.answerCallbackQuery({ text: "❓ Неизвестная настройка." });
            return;
        }
        await beginRuntimeSettingInput(ctx, key);
    });
    bot.callbackQuery(/^settings:reset:([A-Z_]+)$/, async (ctx) => {
        if (!(await ensureAdminAccess(ctx))) {
            return;
        }
        const key = parseRuntimeSettingKey(ctx.match?.[1]);
        if (!key) {
            await ctx.answerCallbackQuery({ text: "❓ Неизвестная настройка." });
            return;
        }
        runtimeSettings.resetValue(key);
        const currentUserId = getCurrentUserId(ctx);
        if (currentUserId) {
            database.clearPendingInputAction(currentUserId);
        }
        await ctx.answerCallbackQuery({ text: "↩️ Настройка сброшена к значению по умолчанию." });
        await showRuntimeSettingDetails(ctx, key, "edit");
    });
    bot.callbackQuery(/^admin:channels:(\d+)$/, async (ctx) => {
        if (!(await ensureAdminAccess(ctx))) {
            return;
        }
        const offset = Number.parseInt(ctx.match?.[1] ?? "0", 10);
        await ctx.answerCallbackQuery();
        await showChannelsPage(ctx, offset, "edit");
    });
    bot.callbackQuery(/^admin:company_sources:(\d+)$/, async (ctx) => {
        if (!(await ensureOwnerAccess(ctx))) {
            return;
        }
        const offset = Number.parseInt(ctx.match?.[1] ?? "0", 10);
        await ctx.answerCallbackQuery();
        await showCompanyCareerSourcesPage(ctx, offset, "edit");
    });
    bot.callbackQuery(/^admin:trusted_services:(\d+)$/, async (ctx) => {
        if (!(await ensureAdminAccess(ctx))) return;
        await ctx.answerCallbackQuery();
        await showTrustedVacancyServicesPage(ctx, Number.parseInt(ctx.match?.[1] ?? "0", 10), "edit");
    });
    bot.callbackQuery("admin:pause", async (ctx) => {
        if (!(await ensureAdminAccess(ctx))) {
            return;
        }
        if (!config.ownerUserId) {
            await ctx.answerCallbackQuery({ text: "⚠️ OWNER_USER_ID пока не настроен." });
            return;
        }
        database.setBotPaused(config.ownerUserId, true);
        await ctx.answerCallbackQuery({ text: "⏸️ Бот поставлен на паузу." });
        await showAdminPanel(ctx, "edit");
    });
    bot.callbackQuery("admin:resume", async (ctx) => {
        if (!(await ensureAdminAccess(ctx))) {
            return;
        }
        if (!config.ownerUserId) {
            await ctx.answerCallbackQuery({ text: "⚠️ OWNER_USER_ID пока не настроен." });
            return;
        }
        database.setBotPaused(config.ownerUserId, false);
        await ctx.answerCallbackQuery({ text: "▶️ Бот снова работает." });
        await showAdminPanel(ctx, "edit");
    });
    bot.callbackQuery("admin:show_keywords", async (ctx) => {
        if (!(await ensureAdminAccess(ctx))) {
            return;
        }
        await ctx.answerCallbackQuery();
        await showPersonalFiltersPanel(ctx, "reply");
    });
    bot.callbackQuery("admin:add_include", async (ctx) => {
        if (!(await ensureAdminAccess(ctx))) {
            return;
        }
        await beginSearchProfileInput(ctx, "preferred");
    });
    bot.callbackQuery("admin:add_exclude", async (ctx) => {
        if (!(await ensureAdminAccess(ctx))) {
            return;
        }
        await beginSearchProfileInput(ctx, "exclude");
    });
    bot.callbackQuery("admin:clear_keywords", async (ctx) => {
        if (!(await ensureAdminAccess(ctx))) {
            return;
        }
        const currentUserId = getCurrentUserId(ctx);
        if (!currentUserId) {
            await ctx.answerCallbackQuery({ text: "⚠️ Не удалось определить пользователя." });
            return;
        }
        database.resetUserSearchProfile(currentUserId);
        database.clearPendingInputAction(currentUserId);
        await ctx.answerCallbackQuery({ text: "↩️ Профиль поиска очищен." });
        await showPersonalFiltersPanel(ctx, "edit");
    });
    bot.callbackQuery("channels:add", async (ctx) => {
        if (!(await ensureAdminAccess(ctx))) {
            return;
        }
        await beginChannelInput(ctx);
    });
    bot.callbackQuery("channels:export", async (ctx) => {
        if (!(await ensureAdminAccess(ctx))) {
            return;
        }
        const channels = database.listChannels(sourceName);
        const rawList = adminUi.formatRawChannelList(channels);
        await ctx.answerCallbackQuery({ text: `📋 Каналов в списке: ${channels.length}` });
        if (!rawList) {
            await ctx.reply("Каналы пока не добавлены.");
            return;
        }
        if (rawList.length <= TELEGRAM_SAFE_CHANNEL_LIST_LENGTH) {
            await ctx.reply(rawList);
            return;
        }
        await ctx.replyWithDocument(new grammy.InputFile(Buffer.from(rawList, "utf8"), "channels.txt"), {
            caption: `📋 Все каналы: ${channels.length}`
        });
    });
    bot.callbackQuery("channels:discover", async (ctx) => {
        if (!(await ensureOwnerAccess(ctx))) {
            return;
        }
        await ctx.answerCallbackQuery();
        await showChannelDiscoveryModeMenu(ctx, "edit");
    });
    bot.callbackQuery("discovery:auto", async (ctx) => {
        if (!(await ensureOwnerAccess(ctx))) return;
        await ctx.answerCallbackQuery();
        await showChannelDiscoveryProfileMenu(ctx, "edit", "auto");
    });
    bot.callbackQuery("discovery:seeds", async (ctx) => {
        if (!(await ensureOwnerAccess(ctx))) return;
        await ctx.answerCallbackQuery();
        await showChannelDiscoveryProfileMenu(ctx, "edit", "seeds");
    });
    bot.callbackQuery(/^discovery:seed_profile:([a-z0-9_]+)$/, async (ctx) => {
        if (!(await ensureOwnerAccess(ctx))) return;
        const profileId = parseChannelDiscoveryProfileId(ctx.match?.[1]);
        if (!profileId || profileId === "custom") {
            await ctx.answerCallbackQuery({ text: "Discovery profile not found." });
            return;
        }
        await beginChannelDiscoverySeedInput(ctx, profileId);
    });
    bot.callbackQuery(/^discovery:candidates:(\d+)$/, async (ctx) => {
        if (!(await ensureOwnerAccess(ctx))) return;
        await ctx.answerCallbackQuery();
        await showPendingChannelDiscoveryCandidates(ctx, Number.parseInt(ctx.match?.[1] ?? "0", 10), "edit");
    });
    bot.callbackQuery("company_sources:add", async (ctx) => {
        if (!(await ensureOwnerAccess(ctx))) {
            return;
        }
        await beginCompanyCareerSourceInput(ctx);
    });
    bot.callbackQuery("trusted_services:add", async (ctx) => {
        if (!(await ensureAdminAccess(ctx))) return;
        await beginTrustedVacancyServiceInput(ctx);
    });
    bot.callbackQuery(/^trusted_services:view:(\d+):(\d+)$/, async (ctx) => {
        if (!(await ensureAdminAccess(ctx))) return;
        await ctx.answerCallbackQuery();
        await showTrustedVacancyServiceDetails(
            ctx,
            Number.parseInt(ctx.match?.[1] ?? "0", 10),
            Number.parseInt(ctx.match?.[2] ?? "0", 10),
            "edit"
        );
    });
    bot.callbackQuery(/^trusted_services:(activate|disable):(\d+):(\d+)$/, async (ctx) => {
        if (!(await ensureAdminAccess(ctx))) return;
        const action = ctx.match?.[1];
        const serviceId = Number.parseInt(ctx.match?.[2] ?? "0", 10);
        const offset = Number.parseInt(ctx.match?.[3] ?? "0", 10);
        const service = database.getTrustedVacancyServiceById(serviceId);
        if (!service) {
            await ctx.answerCallbackQuery({ text: "Trusted service not found." });
            return;
        }
        if (action === "activate" && service.status === "pending" && !service.lastSuccessAt) {
            await ctx.answerCallbackQuery({ text: "Сначала успешно проверь сервис." });
            return;
        }
        const updated = database.setTrustedVacancyServiceStatus(
            serviceId,
            action === "activate" ? "active" : "disabled",
            getCurrentUserId(ctx)
        );
        await ctx.answerCallbackQuery({ text: updated ? `Trusted service ${action === "activate" ? "enabled" : "disabled"}.` : "Trusted service not found." });
        await showTrustedVacancyServiceDetails(ctx, serviceId, offset, "edit");
    });
    bot.callbackQuery(/^trusted_services:check:(\d+):(\d+)$/, async (ctx) => {
        if (!(await ensureAdminAccess(ctx))) return;
        const serviceId = Number.parseInt(ctx.match?.[1] ?? "0", 10);
        const offset = Number.parseInt(ctx.match?.[2] ?? "0", 10);
        const service = database.getTrustedVacancyServiceById(serviceId);
        if (!service) {
            await ctx.answerCallbackQuery({ text: "Trusted service not found." });
            return;
        }
        await ctx.answerCallbackQuery({ text: "Проверяю сервис..." });
        try {
            const result = await externalVacancyEnricher.probeService(service);
            await ctx.reply([
                "✅ Проверка прошла.",
                `Parser: ${result.parser}`,
                `Заголовок: ${result.title ?? "не найден"}`,
                `Компания: ${result.company ?? "не найдена"}`,
                `Локация: ${result.location ?? "не найдена"}`,
                `Занятость: ${result.employment ?? "не найдена"}`
            ].join("\n"));
        } catch (error) {
            await ctx.reply(`⚠️ Проверка не прошла: ${error instanceof Error ? error.message : String(error)}`);
        }
        await showTrustedVacancyServiceDetails(ctx, serviceId, offset, "reply");
    });
    bot.callbackQuery(/^company_sources:view:(\d+):(\d+)$/, async (ctx) => {
        if (!(await ensureOwnerAccess(ctx))) {
            return;
        }
        const sourceId = Number.parseInt(ctx.match?.[1] ?? "0", 10);
        const offset = Number.parseInt(ctx.match?.[2] ?? "0", 10);
        await ctx.answerCallbackQuery();
        await showCompanyCareerSourceDetails(ctx, sourceId, offset, "edit");
    });
    bot.callbackQuery(/^company_sources:(enable|disable):(\d+):(\d+)$/, async (ctx) => {
        if (!(await ensureOwnerAccess(ctx))) {
            return;
        }
        const action = ctx.match?.[1];
        const sourceId = Number.parseInt(ctx.match?.[2] ?? "0", 10);
        const offset = Number.parseInt(ctx.match?.[3] ?? "0", 10);
        if (!action || !sourceId) {
            await ctx.answerCallbackQuery({ text: "Company source not found." });
            return;
        }
        const updated = database.setCompanyCareerSourceActive(sourceId, action === "enable");
        await ctx.answerCallbackQuery({
            text: updated ? `Company source ${action === "enable" ? "enabled" : "disabled"}.` : "Company source not found."
        });
        await showCompanyCareerSourceDetails(ctx, sourceId, offset, "edit");
    });
    bot.callbackQuery(/^company_sources:check:(\d+):(\d+)$/, async (ctx) => {
        if (!(await ensureOwnerAccess(ctx))) {
            return;
        }
        const sourceId = Number.parseInt(ctx.match?.[1] ?? "0", 10);
        const offset = Number.parseInt(ctx.match?.[2] ?? "0", 10);
        if (!sourceId) {
            await ctx.answerCallbackQuery({ text: "Company source not found." });
            return;
        }
        const attempt = heavyActionCooldown.tryAcquire(
            `company-source-check:${sourceId}`,
            COMPANY_SOURCE_CHECK_COOLDOWN_MS
        );
        if (!attempt.allowed) {
            await ctx.answerCallbackQuery({
                text: `⏳ Это действие недавно запускалось. Попробуй снова через ${attempt.retryAfterSeconds} сек.`
            });
            return;
        }
        await ctx.answerCallbackQuery({ text: "Checking company source..." });
        const checker = new companyCareersSource.CompanyCareersSource(config, database);
        const result = await checker.checkSourceById(sourceId);
        if (result.ok) {
            await ctx.reply(`✅ Company source check passed. Parsed vacancies: ${result.items.length}.`);
        }
        else {
            await ctx.reply(`⚠️ Company source check failed: ${result.error}`);
        }
        await showCompanyCareerSourceDetails(ctx, sourceId, offset, "edit");
    });
    bot.callbackQuery(/^discovery:run:([a-z0-9_]+)$/, async (ctx) => {
        if (!(await ensureOwnerAccess(ctx))) {
            return;
        }
        const profileId = parseChannelDiscoveryProfileId(ctx.match?.[1]);
        if (!profileId || profileId === "custom") {
            await ctx.answerCallbackQuery({ text: "Discovery profile not found." });
            return;
        }
        const profile = channelDiscoveryProfiles.getChannelDiscoveryProfile(profileId);
        if (!profile) {
            await ctx.answerCallbackQuery({ text: "Discovery profile not found." });
            return;
        }
        const currentUserId = getCurrentUserId(ctx) ?? undefined;
        const result = startChannelDiscovery(currentUserId ?? undefined, { profileId });
        await ctx.answerCallbackQuery({
            text: result.started ? `🔎 Запускаю поиск: ${profile.label}` : result.notice
        });
        if (result.run) {
            await showChannelDiscoveryRun(ctx, result.run.id, 0, "edit");
        }
    });
    bot.callbackQuery("discovery:custom", async (ctx) => {
        if (!(await ensureOwnerAccess(ctx))) {
            return;
        }
        await beginChannelDiscoveryCustomInput(ctx);
    });
    bot.callbackQuery(/^discovery:page:(\d+):(\d+)$/, async (ctx) => {
        if (!(await ensureOwnerAccess(ctx))) {
            return;
        }
        const runId = Number.parseInt(ctx.match?.[1] ?? "0", 10);
        const offset = Number.parseInt(ctx.match?.[2] ?? "0", 10);
        if (!runId) {
            await ctx.answerCallbackQuery({ text: "Discovery run not found." });
            return;
        }
        await ctx.answerCallbackQuery();
        await showChannelDiscoveryRun(ctx, runId, offset, "edit");
    });
    bot.callbackQuery(/^discovery:add:(\d+)$/, async (ctx) => {
        if (!(await ensureOwnerAccess(ctx))) {
            return;
        }
        const currentUserId = getCurrentUserId(ctx) ?? undefined;
        const candidateId = Number.parseInt(ctx.match?.[1] ?? "0", 10);
        const candidate = database.getChannelDiscoveryCandidate(candidateId);
        if (!candidate) {
            await ctx.answerCallbackQuery({ text: "Candidate not found." });
            return;
        }
        const result = database.addChannel(currentUserId, "telegram_web_preview", candidate.username);
        database.setChannelDiscoveryUsernameStatus(candidate.username, "approved");
        if (currentUserId) {
            await analytics.capture({
                eventName: "channel_added",
                userId: currentUserId,
                properties: {
                    ...buildUserAnalyticsProperties(currentUserId),
                    channel: candidate.username,
                    source_name: "telegram_web_preview",
                    discovery_candidate_id: candidate.id,
                    discovery_run_id: candidate.runId,
                    created: result.added && !result.reactivated,
                    reactivated: result.reactivated
                }
            });
        }
        await ctx.answerCallbackQuery({
            text: result.reactivated
                ? `@${candidate.username} returned to scanning.`
                : result.added
                    ? `@${candidate.username} added.`
                    : `@${candidate.username} is already active.`
        });
        await showChannelDiscoveryRun(ctx, candidate.runId, 0, "edit");
    });
    bot.callbackQuery(/^discovery:(skip|block):(\d+)$/, async (ctx) => {
        if (!(await ensureOwnerAccess(ctx))) {
            return;
        }
        const action = ctx.match?.[1];
        const candidateId = Number.parseInt(ctx.match?.[2] ?? "0", 10);
        const candidate = database.getChannelDiscoveryCandidate(candidateId);
        if (!candidate) {
            await ctx.answerCallbackQuery({ text: "Candidate not found." });
            return;
        }
        if (action === "block") {
            database.blockChannelDiscoveryUsername(candidate.username);
        }
        else {
            database.skipChannelDiscoveryUsername(candidate.username);
        }
        await ctx.answerCallbackQuery({ text: `@${candidate.username} ${action === "block" ? "blocked" : "skipped"}.` });
        await showChannelDiscoveryRun(ctx, candidate.runId, 0, "edit");
    });
    bot.callbackQuery(/^discovery:evidence:(\d+)$/, async (ctx) => {
        if (!(await ensureOwnerAccess(ctx))) return;
        const candidate = database.getChannelDiscoveryCandidate(Number.parseInt(ctx.match?.[1] ?? "0", 10));
        if (!candidate) {
            await ctx.answerCallbackQuery({ text: "Candidate not found." });
            return;
        }
        await ctx.answerCallbackQuery();
        await ctx.editMessageText(adminUi.formatChannelDiscoveryEvidence(candidate), {
            reply_markup: adminUi.createChannelDiscoveryEvidenceKeyboard(candidate)
        });
    });
    bot.callbackQuery("users:add", async (ctx) => {
        if (!(await ensureOwnerAccess(ctx))) {
            return;
        }
        await beginUserInput(ctx);
    });
    bot.callbackQuery(/^users:view:(\d+)$/, async (ctx) => {
        if (!(await ensureOwnerAccess(ctx))) {
            return;
        }
        const targetUserId = ctx.match?.[1];
        if (!targetUserId) {
            await ctx.answerCallbackQuery({ text: "👤 Пользователь не найден." });
            return;
        }
        await ctx.answerCallbackQuery();
        await showUserDetails(ctx, targetUserId, "edit");
    });
    bot.callbackQuery(/^users:role:(\d+):(member|admin)$/, async (ctx) => {
        if (!(await ensureOwnerAccess(ctx))) {
            return;
        }
        const targetUserId = ctx.match?.[1];
        const nextRole = parseManageableRole(ctx.match?.[2]);
        const currentUserId = getCurrentUserId(ctx);
        if (!targetUserId || !nextRole) {
            await ctx.answerCallbackQuery({ text: "⚠️ Не удалось определить пользователя." });
            return;
        }
        const manageable = getManageableUser(targetUserId, currentUserId);
        if (!manageable.ok) {
            await ctx.answerCallbackQuery({ text: manageable.message });
            return;
        }
        if (manageable.user.role === nextRole) {
            await ctx.answerCallbackQuery({ text: "ℹ️ У пользователя уже такая роль." });
            return;
        }
        database.setBotUserRole(targetUserId, nextRole);
        await refreshCommandScopes();
        if (currentUserId) {
            await analytics.capture({
                eventName: "user_role_changed",
                userId: currentUserId,
                properties: {
                    ...buildUserAnalyticsProperties(currentUserId),
                    target_user_id: targetUserId,
                    previous_role: manageable.user.role,
                    next_role: nextRole
                }
            });
        }
        await ctx.answerCallbackQuery({
            text: nextRole === "admin" ? "🛠️ Роль изменена на admin." : "👤 Роль изменена на member."
        });
        await showUserDetails(ctx, targetUserId, "edit");
    });
    bot.callbackQuery(/^users:status:(\d+):(enable|disable)$/, async (ctx) => {
        if (!(await ensureOwnerAccess(ctx))) {
            return;
        }
        const targetUserId = ctx.match?.[1];
        const action = ctx.match?.[2];
        const currentUserId = getCurrentUserId(ctx);
        if (!targetUserId || !action) {
            await ctx.answerCallbackQuery({ text: "⚠️ Не удалось определить пользователя." });
            return;
        }
        const manageable = getManageableUser(targetUserId, currentUserId);
        if (!manageable.ok) {
            await ctx.answerCallbackQuery({ text: manageable.message });
            return;
        }
        const nextIsActive = action === "enable";
        if (manageable.user.isActive === nextIsActive) {
            await ctx.answerCallbackQuery({
                text: nextIsActive ? "ℹ️ Доступ уже включён." : "ℹ️ Доступ уже отключён."
            });
            return;
        }
        database.setBotUserActive(targetUserId, nextIsActive);
        await refreshCommandScopes();
        if (currentUserId) {
            await analytics.capture({
                eventName: "user_access_changed",
                userId: currentUserId,
                properties: {
                    ...buildUserAnalyticsProperties(currentUserId),
                    target_user_id: targetUserId,
                    previous_is_active: manageable.user.isActive,
                    next_is_active: nextIsActive
                }
            });
        }
        await ctx.answerCallbackQuery({
            text: nextIsActive ? "▶️ Доступ включён." : "⏸️ Доступ отключён."
        });
        await showUserDetails(ctx, targetUserId, "edit");
    });
    bot.callbackQuery(/^channels:view:(\d+):(\d+)$/, async (ctx) => {
        if (!(await ensureAdminAccess(ctx))) {
            return;
        }
        const channelId = Number.parseInt(ctx.match?.[1] ?? "0", 10);
        const offset = Number.parseInt(ctx.match?.[2] ?? "0", 10);
        await ctx.answerCallbackQuery();
        await showChannelDetails(ctx, channelId, offset, false, "edit");
    });
    bot.callbackQuery(/^channels:remove:(\d+):(\d+)$/, async (ctx) => {
        if (!(await ensureAdminAccess(ctx))) {
            return;
        }
        const channelId = Number.parseInt(ctx.match?.[1] ?? "0", 10);
        const offset = Number.parseInt(ctx.match?.[2] ?? "0", 10);
        await ctx.answerCallbackQuery({ text: "🗑️ Подтверди удаление." });
        await showChannelDetails(ctx, channelId, offset, true, "edit");
    });
    bot.callbackQuery(/^channels:confirm_remove:(\d+):(\d+)$/, async (ctx) => {
        if (!(await ensureAdminAccess(ctx))) {
            return;
        }
        const channelId = Number.parseInt(ctx.match?.[1] ?? "0", 10);
        const offset = Number.parseInt(ctx.match?.[2] ?? "0", 10);
        const channel = database.deactivateChannel(channelId);
        await ctx.answerCallbackQuery({
            text: channel ? `🛑 @${channel.username} больше не сканируется.` : "📭 Канал не найден."
        });
        await showChannelsPage(ctx, offset, "edit");
    });
    bot.on("message:text", async (ctx) => {
        await inputFlows.handlePendingTextMessage(ctx);
    });
    bot.catch((error) => {
        loggerModule.logger.error({ err: error.error }, "Bot update handler failed.");
    });
    return {
        async start() {
            await refreshCommandScopes();
            void bot.start({
                allowed_updates: ["message", "callback_query"]
            });
        },
        async stop() {
            bot.stop();
        },
        async notifyVacancy(vacancy) {
            if (!database.getBotUser(vacancy.userId)?.isActive) {
                return false;
            }
            if (vacancy.userStatus !== "inbox") {
                return false;
            }
            try {
                const vacancyWithDuplicates = enrichVacancyDuplicatePosts(vacancy);
                await bot.api.sendMessage(vacancy.userId, formatters.formatVacancyNotification(vacancyWithDuplicates, config), {
                    reply_markup: buildVacancyActionsKeyboard(vacancyWithDuplicates, shouldShowNotifications(vacancy.userId), "compact", undefined, vacancy.userId)
                });
            }
            catch (error) {
                loggerModule.logger.warn({
                    err: error,
                    userId: vacancy.userId,
                    vacancyId: vacancy.id
                }, "Failed to deliver vacancy notification to user.");
                return false;
            }
            database.markUserVacancyDelivered(vacancy.userId, vacancy.id);
            await analytics.capture({
                eventName: "vacancy_notified",
                userId: vacancy.userId,
                properties: {
                    ...buildUserAnalyticsProperties(vacancy.userId),
                    vacancy_id: vacancy.id,
                    source_name: vacancy.sourceName,
                    source_channel: vacancy.sourceChannel,
                    source_message_id: vacancy.sourceMessageId,
                    score: vacancy.score,
                    matched_keywords_count: vacancy.matchedKeywords.length
                }
            });
            return true;
        },
        async sendVacancyReminder(reminder) {
            if (!database.getBotUser(reminder.userId)?.isActive) {
                return false;
            }
            const vacancyRecord = buildVacancyMessageRecord(reminder.userId, reminder.id);
            if (!vacancyRecord) {
                return false;
            }
            try {
                const vacancyWithDuplicates = enrichVacancyDuplicatePosts(vacancyRecord);
                await bot.api.sendMessage(reminder.userId, formatters.formatVacancyReminderNotification(vacancyWithDuplicates, config), {
                    reply_markup: buildVacancyActionsKeyboard(vacancyWithDuplicates, shouldShowNotifications(reminder.userId), "compact", undefined, reminder.userId)
                });
            }
            catch (error) {
                loggerModule.logger.warn({ err: error, userId: reminder.userId, vacancyId: reminder.id }, "Failed to deliver vacancy reminder to user.");
                return false;
            }
            await analytics.capture({
                eventName: "vacancy_reminder_sent",
                userId: reminder.userId,
                properties: {
                    ...buildUserAnalyticsProperties(reminder.userId),
                    vacancy_id: reminder.id,
                    source_name: reminder.sourceName,
                attempt_count: reminder.attemptCount
            }
        });
        return true;
    },
        async sendApplicationFollowUp(followUp) {
            if (!database.getBotUser(followUp.userId)?.isActive) {
                return false;
            }
            try {
                await bot.api.sendMessage(followUp.userId, formatters.formatApplicationFollowUpNotification(followUp, config), {
                    reply_markup: keyboards.createApplicationFollowUpDeliveryKeyboard(followUp.id, followUp.url, database.hasAdminAccess(followUp.userId))
                });
            }
            catch (error) {
                loggerModule.logger.warn({ err: error, userId: followUp.userId, vacancyId: followUp.id }, "Failed to deliver application follow-up.");
                return false;
            }
            await analytics.capture({
                eventName: "vacancy_application_followup_sent",
                userId: followUp.userId,
                properties: {
                    ...buildUserAnalyticsProperties(followUp.userId),
                    vacancy_id: followUp.id,
                    source_name: followUp.sourceName,
                    attempt_count: followUp.attemptCount
                }
            });
            return true;
        },
        async sendDailyDigest(digest) {
            if (!database.getBotUser(digest.userId)?.isActive) {
                return false;
            }
            try {
                await bot.api.sendMessage(digest.userId, formatters.formatDailyDigestNotification(digest), {
                    reply_markup: keyboards.createDailyDigestKeyboard(digest)
                });
            }
            catch (error) {
                loggerModule.logger.warn({ err: error, userId: digest.userId }, "Failed to deliver daily digest.");
                return false;
            }
            await analytics.capture({
                eventName: "daily_digest_sent",
                userId: digest.userId,
                properties: {
                    ...buildUserAnalyticsProperties(digest.userId),
                    digest_date: digest.digestDate,
                    scheduled_for: digest.scheduledFor,
                    new_vacancies_count: digest.newVacanciesCount,
                    saved_without_action_count: digest.savedWithoutActionCount,
                    due_application_followups_count: digest.dueApplicationFollowUpsCount,
                    hidden_last_day_count: digest.hiddenLastDayCount,
                    attempt_count: digest.attemptCount
                }
            });
            return true;
        },
        async sendNoNewVacanciesNotification(userId, payload) {
            if (!database.getBotUser(userId)?.isActive) {
                return false;
            }
            const settings = database.getUserSettings(userId);
            if (!settings.notifyOnEmptyCycle) {
                return false;
            }
            if (payload.sourceName === "hh_api" && !database.getUserHhSearchSettings(userId).enabled) {
                return false;
            }
            const hasActiveSearch = database
                .listUserSearchProfiles(userId, true)
                .some((profile) => searchProfileHealth.getSearchProfileHealth(profile).isSearchActive);
            if (!hasActiveSearch) {
                return false;
            }
            try {
                await bot.api.sendMessage(userId, formatters.formatNoNewVacanciesNotification(payload, config), {
                    reply_markup: keyboards.createMainKeyboard(database.hasAdminAccess(userId), true, shouldShowWeeklyEntry(userId))
                });
            }
            catch (error) {
                loggerModule.logger.warn({
                    err: error,
                    userId,
                    sourceName: payload.sourceName
                }, "Failed to deliver empty-cycle notification to user.");
                return false;
            }
            await analytics.capture({
                eventName: "empty_cycle_notice_sent",
                userId,
                properties: {
                    ...buildUserAnalyticsProperties(userId),
                    source_name: payload.sourceName,
                    channels_count: payload.channelsCount,
                    fetched_items_count: payload.fetchedItemsCount
                }
            });
            return true;
        },
        async sendStartupDiagnostic(payload) {
            if (!ownerNotificationChatId) {
                return;
            }
            try {
                await bot.api.sendMessage(ownerNotificationChatId, formatters.formatStartupDiagnostic(payload));
            }
            catch (error) {
                loggerModule.logger.warn({
                    err: error,
                    ownerChatId: ownerNotificationChatId,
                    sourceMode: config.telegramSourceMode,
                    mtprotoConfigured: configModule.hasTelegramCredentials(config)
                }, "Failed to send startup diagnostic message.");
            }
        },
        async sendAdminAlert(text) {
            return sendAdminAlertMessage(text, "Failed to send admin alert message.");
        },
        async sendOwnerReport(text) {
            if (!config.ownerUserId) {
                return false;
            }
            try {
                await bot.api.sendMessage(config.ownerUserId, text);
                return true;
            }
            catch (error) {
                loggerModule.logger.warn({ err: error, ownerUserId: config.ownerUserId }, "Failed to send weekly owner report.");
                return false;
            }
        }
    };
}
