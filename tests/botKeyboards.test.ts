import assert from "node:assert/strict";
import test from "node:test";

import {
  createApplicationDetailKeyboard,
  createApplicationFollowUpDeliveryKeyboard,
  createApplicationFollowUpPromptKeyboard,
  createApplicationStatusPageKeyboard,
  createDailyDigestKeyboard,
  createDiagnosticsKeyboardWithSuggestion,
  createHiddenVacancyReceiptKeyboard,
  createHiddenReasonKeyboard,
  createMainKeyboard,
  createMyVacanciesKeyboard,
  createNotificationsKeyboard,
  createSearchProfileDetailKeyboard,
  createUserSettingsKeyboardWithStatuses,
  createVacancyKeyboardWithActions,
  createVacancyReminderKeyboard,
  createWeeklyReturnKeyboard,
  createWeeklyKeyboard,
  createWeeklyZeroStateKeyboard
} from "../src/bot/keyboards";
import type { DailyDigestPayload, MatchedVacancyRecord, UserFilterSuggestionCandidate, UserSearchProfileRecord, UserVacancyApplicationRecord, UserVacancyApplicationPage, UserWeeklyVacancyPage } from "../src/types";

type InlineButton = {
  text: string;
  callback_data?: string;
  url?: string;
};

function rows(keyboard: unknown): InlineButton[][] {
  return (keyboard as { inline_keyboard?: InlineButton[][] }).inline_keyboard ?? [];
}

function callbacks(keyboard: unknown): string[] {
  return rows(keyboard)
    .flat()
    .map((button) => button.callback_data)
    .filter((value): value is string => typeof value === "string");
}

function urls(keyboard: unknown): string[] {
  return rows(keyboard)
    .flat()
    .map((button) => button.url)
    .filter((value): value is string => typeof value === "string");
}

function createMatchedVacancy(overrides: Partial<MatchedVacancyRecord> = {}): MatchedVacancyRecord {
  return {
    id: 42,
    sourceName: "telegram_web_preview",
    sourceChannel: "job_react",
    sourceMessageId: "42",
    messageDate: "2026-06-16T10:00:00.000Z",
    title: "Frontend Developer",
    text: "Frontend Developer remote react typescript @hr",
    normalizedText: "frontend developer remote react typescript @hr",
    url: "https://t.me/job_react/42",
    canonicalUrl: null,
    fingerprint: "fingerprint-42",
    score: 10,
    matchSummary: "react, typescript",
    matchedKeywords: ["react"],
    contacts: [{ type: "telegram", value: "@hr" }],
    sentToOwnerAt: null,
    createdAt: "2026-06-16T10:00:00.000Z",
    userId: "777",
    deliveredAt: null,
    matchedAt: "2026-06-16T10:00:00.000Z",
    userStatus: "inbox",
    statusUpdatedAt: null,
    matchedProfileIds: [1],
    matchedProfileNames: ["Основной поиск"],
    ...overrides
  };
}

function createWeeklyPage(overrides: Partial<UserWeeklyVacancyPage> = {}): UserWeeklyVacancyPage {
  const items = [
    createMatchedVacancy({ id: 1, url: "https://t.me/job_react/1" }),
    createMatchedVacancy({ id: 2, url: "https://t.me/job_react/2" }),
    createMatchedVacancy({ id: 3, url: "https://t.me/job_react/3" })
  ];

  return {
    items,
    total: 9,
    offset: 0,
    pageSize: 3,
    hiddenMatchedTotal: 0,
    ...overrides
  };
}

function createApplicationRecord(overrides: Partial<UserVacancyApplicationRecord> = {}): UserVacancyApplicationRecord {
  const base = createMatchedVacancy({ userStatus: "applied" });
  return {
    ...base,
    userStatus: "applied",
    statusUpdatedAt: "2026-06-16T10:00:00.000Z",
    isCurrentlyMatched: true,
    application: {
      userId: "777",
      vacancyId: base.id,
      appliedAt: "2026-06-16T10:00:00.000Z",
      note: "Short note",
      followUpAt: "2026-06-19T10:00:00.000Z",
      nextAttemptAt: "2026-06-19T10:00:00.000Z",
      attemptCount: 0,
      deliveredAt: null,
      cancelledAt: null,
      lastError: null,
      respondedAt: null,
      closedAt: null,
      applicationCreatedAt: "2026-06-16T10:00:00.000Z",
      applicationUpdatedAt: "2026-06-16T10:00:00.000Z"
    },
    ...overrides
  };
}

