import { InlineKeyboard } from "grammy";

import {
  AdminPanelState,
  BotUser,
  ChannelDiscoveryCandidate,
  ChannelDiscoveryCandidatePage,
  ChannelDiscoveryRun,
  ChannelDiscoverySource,
  CompanyCareerSourcePage,
  CompanyCareerSourceRecord,
  HhEmployment,
  HhExperience,
  HhSchedule,
  HhSearchSettings,
  KeywordKind,
  MonitoredChannel,
  MonitoredChannelPage,
  RuntimeSettingValue,
  SearchProfileHealthReport,
  SearchProfilePresetForecast,
  SearchProfilePresetId,
  SearchProfileWeeklyStats,
  UserSearchProfile,
  UserSearchProfileRecord,
  TrustedVacancyServicePage,
  TrustedVacancyServiceRecord,
  VacancyLanguageMode
} from "../types";
import { getSearchProfilePreset, listSearchProfilePresetGroups } from "../services/searchProfilePresets";
import { listChannelDiscoveryProfiles } from "../services/channelDiscoveryProfiles";

function boolLabel(value: boolean): string {
  return value ? "да" : "нет";
}

function statusLabel(value: boolean): string {
  return value ? "включено" : "выключено";
}

function sourceModeLabel(value: AdminPanelState["sourceMode"]): string {
  return value === "web" ? "web-preview" : "mtproto";
}

function sourceNameLabel(value: MonitoredChannel["sourceName"]): string {
  return value === "telegram_web_preview" ? "web-preview" : "mtproto";
}

function filterModeLabel(value: AdminPanelState["filterMode"]): string {
  if (value === "hybrid") {
    return "гибридный";
  }

  if (value === "ai") {
    return "AI";
  }

  return "по ключевым словам";
}

function settingSourceLabel(value: RuntimeSettingValue["source"]): string {
  return value === "override" ? "из базы" : "по умолчанию";
}

export function vacancyLanguageModeLabel(mode: VacancyLanguageMode): string {
  switch (mode) {
    case "ru_only":
      return "только русский";
    case "en_only":
      return "только английский";
    default:
      return "русский + английский";
  }
}

export function vacancyLanguageModeFlags(mode: VacancyLanguageMode): string {
  switch (mode) {
    case "ru_only":
      return "🇷🇺";
    case "en_only":
      return "🇬🇧";
    default:
      return "🇷🇺/🇬🇧";
  }
}

export function hhExperienceLabel(value: HhExperience): string {
  switch (value) {
    case "noExperience":
      return "без опыта";
    case "between1And3":
      return "1-3 года";
    case "between3And6":
      return "3-6 лет";
    case "moreThan6":
      return "6+ лет";
    default:
      return "любой опыт";
  }
}

export function hhScheduleLabel(value: HhSchedule): string {
  switch (value) {
    case "remote":
      return "удалёнка";
    case "fullDay":
      return "полный день";
    case "flexible":
      return "гибкий график";
    case "shift":
      return "сменный график";
    default:
      return "любой график";
  }
}

export function hhEmploymentLabel(value: HhEmployment): string {
  switch (value) {
    case "full":
      return "полная занятость";
    case "part":
      return "частичная занятость";
    case "project":
      return "проектная работа";
    case "probation":
      return "стажировка";
    default:
      return "любая занятость";
  }
}

function formatTimestamp(value: string | null): string {
  if (!value) {
    return "ещё не было";
  }

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return value;
  }

  return new Date(timestamp).toISOString().replace("T", " ").slice(0, 16);
}

function summarizeError(value: string | null): string {
  if (!value) {
    return "нет";
  }

  return value.length <= 80 ? value : `${value.slice(0, 77)}...`;
}

function formatSettingValue(setting: RuntimeSettingValue): string {
  const suffix = setting.unit ? ` ${setting.unit}` : "";
  return `${setting.value}${suffix}`;
}

function roleLabel(role: BotUser["role"]): string {
  if (role === "owner") {
    return "owner";
  }

  if (role === "admin") {
    return "admin";
  }

  return "member";
}

function roleEmoji(role: BotUser["role"]): string {
  if (role === "owner") {
    return "👑";
  }

  if (role === "admin") {
    return "🛠️";
  }

  return "👤";
}

function userStatusLabel(user: BotUser): string {
  return user.isActive ? "активен" : "отключён";
}

function userSummaryLabel(user: BotUser): string {
  const status = user.isActive ? "🟢" : "⏸️";
  return `${status} ${roleEmoji(user.role)} ${user.userId}`;
}

function formatProfileKeywordList(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "не задано";
}

function profileHealthTitle(health: SearchProfileHealthReport): string {
  if (health.status === "ready") {
    return "🟢 Профиль готов";
  }

  if (health.status === "weak") {
    return "🟡 Профиль настроен частично";
  }

  return "🔴 Профиль не настроен";
}

export function formatSearchProfileHealthSummary(health: SearchProfileHealthReport): string {
  return [
    profileHealthTitle(health),
    health.summary,
    ...(health.guidance ? [health.guidance] : [])
  ].join("\n");
}

export function createAdminKeyboard(state: AdminPanelState, showOwnerControls: boolean): InlineKeyboard {
  const keyboard = new InlineKeyboard()
    .text(state.botPaused ? "▶️ Возобновить" : "⏸️ Пауза", state.botPaused ? "admin:resume" : "admin:pause")
    .text("🔄 Обновить", "admin:refresh")
    .row()
    .text("📣 Каналы", "admin:channels:0")
    .text("⚙️ Настройки", "admin:settings");

  keyboard.row().text("🔐 Доверенные сервисы", "admin:trusted_services:0");

  if (showOwnerControls) {
    keyboard
      .row()
      .text("👥 Пользователи", "admin:users")
      .text("📦 Backup", "admin:backup")
      .row()
      .text("🌐 Сайты компаний", "admin:company_sources:0");
  }

  return keyboard.row().text("🏠 Меню", "menu:home");
}

