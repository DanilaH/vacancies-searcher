import { Context } from "grammy";

import { AnalyticsService } from "../analytics/analyticsService";
import { VacancyDatabase } from "../db/database";
import { getSearchProfileHealth } from "../services/searchProfileHealth";
import {
  OnboardingStep,
  SearchProfilePresetForecast,
  SearchProfileSectionKey,
  UserVacancyRematchSummary,
  VacancyLanguageMode
} from "../types";
import { formatSearchProfilePromptWithHealth } from "./admin";
import {
  createOnboardingCompletionKeyboard,
  createOnboardingInputKeyboard,
  createOnboardingIntroKeyboard,
  createOnboardingLanguageKeyboard,
  createOnboardingPresetKeyboard,
  createOnboardingWelcomeKeyboard
} from "./keyboards";
import {
  formatOnboardingCompletionMessage,
  formatOnboardingIntroMessage,
  formatOnboardingLanguageMessage,
  formatOnboardingSetupChoiceMessage
} from "./formatters";
import { BotPanelMode, replyOrEdit } from "./render";

export function onboardingStepToSection(step: OnboardingStep): SearchProfileSectionKey | null {
  if (step === "manual_required_context") {
    return "required_context";
  }

  if (step === "manual_required_primary") {
    return "required_primary";
  }

  if (step === "manual_preferred") {
    return "preferred";
  }

  if (step === "manual_exclude") {
    return "exclude";
  }

  return null;
}

export function nextOnboardingStep(step: OnboardingStep): OnboardingStep | null {
  switch (step) {
    case "intro":
      return "welcome";
    case "welcome":
      return "preset";
    case "preset":
      return "language";
    case "manual_required_context":
      return "manual_required_primary";
    case "manual_required_primary":
      return "manual_preferred";
    case "manual_preferred":
      return "manual_exclude";
    case "manual_exclude":
      return "language";
    default:
      return null;
  }
}

export function onboardingStepLabel(step: OnboardingStep): string {
  switch (step) {
    case "manual_required_context":
      return "Шаг 1 из 4: условия и формат";
    case "manual_required_primary":
      return "Шаг 2 из 4: основной профиль";
    case "manual_preferred":
      return "Шаг 3 из 4: желательные сигналы";
    case "manual_exclude":
      return "Шаг 4 из 4: стоп-слова";
    default:
      return "Настройка профиля";
  }
}

export function canSkipOnboardingStep(step: OnboardingStep): boolean {
  return step === "manual_preferred" || step === "manual_exclude";
}

export interface OnboardingFlowDeps {
  database: VacancyDatabase;
  analytics: AnalyticsService;
  getCurrentUserId(ctx: Pick<Context, "from">): string | null;
  shouldShowAdmin(userId: string | number | undefined): boolean;
  buildUserAnalyticsProperties(userId: string): Record<string, string | boolean | number | null>;
  sendFirstWeeklyPage(ctx: Context, userId: string, resultsTotal: number): Promise<boolean>;
  getPresetForecasts(userId: string, languageMode: VacancyLanguageMode): SearchProfilePresetForecast[];
  showStartPanel(ctx: Context, mode?: BotPanelMode): Promise<void>;
}

export interface OnboardingCompletionOptions {
  trigger: "configured" | "skipped";
  rematchSummary?: UserVacancyRematchSummary;
}

export interface OnboardingCompletionResult {
  firstCompletion: boolean;
  initialMatchesCount: number;
  firstResultsShown: boolean;
}

export interface OnboardingFlow {
  showOnboardingIntroPanel(ctx: Context, mode?: BotPanelMode): Promise<void>;
  showOnboardingWelcomePanel(ctx: Context, mode?: BotPanelMode): Promise<void>;
  showOnboardingPresetPanel(ctx: Context, mode?: BotPanelMode): Promise<void>;
  showOnboardingLanguagePanel(ctx: Context, mode?: BotPanelMode): Promise<void>;
  showOnboardingCompletionPanel(
    ctx: Context,
    mode?: BotPanelMode,
    options?: OnboardingCompletionOptions
  ): Promise<OnboardingCompletionResult>;
  showOnboardingManualStep(ctx: Context, step: OnboardingStep, mode?: BotPanelMode): Promise<void>;
  showOnboardingFlow(ctx: Context, mode?: BotPanelMode): Promise<void>;
  getProfileKeywordsForSection(section: SearchProfileSectionKey, userId: string): string[];
}