function createApplicationPage(overrides: Partial<UserVacancyApplicationPage> = {}): UserVacancyApplicationPage {
  const items = [
    createApplicationRecord({ id: 1, url: "https://t.me/job_react/1" }),
    createApplicationRecord({ id: 2, url: "https://t.me/job_react/2" })
  ];

  return {
    items,
    offset: 0,
    pageSize: 5,
    total: 2,
    summary: {
      total: 2,
      waitingFollowUp: 1,
      sentFollowUp: 0,
      closedOrResponded: 0
    },
    ...overrides
  };
}

function createSearchProfile(overrides: Partial<UserSearchProfileRecord> = {}): UserSearchProfileRecord {
  return {
    id: 7,
    userId: "777",
    name: "Основной поиск",
    isActive: true,
    vacancyLanguageMode: "ru_en",
    requiredContextKeywords: ["remote"],
    requiredPrimaryKeywords: ["react"],
    preferredKeywords: ["typescript"],
    excludeKeywords: ["junior"],
    sortOrder: 0,
    createdAt: "2026-06-16T10:00:00.000Z",
    updatedAt: "2026-06-16T10:00:00.000Z",
    ...overrides
  };
}

test("main keyboard no longer has duplicate applications entry", () => {
  const data = callbacks(createMainKeyboard(false, true, true));

  assert.ok(data.includes("week:0"));
  assert.ok(!data.includes("status:applied:0"), "applications accessible only via Мои вакансии");
  assert.ok(data.includes("menu:vacancies"));
  assert.ok(data.includes("menu:filters"));
  assert.ok(data.includes("menu:settings"));
  assert.ok(!data.includes("status:hidden:0"));
});

test("my vacancies keyboard keeps applications entry", () => {
  const data = callbacks(createMyVacanciesKeyboard());

  assert.ok(data.includes("status:applied:0"));
  assert.ok(data.includes("status:saved:0"));
  assert.ok(data.includes("status:hidden:0"));
  assert.ok(data.includes("reminders:page:0"));
  assert.ok(data.includes("menu:home"));
});

test("vacancy action keyboard keeps only vacancy-scoped actions", () => {
  const keyboard = createVacancyKeyboardWithActions(createMatchedVacancy(), true, "compact");
  const data = callbacks(keyboard);

  assert.deepEqual(urls(keyboard), ["https://t.me/job_react/42"]);
  assert.ok(data.includes("vacancy:view:42:full"));
  assert.ok(data.includes("vacancy:remind:42:compact"));
  assert.ok(data.includes("vacancy:status:42:saved:compact"));
  assert.ok(data.includes("vacancy:status:42:applied:compact"));
  assert.ok(data.includes("vacancy:status:42:hidden:compact"));
  assert.ok(!data.includes("week:0"));
  assert.ok(!data.includes("menu:filters"));
  assert.ok(!data.includes("menu:settings"));
  assert.ok(!data.includes("menu:home"));
  assert.ok(!data.includes("status:applied:0"));
});

test("vacancy action keyboard preserves origin suffix", () => {
  const keyboard = createVacancyKeyboardWithActions(createMatchedVacancy(), true, "compact", { offset: 6, profileId: 7 });
  const data = callbacks(keyboard);

  assert.ok(data.includes("vacancy:view:42:full:p7.6"));
  assert.ok(data.includes("vacancy:remind:42:compact:p7.6"));
  assert.ok(data.includes("vacancy:status:42:saved:compact:p7.6"));
  assert.ok(data.includes("vacancy:status:42:applied:compact:p7.6"));
  assert.ok(data.includes("vacancy:status:42:hidden:compact:p7.6"));
  assert.ok(data.includes("week:profile:7:6"));
});

test("hidden vacancy card offers restore instead of deleting again", () => {
  const keyboard = createVacancyKeyboardWithActions(createMatchedVacancy({ userStatus: "hidden" }), true);

  assert.ok(callbacks(keyboard).includes("vacancy:status:42:hidden:compact"));
});