export function formatAdminPanel(state: AdminPanelState): string {
  return [
    "⚙️ Настройки бота",
    "",
    `🤖 Статус: ${state.botPaused ? "на паузе" : "работает"}`,
    `📡 Источник вакансий: ${sourceModeLabel(state.sourceMode)}`,
    `🧠 AI-анализ: ${statusLabel(state.aiEnabled)}`,
    `🎯 Режим фильтрации: ${filterModeLabel(state.filterMode)}`,
    `📣 Активных каналов: ${state.activeChannelsCount}`,
    `⌛ Ожидаю ввод: ${state.pendingInputAction ?? "нет"}`
  ].join("\n");
}

export function formatPersonalKeywords(profile: UserSearchProfile): string {
  return [
    "🎯 Мои поиски",
    "",
    "📍 Условия и формат:",
    formatProfileKeywordList(profile.requiredContextKeywords),
    "",
    "🧩 Основной профиль:",
    formatProfileKeywordList(profile.requiredPrimaryKeywords),
    "",
    "⭐ Желательные сигналы:",
    formatProfileKeywordList(profile.preferredKeywords),
    "",
    "🚫 Стоп-слова:",
    formatProfileKeywordList(profile.excludeKeywords)
  ].join("\n");
}

export function formatPersonalFiltersPanel(
  profile: UserSearchProfile | UserSearchProfileRecord,
  health: SearchProfileHealthReport,
  vacancyLanguageMode: VacancyLanguageMode,
  hhSettings?: HhSearchSettings
): string {
  return [
    "🎯 Настройка поиска",
    ...("name" in profile
      ? [
          "",
          `Название: ${profile.name}`,
          `Статус: ${profile.isActive ? "активен" : "на паузе"}`
        ]
      : []),
    "",
    formatSearchProfileHealthSummary(health),
    `${vacancyLanguageModeFlags(vacancyLanguageMode)} Язык вакансий: ${vacancyLanguageModeLabel(vacancyLanguageMode)}`,
    hhSettings
      ? `🔎 hh.ru: ${hhSettings.enabled ? "включено" : "выключено"} • запрос: ${hhSettings.text.trim() || "не задан"}`
      : null,
    "",
    "📍 Условия и формат:",
    formatProfileKeywordList(profile.requiredContextKeywords),
    "",
    "🧩 Основной профиль:",
    formatProfileKeywordList(profile.requiredPrimaryKeywords),
    "",
    "⭐ Желательные сигналы:",
    formatProfileKeywordList(profile.preferredKeywords),
    "",
    "🚫 Стоп-слова:",
    formatProfileKeywordList(profile.excludeKeywords)
  ].filter((line): line is string => line !== null).join("\n");
}

export function formatSearchProfilesPanel(
  profiles: Array<{ profile: UserSearchProfileRecord; health: SearchProfileHealthReport; weeklyStats?: SearchProfileWeeklyStats }>
): string {
  if (profiles.length === 0) {
    return [
      "🎯 Мои поиски",
      "",
      "Пока нет ни одного поискового профиля.",
      "Создай поиск вручную или выбери готовый пресет."
    ].join("\n");
  }

  return [
    "🎯 Мои поиски",
    "",
    "Вакансия попадёт в общую выдачу, если подойдёт хотя бы одному активному поиску.",
    "",
    ...profiles.flatMap(({ profile, health, weeklyStats }, index) => [
      `${index + 1}. ${profile.isActive ? "🟢" : "⏸️"} ${profile.name}`,
      `   ${vacancyLanguageModeFlags(profile.vacancyLanguageMode)} ${health.summary}`,
      `   📊 За 7 дней: ${weeklyStats?.visibleMatches ?? 0} вакансий · скрыто: ${weeklyStats?.hiddenMatches ?? 0}`,
      ""
    ]),
    `Профилей: ${profiles.length} из 5`
  ].join("\n").replace(/\n{3,}/g, "\n\n");
}

export function formatHhSearchSettingsPanel(settings: HhSearchSettings, sourceEnabled: boolean): string {
  const salary = settings.salaryFrom === null ? "не задана" : `от ${settings.salaryFrom}`;
  const query = settings.text.trim() || "не задан";

  return [
    "🔎 hh.ru",
    "",
    sourceEnabled
      ? "Источник hh.ru доступен. Вакансии из hh будут попадать в общую выдачу вместе с Telegram."
      : "Источник hh.ru пока выключен в окружении. Настройки можно подготовить, но поиск начнётся после включения HH_SOURCE_ENABLED.",
    "",
    `Статус: ${settings.enabled ? "включено" : "выключено"}`,
    `Текст запроса: ${query}`,
    `Регион area: ${settings.areaId}`,
    `Опыт: ${hhExperienceLabel(settings.experience)}`,
    `График: ${hhScheduleLabel(settings.schedule)}`,
    `Занятость: ${hhEmploymentLabel(settings.employment)}`,
    `Зарплата: ${salary}`,
    `Период публикации: ${settings.periodDays} дн.`,
    "",
    settings.enabled
      ? "После изменения параметров нажми «Пересобрать подборку», чтобы обновить текущую неделю."
      : "Чтобы включить hh.ru, сначала задай текст запроса."
  ].join("\n");
}

export function createHhSearchSettingsKeyboard(settings: HhSearchSettings): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  keyboard.text(settings.enabled ? "⏸️ Выключить hh.ru" : "▶️ Включить hh.ru", "filters:hh:toggle").row();
  keyboard.text("🔤 Текст запроса", "filters:hh:edit_text").row();
  keyboard.text("📍 Регион", "filters:hh:edit_area").text("💰 Зарплата", "filters:hh:edit_salary").row();
  keyboard.text(`🧭 Опыт: ${hhExperienceLabel(settings.experience)}`, "filters:hh:cycle_experience").row();
  keyboard.text(`🏡 График: ${hhScheduleLabel(settings.schedule)}`, "filters:hh:cycle_schedule").row();
  keyboard.text(`💼 Занятость: ${hhEmploymentLabel(settings.employment)}`, "filters:hh:cycle_employment").row();
  keyboard.text("🗓️ Период", "filters:hh:edit_period").row();
  keyboard.text("🔄 Пересобрать подборку", "filters:hh:rematch").row();
  return keyboard.text("🎯 Мои поиски", "menu:filters").row().text("🏠 Меню", "menu:home");
}

