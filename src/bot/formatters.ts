import { AppConfig } from "../config";
import { ChannelHealthAlert } from "../services/channelHealthMonitor";
import {
  analyzeVacancyCard,
  ExtractedVacancyDetail,
  VacancyCardAnalysis,
  VacancyCardWarningCode,
  VacancyCriticalUnknown
} from "../services/vacancyDetailsExtractor";
import {
  BotUser,
  DailyDigestDeliveryRecord,
  DailyDigestPayload,
  ExtractedContact,
  HiddenVacancyFeedbackSummary,
  MatchedVacancyRecord,
  SearchProfileHealthReport,
  SearchProfileSectionKey,
  VacancyLanguageMode,
  UserStatusVacancyPage,
  UserSearchProfile,
  UserStatusVacancyRecord,
  UserVacancyApplicationPage,
  UserVacancyApplicationRecord,
  UserFilterSuggestionCandidate,
  UserSearchProfileRecord,
  UserVacancyRematchSummary,
  UserWeeklyVacancyPage,
  VacancyApplicationFollowUpRecord,
  VacancyApplicationRecord,
  VacancyDuplicatePost,
  VacancyReminderPage,
  VacancyReminderRecord,
  VacancyRejectionReason,
  VacancyUserStatus,
  VacancyRecord,
  WeeklyVacancyPage
} from "../types";
import {
  FILTER_SUGGESTION_LABELS,
  HIDDEN_VACANCY_REASON_LABELS
} from "../services/hiddenVacancyReasons";
import { DEFAULT_WEEKLY_WINDOW_DAYS, normalizeWeeklyWindowDays } from "../services/weeklyWindow";
import { normalizeForComparison, normalizeReadableText, normalizeWhitespace, shorten } from "../utils/text";

const VACANCY_CARD_SEPARATOR = "──────────────";
const COMPACT_VACANCY_EXCERPT_LENGTH = 240;
const TELEGRAM_SAFE_MESSAGE_LENGTH = 3900;
const FULL_TEXT_TRUNCATED_NOTICE = "⚠️ Текст сокращён — откройте исходный пост.";

type VacancyMessageRecord = VacancyRecord | MatchedVacancyRecord | UserStatusVacancyRecord;
export type VacancyNotificationView = "compact" | "full";
export type WeeklyZeroStateKind = "hidden" | "no_source_data" | "no_matches" | "diagnostics_unavailable";

export interface WeeklyZeroStateContext {
  activeProfiles?: UserSearchProfileRecord[];
  profileId?: number;
  rematchSummary?: UserVacancyRematchSummary | null;
  days?: number;
}

export type PublicUserRegistrationAlertPayload = {
  user: BotUser;
  telegramUsername?: string | null;
  telegramFirstName?: string | null;
  telegramLastName?: string | null;
  registeredAtIso?: string;
};

function formatDate(value: string | null | undefined, timeZone: string): string {
  if (!value) {
    return "не указано";
  }

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return value;
  }

  return new Intl.DateTimeFormat("ru-RU", {
    timeZone,
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

function formatTime(value: string | null | undefined, timeZone: string): string {
  if (!value) {
    return "не указано";
  }

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return value;
  }

  return new Intl.DateTimeFormat("ru-RU", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(timestamp));
}

function formatMatchedKeywords(keywords: string[]): string {
  return keywords.length > 0 ? keywords.join(", ") : "без явных совпадений";
}

function parseMatchSummary(summary: string): { conditions: string[]; primary: string[]; preferred: string[] } {
  const result = {
    conditions: [] as string[],
    primary: [] as string[],
    preferred: [] as string[]
  };

  for (const part of summary.split(";")) {
    const [rawKey, rawValue] = part.split(":", 2);
    const key = rawKey?.trim().toLowerCase();
    const values = (rawValue ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    if (key === "conditions") {
      result.conditions.push(...values);
    } else if (key === "primary") {
      result.primary.push(...values);
    } else if (key === "preferred") {
      result.preferred.push(...values);
    }
  }

  return result;
}

function formatCompactMatchExplanation(vacancy: VacancyMessageRecord): string {
  const explanation = parseMatchSummary(vacancy.matchSummary);
  const parts = [
    explanation.conditions.length > 0 ? `условия: ${explanation.conditions.join(", ")}` : null,
    explanation.primary.length > 0 ? `профиль: ${explanation.primary.join(", ")}` : null,
    explanation.preferred.length > 0 ? `плюсы: ${explanation.preferred.join(", ")}` : null
  ].filter((part): part is string => part !== null);

  if (parts.length > 0) {
    return parts.join("; ");
  }

  return formatMatchedKeywords(vacancy.matchedKeywords);
}

function uniqueReasonItems(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of items.map((value) => value.trim()).filter(Boolean)) {
    const key = normalizeForComparison(item);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
  }

  return result;
}

function buildMatchReasonItems(vacancy: VacancyMessageRecord, analysis?: VacancyCardAnalysis): string[] {
  const explanation = parseMatchSummary(vacancy.matchSummary);
  const matchReasons = [
    explanation.conditions.join(", "),
    explanation.primary.join(", "),
    explanation.preferred.join(", ")
  ];
  const factReasons = analysis
    ? [
        analysis.details.salary ? "зарплата указана" : null,
        analysis.details.engagement?.confidence === "explicit" ? "оформление указано" : null
      ].filter((part): part is string => Boolean(part))
    : [];
  const hasStructuredReasons = matchReasons.some((reason) => reason.trim()) || factReasons.length > 0;
  const fallbackReasons = !hasStructuredReasons && vacancy.matchedKeywords.length > 0
    ? vacancy.matchedKeywords
    : hasStructuredReasons ? [] : ["без явных совпадений"];

  return uniqueReasonItems([...matchReasons, ...factReasons, ...fallbackReasons]);
}

function formatContacts(contacts: ExtractedContact[], limit = contacts.length): string {
  if (contacts.length === 0) {
    return "не найдено";
  }

  const visible = contacts.slice(0, limit).map((contact) => contact.value);
  const hiddenCount = contacts.length - visible.length;
  return hiddenCount > 0 ? `${visible.join(", ")} и ещё ${hiddenCount}` : visible.join(", ");
}

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function countExternalUrls(contacts: ExtractedContact[]): number {
  return contacts.filter((contact) => contact.type === "url").length;
}

function collapseToSingleLine(value: string): string {
  return normalizeWhitespace(normalizeReadableText(value).replace(/\n+/g, " "));
}

function stripLeadingDecorators(value: string): string {
  return value.replace(/^[^\p{L}\p{N}]+/u, "").trimStart();
}

function normalizeDisplayTitle(value: string): string {
  return collapseToSingleLine(value) || "Без названия";
}

function stripTitlePrefixFromExcerpt(title: string, excerpt: string): string {
  const titleCore = stripLeadingDecorators(title);
  const excerptCore = stripLeadingDecorators(excerpt);
  const normalizedTitle = normalizeForComparison(titleCore);

  if (!normalizedTitle) {
    return excerpt;
  }

  if (!normalizeForComparison(excerptCore).startsWith(normalizedTitle)) {
    return excerpt;
  }

  if (!excerptCore.startsWith(titleCore)) {
    return excerpt;
  }

  const trimmed = excerptCore
    .slice(titleCore.length)
    .replace(/^[\s\-–—|:•·]+/u, "")
    .trimStart();

  return trimmed.length > 0 ? trimmed : excerpt;
}

function buildVacancyExcerpt(vacancy: VacancyMessageRecord, maxLength = 180): string {
  const title = normalizeDisplayTitle(vacancy.title);
  const collapsedText = collapseToSingleLine(vacancy.text);
  const withoutTitlePrefix = stripTitlePrefixFromExcerpt(title, collapsedText);
  const excerptSource = withoutTitlePrefix || collapsedText || title;

  return shorten(excerptSource, maxLength);
}

function buildCompactVacancyExcerpt(vacancy: VacancyMessageRecord): string {
  const structuredLinePattern =
    /^(?:роль|role|позиция|position|должность|вакансия|компания|company|employer|работодатель|зарплата|salary|вилка|compensation|оплата|грейд|grade|seniority|уровень|формат работы|work mode|work format|формат|schedule|график|география|локация|location|регион|город|стек|stack|технологии|technologies|tech stack)\s*[:—–-]/iu;
  const title = normalizeDisplayTitle(vacancy.title);
  const meaningfulLines = normalizeReadableText(vacancy.text)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !structuredLinePattern.test(line))
    .filter((line) => normalizeForComparison(stripLeadingDecorators(line)) !== normalizeForComparison(stripLeadingDecorators(title)));
  const excerptSource = meaningfulLines.join(" ") || buildVacancyExcerpt(vacancy, COMPACT_VACANCY_EXCERPT_LENGTH);
  return shorten(collapseToSingleLine(excerptSource), COMPACT_VACANCY_EXCERPT_LENGTH);
}