export function createOnboardingFlow(deps: OnboardingFlowDeps): OnboardingFlow {
  const {
    database,
    analytics,
    getCurrentUserId,
    shouldShowAdmin,
    buildUserAnalyticsProperties,
    sendFirstWeeklyPage,
    getPresetForecasts,
    showStartPanel
  } = deps;

  function getProfileKeywordsForSection(section: SearchProfileSectionKey, userId: string): string[] {
    const profile = database.getUserSearchProfile(userId);

    switch (section) {
      case "required_context":
        return profile.requiredContextKeywords;
      case "required_primary":
        return profile.requiredPrimaryKeywords;
      case "preferred":
        return profile.preferredKeywords;
      case "exclude":
        return profile.excludeKeywords;
    }
  }

  async function showOnboardingIntroPanel(ctx: Context, mode: BotPanelMode = "reply"): Promise<void> {
    const currentUserId = getCurrentUserId(ctx);
    if (!currentUserId) {
      return;
    }

    database.setOnboardingStep(currentUserId, "intro");
    database.clearPendingInputAction(currentUserId);
    await replyOrEdit(ctx, mode, formatOnboardingIntroMessage(), {
      reply_markup: createOnboardingIntroKeyboard()
    });
  }

  async function showOnboardingWelcomePanel(ctx: Context, mode: BotPanelMode = "reply"): Promise<void> {
    const currentUserId = getCurrentUserId(ctx);
    if (!currentUserId) {
      return;
    }

    database.setOnboardingStep(currentUserId, "welcome");
    database.clearPendingInputAction(currentUserId);
    await replyOrEdit(ctx, mode, formatOnboardingSetupChoiceMessage(), {
      reply_markup: createOnboardingWelcomeKeyboard()
    });
  }

  async function showOnboardingPresetPanel(ctx: Context, mode: BotPanelMode = "reply"): Promise<void> {
    const currentUserId = getCurrentUserId(ctx);
    if (!currentUserId) {
      return;
    }

    database.setOnboardingStep(currentUserId, "preset");
    database.clearPendingInputAction(currentUserId);
    const forecasts = getPresetForecasts(currentUserId, database.getUserSettings(currentUserId).vacancyLanguageMode);
    const text = [
      "🧩 Выбери пресет",
      "",
      "Это быстрый старт: бот сам заполнит профиль поиска, а потом ты сможешь подправить его вручную.",
      "Числа на кнопках — локальная оценка по накопленным вакансиям за 7 дней, а не гарантия будущей выдачи."
    ].join("\n");

    await replyOrEdit(ctx, mode, text, {
      reply_markup: createOnboardingPresetKeyboard(forecasts)
    });
  }

  async function showOnboardingLanguagePanel(ctx: Context, mode: BotPanelMode = "reply"): Promise<void> {
    const currentUserId = getCurrentUserId(ctx);
    if (!currentUserId) {
      return;
    }

    database.setOnboardingStep(currentUserId, "language");
    database.clearPendingInputAction(currentUserId);
    const currentMode = database.getUserSettings(currentUserId).vacancyLanguageMode;
    await replyOrEdit(ctx, mode, formatOnboardingLanguageMessage(currentMode), {
      reply_markup: createOnboardingLanguageKeyboard()
    });
  }

  async function showOnboardingCompletionPanel(
    ctx: Context,
    mode: BotPanelMode = "reply",
    options: OnboardingCompletionOptions = { trigger: "configured" }
  ): Promise<OnboardingCompletionResult> {
    const currentUserId = getCurrentUserId(ctx);
    if (!currentUserId) {
      return {
        firstCompletion: false,
        initialMatchesCount: 0,
        firstResultsShown: false
      };
    }

    const previousSettings = database.getUserSettings(currentUserId);
    if (previousSettings.onboardingCompleted) {
      await showStartPanel(ctx, mode);
      return {
        firstCompletion: false,
        initialMatchesCount: 0,
        firstResultsShown: false
      };
    }

    database.setOnboardingCompleted(currentUserId, true);
    database.setOnboardingStep(currentUserId, null);
    database.clearPendingInputAction(currentUserId);

    const profile = database.getUserSearchProfile(currentUserId);
    const settings = database.getUserSettings(currentUserId);
    const health = getSearchProfileHealth(profile);
    const initialMatchesCount =
      options.trigger === "configured"
        ? options.rematchSummary?.totalMatched ?? 0
        : 0;

    await replyOrEdit(
      ctx,
      mode,
      formatOnboardingCompletionMessage(health, settings.vacancyLanguageMode, {
        trigger: options.trigger,
        initialMatchesCount
      }),
      {
        reply_markup: createOnboardingCompletionKeyboard(
          shouldShowAdmin(ctx.from?.id),
          health.isSearchActive
        )
      }
    );

    const firstResultsShown =
      options.trigger === "configured" &&
      health.isSearchActive &&
      initialMatchesCount > 0
        ? await sendFirstWeeklyPage(ctx, currentUserId, initialMatchesCount)
        : false;

    await analytics.capture({
      eventName: "onboarding_completed",
      userId: currentUserId,
      properties: {
        ...buildUserAnalyticsProperties(currentUserId),
        profile_health: health.status,
        search_active: health.isSearchActive,
        completion_trigger: options.trigger,
        initial_matches_count: initialMatchesCount,
        first_results_shown: firstResultsShown
      }
    });

    return {
      firstCompletion: true,
      initialMatchesCount,
      firstResultsShown
    };
  }

  async function showOnboardingManualStep(
    ctx: Context,
    step: OnboardingStep,
    mode: BotPanelMode = "reply"
  ): Promise<void> {
    const currentUserId = getCurrentUserId(ctx);
    const section = onboardingStepToSection(step);
    if (!currentUserId || !section) {
      return;
    }

    const actionBySection = {
      required_context: "set_profile_required_context",
      required_primary: "set_profile_required_primary",
      preferred: "set_profile_preferred",
      exclude: "set_profile_exclude"
    } as const;

    database.setOnboardingStep(currentUserId, step);
    database.setPendingInputAction(currentUserId, actionBySection[section]);

    const text = [
      `🧭 ${onboardingStepLabel(step)}`,
      "",
      formatSearchProfilePromptWithHealth(
        section,
        getProfileKeywordsForSection(section, currentUserId),
        getSearchProfileHealth(database.getUserSearchProfile(currentUserId))
      )
    ].join("\n");

    await replyOrEdit(ctx, mode, text, {
      reply_markup: createOnboardingInputKeyboard(canSkipOnboardingStep(step))
    });
  }

  async function showOnboardingFlow(ctx: Context, mode: BotPanelMode = "reply"): Promise<void> {
    const currentUserId = getCurrentUserId(ctx);
    if (!currentUserId) {
      return;
    }

    const settings = database.getUserSettings(currentUserId);
    if (settings.onboardingCompleted) {
      await showStartPanel(ctx, mode);
      return;
    }

    if (settings.onboardingStep === "intro") {
      await showOnboardingIntroPanel(ctx, mode);
      return;
    }

    if (settings.onboardingStep === "welcome") {
      await showOnboardingWelcomePanel(ctx, mode);
      return;
    }

    if (settings.onboardingStep === "preset") {
      await showOnboardingPresetPanel(ctx, mode);
      return;
    }

    if (settings.onboardingStep === "language") {
      await showOnboardingLanguagePanel(ctx, mode);
      return;
    }

    if (settings.onboardingStep) {
      const section = onboardingStepToSection(settings.onboardingStep);
      if (section) {
        await showOnboardingManualStep(ctx, settings.onboardingStep, mode);
        return;
      }
    }

    await showOnboardingIntroPanel(ctx, mode);
  }

  return {
    showOnboardingIntroPanel,
    showOnboardingWelcomePanel,
    showOnboardingPresetPanel,
    showOnboardingLanguagePanel,
    showOnboardingCompletionPanel,
    showOnboardingManualStep,
    showOnboardingFlow,
    getProfileKeywordsForSection
  };
}