test("applied vacancy uses application follow-up prompt instead of ordinary reminder", () => {
  const keyboard = createVacancyKeyboardWithActions(createMatchedVacancy({ userStatus: "applied" }), true, "compact");
  const data = callbacks(keyboard);

  assert.ok(data.includes("application:followup:42:compact"));
  assert.ok(!data.includes("vacancy:remind:42:compact"));
  assert.ok(data.includes("vacancy:status:42:applied:compact"));
  assert.ok(data.includes("status:applied:0"));
});

test("application follow-up prompt has schedule, note, skip and back actions", () => {
  const keyboard = createApplicationFollowUpPromptKeyboard(42, "compact", { offset: 3 });

  assert.deepEqual(callbacks(keyboard), [
    "application:followup:set:42:three_days:compact:w3",
    "application:followup:set:42:week:compact:w3",
    "application:note:42:compact:w3",
    "application:followup:skip:42:compact:w3",
    "vacancy:view:42:compact:w3",
    "status:applied:0",
    "week:3"
  ]);
});

test("vacancy reminder prompt preserves return to weekly origin", () => {
  const data = callbacks(createVacancyReminderKeyboard(42, "compact", false, { offset: 3 }));

  assert.ok(data.includes("vacancy:remind:set:42:evening:compact:w3"));
  assert.ok(data.includes("vacancy:view:42:compact:w3"));
  assert.ok(data.includes("week:3"));
});

test("application follow-up prompt exposes one-minute debug only when requested", () => {
  assert.ok(!callbacks(createApplicationFollowUpPromptKeyboard(42, "compact")).includes("application:followup:set:42:one_minute:compact"));
  assert.ok(callbacks(createApplicationFollowUpPromptKeyboard(42, "compact", undefined, true)).includes("application:followup:set:42:one_minute:compact"));
});

test("application follow-up delivery keyboard has quick reschedule actions and post link", () => {
  const keyboard = createApplicationFollowUpDeliveryKeyboard(42, "https://t.me/job_react/42");

  assert.deepEqual(callbacks(keyboard), [
    "application:followup:set:42:three_days:compact",
    "application:followup:set:42:week:compact",
    "application:responded:42",
    "application:closed:42"
  ]);
  assert.deepEqual(urls(keyboard), ["https://t.me/job_react/42"]);
});

test("application follow-up delivery keyboard exposes one-minute debug only when requested", () => {
  assert.ok(!callbacks(createApplicationFollowUpDeliveryKeyboard(42, "https://t.me/job_react/42")).includes("application:followup:set:42:one_minute:compact"));
  assert.ok(callbacks(createApplicationFollowUpDeliveryKeyboard(42, "https://t.me/job_react/42", true)).includes("application:followup:set:42:one_minute:compact"));
});

test("application status page opens application detail cards", () => {
  const data = callbacks(createApplicationStatusPageKeyboard(createApplicationPage()));

  assert.ok(data.includes("application:detail:1:0"));
  assert.ok(data.includes("application:detail:2:0"));
  assert.ok(data.includes("status:applied:0"));
  assert.ok(data.includes("menu:vacancies"));
  assert.ok(!data.includes("menu:settings"));
});

test("application detail keyboard manages the current application", () => {
  const data = callbacks(createApplicationDetailKeyboard(createApplicationRecord(), 5, true));

  assert.ok(data.includes("application:followup:42:compact"));
  assert.ok(data.includes("application:note:42:detail:5"));
  assert.ok(data.includes("application:followup:set:42:one_minute:compact"));
  assert.ok(data.includes("application:responded:42:detail:5"));
  assert.ok(data.includes("application:closed:42:detail:5"));
  assert.ok(data.includes("application:clear:42:5"));
  assert.ok(data.includes("status:applied:5"));
});

test("weekly keyboard is compact and keeps explicit menu exit", () => {
  const keyboard = createWeeklyKeyboard(createWeeklyPage(), true);
  const rowData = rows(keyboard).map((row) => row.map((button) => button.callback_data));
  const data = callbacks(keyboard);

  assert.deepEqual(rowData[0], [
    "vacancy:view:1:compact:w0",
    "vacancy:view:2:compact:w0",
    "vacancy:view:3:compact:w0"
  ]);
  assert.ok(data.includes("week:3"));
  assert.ok(data.includes("week:14:0"));
  assert.ok(data.includes("week:30:0"));
  assert.ok(data.includes("week:0"));
  assert.ok(data.includes("menu:home"));
  assert.ok(!data.includes("menu:filters"));
  assert.ok(!data.includes("menu:settings"));
});