function formatVacancyMetaLine(vacancy: VacancyMessageRecord, config: AppConfig): string {
  if (vacancy.sourceName === "hh_api" || vacancy.sourceName === "company_careers") {
    return `📣 ${vacancy.sourceChannel} • ${formatDate(vacancy.messageDate, config.timeZone)}`;
  }

  return `📣 @${vacancy.sourceChannel} • ${formatDate(vacancy.messageDate, config.timeZone)}`;
}

function formatDuplicatePostSource(post: VacancyDuplicatePost): string {
  if (post.sourceName === "hh_api" || post.sourceName === "company_careers") {
    return post.sourceChannel;
  }

  return post.sourceChannel.startsWith("@") ? post.sourceChannel : `@${post.sourceChannel}`;
}

function formatVacancyDuplicatePostLines(vacancy: VacancyMessageRecord, config: AppConfig): string[] {
  const duplicatePosts = vacancy.duplicatePosts ?? [];
  if (duplicatePosts.length === 0) {
    return [];
  }

  const total = Math.max(vacancy.duplicatePostsTotal ?? duplicatePosts.length, duplicatePosts.length);
  const hiddenCount = total - duplicatePosts.length;
  const lines = ["🔁 Дубли:"];

  for (const post of duplicatePosts) {
    lines.push(
      `• ${formatDuplicatePostSource(post)} • ${formatDate(post.messageDate, config.timeZone)}`,
      `  ${post.url}`
    );
  }

  if (hiddenCount > 0) {
    lines.push(`…и ещё ${hiddenCount}`);
  }

  return lines;
}

function formatVacancyStatusLine(vacancy: VacancyMessageRecord): string | null {
  if (!("userStatus" in vacancy)) {
    return null;
  }

  const statusLabel = formatVacancyUserStatus(vacancy.userStatus);
  if (!statusLabel) {
    return null;
  }

  if ("isCurrentlyMatched" in vacancy) {
    return `📌 ${statusLabel} • ${vacancy.isCurrentlyMatched ? "всё ещё подходит" : "уже не входит в текущую подборку"}`;
  }

  return `📌 ${statusLabel}`;
}

function formatHiddenReasonLine(vacancy: VacancyMessageRecord): string | null {
  if (!("userStatus" in vacancy) || vacancy.userStatus !== "hidden" || !vacancy.hiddenReason) {
    return null;
  }

  return `🙈 Скрыто: ${HIDDEN_VACANCY_REASON_LABELS[vacancy.hiddenReason]}`;
}

function formatVacancyApplicationLines(vacancy: VacancyMessageRecord, config: AppConfig, includeNoteText: boolean): string[] {
  if (!("userStatus" in vacancy) || vacancy.userStatus !== "applied" || !vacancy.application) {
    return [];
  }

  const application = vacancy.application;
  const lines = [`✅ Откликнулся: ${formatDate(application.appliedAt, config.timeZone)}`];

  if (application.followUpAt && !application.cancelledAt && !application.respondedAt && !application.closedAt) {
    lines.push(
      application.deliveredAt
        ? `⏰ Follow-up отправлен: ${formatDate(application.deliveredAt, config.timeZone)}`
        : `⏰ Follow-up: ${formatDate(application.followUpAt, config.timeZone)}`
    );
  }

  if (application.note) {
    lines.push(includeNoteText ? `📝 Заметка: ${application.note}` : "📝 Есть заметка");
  }

  return lines;
}

function formatApplicationFollowUpState(application: VacancyApplicationRecord, config: AppConfig): string {
  if (application.respondedAt) {
    return `Ответили: ${formatDate(application.respondedAt, config.timeZone)}`;
  }

  if (application.closedAt) {
    return `Закрыт: ${formatDate(application.closedAt, config.timeZone)}`;
  }

  if (application.deliveredAt) {
    return `Follow-up отправлен: ${formatDate(application.deliveredAt, config.timeZone)}`;
  }

  if (application.cancelledAt && application.followUpAt) {
    return `Follow-up отменён: ${formatDate(application.cancelledAt, config.timeZone)}`;
  }

  if (application.followUpAt) {
    return `Follow-up: ${formatDate(application.followUpAt, config.timeZone)}`;
  }

  return "Follow-up не задан";
}

function formatCompactMatchContext(vacancy: VacancyMessageRecord): string {
  const explanation = formatCompactMatchExplanation(vacancy);
  if (!("matchedProfileNames" in vacancy) || !vacancy.matchedProfileNames?.length) {
    return `🎯 ${explanation}`;
  }

  return `🎯 ${vacancy.matchedProfileNames.join(", ")}: ${explanation}`;
}

function formatExtractedDetail(detail: ExtractedVacancyDetail): string {
  return detail.value;
}

function formatReadableMatchContext(vacancy: VacancyMessageRecord, analysis?: VacancyCardAnalysis): string {
  const explanation = buildMatchReasonItems(vacancy, analysis).slice(0, 5).join("; ");
  if (!("matchedProfileNames" in vacancy) || !vacancy.matchedProfileNames?.length) {
    return `🎯 Почему показал: ${explanation}`;
  }

  return `🎯 Почему показал: ${vacancy.matchedProfileNames.join(", ")} — ${explanation}`;
}

function formatDetailedMatchContext(vacancy: VacancyMessageRecord, analysis: VacancyCardAnalysis): string[] {
  const reasons = buildMatchReasonItems(vacancy, analysis).slice(0, 6);
  const header = !("matchedProfileNames" in vacancy) || !vacancy.matchedProfileNames?.length
    ? "🎯 Почему показал:"
    : `🎯 Почему показал (${vacancy.matchedProfileNames.join(", ")}):`;

  return [
    header,
    ...reasons.map((reason) => `+ ${reason}`)
  ];
}