export function formatHhInputPrompt(action: "text" | "area" | "salary" | "period", settings: HhSearchSettings): string {
  if (action === "text") {
    return [
      "🔤 Текст запроса hh.ru",
      "",
      `Сейчас: ${settings.text.trim() || "не задан"}`,
      "",
      "Отправь короткий запрос, например:",
      "frontend react remote"
    ].join("\n");
  }

  if (action === "area") {
    return [
      "📍 Регион hh.ru",
      "",
      `Сейчас: ${settings.areaId}`,
      "",
      "Отправь числовой area ID. Например, 113 для России."
    ].join("\n");
  }

  if (action === "salary") {
    return [
      "💰 Зарплата от",
      "",
      `Сейчас: ${settings.salaryFrom === null ? "не задана" : settings.salaryFrom}`,
      "",
      "Отправь число или '-' чтобы очистить."
    ].join("\n");
  }

  return [
    "🗓️ Период публикации",
    "",
    `Сейчас: ${settings.periodDays} дн.`,
    "",
    "Отправь число от 1 до 30."
  ].join("\n");
}

export function formatKeywordPrompt(kind: KeywordKind): string {
  return kind === "include"
    ? "Отправь слово или короткую фразу, которые помогут находить подходящие вакансии."
    : "Отправь слово или короткую фразу, по которым бот будет отсеивать вакансии.";
}

export function formatChannelPrompt(): string {
  return [
    "Отправь один или сразу несколько публичных Telegram-каналов.",
    "",
    "За один запуск проверяется максимум 50 уникальных валидных каналов.",
    "",
    "Поддерживаются разделители: запятая, пробел, новая строка.",
    "",
    "Примеры:",
    "Remoteit,jobs_in_it_remoute,workayte",
    "@Remoteit @jobs_in_it_remoute @workayte",
    "https://t.me/job_react https://t.me/rabotafrontend"
  ].join("\n");
}

function formatChannelList(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "нет";
}

function channelDiscoverySourceLabel(source: ChannelDiscoverySource): string {
  switch (source) {
    case "mtproto_recommendation":
      return "recommendations";
    case "raw_message_link":
      return "raw links";
    case "mention_graph_link":
      return "mention links";
    case "mention_graph_username":
      return "mentions";
    case "manual_seed":
      return "manual seeds";
    case "duckduckgo_search":
      return "DuckDuckGo";
    default:
      return "search";
  }
}

function channelDiscoveryStatusLabel(candidate: ChannelDiscoveryCandidate): string {
  if (candidate.status === "approved") {
    return "added";
  }
  if (candidate.status === "blocked") {
    return "blocked";
  }
  if (candidate.status === "skipped") {
    return "skipped";
  }

  return "pending";
}

export function formatChannelBatchSummary(input: {
  totalEntries: number;
  totalActiveChannels: number;
  added: string[];
  reactivated: string[];
  alreadyActive: string[];
  duplicatesInBatch: string[];
  invalid: string[];
  probeFailed: string[];
  truncated: number;
}): string {
  const notAddedCount =
    input.alreadyActive.length +
    input.duplicatesInBatch.length +
    input.invalid.length +
    input.probeFailed.length +
    input.truncated;

  const lines = [
    "📣 Итог по добавлению каналов",
    "",
    `🔢 Распознано записей: ${input.totalEntries}`,
    `📚 Активных каналов теперь: ${input.totalActiveChannels}`,
    `✅ Добавлено новых: ${input.added.length}`,
    `♻️ Возвращено в сканирование: ${input.reactivated.length}`,
    `⛔ Не добавлено: ${notAddedCount}`
  ];

  if (input.added.length > 0) {
    lines.push("", `✅ Добавлены: ${formatChannelList(input.added)}`);
  }

  if (input.reactivated.length > 0) {
    lines.push("", `♻️ Возвращены: ${formatChannelList(input.reactivated)}`);
  }

  if (input.alreadyActive.length > 0) {
    lines.push("", `↩️ Уже были в списке: ${formatChannelList(input.alreadyActive)}`);
  }

  if (input.duplicatesInBatch.length > 0) {
    lines.push("", `🌀 Повторы во вводе: ${formatChannelList(input.duplicatesInBatch)}`);
  }

  if (input.invalid.length > 0) {
    lines.push("", `⚠️ Не прошли валидацию: ${formatChannelList(input.invalid)}`);
  }

  if (input.probeFailed.length > 0) {
    lines.push("", `🌐 Не открылись при проверке: ${formatChannelList(input.probeFailed)}`);
  }

  if (input.truncated > 0) {
    lines.push("", `✂️ Сверх лимита 50: ${input.truncated}`);
  }

  return lines.join("\n");
}

export function formatChannelsPage(page: MonitoredChannelPage): string {
  const lines = [
    "📣 Каналы",
    "",
    `📚 Всего: ${page.total}`,
    `👀 На экране: ${page.items.length}`
  ];

  if (page.items.length === 0) {
    lines.push("", "Пока пусто. Добавь первый канал ниже.");
    return lines.join("\n");
  }

  lines.push("");
  for (const channel of page.items) {
    lines.push(
      `@${channel.username} • ${channel.isActive ? "активен" : "выключен"} • последнее успешное чтение: ${formatTimestamp(channel.lastSuccessAt)}`
    );
  }

  return lines.join("\n");
}

export function formatRawChannelList(channels: MonitoredChannel[]): string {
  return channels.map((channel) => `@${channel.username}`).join(", ");
}

export function formatChannelDiscoverySetupMessage(): string {
  return [
    "🔎 Channel discovery",
    "",
    "MTProto is not configured yet, so I cannot search Telegram for new channels.",
    "",
    "Keep TELEGRAM_SOURCE_MODE=web if you want the main bot to keep using public preview pages.",
    "",
    "Setup:",
    "1. Get TELEGRAM_API_ID and TELEGRAM_API_HASH at https://my.telegram.org",
    "2. Put TELEGRAM_API_ID and TELEGRAM_API_HASH into .env",
    "3. Run npm run auth:telegram",
    "4. Put the printed TELEGRAM_SESSION into .env",
    "5. Restart npm run dev",
    "",
    "TELEGRAM_SESSION is a secret. Do not send it through Telegram."
  ].join("\n");
}

export function formatChannelDiscoveryProfileMenu(): string {
  return [
    "🔎 Channel discovery",
    "",
    "Choose a topic preset for Telegram channel search, or use a custom query.",
    "",
    "Presets use topic-specific signals. Custom query is more flexible, but can be noisier."
  ].join("\n");
}