test("weekly keyboard paginates first, middle and last pages", () => {
  const firstRows = rows(createWeeklyKeyboard(createWeeklyPage({ offset: 0 }), true));
  const firstData = callbacks(createWeeklyKeyboard(createWeeklyPage({ offset: 0 }), true));
  assert.ok(firstData.includes("week:3"));
  assert.ok(!firstRows.some((row) => row.length === 2 && row.some((button) => button.callback_data === "week:0")));

  const middle = callbacks(createWeeklyKeyboard(createWeeklyPage({ offset: 3 }), true));
  assert.ok(middle.includes("week:0"));
  assert.ok(middle.includes("week:6"));

  const last = callbacks(createWeeklyKeyboard(createWeeklyPage({ offset: 6, total: 9 }), true));
  assert.ok(last.includes("week:3"));
  assert.ok(!last.includes("week:9"));
});

test("weekly keyboard preserves profile origin and callbacks", () => {
  const keyboard = createWeeklyKeyboard(createWeeklyPage({ offset: 3 }), true, 5);
  const data = callbacks(keyboard);

  assert.ok(data.includes("vacancy:view:1:compact:p5.3"));
  assert.ok(data.includes("week:profile:5:0"));
  assert.ok(data.includes("week:profile:5:6"));
  assert.ok(data.includes("filters:profile:5"));
  assert.ok(!callbacks(createWeeklyKeyboard(createWeeklyPage({ offset: 3 }), true)).some((callback) => callback.startsWith("filters:profile:")));
});

test("weekly keyboard preserves selected window in callbacks and vacancy origin", () => {
  const keyboard = createWeeklyKeyboard(createWeeklyPage({ offset: 3 }), true, 5, 14);
  const data = callbacks(keyboard);

  assert.ok(data.includes("vacancy:view:1:compact:p5.3.e"));
  assert.ok(data.includes("week:profile:5:14:0"));
  assert.ok(data.includes("week:profile:5:14:6"));
  assert.ok(data.includes("week:profile:5:30:0"));
});

test("profile weekly zero-state can return to the search profile", () => {
  const data = callbacks(createWeeklyZeroStateKeyboard(createWeeklyPage({ items: [], total: 0 }), 5));

  assert.ok(data.includes("filters:profile:5"));
  assert.ok(data.includes("week:profile:5:0"));
  assert.ok(data.includes("week:profile:5:14:0"));
  assert.ok(data.includes("week:profile:5:30:0"));
  assert.ok(data.includes("menu:home"));
});

test("settings keyboard exposes weekly page size control", () => {
  const keyboard = createUserSettingsKeyboardWithStatuses(3, false, true);
  const data = callbacks(keyboard);
  const labels = rows(keyboard).flat().map((button) => button.text);

  assert.ok(data.includes("settings:weekly_page_size"));
  assert.ok(data.includes("notifications:toggle_daily_digest"));
  assert.ok(data.includes("notifications:toggle_empty_cycle_notice"));
  assert.ok(data.includes("menu:diagnostics"));
  assert.ok(data.includes("menu:home"));
  assert.ok(!data.includes("status:applied:0"));
  assert.ok(!data.includes("status:saved:0"));
  assert.ok(!data.includes("status:hidden:0"));
  assert.ok(!data.includes("reminders:page:0"));
  assert.ok(labels.includes("📄 В недельной выдаче: 3"));
  assert.ok(labels.includes("🔔 Сообщать, если новых вакансий нет"));
  assert.ok(labels.includes("🌅 Выключить утренний дайджест"));
});

test("my vacancies keyboard owns user vacancy lists", () => {
  const data = callbacks(createMyVacanciesKeyboard());

  assert.ok(data.includes("status:saved:0"));
  assert.ok(data.includes("status:applied:0"));
  assert.ok(data.includes("status:hidden:0"));
  assert.ok(data.includes("reminders:page:0"));
  assert.ok(data.includes("menu:home"));
  assert.ok(!data.includes("menu:settings"));
});