function safeAnalyzeVacancyCard(vacancy: VacancyMessageRecord): VacancyCardAnalysis {
  try {
    return analyzeVacancyCard(vacancy.title, vacancy.text);
  } catch {
    return {
      displayTitle: normalizeDisplayTitle(vacancy.title),
      details: {},
      reliableFactCount: 0,
      warnings: [],
      criticalUnknowns: ["salary", "geography_or_russia", "engagement"]
    };
  }
}

const WARNING_LABELS: Record<VacancyCardWarningCode, string> = {
  russia_not_allowed: "работа из РФ явно недоступна",
  remote_geo_restricted: "удалёнка ограничена указанной географией",
  conflicting_work_formats: "одновременно указаны удалённый и офисный/гибридный форматы",
  unpaid: "вакансия явно указана как неоплачиваемая"
};

const CRITICAL_UNKNOWN_LABELS: Record<VacancyCriticalUnknown, string> = {
  salary: "зарплату",
  geography_or_russia: "географию / возможность работать из РФ",
  engagement: "оформление"
};

function formatWarningLine(analysis: VacancyCardAnalysis): string | null {
  return analysis.warnings.length > 0
    ? `⚠️ Важно: ${analysis.warnings.map((warning) => WARNING_LABELS[warning]).join("; ")}`
    : null;
}

function formatCriticalUnknownsLine(analysis: VacancyCardAnalysis): string | null {
  return analysis.criticalUnknowns.length > 0
    ? `❓ Проверить: ${analysis.criticalUnknowns.map((unknown) => CRITICAL_UNKNOWN_LABELS[unknown]).join(", ")}`
    : null;
}

function formatWeeklyFactLines(analysis: VacancyCardAnalysis): string[] {
  const details = analysis.details;
  const compactDetail = (detail: ExtractedVacancyDetail): string => shorten(formatExtractedDetail(detail), 80);
  const firstLine = [
    details.salary ? `💰 ${compactDetail(details.salary)}` : null,
    details.workFormat ? `🏠 ${compactDetail(details.workFormat)}` : null,
    details.grade ? `🧭 ${compactDetail(details.grade)}` : null
  ].filter((part): part is string => Boolean(part));
  const secondLine = [
    details.geography ? `📍 ${compactDetail(details.geography)}` : details.russiaAccess ? `📍 ${compactDetail(details.russiaAccess)}` : null,
    details.employment ? `📄 ${compactDetail(details.employment)}` : null,
    details.engagement ? `🤝 ${compactDetail(details.engagement)}` : null,
    details.stack ? `🧩 ${compactDetail(details.stack)}` : null
  ].filter((part): part is string => Boolean(part));

  return [
    ...(firstLine.length > 0 ? [firstLine.join(" · ")] : []),
    ...(secondLine.length > 0 ? [secondLine.join(" · ")] : [])
  ];
}

function formatDetailFactLines(analysis: VacancyCardAnalysis): string[] {
  const details = analysis.details;
  const lines = [
    details.company ? `🏢 ${formatExtractedDetail(details.company)}` : null,
    details.salary || details.grade
      ? `💰 ${[details.salary, details.grade].filter(Boolean).map((detail) => formatExtractedDetail(detail!)).join(" · ")}`
      : null,
    details.workFormat || details.geography || details.russiaAccess
      ? `🏠 ${[
          details.workFormat ? formatExtractedDetail(details.workFormat) : null,
          details.geography ? `📍 ${formatExtractedDetail(details.geography)}` : details.russiaAccess ? `📍 ${formatExtractedDetail(details.russiaAccess)}` : null
        ].filter(Boolean).join(" · ")}`
      : null,
    details.employment || details.engagement
      ? `📄 ${[details.employment, details.engagement].filter(Boolean).map((detail) => formatExtractedDetail(detail!)).join(" · ")}`
      : null,
    details.english || details.timeZone
      ? `🌍 ${[details.english, details.timeZone].filter(Boolean).map((detail) => formatExtractedDetail(detail!)).join(" · ")}`
      : null,
    details.stack ? `🧩 ${formatExtractedDetail(details.stack)}` : null
  ];
  return lines.filter((line): line is string => Boolean(line));
}