export function formatChannelDiscoveryModeMenu(): string {
  return [
    "Channel discovery",
    "",
    "Автопоиск анализирует ссылки и упоминания в уже собранных постах.",
    "Проверить список позволяет отправить до 50 username или t.me-ссылок.",
    "",
    "Ни один найденный канал не добавляется автоматически."
  ].join("\n");
}

export function formatChannelDiscoverySeedPrompt(profileLabel: string): string {
  return [
    `Проверить список каналов: ${profileLabel}`,
    "",
    "Отправь до 50 username или публичных t.me-ссылок через пробел, запятую или с новой строки.",
    "Каналы пройдут проверку и scoring, но не будут добавлены автоматически."
  ].join("\n");
}

export function formatChannelDiscoveryModeMenuWithProviders(
  providers: Array<{ name: string; available: boolean }>
): string {
  return [
    formatChannelDiscoveryModeMenu(),
    "",
    "Providers:",
    ...providers.map((provider) => `${provider.available ? "available" : "unavailable"}: ${provider.name}`)
  ].join("\n");
}

export function formatChannelDiscoveryCustomPrompt(): string {
  return [
    "🔎 Custom channel discovery",
    "",
    "Send a short topic or profession name.",
    "",
    "Examples:",
    "backend",
    "3d printing",
    "motion design",
    "rust blockchain"
  ].join("\n");
}

export function formatChannelDiscoveryRunningMessage(profileLabel: string): string {
  return [
    `🔎 Ищу каналы: ${profileLabel}`,
    "",
    "Запустил ручной discovery-run.",
    "Проверяю Telegram search, похожие каналы и ссылки из уже найденных постов.",
    "",
    "Это может занять немного времени."
  ].join("\n");
}