test("notification settings keyboard names concrete notification types", () => {
  const keyboard = createNotificationsKeyboard(false, true);
  const data = callbacks(keyboard);
  const labels = rows(keyboard).flat().map((button) => button.text);

  assert.deepEqual(data, [
    "notifications:toggle_empty_cycle_notice",
    "notifications:toggle_daily_digest",
    "menu:settings"
  ]);
  assert.ok(labels.includes("🔔 Сообщать, если новых вакансий нет"));
  assert.ok(labels.includes("🌅 Выключить утренний дайджест"));
});

test("search profile detail keyboard groups use, edit, advanced and navigation actions", () => {
  const data = callbacks(createSearchProfileDetailKeyboard(createSearchProfile()));

  assert.deepEqual(data, [
    "week:profile:7:0",
    "filters:profile:7:rematch",
    "filters:profile:7:toggle",
    "filters:profile:7:edit:required_context",
    "filters:profile:7:edit:required_primary",
    "filters:profile:7:edit:preferred",
    "filters:profile:7:edit:exclude",
    "filters:profile:7:language",
    "filters:profile:7:presets",
    "filters:profile:7:rename",
    "filters:profile:7:reset",
    "filters:profile:7:delete",
    "menu:filters",
    "menu:home"
  ]);
});

test("daily digest keyboard shows only actionable sections and settings", () => {
  const payload: DailyDigestPayload = {
    userId: "777",
    digestDate: "2026-06-17",
    scheduledFor: "2026-06-17 09:00 UTC",
    newVacanciesCount: 2,
    savedWithoutActionCount: 0,
    dueApplicationFollowUpsCount: 1,
    hiddenLastDayCount: 5
  };
  const data = callbacks(createDailyDigestKeyboard(payload));

  assert.deepEqual(data, ["week:0", "status:applied:0", "menu:settings"]);
  assert.ok(!data.includes("status:saved:0"));
});

test("hidden reason keyboard captures quick feedback or skip", () => {
  const data = callbacks(createHiddenReasonKeyboard(42));

  assert.ok(data.includes("hidden_reason:set:42:not_rf"));
  assert.ok(data.includes("hidden_reason:set:42:stack_mismatch"));
  assert.ok(data.includes("hidden_reason:set:42:low_salary"));
  assert.ok(data.includes("hidden_reason:set:42:wrong_grade"));
  assert.ok(data.includes("hidden_reason:set:42:office_or_hybrid"));
  assert.ok(data.includes("hidden_reason:set:42:scam"));
  assert.ok(data.includes("hidden_reason:set:42:seen_before"));
  assert.ok(data.includes("hidden_reason:set:42:unwanted_niche"));
  assert.ok(data.includes("hidden_reason:set:42:unclear_company"));
  assert.ok(data.includes("hidden_reason:skip:42"));
  assert.ok(data.includes("vacancy:status:42:hidden:compact"));
  assert.ok(data.includes("menu:home"));
});

test("hidden reason keyboard preserves weekly origin without duplicate return action", () => {
  const data = callbacks(createHiddenReasonKeyboard(42, { offset: 6, profileId: 7 }));

  assert.ok(data.includes("hidden_reason:set:42:not_rf:p7.6"));
  assert.ok(data.includes("hidden_reason:skip:42:p7.6"));
  assert.ok(!data.includes("week:profile:7:6"));
  assert.ok(!data.includes("menu:home"));
});

test("weekly return keyboard is only built when origin exists", () => {
  assert.equal(createWeeklyReturnKeyboard(undefined), undefined);
  assert.deepEqual(callbacks(createWeeklyReturnKeyboard({ offset: 6, profileId: 7 })), ["week:profile:7:6"]);
});

test("hidden vacancy receipt offers restore and contextual exit", () => {
  assert.deepEqual(callbacks(createHiddenVacancyReceiptKeyboard(42)), [
    "vacancy:status:42:hidden:compact",
    "menu:home"
  ]);
  assert.deepEqual(callbacks(createHiddenVacancyReceiptKeyboard(42, { offset: 6, profileId: 7 })), [
    "vacancy:status:42:hidden:compact:p7.6",
    "week:profile:7:6"
  ]);
});

