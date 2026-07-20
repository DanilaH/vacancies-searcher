import { Context, type InlineKeyboard } from "grammy";

import { AnalyticsService } from "../analytics/analyticsService";
import { AppConfig } from "../config";
import { VacancyDatabase } from "../db/database";
import { RuntimeSettingsService } from "../runtime/runtimeSettings";
import type { ActionCooldownAttempt } from "../services/actionCooldown";
import { ChannelDiscoveryRunInput } from "../services/channelDiscovery";
import { buildCustomChannelDiscoveryProfile, getChannelDiscoveryProfile } from "../services/channelDiscoveryProfiles";
import { detectCompanyCareerUrl } from "../services/companyCareerUrls";
import { detectTrustedVacancyService } from "../services/trustedVacancyServices";
import { parseChannelDiscoverySeedBatch, parseLimitedChannelBatchInput } from "../services/channelValidation";
import {
  validateHhAreaInput,
  validateHhPeriodInput,
  validateHhSalaryInput,
  validateHhTextInput
} from "../services/hhSearchValidation";
import { validateRuntimeSettingInput } from "../services/runtimeSettingValidation";
import { getSearchProfileHealth } from "../services/searchProfileHealth";
import { validateSearchProfileKeywordsInput } from "../services/searchProfileValidation";
import {
  ChannelDiscoveryProfileId,
  ChannelDiscoveryRun,
  OnboardingStep,
  PendingInputAction,
  RuntimeSettingKey,
  SearchProfileSectionKey,
  SourceName
} from "../types";
import type { VacancyNotificationView } from "./formatters";
import {
  createPendingInputKeyboard,
  formatChannelBatchSummary,
  formatChannelDiscoveryCustomPrompt,
  formatChannelDiscoverySeedPrompt,
  formatChannelPrompt,
  formatCompanyCareerSourcePrompt,
  formatTrustedVacancyServicePrompt,
  formatHhInputPrompt,
  formatRuntimeSettingPrompt,
  formatSearchProfilePromptWithHealth,
  formatUserPrompt
} from "./admin";
import { createOnboardingInputKeyboard } from "./keyboards";
import {
  canSkipOnboardingStep,
  nextOnboardingStep,
  onboardingStepToSection,
  type OnboardingCompletionOptions,
  type OnboardingCompletionResult
} from "./onboardingFlow";

type TextContext = Context & { message: { text: string } };

function isTextMessage(ctx: Context): ctx is TextContext {
  return Boolean(ctx.message && "text" in ctx.message);
}

function searchProfileSectionFromPendingAction(action: PendingInputAction): SearchProfileSectionKey | null {
  if (action === "set_profile_required_context") {
    return "required_context";
  }

  if (action === "set_profile_required_primary") {
    return "required_primary";
  }

  if (action === "set_profile_preferred" || action === "add_include_keyword") {
    return "preferred";
  }

  if (action === "set_profile_exclude" || action === "add_exclude_keyword") {
    return "exclude";
  }

  return null;
}

export interface InputFlowsDeps {
  config: AppConfig;
  database: VacancyDatabase;
  runtimeSettings: RuntimeSettingsService;
  analytics: AnalyticsService;
  startChannelDiscovery(userId: string, input: ChannelDiscoveryRunInput): {
    run: ChannelDiscoveryRun | null;
    started: boolean;
    notice: string;
  };
  tryAcquireChannelBatchAdd(): ActionCooldownAttempt;
  sourceName: SourceName;
  getCurrentUserId(ctx: Pick<Context, "from">): string | null;
  parseRuntimeSettingKey(value: string | undefined): RuntimeSettingKey | null;
  buildUserAnalyticsProperties(userId: string): Record<string, string | boolean | number | null>;
  trackProfileReadyTransition(
    userId: string,
    beforeStatus: ReturnType<typeof getSearchProfileHealth>["status"],
    trigger: "preset" | "manual_update" | "reset",
    extraProperties?: Record<string, string | boolean | number | null>
  ): Promise<void>;
  rebuildUserVacancyFeed(userId: string): Promise<unknown>;
  refreshCommandScopes(): Promise<void>;
  summarizeProbeError(error: string): string;
  probeTelegramWebPreviewChannel(config: AppConfig, username: string): Promise<{ ok: true; url: string } | { ok: false; error: string }>;
  getProfileKeywordsForSection(section: SearchProfileSectionKey, userId: string): string[];
  showOnboardingCompletionPanel(
    ctx: Context,
    mode?: "reply" | "edit",
    options?: OnboardingCompletionOptions
  ): Promise<OnboardingCompletionResult>;
  showOnboardingLanguagePanel(ctx: Context, mode?: "reply" | "edit"): Promise<void>;
  showOnboardingManualStep(ctx: Context, step: OnboardingStep, mode?: "reply" | "edit"): Promise<void>;
  showPersonalFiltersPanel(ctx: Context, mode?: "reply" | "edit"): Promise<void>;
  showSearchProfileDetailPanel(ctx: Context, profileId: number, mode?: "reply" | "edit"): Promise<void>;
  showHhSearchSettingsPanel(ctx: Context, mode?: "reply" | "edit"): Promise<void>;
  showChannelDiscoveryRun(ctx: Context, runId: number, offset?: number, mode?: "reply" | "edit"): Promise<void>;
  showCompanyCareerSourcesPage(ctx: Context, offset?: number, mode?: "reply" | "edit"): Promise<void>;
  showTrustedVacancyServicesPage(ctx: Context, offset?: number, mode?: "reply" | "edit"): Promise<void>;
  showChannelsPage(ctx: Context, offset?: number, mode?: "reply" | "edit"): Promise<void>;
  showUsersPage(ctx: Context, mode?: "reply" | "edit"): Promise<void>;
  showRuntimeSettingDetails(ctx: Context, key: RuntimeSettingKey, mode?: "reply" | "edit"): Promise<void>;
  showVacancyCardById(
    ctx: Context,
    userId: string,
    vacancyId: number,
    view?: VacancyNotificationView,
    origin?: undefined,
    mode?: "reply" | "edit"
  ): Promise<void>;
  showApplicationDetailById(
    ctx: Context,
    userId: string,
    vacancyId: number,
    offset?: number,
    mode?: "reply" | "edit"
  ): Promise<void>;
}