export function formatChannelDiscoveryRunPage(
  run: ChannelDiscoveryRun,
  page: ChannelDiscoveryCandidatePage
): string {
  const visibleWarnings = run.providerWarnings.slice(0, 5);
  const rejectedAfterCheck = Math.max(0, run.candidatesChecked - run.candidatesRecommended);
  const notCheckedDueToLimit = Math.max(0, run.totalCandidatesFound - run.candidatesToCheck);
  const lines = [
    "🔎 Channel discovery",
    "",
    `Run #${run.id}: ${run.status}`,
    `Profile: ${run.profileLabel}`,
    ...(run.customQuery ? [`Query: ${run.customQuery}`] : []),
    `Providers: ${run.providers.join(", ") || "none"}`,
    `Найдено username-кандидатов: ${run.totalCandidatesFound}`,
    `Выбрано для проверки: ${run.candidatesToCheck}`,
    run.status === "running"
      ? `Прогресс проверки: ${run.candidatesChecked} из ${run.candidatesToCheck || "идёт сбор кандидатов"}`
      : `Проверено: ${run.candidatesChecked} из ${run.candidatesToCheck}`,
    `${run.status === "running" ? "Прошли фильтр сейчас" : "Прошли фильтр"}: ${run.candidatesRecommended}`,
    `${run.status === "running" ? "Отклонено после проверки сейчас" : "Отклонено после проверки"}: ${rejectedAfterCheck}`,
    `Не проверено из-за лимита: ${notCheckedDueToLimit}`,
    ...(notCheckedDueToLimit > 0
      ? ["Ротация: следующий автопоиск начнёт с ещё не проверенных username."]
      : []),
    ...(run.error ? [`Error: ${run.error}`] : []),
    ...visibleWarnings.map((warning) => `Warning: ${warning}`),
    ...(run.providerWarnings.length > visibleWarnings.length
      ? [`...and ${run.providerWarnings.length - visibleWarnings.length} more warnings.`]
      : []),
    "",
    page.total > 0
      ? `Shown: ${page.items.length} of ${page.total}`
      : run.status === "running"
        ? "Discovery is running. Press Refresh progress to update this screen."
        : "No channel candidates passed the quality threshold."
  ];

  if (page.items.length === 0) {
    lines.push(
      "",
      run.status === "running"
        ? "Candidates that pass the quality threshold will appear here while the run continues."
        : "Try again later after the bot has collected more posts, or add channels manually."
    );
    return lines.join("\n");
  }

  lines.push("");
  for (const [index, candidate] of page.items.entries()) {
    lines.push(
      `${page.offset + index + 1}. @${candidate.username} • score ${candidate.score} • ${channelDiscoveryStatusLabel(candidate)}`,
      `Sources: ${candidate.sources.map(channelDiscoverySourceLabel).join(", ")}`,
      `Sample: ${candidate.stats.samplePosts} posts • signals ${candidate.stats.primarySignalPosts} • format ${candidate.stats.formatSignalPosts} • hiring ${candidate.stats.hiringPosts} • vacancy-like ${candidate.stats.vacancyLikePosts} • resumes ${Math.round(candidate.stats.resumeRate * 100)}%`,
      `Why: ${candidate.reasons.join("; ")}`
    );
    if (candidate.title) {
      lines.push(`Title: ${candidate.title}`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

export function formatChannelDiscoveryEvidence(candidate: ChannelDiscoveryCandidate): string {
  const lines = [`Evidence: @${candidate.username}`, "", `Score: ${candidate.score}`, `Why: ${candidate.reasons.join("; ")}`];
  if (candidate.evidence.length === 0) {
    return [...lines, "", "Подтверждающие посты не сохранены."].join("\n");
  }
  for (const [index, evidence] of candidate.evidence.entries()) {
    lines.push(
      "",
      `${index + 1}. ${evidence.messageDate ?? "дата неизвестна"}`,
      `Signals: ${evidence.matchedSignals.join(", ") || "нет"}`,
      evidence.excerpt,
      evidence.url
    );
  }
  return lines.join("\n");
}

export function formatPendingChannelDiscoveryCandidates(page: ChannelDiscoveryCandidatePage): string {
  const lines = ["Кандидаты каналов", "", `Pending: ${page.total}`];
  for (const [index, candidate] of page.items.entries()) {
    lines.push(
      "",
      `${page.offset + index + 1}. @${candidate.username} • score ${candidate.score}`,
      `Sources: ${candidate.sources.map(channelDiscoverySourceLabel).join(", ")}`,
      `Why: ${candidate.reasons.join("; ")}`
    );
  }
  return lines.join("\n");
}

export function formatSettingsPage(settings: RuntimeSettingValue[]): string {
  const lines = ["⚙️ Настройки бота", ""];

  for (const setting of settings) {
    lines.push(
      `${setting.label} <i>${setting.key}</i>: <b>${formatSettingValue(setting)}</b> (${settingSourceLabel(setting.source)})`
    );
  }

  return lines.join("\n");
}

export function createSettingsKeyboard(settings: RuntimeSettingValue[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  for (const setting of settings) {
    keyboard.text(setting.label, `settings:view:${setting.key}`).row();
  }

  return keyboard
    .row()
    .text("🔄 Обновить", "admin:settings")
    .text("⚙️ Админ-панель", "menu:admin")
    .row()
    .text("🏠 Меню", "menu:home");
}

export function formatRuntimeSettingDetails(setting: RuntimeSettingValue): string {
  const rangeSuffix = setting.unit ? ` ${setting.unit}` : "";

  return [
    `⚙️ ${setting.label}`,
    "",
    `🔤 ENV-переменная: <i>${setting.key}</i>`,
    `🔢 Текущее значение: <b>${formatSettingValue(setting)}</b>`,
    `📌 Значение по умолчанию: <b>${setting.defaultValue}${rangeSuffix}</b>`,
    `↔️ Допустимый диапазон: ${setting.min}-${setting.max}${rangeSuffix}`,
    `🗂️ Источник значения: ${settingSourceLabel(setting.source)}`,
    `📝 Что меняет: ${setting.description}`,
    `⏱️ Когда применяется: ${setting.applyHint}`
  ].join("\n");
}

export function createRuntimeSettingDetailsKeyboard(setting: RuntimeSettingValue): InlineKeyboard {
  return new InlineKeyboard()
    .text("✏️ Изменить", `settings:set:${setting.key}`)
    .text("↩️ Сбросить", `settings:reset:${setting.key}`)
    .row()
    .text("⚙️ К настройкам", "admin:settings")
    .row()
    .text("🏠 Меню", "menu:home");
}

export function formatRuntimeSettingPrompt(setting: RuntimeSettingValue): string {
  const rangeSuffix = setting.unit ? ` ${setting.unit}` : "";
  return [
    `Отправь новое целое число для настройки «${setting.label}».`,
    `Сейчас: ${formatSettingValue(setting)}`,
    `Допустимый диапазон: ${setting.min}-${setting.max}${rangeSuffix}`,
    setting.applyHint
  ].join("\n");
}

export function createPendingInputKeyboard(backTarget = "menu:home"): InlineKeyboard {
  const keyboard = new InlineKeyboard().text("❌ Отменить ввод", "admin:cancel_input");

  if (backTarget !== "menu:home") {
    const backLabel =
      backTarget === "menu:admin"
        ? "⚙️ Админ-панель"
        : backTarget === "menu:filters"
          ? "🎯 Мои поиски"
          : backTarget === "filters:hh"
            ? "↩️ К настройкам hh.ru"
            : backTarget === "channels:discover"
              ? "🔎 К поиску каналов"
              : backTarget.startsWith("admin:company_sources:")
                ? "🌐 К сайтам компаний"
                : "↩️ Назад";

    keyboard.row().text(backLabel, backTarget);
  }

  return keyboard.row().text("🏠 Меню", "menu:home");
}

export function createChannelsKeyboard(page: MonitoredChannelPage, showOwnerControls = false): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  for (const channel of page.items) {
    keyboard.text(`@${channel.username}`, `channels:view:${channel.id}:${page.offset}`).row();
  }

  const previousOffset = Math.max(0, page.offset - page.pageSize);
  const nextOffset = page.offset + page.pageSize;

  if (page.offset > 0) {
    keyboard.text("⬅️ Назад", `admin:channels:${previousOffset}`);
  }
  if (nextOffset < page.total) {
    keyboard.text("➡️ Дальше", `admin:channels:${nextOffset}`);
  }

  keyboard
    .row()
    .text("➕ Добавить канал", "channels:add")
    .text("🔄 Обновить", `admin:channels:${page.offset}`);

  keyboard.row().text("📋 Список каналов", "channels:export");

  if (showOwnerControls) {
    keyboard
      .row()
      .text("🔎 Найти каналы", "channels:discover")
      .text("🌐 Сайты компаний", "admin:company_sources:0");
  }

  return keyboard
    .row()
    .text("⚙️ Админ-панель", "menu:admin")
    .row()
    .text("🏠 Меню", "menu:home");
}

export function createChannelDiscoveryProfileKeyboard(mode: "auto" | "seeds" = "auto"): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const profiles = listChannelDiscoveryProfiles();

  for (let index = 0; index < profiles.length; index += 2) {
    const left = profiles[index];
    const right = profiles[index + 1];
    keyboard.text(left.label, `${mode === "auto" ? "discovery:run" : "discovery:seed_profile"}:${left.id}`);
    if (right) {
      keyboard.text(right.label, `${mode === "auto" ? "discovery:run" : "discovery:seed_profile"}:${right.id}`);
    }
    keyboard.row();
  }

  if (mode === "auto") {
    keyboard.text("✍️ Свой запрос", "discovery:custom").row();
  }
  keyboard
    .text("⬅️ К выбору режима", "channels:discover")
    .row()
    .text("📣 Каналы", "admin:channels:0")
    .row()
    .text("⚙️ Админ-панель", "menu:admin")
    .row()
    .text("🏠 Меню", "menu:home");

  return keyboard;
}

export function createChannelDiscoveryModeKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Автопоиск", "discovery:auto")
    .text("Проверить список", "discovery:seeds")
    .row()
    .text("Кандидаты", "discovery:candidates:0")
    .row()
    .text("Каналы", "admin:channels:0")
    .row()
    .text("Меню", "menu:home");
}

export function createChannelDiscoverySetupKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("📣 Каналы", "admin:channels:0")
    .row()
    .text("⚙️ Админ-панель", "menu:admin")
    .row()
    .text("🏠 Меню", "menu:home");
}

export function createChannelDiscoveryRunKeyboard(
  run: ChannelDiscoveryRun,
  page: ChannelDiscoveryCandidatePage
): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  if (run.status === "running") {
    keyboard.text("Refresh progress", `discovery:page:${run.id}:${page.offset}`).row();
  }

  for (const candidate of page.items) {
    keyboard.url(`🔗 @${candidate.username}`, `https://t.me/${candidate.username}`).row();
    if (candidate.status === "pending") {
      keyboard
        .text("➕ Добавить", `discovery:add:${candidate.id}`)
        .text("⏭️ Skip", `discovery:skip:${candidate.id}`)
        .text("🚫 Block", `discovery:block:${candidate.id}`)
        .row();
      keyboard.text("🧾 Evidence", `discovery:evidence:${candidate.id}`).row();
    }
  }

  const previousOffset = Math.max(0, page.offset - page.pageSize);
  const nextOffset = page.offset + page.pageSize;

  if (page.offset > 0) {
    keyboard.text("⬅️ Назад", `discovery:page:${run.id}:${previousOffset}`);
  }
  if (nextOffset < page.total) {
    keyboard.text("➡️ Дальше", `discovery:page:${run.id}:${nextOffset}`);
  }

  keyboard
    .row()
    .text("🔎 Новый поиск", "channels:discover")
    .text("📣 Каналы", "admin:channels:0")
    .row()
    .text("⚙️ Админ-панель", "menu:admin")
    .row()
    .text("🏠 Меню", "menu:home");

  return keyboard;
}