function formatCompactVacancyNotification(vacancy: VacancyMessageRecord, config: AppConfig): string {
  const analysis = safeAnalyzeVacancyCard(vacancy);
  const statusLine = formatVacancyStatusLine(vacancy);
  const hiddenReasonLine = formatHiddenReasonLine(vacancy);
  const applicationLines = formatVacancyApplicationLines(vacancy, config, false);
  const duplicateCount = vacancy.duplicatePostsTotal ?? vacancy.duplicatePosts?.length ?? 0;
  const warningLine = formatWarningLine(analysis);
  const unknownsLine = formatCriticalUnknownsLine(analysis);
  const lines = [
    `🔥 ${normalizeDisplayTitle(analysis.displayTitle)}`,
    ...formatDetailFactLines(analysis),
    ...(warningLine ? ["", warningLine] : []),
    ...(unknownsLine ? [unknownsLine] : []),
    ...(analysis.reliableFactCount < 3 ? [`📝 ${buildCompactVacancyExcerpt(vacancy)}`] : []),
    "",
    formatReadableMatchContext(vacancy, analysis),
    formatVacancyMetaLine(vacancy, config),
    ...(statusLine ? [statusLine] : []),
    ...(hiddenReasonLine ? [hiddenReasonLine] : []),
    ...applicationLines,
    ...(vacancy.contacts.length > 0 ? [`📬 ${formatContacts(vacancy.contacts, 4)}`] : []),
    ...(duplicateCount > 0 ? [`🔁 Дубли: ${duplicateCount}`] : [])
  ];

  return lines.filter((line, index) => line !== "" || lines[index - 1] !== "").join("\n").trim();
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function fitFullVacancyNotification(prefix: string, description: string): string {
  const normalizedDescription = normalizeReadableText(description);
  const complete = `${prefix}${normalizedDescription}`;
  if (codePointLength(complete) <= TELEGRAM_SAFE_MESSAGE_LENGTH) {
    return complete;
  }

  const notice = `\n\n${FULL_TEXT_TRUNCATED_NOTICE}`;
  const availableDescriptionLength = TELEGRAM_SAFE_MESSAGE_LENGTH - codePointLength(prefix) - codePointLength(notice);
  if (availableDescriptionLength > 20) {
    return `${prefix}${shorten(normalizedDescription, availableDescriptionLength)}${notice}`;
  }

  return `${shorten(prefix, TELEGRAM_SAFE_MESSAGE_LENGTH - codePointLength(notice))}${notice}`;
}

function formatFullVacancyNotification(vacancy: VacancyMessageRecord, config: AppConfig): string {
  const analysis = safeAnalyzeVacancyCard(vacancy);
  const statusLine = formatVacancyStatusLine(vacancy);
  const hiddenReasonLine = formatHiddenReasonLine(vacancy);
  const applicationLines = formatVacancyApplicationLines(vacancy, config, true);
  const duplicatePostLines = formatVacancyDuplicatePostLines(vacancy, config);
  const warningLine = formatWarningLine(analysis);
  const unknownsLine = formatCriticalUnknownsLine(analysis);
  const lines = [
    "📄 Полный текст вакансии",
    "",
    `🧾 ${normalizeDisplayTitle(analysis.displayTitle)}`,
    ...formatDetailFactLines(analysis),
    ...(warningLine ? ["", warningLine] : []),
    ...(unknownsLine ? [unknownsLine] : []),
    "",
    ...formatDetailedMatchContext(vacancy, analysis),
    formatVacancyMetaLine(vacancy, config),
    ...(statusLine ? [statusLine] : []),
    ...(hiddenReasonLine ? [hiddenReasonLine] : []),
    ...applicationLines,
  ];

  if (vacancy.contacts.length > 0) {
    lines.push(`📬 ${formatContacts(vacancy.contacts, 5)}`);
  }

  if (countExternalUrls(vacancy.contacts) > 0) {
    lines.push(`🔗 Внешние ссылки: ${countExternalUrls(vacancy.contacts)}`);
  }

  if (vacancy.canonicalUrl && vacancy.canonicalUrl !== vacancy.url) {
    lines.push(`🔗 Подробное описание: ${vacancy.canonicalUrl}`);
  }

  if (duplicatePostLines.length > 0) {
    lines.push("", ...duplicatePostLines);
  }

  return fitFullVacancyNotification(`${lines.join("\n")}\n\n📝 Описание:\n`, vacancy.text);
}

function formatVacancyListCard(
  vacancy: VacancyMessageRecord,
  config: AppConfig,
  position: number
): string {
  const analysis = safeAnalyzeVacancyCard(vacancy);
  const statusLine = formatVacancyStatusLine(vacancy);
  const hiddenReasonLine = formatHiddenReasonLine(vacancy);
  const title = analysis.details.company
    ? `${normalizeDisplayTitle(analysis.displayTitle)} · ${formatExtractedDetail(analysis.details.company)}`
    : normalizeDisplayTitle(analysis.displayTitle);
  const factLines = formatWeeklyFactLines(analysis);
  const fallbackLine = analysis.reliableFactCount < 2 ? `📝 ${buildVacancyExcerpt(vacancy)}` : null;

  return [
    `${position}. ${title}`,
    ...factLines,
    ...(fallbackLine ? [fallbackLine] : []),
    formatReadableMatchContext(vacancy, analysis),
    formatVacancyMetaLine(vacancy, config),
    ...(statusLine ? [statusLine] : []),
    ...(hiddenReasonLine ? [hiddenReasonLine] : []),
  ].join("\n");
}

function joinVacancyCards(cards: string[]): string {
  return cards.join(`\n${VACANCY_CARD_SEPARATOR}\n`);
}

function searchProfileSectionLabel(section: SearchProfileSectionKey): string {
  switch (section) {
    case "required_context":
      return "Условия и формат";
    case "required_primary":
      return "Основной профиль";
    case "preferred":
      return "Желательные сигналы";
    case "exclude":
      return "Стоп-слова";
  }
}

function formatVacancyLanguageModeLabel(mode: VacancyLanguageMode): string {
  switch (mode) {
    case "ru_only":
      return "только русский";
    case "en_only":
      return "только английский";
    default:
      return "русский + английский";
  }
}

function formatVacancyLanguageModeFlags(mode: VacancyLanguageMode): string {
  switch (mode) {
    case "ru_only":
      return "🇷🇺";
    case "en_only":
      return "🇬🇧";
    default:
      return "🇷🇺/🇬🇧";
  }
}

function collectFilledProfileSections(profile: UserSearchProfile): string[] {
  const filledSections: string[] = [];

  if (profile.requiredContextKeywords.length > 0) {
    filledSections.push(searchProfileSectionLabel("required_context"));
  }
  if (profile.requiredPrimaryKeywords.length > 0) {
    filledSections.push(searchProfileSectionLabel("required_primary"));
  }
  if (profile.preferredKeywords.length > 0) {
    filledSections.push(searchProfileSectionLabel("preferred"));
  }
  if (profile.excludeKeywords.length > 0) {
    filledSections.push(searchProfileSectionLabel("exclude"));
  }

  return filledSections;
}

function formatVacancyUserStatus(status: VacancyUserStatus): string | null {
  if (status === "inbox") {
    return null;
  }

  if (status === "saved") {
    return "💾 Сохранено";
  }

  if (status === "applied") {
    return "✅ Откликнулся";
  }

  return "🙈 Скрыто";
}

export function formatStartMessage(_config: AppConfig): string {
  return [
    "👋 Это бот для отслеживания вакансий в Telegram.",
    "",
    "Главные разделы:",
    "• 🗂️ Вакансии за неделю — накопленная подборка",
    "• 🎯 Мои фильтры — поиски, пресеты и стоп-слова",
    "• 📌 Мои вакансии — сохранённые, отклики, скрытые и напоминания",
    "• ⚙️ Настройки — дайджест, уведомления и размер выдачи",
    "",
    "Чтобы начать получать подходящие вакансии, открой «Мои фильтры» и настрой первый поиск."
  ].join("\n");
}

export function formatOnboardingIntroMessage(): string {
  return [
    "👋 Помогу собрать персональную подборку вакансий из Telegram-каналов и других подключённых источников.",
    "",
    "Что ты получишь после настройки:",
    "• новые подходящие вакансии",
    "• подборку вакансий за неделю",
    "• фильтры, которые можно менять в любой момент",
    "",
    "Настройка займёт около минуты."
  ].join("\n");
}

export function formatOnboardingSetupChoiceMessage(): string {
  return [
    "🎯 Выбери, как удобнее настроить первый поиск.",
    "",
    "Можно пойти двумя путями:",
    "• пресет — быстрый старт для типовой роли",
    "• ручная настройка — если хочешь точнее задать профиль",
    "",
    "Позже всё можно поменять в разделе «Мои фильтры» и добавить до пяти отдельных поисков."
  ].join("\n");
}

export function formatOnboardingLanguageMessage(mode: VacancyLanguageMode): string {
  return [
    "🧭 Финальный шаг",
    "",
    "🌐 Какие вакансии показывать в этом поиске?",
    "Выбери язык текущего поиска. Это можно поменять позже в разделе «Мои фильтры».",
    `Сейчас выбрано: ${formatVacancyLanguageModeFlags(mode)} ${formatVacancyLanguageModeLabel(mode)}`
  ].join("\n");
}

export function formatOnboardingCompletionMessage(
  health: SearchProfileHealthReport,
  vacancyLanguageMode: VacancyLanguageMode,
  options: {
    trigger: "configured" | "skipped";
    initialMatchesCount: number;
  } = {
    trigger: "configured",
    initialMatchesCount: 0
  }
): string {
  if (options.trigger === "skipped") {
    return [
      "⏸️ Настройка отложена.",
      "",
      `${formatVacancyLanguageModeFlags(vacancyLanguageMode)} Язык вакансий: ${formatVacancyLanguageModeLabel(vacancyLanguageMode)}`,
      health.summary,
      health.guidance,
      "",
      "Когда будешь готов, открой «Мои фильтры» и заполни первый поиск."
    ].filter((line): line is string => line !== null).join("\n");
  }

  const resultLines = !health.isSearchActive
    ? [
        "🎯 Поиск пока не активен.",
        "Заполни обязательные блоки в «Мои фильтры», и бот сразу пересоберёт подборку."
      ]
    : options.initialMatchesCount > 0
      ? [
          `🎉 Уже найдено вакансий за последние 7 дней: ${options.initialMatchesCount}.`,
          "Первые вакансии покажу следующим сообщением."
        ]
      : [
          "🔎 Поиск активен, но точных совпадений пока нет.",
          "Новые подходящие вакансии придут автоматически. Если захочется расширить выдачу, проверь «Мои фильтры»."
        ];

  return [
    "✅ Первый поиск настроен.",
    "",
    `${formatVacancyLanguageModeFlags(vacancyLanguageMode)} Язык вакансий: ${formatVacancyLanguageModeLabel(vacancyLanguageMode)}`,
    health.summary,
    health.guidance,
    "",
    ...resultLines,
    "",
    "Полезно знать:",
    "• можно создать до пяти отдельных поисков;",
    "• сохраняй интересное, отмечай отклики и скрывай неподходящее;",
    "• всё обработанное потом лежит в «Мои вакансии»;",
    "• на интересную вакансию можно поставить напоминание."
  ].join("\n");
}

export function formatVacancyNotification(
  vacancy: VacancyRecord | MatchedVacancyRecord | UserStatusVacancyRecord,
  config: AppConfig,
  view: VacancyNotificationView = "compact"
): string {
  return view === "full"
    ? formatFullVacancyNotification(vacancy, config)
    : formatCompactVacancyNotification(vacancy, config);
}

export function formatVacancyReminderNotification(
  vacancy: VacancyRecord | MatchedVacancyRecord | UserStatusVacancyRecord,
  config: AppConfig
): string {
  return ["⏰ Напоминание о вакансии", "", formatCompactVacancyNotification(vacancy, config)].join("\n");
}

export function formatApplicationFollowUpNotification(
  followUp: VacancyApplicationFollowUpRecord,
  config: AppConfig
): string {
  const lines = [
    "⏰ Follow-up по отклику",
    "",
    formatCompactVacancyNotification({
      ...followUp,
      userStatus: "applied",
      statusUpdatedAt: null,
      deliveredAt: null,
      matchedAt: followUp.createdAt,
      application: {
        userId: followUp.userId,
        vacancyId: followUp.id,
        appliedAt: followUp.appliedAt,
        note: followUp.note,
        followUpAt: followUp.followUpAt,
        nextAttemptAt: followUp.nextAttemptAt,
        attemptCount: followUp.attemptCount,
        deliveredAt: followUp.deliveredAt,
        cancelledAt: followUp.cancelledAt,
        lastError: followUp.lastError,
        respondedAt: followUp.respondedAt,
        closedAt: followUp.closedAt,
        applicationCreatedAt: followUp.applicationCreatedAt,
        applicationUpdatedAt: followUp.applicationUpdatedAt
      }
    }, config),
    "",
    "Время проверить ответ. Пингануть HR?"
  ];

  return lines.join("\n");
}

export function formatVacancyReminders(page: VacancyReminderPage, config: AppConfig): string {
  const title = "⏰ Напоминания";
  if (page.total === 0) {
    return [title, "", "Активных напоминаний пока нет."].join("\n");
  }

  const cards = page.items.map((reminder: VacancyReminderRecord, index) =>
    [
      `${page.offset + index + 1}. ${normalizeDisplayTitle(reminder.title)}`,
      `🕒 ${formatDate(reminder.remindAt, config.timeZone)}`,
      formatVacancyMetaLine(reminder, config),
      `🔗 ${reminder.url}`
    ].join("\n")
  );

  return [title, "", `Показано: ${page.items.length} из ${page.total}`, "", joinVacancyCards(cards)].join("\n");
}

export interface EmptyCycleNotificationPayload {
  sourceName: string;
  channelsCount: number;
  fetchedItemsCount: number;
  checkedAtIso: string;
}

export interface UserQuietDiagnosticsPayload {
  profile: UserSearchProfile;
  health: SearchProfileHealthReport;
  onboardingCompleted: boolean;
  botPaused: boolean;
  notifyOnEmptyCycle: boolean;
  dailyDigestEnabled: boolean;
  latestDailyDigestDelivery: DailyDigestDeliveryRecord | null;
  hiddenFeedbackSummary: HiddenVacancyFeedbackSummary;
  filterSuggestion: UserFilterSuggestionCandidate | null;
  vacancyLanguageMode: VacancyLanguageMode;
  weeklyMatchesCount: number;
  telegramActiveChannelsCount: number;
  hhSourceEnabled: boolean;
  hhUserEnabled: boolean;
  hhUserQuery: string;
  companyCareersSourceEnabled: boolean;
  companyCareerSourcesCount: number;
  latestPollCycle: {
    sourceName: string;
    fetchedItemsCount: number | null;
    newVacanciesCount: number | null;
    checkedAtIso: string;
  } | null;
}

export function formatNotificationPreferences(notifyOnEmptyCycle: boolean, dailyDigestEnabled = false): string {
  return [
    "🔔 Настройки уведомлений",
    "",
    "Здесь можно настроить два служебных сигнала: утренний дайджест и сообщение о пустой проверке.",
    "",
    `🌅 Утренний дайджест: ${dailyDigestEnabled ? "включён" : "выключен"}`,
    `🔔 Если новых вакансий нет: ${notifyOnEmptyCycle ? "сообщать" : "не сообщать"}`,
    "🕘 Время дайджеста: 09:00"
  ].join("\n");
}

export function formatUserSettingsPanel(notifyOnEmptyCycle: boolean, weeklyPageSize: number, dailyDigestEnabled = false): string {
  return [
    "⚙️ Настройки",
    "",
    "Здесь настраивается поведение бота. Фильтры поиска и списки вакансий вынесены в отдельные разделы главного меню.",
    "",
    `🌅 Утренний дайджест: ${dailyDigestEnabled ? "включён" : "выключен"}`,
    `🔔 Если новых вакансий нет: ${notifyOnEmptyCycle ? "сообщать" : "не сообщать"}`,
    `📄 В недельной выдаче: ${weeklyPageSize} вакансии`
  ].join("\n");
}

export function formatMyVacanciesPanel(): string {
  return [
    "📌 Мои вакансии",
    "",
    "Здесь собраны списки вакансий, с которыми ты уже что-то сделал: сохранил, откликнулся, скрыл или поставил напоминание."
  ].join("\n");
}

export function formatDailyDigestNotification(payload: DailyDigestPayload): string {
  const lines = ["Сегодня:"];

  if (payload.newVacanciesCount > 0) {
    lines.push(`🔥 ${payload.newVacanciesCount} новых вакансий`);
  }
  if (payload.savedWithoutActionCount > 0) {
    lines.push(`💾 ${payload.savedWithoutActionCount} сохранённых без действия`);
  }
  if (payload.dueApplicationFollowUpsCount > 0) {
    lines.push(`⏰ ${payload.dueApplicationFollowUpsCount} откликов ждут follow-up`);
  }
  if (payload.hiddenLastDayCount > 0) {
    lines.push(`🙈 ${payload.hiddenLastDayCount} скрыто за сутки`);
  }

  if (payload.hiddenLastDayCount > 0 && payload.hiddenReasonTop?.length) {
    lines.push(`Чаще всего: ${payload.hiddenReasonTop.map((item) => HIDDEN_VACANCY_REASON_LABELS[item.reason]).join(", ")}`);
  }

  return lines.join("\n");
}

function formatDiagnosticsStatus(value: boolean): string {
  return value ? "да" : "нет";
}

function formatDiagnosticsCount(value: number): string {
  return Number.isFinite(value) ? String(value) : "0";
}

function formatDailyDigestDeliveryStatus(delivery: DailyDigestDeliveryRecord | null, timeZone: string): string {
  if (!delivery) {
    return "ещё не было";
  }
  if (delivery.deliveredAt) {
    return `доставлен ${formatTime(delivery.deliveredAt, timeZone)}`;
  }
  if (delivery.skippedAt) {
    return `пропущен ${formatTime(delivery.skippedAt, timeZone)}`;
  }
  if (delivery.lastError) {
    return `ошибка: ${delivery.lastError}`;
  }
  return `запланирован на ${delivery.scheduledFor}`;
}

function formatHiddenFeedbackSummary(summary: HiddenVacancyFeedbackSummary): string {
  if (summary.totalHidden === 0) {
    return "за 7 дней скрытых вакансий нет";
  }

  const topReasons = summary.topReasons.length > 0
    ? summary.topReasons.map((item) => `${HIDDEN_VACANCY_REASON_LABELS[item.reason]}: ${item.count}`).join(", ")
    : "причины пока не указаны";
  return `${summary.totalHidden} за 7 дней; причины: ${topReasons}; без причины: ${summary.withoutReason}`;
}

function formatFilterSuggestion(candidate: UserFilterSuggestionCandidate | null | undefined): string | null {
  if (!candidate) {
    return null;
  }

  return `💡 Подсказка по фильтрам: ${FILTER_SUGGESTION_LABELS[candidate.suggestionKey]}`;
}

function buildQuietDiagnosticsHints(payload: UserQuietDiagnosticsPayload): string[] {
  const hints: string[] = [];
  if (payload.hiddenFeedbackSummary.totalHidden > 0) {
    hints.push(`Скрытые: ${formatHiddenFeedbackSummary(payload.hiddenFeedbackSummary)}`);
  }
  const filterSuggestion = formatFilterSuggestion(payload.filterSuggestion);
  if (filterSuggestion) {
    hints.push(filterSuggestion);
  }

  if (!payload.onboardingCompleted) {
    hints.push("завершить онбординг, чтобы поиск стал предсказуемым");
  }
  if (payload.botPaused) {
    hints.push("бот сейчас на паузе; владелец может включить его в админке");
  }
  if (!payload.health.isSearchActive) {
    hints.push("заполнить обязательные блоки в «Мои фильтры»");
  }
  if (payload.telegramActiveChannelsCount === 0 && !payload.hhUserEnabled && payload.companyCareerSourcesCount === 0) {
    hints.push("добавить хотя бы один источник вакансий");
  }
  if (payload.hhUserEnabled && payload.hhUserQuery.trim().length === 0) {
    hints.push("задать текст запроса для hh.ru или выключить hh.ru");
  }
  if (payload.weeklyMatchesCount === 0 && payload.health.isSearchActive) {
    hints.push("если профиль слишком строгий, ослабить обязательные условия или добавить каналы");
  }
  if (!payload.latestPollCycle) {
    hints.push("дождаться первого цикла проверки после запуска бота");
  } else if ((payload.latestPollCycle.fetchedItemsCount ?? 0) === 0) {
    hints.push("последний цикл не принёс новых постов из источников");
  }

  return hints.length > 0 ? hints : ["критичных причин молчания не видно; можно открыть недельную подборку или немного подождать следующий цикл"];
}

export function formatUserQuietDiagnostics(
  payload: UserQuietDiagnosticsPayload,
  config: AppConfig
): string {
  const filledSections = collectFilledProfileSections(payload.profile);
  const missingRequired = payload.health.missingRequiredSections.map(searchProfileSectionLabel);
  const latestPoll = payload.latestPollCycle;
  const hints = buildQuietDiagnosticsHints(payload);

  return [
    "🩺 Почему бот может молчать",
    "",
    "Профиль:",
    `• Онбординг завершён: ${formatDiagnosticsStatus(payload.onboardingCompleted)}`,
    `• Поиск активен: ${formatDiagnosticsStatus(payload.health.isSearchActive)}`,
    `• Статус: ${payload.health.summary}`,
    `• Заполнено: ${filledSections.length > 0 ? filledSections.join(", ") : "ничего"}`,
    `• Не хватает: ${missingRequired.length > 0 ? missingRequired.join(", ") : "ничего"}`,
    `• Язык: ${formatVacancyLanguageModeFlags(payload.vacancyLanguageMode)} ${formatVacancyLanguageModeLabel(payload.vacancyLanguageMode)}`,
    "",
    "Источники:",
    `• Бот на паузе: ${formatDiagnosticsStatus(payload.botPaused)}`,
    `• Telegram-каналы: ${formatDiagnosticsCount(payload.telegramActiveChannelsCount)}`,
    `• hh.ru: ${payload.hhSourceEnabled ? "источник включён" : "источник выключен"}; личный поиск: ${payload.hhUserEnabled ? "включён" : "выключен"}`,
    `• Company sites: ${payload.companyCareersSourceEnabled ? "источник включён" : "источник выключен"}; активных сайтов: ${formatDiagnosticsCount(payload.companyCareerSourcesCount)}`,
    "",
    "Текущая выдача:",
    `• Вакансий в недельной подборке: ${formatDiagnosticsCount(payload.weeklyMatchesCount)}`,
    `• Уведомление «ничего нового»: ${payload.notifyOnEmptyCycle ? "включено" : "выключено"}`,
    `• Ежедневный дайджест: ${payload.dailyDigestEnabled ? "включён" : "выключен"}`,
    `• Последний дайджест: ${formatDailyDigestDeliveryStatus(payload.latestDailyDigestDelivery, config.timeZone)}`,
    "",
    "Последний цикл:",
    latestPoll
      ? `• ${latestPoll.sourceName} в ${formatTime(latestPoll.checkedAtIso, config.timeZone)}: просмотрено ${latestPoll.fetchedItemsCount ?? "?"}, новых вакансий ${latestPoll.newVacanciesCount ?? "?"}`
      : "• данных пока нет",
    "",
    "Что попробовать:",
    ...hints.map((hint) => `• ${hint}`)
  ].join("\n");
}

export function formatNoNewVacanciesNotification(
  payload: EmptyCycleNotificationPayload,
  config: AppConfig
): string {
  return [
    "📭 Новых вакансий не найдено",
    "",
    `📡 Источник: ${payload.sourceName}`,
    `📣 Проверено каналов: ${payload.channelsCount}`,
    `🧾 Просмотрено постов: ${payload.fetchedItemsCount}`,
    `🕒 Время проверки: ${formatTime(payload.checkedAtIso, config.timeZone)}`,
    "",
    "Если хочешь посмотреть накопленную подборку, открой «Вакансии за неделю»."
  ].join("\n");
}

export function formatBlockedWeeklyAccess(
  profile: UserSearchProfile,
  health: SearchProfileHealthReport
): string {
  const filledSections = collectFilledProfileSections(profile);
  const missingRequired = health.missingRequiredSections.map(searchProfileSectionLabel);

  return [
    "🗂️ Вакансии за неделю пока недоступны",
    "",
    health.summary,
    ...(health.guidance ? [health.guidance] : []),
    "",
    "У вас заполнено:",
    ...(filledSections.length > 0 ? filledSections.map((section) => `• ${section}`) : ["• Пока ничего"]),
    "",
    "Нужно заполнить:",
    ...(missingRequired.length > 0 ? missingRequired.map((section) => `• ${section}`) : ["• Ничего, профиль уже готов"]),
    "",
    "Перейдите в «Мои фильтры», чтобы настроить профиль."
  ].join("\n");
}

export function formatWeeklyVacancies(
  page: WeeklyVacancyPage | UserWeeklyVacancyPage,
  config: AppConfig,
  profileName?: string,
  zeroStateContext?: WeeklyZeroStateContext
): string {
  const days = normalizeWeeklyWindowDays(zeroStateContext?.days);
  const windowLabel = days === DEFAULT_WEEKLY_WINDOW_DAYS ? "за неделю" : `за ${days} дней`;
  const heading = profileName ? `🗂️ Вакансии: ${profileName} (${windowLabel})` : `🗂️ Вакансии ${windowLabel}`;
  if (page.total === 0) {
    return formatWeeklyZeroState(page, heading, { ...zeroStateContext, days });
  }

  const lines = [
    heading,
    "",
    `Показано: ${page.items.length} из ${page.total}`,
    "Нажми номер вакансии, чтобы открыть карточку."
  ];

  const cards = page.items.map((vacancy, index) =>
    formatVacancyListCard(vacancy, config, page.offset + index + 1)
  );

  lines.push("", joinVacancyCards(cards));

  return lines.join("\n");
}

const REJECTION_REASON_LABELS: Record<VacancyRejectionReason, string> = {
  candidate_post: "посты были похожи на резюме кандидатов",
  language: "не подошёл выбранный язык вакансий",
  stop_words: "сработали стоп-слова",
  missing_context: "не совпали условия или формат работы",
  missing_primary: "не совпал основной профиль",
  preferred_signals: "не нашлись желательные сигналы"
};

export function getWeeklyTopRejectionReasons(
  summary: UserVacancyRematchSummary | null | undefined,
  profileId?: number
): VacancyRejectionReason[] {
  if (!summary) {
    return [];
  }

  const diagnostics = profileId
    ? summary.profileDiagnostics.filter((diagnostic) => diagnostic.profileId === profileId)
    : summary.profileDiagnostics;
  const totals = new Map<VacancyRejectionReason, number>();

  for (const diagnostic of diagnostics) {
    for (const [reason, count] of Object.entries(diagnostic.rejectionReasons)) {
      if (count && count > 0) {
        const typedReason = reason as VacancyRejectionReason;
        totals.set(typedReason, (totals.get(typedReason) ?? 0) + count);
      }
    }
  }

  return [...totals.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([reason]) => reason);
}

export function getWeeklyEvaluatedVacancies(
  summary: UserVacancyRematchSummary | null | undefined,
  profileId?: number
): number | null {
  if (!summary) {
    return null;
  }

  if (!profileId) {
    return summary.evaluatedVacancies;
  }

  return summary.profileDiagnostics.find((diagnostic) => diagnostic.profileId === profileId)?.evaluatedVacancies ?? null;
}

export function getWeeklyZeroStateKind(
  page: WeeklyVacancyPage | UserWeeklyVacancyPage,
  summary?: UserVacancyRematchSummary | null,
  profileId?: number
): WeeklyZeroStateKind {
  if ("hiddenMatchedTotal" in page && (page.hiddenMatchedTotal ?? 0) > 0) {
    return "hidden";
  }

  const evaluatedVacancies = getWeeklyEvaluatedVacancies(summary, profileId);
  if (evaluatedVacancies === 0) {
    return "no_source_data";
  }
  if (evaluatedVacancies !== null) {
    return "no_matches";
  }
  return "diagnostics_unavailable";
}

function formatWeeklyZeroState(
  page: WeeklyVacancyPage | UserWeeklyVacancyPage,
  heading: string,
  context?: WeeklyZeroStateContext
): string {
  const summary = context?.rematchSummary;
  const profileId = context?.profileId;
  const days = normalizeWeeklyWindowDays(context?.days);
  const periodLabel = days === DEFAULT_WEEKLY_WINDOW_DAYS ? "последние 7 дней" : `последние ${days} дней`;
  const kind = getWeeklyZeroStateKind(page, summary, profileId);

  if (kind === "hidden") {
    return [
      heading,
      "",
      `🙈 Подходящие вакансии найдены, но сейчас они находятся в «Скрытых»: ${"hiddenMatchedTotal" in page ? page.hiddenMatchedTotal ?? 0 : 0}.`,
      "Можно вернуть нужные вакансии в обычный поток.",
      "",
      "Новые совпадения продолжат приходить автоматически."
    ].join("\n");
  }

  const evaluatedVacancies = getWeeklyEvaluatedVacancies(summary, profileId);
  if (kind === "no_source_data") {
    return [
      heading,
      "",
      `Источники пока не накопили вакансий за ${periodLabel}, которые можно проверить для этого поиска.`,
      "",
      "Поиск активен. Новые совпадения придут автоматически."
    ].join("\n");
  }

  if (kind === "no_matches" && evaluatedVacancies !== null) {
    const activeProfiles = context?.activeProfiles ?? [];
    const selectedProfile = profileId ? activeProfiles.find((profile) => profile.id === profileId) : null;
    const profileLine = selectedProfile
      ? `🎯 Поиск: ${selectedProfile.name}`
      : `🎯 Активных поисков: ${activeProfiles.length}`;
    const reasons = getWeeklyTopRejectionReasons(summary, profileId);

    return [
      heading,
      "",
      `Точных совпадений за ${periodLabel} пока нет.`,
      `🧾 Проверено вакансий: ${evaluatedVacancies}`,
      profileLine,
      ...(reasons.length > 0
        ? ["", "Чаще всего вакансии не проходили из-за:", ...reasons.map((reason) => `• ${REJECTION_REASON_LABELS[reason]}`)]
        : []),
      "",
      "Можно скорректировать поиск или выбрать дополнительный пресет.",
      "Новые совпадения продолжат приходить автоматически."
    ].join("\n");
  }

  return [
    heading,
    "",
    `Точных совпадений за ${periodLabel} пока нет.`,
    "Диагностика этой проверки временно недоступна.",
    "",
    "Поиск активен. Новые совпадения придут автоматически."
  ].join("\n");
}

export interface StartupDiagnosticPayload {
  host: string;
  sourceMode: string;
  sourceName: string;
  channelsCount: number;
  checkIntervalSeconds: number;
  databaseUrl: string;
  totalVacancies: number;
  weeklyVacancies: number;
  telegramSessionLoaded: boolean;
}

export function formatStartupDiagnostic(payload: StartupDiagnosticPayload): string {
  return [
    "🛠️ Служебное сообщение: бот запущен.",
    "",
    `💻 Хост: ${payload.host}`,
    `📡 Режим источника: ${payload.sourceMode}`,
    `🧩 Адаптер: ${payload.sourceName}`,
    `📣 Активных каналов: ${payload.channelsCount}`,
    `⏱️ Интервал проверки: ${payload.checkIntervalSeconds} с`,
    `🗄️ База данных: ${payload.databaseUrl}`,
    `🗂️ Вакансий за неделю: ${payload.weeklyVacancies}`,
    `📦 Всего вакансий: ${payload.totalVacancies}`,
    `🔐 Сессия Telegram: ${payload.telegramSessionLoaded ? "загружена" : "не загружена"}`
  ].join("\n");
}

export function formatChannelHealthAlert(alert: ChannelHealthAlert, config: AppConfig): string {
  if (alert.kind === "failure") {
    return [
      "🚨 Проблема с каналом",
      "",
      `📣 Канал: @${alert.channel.username}`,
      `📡 Источник: ${alert.channel.sourceName}`,
      `🕒 Последняя проверка: ${formatDate(alert.channel.lastCheckedAt, config.timeZone)}`,
      `✅ Последний успешный проход: ${formatDate(alert.channel.lastSuccessAt, config.timeZone)}`,
      "",
      `Ошибка: ${alert.errorMessage}`
    ].join("\n");
  }

  const staleMinutes = Math.max(1, Math.round(alert.staleForMs / 60_000));
  const thresholdMinutes = Math.max(1, Math.round(alert.staleThresholdMs / 60_000));

  return [
    "⚠️ Канал давно не обновлялся",
    "",
    `📣 Канал: @${alert.channel.username}`,
    `📡 Источник: ${alert.channel.sourceName}`,
    `✅ Последний успешный проход: ${formatDate(alert.channel.lastSuccessAt, config.timeZone)}`,
    `🕒 Последняя проверка: ${formatDate(alert.channel.lastCheckedAt, config.timeZone)}`,
    "",
    `Канал без успешного чтения уже около ${staleMinutes} мин.`,
    `Порог алерта: ${thresholdMinutes} мин.`
  ].join("\n");
}

export function formatSourcePollFailureAlert(sourceName: string, error: unknown, config: AppConfig): string {
  const errorMessage = error instanceof Error ? error.message : String(error);

  return [
    "⚠️ Ошибка источника вакансий",
    "",
    `📡 Источник: ${sourceName}`,
    `🧾 Причина: ${errorMessage}`,
    `🕒 Время: ${formatTime(new Date().toISOString(), config.timeZone)}`,
    "",
    "Бот продолжает работать; следующий цикл попробует источник снова."
  ].join("\n");
}

export function formatPublicUserRegistrationAlert(
  payload: PublicUserRegistrationAlertPayload,
  config: AppConfig
): string {
  const displayName = [payload.telegramFirstName, payload.telegramLastName].filter(Boolean).join(" ").trim();
  const username = payload.telegramUsername?.trim();

  return [
    "👤 Новый пользователь в боте",
    "",
    `🆔 Telegram ID: ${payload.user.userId}`,
    ...(username ? [`🔤 Username: @${username}`] : []),
    ...(displayName ? [`👋 Имя: ${displayName}`] : []),
    `🎭 Роль: ${payload.user.role}`,
    `🕒 Зарегистрирован: ${formatTime(payload.registeredAtIso ?? payload.user.createdAt, config.timeZone)}`,
    "",
    "Управление доступом: /admin -> Пользователи"
  ].join("\n");
}

export function formatBackupExportCaption(payload: {
  createdAt: string;
  fileName: string;
  sizeBytes: number;
  activeChannels: number;
  totalVacancies: number;
  activeUsers: number;
}): string {
  return [
    "📦 Резервная копия готова",
    "",
    `Файл: ${payload.fileName}`,
    `Размер: ${formatBytes(payload.sizeBytes)}`,
    `Создано: ${payload.createdAt}`,
    "",
    `📣 Активных каналов: ${payload.activeChannels}`,
    `👥 Активных пользователей: ${payload.activeUsers}`,
    `🗂️ Всего вакансий: ${payload.totalVacancies}`
  ].join("\n");
}

export function formatUserVacancyRematchSummary(summary: UserVacancyRematchSummary): string {
  return [
    "🔄 Подборка обновлена",
    "",
    `🗓️ Окно пересборки: ${summary.windowDays} дн.`,
    `🧾 Проверено вакансий: ${summary.evaluatedVacancies}`,
    `🎯 Сейчас подходит: ${summary.totalMatched}`,
    `➕ Новых совпадений: ${summary.created}`,
    `♻️ Обновлено совпадений: ${summary.updated}`,
    `➖ Убрано из подборки: ${summary.removed}`,
    "",
    summary.profileStatus === "ready"
      ? "Профиль готов к поиску. Можешь открыть вакансии за неделю и проверить обновлённую подборку."
      : summary.profileStatus === "weak"
        ? "Подборка пересчитана, но профиль всё ещё настроен не полностью. Если хочешь больше точности, заполни обязательные блоки."
        : "Подборка очищена, потому что профиль пока не активен. Заполни фильтры или выбери пресет, чтобы бот снова подбирал вакансии."
  ].join("\n");
}

export function formatStatusVacancies(
  page: UserStatusVacancyPage,
  config: AppConfig
): string {
  const title =
    page.status === "saved"
      ? "💾 Сохранённые вакансии"
      : page.status === "applied"
        ? "✅ Откликнулся"
        : "🙈 Скрытые вакансии";

  if (page.total === 0) {
    return [title, "", "Пока здесь пусто."].join("\n");
  }

  const lines = [title, "", `Показано: ${page.items.length} из ${page.total}`];

  const cards = page.items.map((vacancy, index) =>
    formatVacancyListCard(vacancy, config, page.offset + index + 1)
  );

  lines.push("", joinVacancyCards(cards));

  return lines.join("\n");
}

export function formatApplicationStatusPage(
  page: UserVacancyApplicationPage,
  config: AppConfig
): string {
  const title = "✅ Отклики";
  if (page.total === 0) {
    return [title, "", "Пока здесь пусто."].join("\n");
  }

  const summary = [
    `Всего: ${page.summary.total}`,
    `Ждут follow-up: ${page.summary.waitingFollowUp}`,
    `Follow-up отправлен: ${page.summary.sentFollowUp}`,
    `Закрыты/ответили: ${page.summary.closedOrResponded}`
  ].join("\n");

  const cards = page.items.map((application, index) => {
    const noteMarker = application.application.note ? " · 📝" : "";
    return [
      `${page.offset + index + 1}. ${normalizeDisplayTitle(application.title)}`,
      `✅ Отклик: ${formatDate(application.application.appliedAt, config.timeZone)}`,
      `⏰ ${formatApplicationFollowUpState(application.application, config)}${noteMarker}`,
      formatVacancyMetaLine(application, config)
    ].join("\n");
  });

  return [
    title,
    "",
    summary,
    "",
    `Показано: ${page.items.length} из ${page.total}`,
    "",
    joinVacancyCards(cards)
  ].join("\n");
}

export function formatApplicationDetail(
  application: UserVacancyApplicationRecord,
  config: AppConfig
): string {
  const compactCard = formatCompactVacancyNotification(application, config);
  const noteLines = application.application.note
    ? ["", `📝 Заметка:\n${application.application.note}`]
    : ["", "📝 Заметка: не добавлена"];

  return [
    "✅ Отклик",
    "",
    compactCard,
    "",
    `✅ Откликнулся: ${formatDate(application.application.appliedAt, config.timeZone)}`,
    `⏰ ${formatApplicationFollowUpState(application.application, config)}`,
    ...noteLines
  ].join("\n");
}