export interface InputFlows {
  beginChannelDiscoveryCustomInput(ctx: Context): Promise<void>;
  beginChannelDiscoverySeedInput(ctx: Context, profileId: Exclude<ChannelDiscoveryProfileId, "custom">): Promise<void>;
  beginCompanyCareerSourceInput(ctx: Context): Promise<void>;
  beginTrustedVacancyServiceInput(ctx: Context): Promise<void>;
  beginSearchProfileInput(
    ctx: Context,
    section: "required_context" | "required_primary" | "preferred" | "exclude",
    options?: {
      answerText?: string;
      backTarget?: string;
      replyMode?: "reply" | "edit";
      replyMarkup?: InlineKeyboard;
      profileId?: number;
    }
  ): Promise<void>;
  beginHhInput(
    ctx: Context,
    action: Extract<PendingInputAction, "set_hh_text" | "set_hh_area" | "set_hh_salary" | "set_hh_period">
  ): Promise<void>;
  beginChannelInput(ctx: Context): Promise<void>;
  beginRuntimeSettingInput(ctx: Context, key: RuntimeSettingKey): Promise<void>;
  beginUserInput(ctx: Context): Promise<void>;
  handlePendingTextMessage(ctx: Context): Promise<void>;
}

export function createInputFlows(deps: InputFlowsDeps): InputFlows {
  const {
    config,
    database,
    runtimeSettings,
    analytics,
    startChannelDiscovery,
    tryAcquireChannelBatchAdd,
    sourceName,
    getCurrentUserId,
    parseRuntimeSettingKey,
    buildUserAnalyticsProperties,
    trackProfileReadyTransition,
    rebuildUserVacancyFeed,
    refreshCommandScopes,
    summarizeProbeError,
    probeTelegramWebPreviewChannel,
    getProfileKeywordsForSection,
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
    showApplicationDetailById
  } = deps;

  async function beginChannelDiscoveryCustomInput(ctx: Context): Promise<void> {
    const currentUserId = getCurrentUserId(ctx);
    if (!currentUserId) {
      await ctx.answerCallbackQuery({
        text: "⚠️ Не удалось определить пользователя."
      });
      return;
    }

    database.setPendingInputAction(currentUserId, "run_channel_discovery_custom");
    await ctx.answerCallbackQuery({ text: "⌛ Жду тему поиска." });
    await ctx.reply(formatChannelDiscoveryCustomPrompt(), {
      reply_markup: createPendingInputKeyboard("channels:discover")
    });
  }

  async function beginChannelDiscoverySeedInput(
    ctx: Context,
    profileId: Exclude<ChannelDiscoveryProfileId, "custom">
  ): Promise<void> {
    const currentUserId = getCurrentUserId(ctx);
    const profile = getChannelDiscoveryProfile(profileId);
    if (!currentUserId || !profile) {
      await ctx.answerCallbackQuery({ text: "Не удалось открыть проверку списка." });
      return;
    }
    database.setPendingInputAction(currentUserId, "run_channel_discovery_seeds", profileId);
    await ctx.answerCallbackQuery({ text: "Жду список каналов." });
    await ctx.reply(formatChannelDiscoverySeedPrompt(profile.label), {
      reply_markup: createPendingInputKeyboard("channels:discover")
    });
  }

  async function beginCompanyCareerSourceInput(ctx: Context): Promise<void> {
    const currentUserId = getCurrentUserId(ctx);
    if (!currentUserId) {
      await ctx.answerCallbackQuery({
        text: "Cannot identify current user."
      });
      return;
    }

    database.setPendingInputAction(currentUserId, "add_company_career_source");
    await ctx.answerCallbackQuery({ text: "Waiting for careers URL." });
    await ctx.reply(formatCompanyCareerSourcePrompt(), {
      reply_markup: createPendingInputKeyboard("admin:company_sources:0")
    });
  }

  async function beginTrustedVacancyServiceInput(ctx: Context): Promise<void> {
    const currentUserId = getCurrentUserId(ctx);
    if (!currentUserId) return;
    database.setPendingInputAction(currentUserId, "add_trusted_vacancy_service");
    await ctx.answerCallbackQuery({ text: "Жду пример ссылки на вакансию." });
    await ctx.reply(formatTrustedVacancyServicePrompt(), {
      reply_markup: createPendingInputKeyboard("admin:trusted_services:0")
    });
  }

  async function beginSearchProfileInput(
    ctx: Context,
    section: "required_context" | "required_primary" | "preferred" | "exclude",
    options?: {
      answerText?: string;
      backTarget?: string;
      replyMode?: "reply" | "edit";
      replyMarkup?: InlineKeyboard;
      profileId?: number;
    }
  ): Promise<void> {
    const currentUserId = getCurrentUserId(ctx);
    if (!currentUserId) {
      await ctx.answerCallbackQuery({
        text: "⚠️ Не удалось определить пользователя."
      });
      return;
    }

    const actionBySection = {
      required_context: "set_profile_required_context",
      required_primary: "set_profile_required_primary",
      preferred: "set_profile_preferred",
      exclude: "set_profile_exclude"
    } as const;

    const action = actionBySection[section];
    const targetProfile = options?.profileId
      ? database.getUserSearchProfileById(currentUserId, options.profileId)
      : database.getUserSearchProfile(currentUserId);
    if (!targetProfile) {
      await ctx.answerCallbackQuery({ text: "⚠️ Поиск не найден." });
      return;
    }

    database.setPendingInputAction(currentUserId, action, options?.profileId ? String(options.profileId) : undefined);
    const text = formatSearchProfilePromptWithHealth(
      section,
      section === "required_context"
        ? targetProfile.requiredContextKeywords
        : section === "required_primary"
          ? targetProfile.requiredPrimaryKeywords
          : section === "preferred"
            ? targetProfile.preferredKeywords
            : targetProfile.excludeKeywords,
      getSearchProfileHealth(targetProfile)
    );
    const replyMarkup = options?.replyMarkup ?? createPendingInputKeyboard(options?.backTarget ?? "menu:filters");

    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({
        text: options?.answerText ?? "⌛ Жду список слов."
      });
    }

    if (options?.replyMode === "edit" && ctx.callbackQuery) {
      await ctx.editMessageText(text, {
        reply_markup: replyMarkup
      });
      return;
    }

    await ctx.reply(text, {
      reply_markup: replyMarkup
    });
  }

  async function beginHhInput(
    ctx: Context,
    action: Extract<PendingInputAction, "set_hh_text" | "set_hh_area" | "set_hh_salary" | "set_hh_period">
  ): Promise<void> {
    const currentUserId = getCurrentUserId(ctx);
    if (!currentUserId) {
      await ctx.answerCallbackQuery({
        text: "⚠️ Не удалось определить пользователя."
      });
      return;
    }

    const promptByAction = {
      set_hh_text: "text",
      set_hh_area: "area",
      set_hh_salary: "salary",
      set_hh_period: "period"
    } as const;

    database.setPendingInputAction(currentUserId, action);
    await ctx.answerCallbackQuery({ text: "⌛ Жду значение." });
    await ctx.reply(formatHhInputPrompt(promptByAction[action], database.getUserHhSearchSettings(currentUserId)), {
      reply_markup: createPendingInputKeyboard("filters:hh")
    });
  }

  async function beginChannelInput(ctx: Context): Promise<void> {
    const currentUserId = getCurrentUserId(ctx);
    if (!currentUserId) {
      await ctx.answerCallbackQuery({
        text: "⚠️ Не удалось определить пользователя."
      });
      return;
    }

    database.setPendingInputAction(currentUserId, "add_channel");
    await ctx.answerCallbackQuery({
      text: "⌛ Жду канал."
    });
    await ctx.reply(formatChannelPrompt(), {
      reply_markup: createPendingInputKeyboard("menu:admin")
    });
  }

  async function beginRuntimeSettingInput(ctx: Context, key: RuntimeSettingKey): Promise<void> {
    const currentUserId = getCurrentUserId(ctx);
    if (!currentUserId) {
      await ctx.answerCallbackQuery({
        text: "⚠️ Не удалось определить пользователя."
      });
      return;
    }

    const setting = runtimeSettings.getValue(key);
    database.setPendingInputAction(currentUserId, "set_runtime_setting", key);
    await ctx.answerCallbackQuery({
      text: "⌛ Жду новое значение."
    });
    await ctx.reply(formatRuntimeSettingPrompt(setting), {
      reply_markup: createPendingInputKeyboard("menu:admin")
    });
  }

  async function beginUserInput(ctx: Context): Promise<void> {
    const currentUserId = getCurrentUserId(ctx);
    if (!currentUserId) {
      await ctx.answerCallbackQuery({
        text: "⚠️ Не удалось определить пользователя."
      });
      return;
    }

    database.setPendingInputAction(currentUserId, "add_user");
    await ctx.answerCallbackQuery({
      text: "⌛ Жду Telegram ID пользователя."
    });
    await ctx.reply(formatUserPrompt(), {
      reply_markup: createPendingInputKeyboard("menu:admin")
    });
  }

  async function handlePendingTextMessage(ctx: Context): Promise<void> {
    const currentUserId = getCurrentUserId(ctx);
    if (!isTextMessage(ctx) || ctx.message.text.startsWith("/") || !currentUserId) {
      return;
    }

    const userSettings = database.getUserSettings(currentUserId);
    const pendingAction = userSettings.pendingInputAction;
    if (!pendingAction) {
      return;
    }

    const searchProfileSection = searchProfileSectionFromPendingAction(pendingAction);
    if (searchProfileSection) {
      const pendingProfileId = userSettings.pendingInputPayload
        ? Number.parseInt(userSettings.pendingInputPayload, 10)
        : null;
      const targetProfile = pendingProfileId
        ? database.getUserSearchProfileById(currentUserId, pendingProfileId)
        : database.getUserSearchProfile(currentUserId);
      if (!targetProfile) {
        database.clearPendingInputAction(currentUserId);
        await ctx.reply("⚠️ Поиск не найден. Возможно, он был удалён.");
        await showPersonalFiltersPanel(ctx, "reply");
        return;
      }
      const onboardingSection = userSettings.onboardingStep
        ? onboardingStepToSection(userSettings.onboardingStep)
        : null;
      const validation = validateSearchProfileKeywordsInput(searchProfileSection, ctx.message.text);

      if (!validation.ok) {
        await ctx.reply(validation.error, {
          reply_markup:
            onboardingSection && userSettings.onboardingStep
              ? createOnboardingInputKeyboard(canSkipOnboardingStep(userSettings.onboardingStep))
              : createPendingInputKeyboard(pendingProfileId ? `filters:profile:${pendingProfileId}` : "menu:filters")
        });
        return;
      }

      const previousHealth = getSearchProfileHealth(targetProfile);
      const updatedProfile = database.setUserSearchProfileKeywords(
        currentUserId,
        searchProfileSection,
        validation.keywords,
        targetProfile.id
      );
      database.clearPendingInputAction(currentUserId);

      const sectionLabelByKey = {
        required_context: "📍 Условия и формат",
        required_primary: "🧩 Основной профиль",
        preferred: "⭐ Желательные сигналы",
        exclude: "🚫 Стоп-слова"
      } as const;
      const valuesBySection = {
        required_context: updatedProfile.requiredContextKeywords,
        required_primary: updatedProfile.requiredPrimaryKeywords,
        preferred: updatedProfile.preferredKeywords,
        exclude: updatedProfile.excludeKeywords
      } as const;

      const updatedValues = valuesBySection[searchProfileSection];
      await analytics.capture({
        eventName: "profile_block_updated",
        userId: currentUserId,
        properties: {
          ...buildUserAnalyticsProperties(currentUserId),
          section: searchProfileSection,
          keywords_count: updatedValues.length,
          is_cleared: updatedValues.length === 0,
          previous_profile_health: previousHealth.status,
          profile_id: updatedProfile.id,
          profile_name: updatedProfile.name
        }
      });
      await trackProfileReadyTransition(currentUserId, previousHealth.status, "manual_update", {
        section: searchProfileSection,
        keywords_count: updatedValues.length,
        profile_id: updatedProfile.id,
        profile_name: updatedProfile.name
      });
      await rebuildUserVacancyFeed(currentUserId);
      await ctx.reply(
        updatedValues.length > 0
          ? `✅ Обновил блок «${sectionLabelByKey[searchProfileSection]}»: ${updatedValues.join(", ")}`
          : `✅ Очистил блок «${sectionLabelByKey[searchProfileSection]}».`
      );

      if (
        userSettings.onboardingStep &&
        onboardingSection === searchProfileSection
      ) {
        const nextStep = nextOnboardingStep(userSettings.onboardingStep);
        if (!nextStep) {
          await showOnboardingCompletionPanel(ctx, "reply", { trigger: "configured" });
          return;
        }

        if (nextStep === "language") {
          await showOnboardingLanguagePanel(ctx, "reply");
          return;
        }

        await showOnboardingManualStep(ctx, nextStep, "reply");
        return;
      }

      await showSearchProfileDetailPanel(ctx, updatedProfile.id, "reply");
      return;
    }

    if (pendingAction === "rename_search_profile") {
      const profileId = Number.parseInt(userSettings.pendingInputPayload ?? "", 10);
      const profile = database.getUserSearchProfileById(currentUserId, profileId);
      if (!profile) {
        database.clearPendingInputAction(currentUserId);
        await ctx.reply("⚠️ Поиск не найден.");
        await showPersonalFiltersPanel(ctx, "reply");
        return;
      }

      try {
        const renamed = database.renameUserSearchProfile(currentUserId, profileId, ctx.message.text);
        database.clearPendingInputAction(currentUserId);
        await analytics.capture({
          eventName: "profile_renamed",
          userId: currentUserId,
          properties: {
            ...buildUserAnalyticsProperties(currentUserId),
            profile_id: renamed.id,
            profile_name: renamed.name,
            previous_profile_name: profile.name
          }
        });
        await ctx.reply(`✅ Поиск переименован: ${renamed.name}`);
        await showSearchProfileDetailPanel(ctx, renamed.id, "reply");
      } catch (error) {
        await ctx.reply(error instanceof Error ? error.message : "Не удалось переименовать поиск.", {
          reply_markup: createPendingInputKeyboard(`filters:profile:${profileId}`)
        });
      }
      return;
    }

    if (pendingAction === "set_hh_text") {
      const validation = validateHhTextInput(ctx.message.text);
      if (!validation.ok) {
        await ctx.reply(validation.error, {
          reply_markup: createPendingInputKeyboard("filters:hh")
        });
        return;
      }

      database.updateUserHhSearchSettings(currentUserId, { text: validation.value });
      database.clearPendingInputAction(currentUserId);
      await rebuildUserVacancyFeed(currentUserId);
      await ctx.reply(`✅ Обновил hh-запрос: ${validation.value}`);
      await showHhSearchSettingsPanel(ctx, "reply");
      return;
    }

    if (pendingAction === "set_hh_area") {
      const validation = validateHhAreaInput(ctx.message.text);
      if (!validation.ok) {
        await ctx.reply(validation.error, {
          reply_markup: createPendingInputKeyboard("filters:hh")
        });
        return;
      }

      database.updateUserHhSearchSettings(currentUserId, { areaId: validation.value });
      database.clearPendingInputAction(currentUserId);
      await rebuildUserVacancyFeed(currentUserId);
      await ctx.reply(`✅ Обновил регион hh.ru: ${validation.value}`);
      await showHhSearchSettingsPanel(ctx, "reply");
      return;
    }

    if (pendingAction === "set_hh_salary") {
      const validation = validateHhSalaryInput(ctx.message.text);
      if (!validation.ok) {
        await ctx.reply(validation.error, {
          reply_markup: createPendingInputKeyboard("filters:hh")
        });
        return;
      }

      database.updateUserHhSearchSettings(currentUserId, { salaryFrom: validation.value });
      database.clearPendingInputAction(currentUserId);
      await rebuildUserVacancyFeed(currentUserId);
      await ctx.reply(validation.value === null ? "✅ Очистил зарплату hh.ru." : `✅ Обновил зарплату hh.ru: от ${validation.value}`);
      await showHhSearchSettingsPanel(ctx, "reply");
      return;
    }

    if (pendingAction === "set_hh_period") {
      const validation = validateHhPeriodInput(ctx.message.text);
      if (!validation.ok) {
        await ctx.reply(validation.error, {
          reply_markup: createPendingInputKeyboard("filters:hh")
        });
        return;
      }

      database.updateUserHhSearchSettings(currentUserId, { periodDays: validation.value });
      database.clearPendingInputAction(currentUserId);
      await rebuildUserVacancyFeed(currentUserId);
      await ctx.reply(`✅ Обновил период hh.ru: ${validation.value} дн.`);
      await showHhSearchSettingsPanel(ctx, "reply");
      return;
    }

    if (pendingAction === "run_channel_discovery_custom") {
      if (!database.hasOwnerAccess(currentUserId)) {
        database.clearPendingInputAction(currentUserId);
        await ctx.reply("🔒 Этот раздел недоступен.");
        return;
      }

      const profile = buildCustomChannelDiscoveryProfile(ctx.message.text);
      if (!profile) {
        await ctx.reply("⚠️ Отправь тему поиска хотя бы из двух символов.", {
          reply_markup: createPendingInputKeyboard("channels:discover")
        });
        return;
      }

      const result = startChannelDiscovery(currentUserId, {
        profileId: "custom",
        customQuery: ctx.message.text
      });
      if (!result.run) {
        await ctx.reply(result.notice, {
          reply_markup: createPendingInputKeyboard("channels:discover")
        });
        return;
      }
      database.clearPendingInputAction(currentUserId);
      if (!result.started) {
        await ctx.reply(result.notice);
      }
      await showChannelDiscoveryRun(ctx, result.run.id, 0, "reply");
      return;
    }

    if (pendingAction === "run_channel_discovery_seeds") {
      if (!database.hasOwnerAccess(currentUserId)) {
        database.clearPendingInputAction(currentUserId);
        await ctx.reply("Этот раздел недоступен.");
        return;
      }
      const profileId = userSettings.pendingInputPayload as Exclude<ChannelDiscoveryProfileId, "custom"> | null;
      const profile = profileId ? getChannelDiscoveryProfile(profileId) : null;
      if (!profileId || !profile) {
        database.clearPendingInputAction(currentUserId);
        await ctx.reply("Профиль discovery не найден.");
        return;
      }
      const batch = parseChannelDiscoverySeedBatch(ctx.message.text, 50);
      if (batch.usernames.length === 0) {
        await ctx.reply("Не нашёл ни одного допустимого публичного username или t.me-ссылки.", {
          reply_markup: createPendingInputKeyboard("channels:discover")
        });
        return;
      }
      const result = startChannelDiscovery(currentUserId, {
        profileId,
        manualSeeds: batch.usernames
      });
      if (!result.run) {
        await ctx.reply(result.notice, {
          reply_markup: createPendingInputKeyboard("channels:discover")
        });
        return;
      }
      database.clearPendingInputAction(currentUserId);
      await ctx.reply(
        result.started
          ? [
              `Проверяю ${batch.usernames.length} каналов.`,
              batch.invalid.length > 0 ? `Некорректных: ${batch.invalid.length}.` : "",
              batch.duplicates.length > 0 ? `Дублей: ${batch.duplicates.length}.` : "",
              batch.truncated > 0 ? `Сверх лимита 50: ${batch.truncated}.` : ""
            ]
              .filter(Boolean)
              .join(" ")
          : result.notice
      );
      await showChannelDiscoveryRun(ctx, result.run.id, 0, "reply");
      return;
    }

    if (pendingAction === "add_company_career_source") {
      if (!database.hasOwnerAccess(currentUserId)) {
        database.clearPendingInputAction(currentUserId);
        await ctx.reply("🔒 Этот раздел недоступен.");
        return;
      }

      let detected;
      try {
        detected = detectCompanyCareerUrl(ctx.message.text);
      } catch (error) {
        await ctx.reply(error instanceof Error ? error.message : "Company careers URL is invalid.", {
          reply_markup: createPendingInputKeyboard("admin:company_sources:0")
        });
        return;
      }

      if (!detected) {
        await ctx.reply("Company careers URL is invalid.", {
          reply_markup: createPendingInputKeyboard("admin:company_sources:0")
        });
        return;
      }

      const result = database.addCompanyCareerSource({
        companyName: detected.companyName,
        adapter: detected.adapter,
        startUrl: detected.normalizedStartUrl,
        addedByUserId: currentUserId
      });
      database.clearPendingInputAction(currentUserId);

      await ctx.reply(
        [
          result.reactivated
            ? "✅ Company source reactivated."
            : result.added
              ? "✅ Company source added."
              : "ℹ️ Company source is already active.",
          "",
          `Company: ${result.source.companyName}`,
          `Adapter: ${result.source.adapter}`,
          `URL: ${result.source.startUrl}`,
          detected.adapter === "generic_html"
            ? "Note: generic HTML works only when schema.org JobPosting is present."
            : null
        ].filter((line): line is string => line !== null).join("\n")
      );
      await showCompanyCareerSourcesPage(ctx, 0, "reply");
      return;
    }

    if (pendingAction === "add_trusted_vacancy_service") {
      if (!database.hasAdminAccess(currentUserId)) {
        database.clearPendingInputAction(currentUserId);
        await ctx.reply("🔒 Этот раздел недоступен.");
        return;
      }
      try {
        const detected = detectTrustedVacancyService(ctx.message.text);
        const service = database.addTrustedVacancyService({
          ...detected,
          addedByUserId: currentUserId
        });
        database.clearPendingInputAction(currentUserId);
        await ctx.reply([
          "✅ Сервис добавлен как pending.",
          `Hostname: ${service.hostname}`,
          `Adapter: ${service.adapter}`,
          "Проверь страницу и затем включи доверие вручную."
        ].join("\n"));
        await showTrustedVacancyServicesPage(ctx, 0, "reply");
      } catch (error) {
        await ctx.reply(error instanceof Error ? error.message : "Не удалось добавить доверенный сервис.", {
          reply_markup: createPendingInputKeyboard("admin:trusted_services:0")
        });
      }
      return;
    }

    if (pendingAction === "add_channel") {
      const batch = parseLimitedChannelBatchInput(ctx.message.text, 50);
      if (batch.totalEntries === 0) {
        await ctx.reply("⚠️ Не удалось распознать каналы. Отправь username или ссылки с запятыми, пробелами или с новой строки.", {
          reply_markup: createPendingInputKeyboard("menu:admin")
        });
        return;
      }

      const addedChannels: string[] = [];
      const reactivatedChannels: string[] = [];
      const alreadyActiveChannels: string[] = [];
      const duplicateChannelsInBatch = batch.duplicates.map((username) => `@${username}`);
      const invalidChannels = batch.invalid.map((entry) => `${entry} — невалидный username или ссылка`);
      const failedProbeChannels: string[] = [];

      if (batch.usernames.length > 0) {
        const attempt = tryAcquireChannelBatchAdd();
        if (!attempt.allowed) {
          await ctx.reply(`⏳ Это действие недавно запускалось. Попробуй снова через ${attempt.retryAfterSeconds} сек.`, {
            reply_markup: createPendingInputKeyboard("menu:admin")
          });
          return;
        }
      }

      for (const normalizedUsername of batch.usernames) {
        const existingChannel = database.getChannelByUsername(sourceName, normalizedUsername);
        if (existingChannel?.isActive) {
          alreadyActiveChannels.push(`@${normalizedUsername}`);
          continue;
        }

        const batchProbeResult = await probeTelegramWebPreviewChannel(config, normalizedUsername);
        if (!batchProbeResult.ok) {
          failedProbeChannels.push(`@${normalizedUsername} — ${summarizeProbeError(batchProbeResult.error)}`);
          continue;
        }

        const batchAddResult = database.addChannel(currentUserId, sourceName, normalizedUsername);
        if (batchAddResult.reactivated) {
          reactivatedChannels.push(`@${normalizedUsername}`);
        } else if (batchAddResult.added) {
          addedChannels.push(`@${normalizedUsername}`);
        } else {
          alreadyActiveChannels.push(`@${normalizedUsername}`);
        }

        await analytics.capture({
          eventName: "channel_added",
          userId: currentUserId,
          properties: {
            ...buildUserAnalyticsProperties(currentUserId),
            channel: normalizedUsername,
            source_name: sourceName,
            created: batchAddResult.added && !batchAddResult.reactivated,
            reactivated: batchAddResult.reactivated
          }
        });
      }

      database.clearPendingInputAction(currentUserId);

      await ctx.reply(
        formatChannelBatchSummary({
          totalEntries: batch.totalEntries,
          totalActiveChannels: database.countActiveChannels(sourceName),
          added: addedChannels,
          reactivated: reactivatedChannels,
          alreadyActive: alreadyActiveChannels,
          duplicatesInBatch: duplicateChannelsInBatch,
          invalid: invalidChannels,
          probeFailed: failedProbeChannels,
          truncated: batch.truncated
        })
      );

      await showChannelsPage(ctx, 0, "reply");
      return;
    }

    if (pendingAction === "add_user") {
      if (!database.hasOwnerAccess(currentUserId)) {
        database.clearPendingInputAction(currentUserId);
        await ctx.reply("🔒 Этот раздел недоступен.");
        return;
      }

      const candidateId = ctx.message.text.trim();
      if (!/^\d+$/.test(candidateId)) {
        await ctx.reply("⚠️ Отправь Telegram ID только цифрами, без лишнего текста.", {
          reply_markup: createPendingInputKeyboard("menu:admin")
        });
        return;
      }

      const result = database.addOrActivateBotUser(candidateId, "member", currentUserId);
      database.clearPendingInputAction(currentUserId);
      await refreshCommandScopes();

      await analytics.capture({
        eventName: "user_added",
        userId: currentUserId,
        properties: {
          ...buildUserAnalyticsProperties(currentUserId),
          target_user_id: candidateId,
          created: result.created,
          reactivated: result.reactivated,
          role: result.user.role
        }
      });
      await analytics.identify({
        distinctId: candidateId,
        userId: candidateId,
        properties: {
          role: result.user.role,
          user_active: result.user.isActive
        }
      });

      await ctx.reply(
        result.created
          ? `✅ Пользователь ${candidateId} добавлен в список доступа.`
          : result.reactivated
            ? `✅ Пользователь ${candidateId} снова активен.`
            : `♻️ Пользователь ${candidateId} уже был в списке.`
      );
      await showUsersPage(ctx, "reply");
      return;
    }

    if (pendingAction === "set_runtime_setting") {
      const key = parseRuntimeSettingKey(userSettings.pendingInputPayload ?? undefined);
      if (!key) {
        database.clearPendingInputAction(currentUserId);
        await ctx.reply("⚠️ Не удалось определить настройку. Открой раздел настроек заново.");
        return;
      }

      const validation = validateRuntimeSettingInput(key, ctx.message.text);
      if (!validation.ok) {
        await ctx.reply(validation.error, {
          reply_markup: createPendingInputKeyboard("menu:admin")
        });
        return;
      }

      const savedSetting = runtimeSettings.setNumericValue(key, validation.value, currentUserId);
      database.clearPendingInputAction(currentUserId);

      await ctx.reply(
        `✅ Сохранил: ${savedSetting.label} = ${savedSetting.value}${savedSetting.unit ? ` ${savedSetting.unit}` : ""}`
      );
      await showRuntimeSettingDetails(ctx, key, "reply");
      return;
    }

    if (pendingAction === "set_application_note") {
      let payload: {
        vacancyId?: number;
        view?: VacancyNotificationView;
        returnTo?: "application_detail";
        offset?: number;
      } = {};
      try {
        payload = JSON.parse(userSettings.pendingInputPayload ?? "{}") as typeof payload;
      } catch {
        payload = {};
      }
      const vacancyId = typeof payload.vacancyId === "number" ? payload.vacancyId : 0;
      const view = payload.view === "full" ? "full" : "compact";
      const vacancy = vacancyId ? database.getVacancy(vacancyId) : null;
      if (!vacancy) {
        database.clearPendingInputAction(currentUserId);
        await ctx.reply("⚠️ Вакансия больше недоступна.");
        return;
      }
      const canAccessVacancy =
        Boolean(database.getUserMatchedVacancy(currentUserId, vacancyId)) ||
        database.getUserVacancyStatus(currentUserId, vacancyId) !== "inbox";
      if (!canAccessVacancy) {
        database.clearPendingInputAction(currentUserId);
        await ctx.reply("⚠️ Вакансия недоступна для этого пользователя.");
        return;
      }

      const trimmed = ctx.message.text.trim();
      const note = trimmed === "-" || trimmed.toLowerCase() === "clear" || trimmed.toLowerCase() === "очистить"
        ? null
        : trimmed;

      if (note !== null && Array.from(note).length > 500) {
        const backTarget = payload.returnTo === "application_detail"
          ? `application:detail:${vacancyId}:${typeof payload.offset === "number" ? payload.offset : 0}`
          : `vacancy:view:${vacancyId}:${view}`;
        await ctx.reply("⚠️ Заметка слишком длинная. Отправь до 500 символов.", {
          reply_markup: createPendingInputKeyboard(backTarget)
        });
        return;
      }

      database.setUserVacancyStatus(currentUserId, vacancyId, "applied");
      database.setUserVacancyApplicationNote(currentUserId, vacancyId, note);
      database.clearPendingInputAction(currentUserId);
      await analytics.capture({
        eventName: "vacancy_application_note_updated",
        userId: currentUserId,
        properties: {
          ...buildUserAnalyticsProperties(currentUserId),
          vacancy_id: vacancyId,
          is_cleared: note === null
        }
      });
      await ctx.reply(note === null ? "✅ Заметка очищена." : "✅ Заметка сохранена.");
      if (payload.returnTo === "application_detail") {
        await showApplicationDetailById(
          ctx,
          currentUserId,
          vacancyId,
          typeof payload.offset === "number" ? payload.offset : 0,
          "reply"
        );
        return;
      }
      await showVacancyCardById(ctx, currentUserId, vacancyId, view, undefined, "reply");
    }
  }

  return {
    beginChannelDiscoveryCustomInput,
    beginChannelDiscoverySeedInput,
    beginCompanyCareerSourceInput,
    beginTrustedVacancyServiceInput,
    beginSearchProfileInput,
    beginHhInput,
    beginChannelInput,
    beginRuntimeSettingInput,
    beginUserInput,
    handlePendingTextMessage
  };
}