export function createPendingChannelDiscoveryCandidatesKeyboard(page: ChannelDiscoveryCandidatePage): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const candidate of page.items) {
    keyboard.url(`@${candidate.username}`, `https://t.me/${candidate.username}`).row();
    keyboard
      .text("Добавить", `discovery:add:${candidate.id}`)
      .text("Skip", `discovery:skip:${candidate.id}`)
      .text("Block", `discovery:block:${candidate.id}`)
      .row()
      .text("Evidence", `discovery:evidence:${candidate.id}`)
      .row();
  }
  const previousOffset = Math.max(0, page.offset - page.pageSize);
  const nextOffset = page.offset + page.pageSize;
  if (page.offset > 0) keyboard.text("Назад", `discovery:candidates:${previousOffset}`);
  if (nextOffset < page.total) keyboard.text("Дальше", `discovery:candidates:${nextOffset}`);
  return keyboard.row().text("Новый поиск", "channels:discover").row().text("Меню", "menu:home");
}

export function createChannelDiscoveryEvidenceKeyboard(candidate: ChannelDiscoveryCandidate): InlineKeyboard {
  return new InlineKeyboard()
    .url(`@${candidate.username}`, `https://t.me/${candidate.username}`)
    .row()
    .text("К результатам", `discovery:page:${candidate.runId}:0`)
    .row()
    .text("Меню", "menu:home");
}

export function formatCompanyCareerSourcesPage(page: CompanyCareerSourcePage, sourceEnabled: boolean): string {
  const lines = [
    "🌐 Сайты компаний",
    "",
    sourceEnabled
      ? "Источник включён. Активные сайты проверяются автоматически."
      : "Источник выключен в env. Можно подготовить список, затем включить COMPANY_CAREERS_SOURCE_ENABLED=true.",
    "",
    `Всего: ${page.total}`,
    `Показано: ${page.items.length}`
  ];

  if (page.items.length === 0) {
    lines.push("", "Сайтов пока нет. Добавь HTTPS-ссылку на страницу вакансий.");
    return lines.join("\n");
  }

  lines.push("");
  for (const source of page.items) {
    lines.push(
      `${source.isActive ? "ON" : "OFF"} ${source.companyName} • ${source.adapter}`,
      source.startUrl,
      `успешная проверка: ${formatTimestamp(source.lastSuccessAt)} • ошибка: ${summarizeError(source.lastError)}`,
      ""
    );
  }

  return lines.join("\n").trimEnd();
}

export function createCompanyCareerSourcesKeyboard(page: CompanyCareerSourcePage): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  for (const source of page.items) {
    keyboard.text(`${source.isActive ? "ON" : "OFF"} ${source.companyName}`, `company_sources:view:${source.id}:${page.offset}`).row();
  }

  const previousOffset = Math.max(0, page.offset - page.pageSize);
  const nextOffset = page.offset + page.pageSize;

  if (page.offset > 0) {
    keyboard.text("⬅️ Назад", `admin:company_sources:${previousOffset}`);
  }
  if (nextOffset < page.total) {
    keyboard.text("➡️ Дальше", `admin:company_sources:${nextOffset}`);
  }

  keyboard
    .row()
    .text("➕ Добавить сайт", "company_sources:add")
    .text("🔄 Обновить", `admin:company_sources:${page.offset}`)
    .row()
    .text("📣 Каналы", "admin:channels:0")
    .row()
    .text("⚙️ Админ-панель", "menu:admin")
    .row()
    .text("🏠 Меню", "menu:home");

  return keyboard;
}

export function formatCompanyCareerSourcePrompt(): string {
  return [
    "🌐 Добавить сайт компании",
    "",
    "Отправь HTTPS-ссылку на страницу вакансий компании.",
    "",
    "Поддерживается в первой версии:",
    "https://www.aviasales.ru/about/vacancies",
    "https://boards.greenhouse.io/company",
    "https://jobs.lever.co/company",
    "https://jobs.ashbyhq.com/company",
    "https://jobs.smartrecruiters.com/company",
    "",
    "Обычная HTML-страница принимается только при наличии schema.org JobPosting."
  ].join("\n");
}

export function formatCompanyCareerSourceDetails(source: CompanyCareerSourceRecord, sourceEnabled: boolean): string {
  return [
    "🌐 Сайт компании",
    "",
    `Компания: ${source.companyName}`,
    `Адаптер: ${source.adapter}`,
    `URL: ${source.startUrl}`,
    `Статус: ${source.isActive ? "активен" : "выключен"}`,
    `Источник в env: ${sourceEnabled ? "включён" : "выключен"}`,
    `Интервал проверки: ${source.pollIntervalSeconds} сек.`,
    `Следующая проверка после: ${formatTimestamp(source.nextPollAfter)}`,
    `Последняя проверка: ${formatTimestamp(source.lastCheckedAt)}`,
    `Последняя успешная проверка: ${formatTimestamp(source.lastSuccessAt)}`,
    `Последняя ошибка: ${summarizeError(source.lastError)}`
  ].join("\n");
}