test("weekly period buttons show correct Cyrillic labels without mojibake", () => {
  const keyboard = createWeeklyKeyboard(createWeeklyPage(), true);
  const texts = rows(keyboard).flat().map((button) => button.text);

  assert.ok(texts.some((t) => t.includes("7 дн.")), "должен содержать '7 дн.'");
  assert.ok(texts.some((t) => t.includes("14 дн.")), "должен содержать '14 дн.'");
  assert.ok(texts.some((t) => t.includes("30 дн.")), "должен содержать '30 дн.'");
  assert.ok(!texts.some((t) => t.includes("â") || t.includes("œ") || t.includes("Ð")), "нет mojibake-символов");
});

test("weekly period buttons add checkmark only for selected window", () => {
  const keyboard7 = createWeeklyKeyboard(createWeeklyPage(), true, undefined, 7);
  const texts7 = rows(keyboard7).flat().map((button) => button.text);
  assert.ok(texts7.some((t) => t === "✅ 7 дн."));
  assert.ok(texts7.some((t) => t === "14 дн."));
  assert.ok(texts7.some((t) => t === "30 дн."));

  const keyboard14 = createWeeklyKeyboard(createWeeklyPage(), true, 5, 14);
  const texts14 = rows(keyboard14).flat().map((button) => button.text);
  assert.ok(texts14.some((t) => t === "7 дн."));
  assert.ok(texts14.some((t) => t === "✅ 14 дн."));
  assert.ok(texts14.some((t) => t === "30 дн."));

  const keyboard30 = createWeeklyKeyboard(createWeeklyPage(), true, 5, 30);
  const texts30 = rows(keyboard30).flat().map((button) => button.text);
  assert.ok(texts30.some((t) => t === "7 дн."));
  assert.ok(texts30.some((t) => t === "14 дн."));
  assert.ok(texts30.some((t) => t === "✅ 30 дн."));
});

test("weekly period buttons preserve callback data", () => {
  const keyboard = createWeeklyKeyboard(createWeeklyPage(), true, 5);
  const data = callbacks(keyboard);

  assert.ok(data.includes("week:profile:5:14:0"), "callback for 14-day window");
  assert.ok(data.includes("week:profile:5:30:0"), "callback for 30-day window");
  assert.ok(data.includes("week:profile:5:7:0") || data.includes("week:profile:5:0"), "callback for 7-day window (default)");
});

test("weekly zero-state period buttons show correct Cyrillic labels without mojibake", () => {
  const keyboard = createWeeklyZeroStateKeyboard(createWeeklyPage({ items: [], total: 0 }), 5);
  const texts = rows(keyboard).flat().map((button) => button.text);

  assert.ok(texts.some((t) => t.includes("7 дн.")), "должен содержать '7 дн.'");
  assert.ok(texts.some((t) => t.includes("14 дн.")), "должен содержать '14 дн.'");
  assert.ok(texts.some((t) => t.includes("30 дн.")), "должен содержать '30 дн.'");
  assert.ok(!texts.some((t) => t.includes("â") || t.includes("œ") || t.includes("Ð")), "нет mojibake-символов");
});

test("weekly zero-state period buttons add checkmark only for selected window", () => {
  const keyboard14 = createWeeklyZeroStateKeyboard(createWeeklyPage({ items: [], total: 0 }), 5, 1, 14);
  const texts14 = rows(keyboard14).flat().map((button) => button.text);
  assert.ok(texts14.some((t) => t === "7 дн."));
  assert.ok(texts14.some((t) => t === "✅ 14 дн."));
  assert.ok(texts14.some((t) => t === "30 дн."));
});

test("diagnostics suggestion keyboard links to filters and suppression actions", () => {
  const suggestion: UserFilterSuggestionCandidate = {
    suggestionKey: "hidden_stack_mismatch",
    reason: "stack_mismatch",
    count: 3,
    totalWithReason: 5,
    share: 0.6
  };
  const data = callbacks(createDiagnosticsKeyboardWithSuggestion(true, suggestion));

  assert.ok(data.includes("menu:filters"));
  assert.ok(data.includes("menu:settings"));
  assert.ok(!data.includes("menu:notifications"));
  assert.ok(data.includes("week:0"));
  assert.ok(data.includes("filter_suggestion:open:hidden_stack_mismatch"));
  assert.ok(data.includes("filter_suggestion:dismiss:hidden_stack_mismatch"));
  assert.ok(data.includes("filter_suggestion:later:hidden_stack_mismatch"));
});