export function createCompanyCareerSourceDetailsKeyboard(source: CompanyCareerSourceRecord, offset: number): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  keyboard
    .text("🔍 Проверить сейчас", `company_sources:check:${source.id}:${offset}`)
    .row()
    .text(source.isActive ? "⏸️ Выключить" : "▶️ Включить", `company_sources:${source.isActive ? "disable" : "enable"}:${source.id}:${offset}`);
  return keyboard
    .row()
    .text("🌐 К сайтам компаний", `admin:company_sources:${offset}`)
    .row()
    .text("⚙️ Админ-панель", "menu:admin")
    .row()
    .text("🏠 Меню", "menu:home");
}

export function formatChannelDetails(channel: MonitoredChannel): string {
  return [
    "📣 Канал",
    "",
    `🔤 Username: @${channel.username}`,
    `📡 Источник: ${sourceNameLabel(channel.sourceName)}`,
    `🤖 Статус: ${channel.isActive ? "активен" : "выключен"}`,
    `📥 Первая загрузка завершена: ${boolLabel(channel.initialBackfillCompleted)}`,
    `🕒 Последняя проверка: ${formatTimestamp(channel.lastCheckedAt)}`,
    `✅ Последнее успешное чтение: ${formatTimestamp(channel.lastSuccessAt)}`,
    `⚠️ Последняя ошибка: ${summarizeError(channel.lastError)}`
  ].join("\n");
}

export function createChannelDetailsKeyboard(
  channel: MonitoredChannel,
  offset: number,
  confirmRemoval = false
): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  if (confirmRemoval) {
    keyboard
      .text("✅ Подтвердить", `channels:confirm_remove:${channel.id}:${offset}`)
      .text("❌ Отмена", `channels:view:${channel.id}:${offset}`);
  } else {
    keyboard.text("🗑️ Убрать из сканирования", `channels:remove:${channel.id}:${offset}`);
  }

  return keyboard
    .row()
    .text("📣 К списку каналов", `admin:channels:${offset}`)
    .row()
    .text("🏠 Меню", "menu:home");
}

export function formatUsersPage(users: BotUser[]): string {
  const lines = ["👥 Пользователи", ""];

  if (users.length === 0) {
    lines.push("Список пока пуст.");
    return lines.join("\n");
  }

  lines.push(`Всего: ${users.length}`, "");
  for (const user of users) {
    lines.push(`${userSummaryLabel(user)} • ${roleLabel(user.role)} • ${userStatusLabel(user)}`);
  }

  return lines.join("\n");
}

export function createUsersKeyboard(users: BotUser[], currentUserId?: string): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  for (const user of users) {
    const isCurrent = currentUserId === user.userId;
    keyboard.text(`${userSummaryLabel(user)}${isCurrent ? " (я)" : ""}`, `users:view:${user.userId}`).row();
  }

  keyboard
    .text("➕ Добавить пользователя", "users:add")
    .row()
    .text("⚙️ Админ-панель", "menu:admin")
    .row()
    .text("🏠 Меню", "menu:home");

  return keyboard;
}

export function formatUserDetails(user: BotUser): string {
  const identityParts = [user.displayName, user.username ? `@${user.username}` : null].filter(Boolean);
  const identity = identityParts.length > 0 ? identityParts.join(" • ") : "не указано";

  return [
    `${roleEmoji(user.role)} Пользователь`,
    "",
    `🆔 ID: ${user.userId}`,
    `🎭 Роль: ${roleLabel(user.role)}`,
    `🔐 Доступ: ${userStatusLabel(user)}`,
    `👤 Профиль: ${identity}`,
    `➕ Добавлен: ${user.addedByUserId ?? "неизвестно"}`,
    `🕒 Создан: ${formatTimestamp(user.createdAt)}`,
    `♻️ Обновлён: ${formatTimestamp(user.updatedAt)}`
  ].join("\n");
}

export function createUserDetailsKeyboard(user: BotUser, currentUserId?: string): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const canManage = user.role !== "owner" && currentUserId !== undefined && currentUserId !== user.userId;

  if (canManage) {
    keyboard
      .text(
        user.role === "admin" ? "⬇️ Сделать member" : "⬆️ Сделать admin",
        `users:role:${user.userId}:${user.role === "admin" ? "member" : "admin"}`
      )
      .row()
      .text(
        user.isActive ? "⏸️ Отключить доступ" : "▶️ Включить доступ",
        `users:status:${user.userId}:${user.isActive ? "disable" : "enable"}`
      )
      .row();
  }

  return keyboard
    .text("👥 К списку пользователей", "admin:users")
    .row()
    .text("🏠 Меню", "menu:home");
}

export function formatUserPrompt(): string {
  return "Отправь Telegram ID пользователя, которого нужно добавить в список доступа.";
}

export function formatSearchProfilePrompt(
  section: "required_context" | "required_primary" | "preferred" | "exclude",
  currentKeywords: string[]
): string {
  const metaBySection = {
    required_context: {
      emoji: "📍",
      label: "Условия и формат",
      example: "remote, удаленно, europe"
    },
    required_primary: {
      emoji: "🧩",
      label: "Основной профиль",
      example: "react, frontend, backend"
    },
    preferred: {
      emoji: "⭐",
      label: "Желательные сигналы",
      example: "typescript, senior, saas"
    },
    exclude: {
      emoji: "🚫",
      label: "Стоп-слова",
      example: "junior, office, php"
    }
  } as const;

  const meta = metaBySection[section];
  const currentValue = currentKeywords.length > 0 ? currentKeywords.join(", ") : "пока ничего не задано";

  return [
    `${meta.emoji} ${meta.label}`,
    "",
    `Сейчас: ${currentValue}`,
    "",
    "Отправь новый список через запятую или с новой строки.",
    `Пример: ${meta.example}`,
    "Чтобы очистить блок, отправь один символ: -"
  ].join("\n");
}

export function formatSearchProfilePromptWithHealth(
  section: "required_context" | "required_primary" | "preferred" | "exclude",
  currentKeywords: string[],
  health: SearchProfileHealthReport
): string {
  return [
    formatSearchProfileHealthSummary(health),
    "",
    formatSearchProfilePrompt(section, currentKeywords)
  ].join("\n");
}

export function formatSearchProfilePresets(): string {
  const lines = [
    "🧩 Пресеты профиля",
    "",
    "Выбери готовый профиль, чтобы быстро заполнить блоки поиска.",
    "После применения пресет можно спокойно донастроить вручную.",
    "Числа на кнопках — локальная оценка по накопленным вакансиям за 7 дней, а не гарантия будущей выдачи.",
    "",
    "Категории:"
  ];

  for (const group of listSearchProfilePresetGroups()) {
    lines.push(`• ${group.label}: ${group.presets.map((preset) => preset.label).join(", ")}`);
  }

  return lines.join("\n");
}

export function createSearchProfilePresetsKeyboard(
  targetProfileId?: number | "new",
  forecasts: SearchProfilePresetForecast[] = []
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const forecastByPreset = new Map(forecasts.map((forecast) => [forecast.presetId, forecast]));
  const labelForPreset = (presetId: SearchProfilePresetId, label: string): string => {
    const forecast = forecastByPreset.get(presetId);
    if (!forecast) {
      return label;
    }
    if (forecast.matchesCount === 0) {
      return `${label} · мало данных`;
    }
    return `${label} · ~${forecast.matchesCount}`;
  };
  const callbackForPreset = (presetId: SearchProfilePresetId): string => {
    if (targetProfileId === "new") {
      return `filters:preset_new:${presetId}`;
    }
    if (typeof targetProfileId === "number") {
      return `filters:profile:${targetProfileId}:preset:${presetId}`;
    }
    return `filters:preset:${presetId}`;
  };

  for (const group of listSearchProfilePresetGroups()) {
    keyboard.text(`— ${group.label} —`, "noop").row();
    for (let index = 0; index < group.presets.length; index += 2) {
      const left = group.presets[index];
      const right = group.presets[index + 1];
      keyboard.text(labelForPreset(left.id, left.label), callbackForPreset(left.id));
      if (right) {
        keyboard.text(labelForPreset(right.id, right.label), callbackForPreset(right.id));
      }
      keyboard.row();
    }
  }

  if (typeof targetProfileId === "number") {
    keyboard.text("↩️ К поиску", `filters:profile:${targetProfileId}`).row();
  } else {
    keyboard.text("🎯 К моим поискам", "menu:filters").row();
  }

  return keyboard.text("🏠 Меню", "menu:home");
}

export function formatTrustedVacancyServicesPage(page: TrustedVacancyServicePage): string {
  const lines = [
    "🔐 Доверенные сервисы вакансий",
    "",
    "Ссылки этих сервисов открываются только для обогащения вакансий из Telegram.",
    `Всего: ${page.total} · показано: ${page.items.length}`,
    ""
  ];
  if (page.items.length === 0) return [...lines, "Сервисов пока нет."].join("\n");
  for (const service of page.items) {
    const status = service.status === "active" ? "🟢" : service.status === "pending" ? "🟡" : "⏸️";
    lines.push(`${status} ${service.displayName}`, `${service.hostname} · ${service.adapter} · ${service.status}`, "");
  }
  return lines.join("\n").trimEnd();
}

export function createTrustedVacancyServicesKeyboard(page: TrustedVacancyServicePage): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const service of page.items) {
    const status = service.status === "active" ? "ON" : service.status === "pending" ? "NEW" : "OFF";
    keyboard.text(`${status} ${service.displayName}`, `trusted_services:view:${service.id}:${page.offset}`).row();
  }
  if (page.offset > 0) keyboard.text("⬅️ Назад", `admin:trusted_services:${Math.max(0, page.offset - page.pageSize)}`);
  if (page.offset + page.pageSize < page.total) keyboard.text("➡️ Дальше", `admin:trusted_services:${page.offset + page.pageSize}`);
  return keyboard
    .row()
    .text("➕ Добавить сервис", "trusted_services:add")
    .text("🔄 Обновить", `admin:trusted_services:${page.offset}`)
    .row()
    .text("⚙️ Админ-панель", "menu:admin")
    .row()
    .text("🏠 Меню", "menu:home");
}

export function formatTrustedVacancyServicePrompt(): string {
  return [
    "🔐 Добавить доверенный сервис",
    "",
    "Отправь пример HTTPS-ссылки на конкретную вакансию.",
    "После безопасной проверки сервис нужно включить вручную.",
    "Доверие действует только для точного hostname."
  ].join("\n");
}

export function formatTrustedVacancyServiceDetails(service: TrustedVacancyServiceRecord): string {
  return [
    "🔐 Доверенный сервис",
    "",
    `Название: ${service.displayName}`,
    `Hostname: ${service.hostname}`,
    `Adapter: ${service.adapter}`,
    `Parser: ${service.parserMode}`,
    `Статус: ${service.status}`,
    `Пример URL: ${service.exampleUrl}`,
    `Последняя проверка: ${formatTimestamp(service.lastCheckedAt)}`,
    `Последний успех: ${formatTimestamp(service.lastSuccessAt)}`,
    `Последняя ошибка: ${summarizeError(service.lastError)}`
  ].join("\n");
}

export function createTrustedVacancyServiceDetailsKeyboard(service: TrustedVacancyServiceRecord, offset: number): InlineKeyboard {
  const keyboard = new InlineKeyboard().text("🔍 Проверить", `trusted_services:check:${service.id}:${offset}`);
  if (service.status === "active") {
    keyboard.row().text("⏸️ Выключить", `trusted_services:disable:${service.id}:${offset}`);
  } else if (service.status === "disabled" || service.lastSuccessAt) {
    keyboard.row().text("✅ Доверять и включить", `trusted_services:activate:${service.id}:${offset}`);
  }
  return keyboard
    .row()
    .text("🔐 К сервисам", `admin:trusted_services:${offset}`)
    .row()
    .text("⚙️ Админ-панель", "menu:admin")
    .row()
    .text("🏠 Меню", "menu:home");
}

export function presetAppliedLabel(presetId: SearchProfilePresetId): string {
  return getSearchProfilePreset(presetId)?.label ?? presetId;
}
