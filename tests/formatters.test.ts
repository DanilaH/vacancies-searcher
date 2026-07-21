import test from "node:test";
import assert from "node:assert/strict";

import {
  formatBlockedWeeklyAccess,
  formatOnboardingCompletionMessage,
  formatOnboardingIntroMessage,
  formatOnboardingLanguageMessage,
  formatOnboardingSetupChoiceMessage,
  formatApplicationDetail,
  formatApplicationStatusPage,
  formatDailyDigestNotification,
  formatPublicUserRegistrationAlert,
  formatStatusVacancies,
  formatUserQuietDiagnostics,
  formatVacancyNotification,
  formatVacancyReminderNotification,
  formatVacancyReminders,
  formatWeeklyVacancies
} from "../src/bot/formatters";
import {
  MatchedVacancyRecord,
  SearchProfileHealthReport,
  BotUser,
  UserStatusVacancyPage,
  UserSearchProfile,
  UserSearchProfileRecord,
  UserStatusVacancyRecord,
  UserVacancyApplicationPage,
  UserVacancyApplicationRecord,
  UserVacancyRematchSummary,
  UserWeeklyVacancyPage,
  VacancyRecord
} from "../src/types";
import {
  FILTER_SUGGESTION_LABELS,
  HIDDEN_VACANCY_REASON_LABELS
} from "../src/services/hiddenVacancyReasons";
import { createTestConfig } from "./helpers";

const config = createTestConfig({ timeZone: "UTC" });

function createVacancyRecord(overrides: Partial<VacancyRecord> = {}): VacancyRecord {
  return {
    id: 1,
    sourceName: "telegram_web_preview",
    sourceChannel: "job_react",
    sourceMessageId: "1001",
    messageDate: "2026-05-27T20:02:00.000Z",
    title: "🔥 Frontend Developer",
    text: "🔥 Frontend Developer\nУдалённо\nReact   TypeScript",
    normalizedText: "frontend developer удаленно react typescript",
    url: "https://t.me/job_react/1001",
    canonicalUrl: null,
    fingerprint: "fp-1",
    score: 3,
    matchSummary: "conditions: remote; primary: react, frontend; preferred: typescript",
    matchedKeywords: ["react", "frontend", "typescript"],
    contacts: [],
    sentToOwnerAt: null,
    createdAt: "2026-05-27T20:03:00.000Z",
    ...overrides
  };
}

function createMatchedVacancyRecord(overrides: Partial<MatchedVacancyRecord> = {}): MatchedVacancyRecord {
  return {
    ...createVacancyRecord(),
    userId: "777",
    deliveredAt: null,
    matchedAt: "2026-05-27T20:04:00.000Z",
    userStatus: "inbox",
    statusUpdatedAt: null,
    ...overrides
  };
}

function createUserStatusVacancyRecord(
  overrides: Partial<UserStatusVacancyRecord> = {}
): UserStatusVacancyRecord {
  return {
    ...createVacancyRecord(),
    userId: "777",
    userStatus: "saved",
    statusUpdatedAt: "2026-05-27T21:00:00.000Z",
    isCurrentlyMatched: true,
    matchedAt: "2026-05-27T20:04:00.000Z",
    ...overrides
  };
}

function createApplicationRecord(overrides: Partial<UserVacancyApplicationRecord> = {}): UserVacancyApplicationRecord {
  return {
    ...createVacancyRecord(),
    userId: "777",
    userStatus: "applied",
    statusUpdatedAt: "2026-05-27T21:00:00.000Z",
    isCurrentlyMatched: true,
    matchedAt: "2026-05-27T20:04:00.000Z",
    application: {
      userId: "777",
      vacancyId: 1,
      appliedAt: "2026-05-27T21:00:00.000Z",
      note: "Sent a short React note",
      followUpAt: "2026-05-30T21:00:00.000Z",
      nextAttemptAt: "2026-05-30T21:00:00.000Z",
      attemptCount: 0,
      deliveredAt: null,
      cancelledAt: null,
      lastError: null,
      respondedAt: null,
      closedAt: null,
      applicationCreatedAt: "2026-05-27T21:00:00.000Z",
      applicationUpdatedAt: "2026-05-27T21:00:00.000Z"
    },
    ...overrides
  };
}

function createSearchProfile(overrides: Partial<UserSearchProfile> = {}): UserSearchProfile {
  return {
    userId: "777",
    requiredContextKeywords: [],
    requiredPrimaryKeywords: [],
    preferredKeywords: [],
    excludeKeywords: [],
    updatedAt: "2026-05-27T21:00:00.000Z",
    ...overrides
  };
}

function createHealthReport(overrides: Partial<SearchProfileHealthReport> = {}): SearchProfileHealthReport {
  return {
    status: "weak",
    summary: "Профиль настроен частично.",
    guidance: "Для более точного поиска заполни блок «Основной профиль».",
    missingRequiredSections: ["required_primary"],
    isSearchActive: true,
    ...overrides
  };
}

test("formatWeeklyVacancies uses compact cards with separators", () => {
  const page: UserWeeklyVacancyPage = {
    items: [
      createMatchedVacancyRecord({ userStatus: "saved" }),
      createMatchedVacancyRecord({
        id: 2,
        sourceMessageId: "1002",
        title: "Senior React Engineer",
        text: "Senior React Engineer\nRemote-first\nDesign systems",
        url: "https://t.me/job_react/1002"
      })
    ],
    offset: 0,
    pageSize: 5,
    total: 2
  };

  const formatted = formatWeeklyVacancies(page, config);

  assert.match(formatted, /🗂️ Вакансии за неделю/);
  assert.match(formatted, /Показано: 2 из 2/);
  assert.match(formatted, /Нажми номер вакансии, чтобы открыть карточку\./);
  assert.match(formatted, /1\. Frontend Developer/);
  assert.match(formatted, /📌 💾 Сохранено/);
  assert.match(formatted, /🏠 Remote/);
  assert.match(formatted, /🧩 react, typescript/);
  assert.doesNotMatch(formatted, /\(\?\)/);
  assert.doesNotMatch(formatted, /https:\/\/t\.me\/job_react\/1001/);
  assert.match(formatted, /──────────────/);
  assert.equal((formatted.match(/──────────────/g) ?? []).length, 1);
  assert.ok(!formatted.trimEnd().endsWith("──────────────"));
});

test("weekly rich vacancy card stays within five main lines and hides raw url", () => {
  const page: UserWeeklyVacancyPage = {
    items: [
      createMatchedVacancyRecord({
        title: "Senior Frontend Developer",
        text: [
          "Компания: Acme",
          "Заработная плата: $4 000-5 500",
          "Формат работы: Remote",
          "Грейд: Senior",
          "Локация работы: РФ и РБ",
          "Занятость: Full-time",
          "Оформление: ТК РФ",
          "Стек: React, TypeScript, Next.js"
        ].join("\n")
      })
    ],
    offset: 0,
    pageSize: 5,
    total: 1
  };

  const formatted = formatWeeklyVacancies(page, config);
  const cardLines = formatted.slice(formatted.indexOf("1. ")).trim().split("\n");

  assert.equal(cardLines.length, 5);
  assert.match(cardLines[0]!, /Senior Frontend Developer · Acme/u);
  assert.match(formatted, /💰 \$4 000-5 500 · 🏠 Remote · 🧭 Senior/u);
  assert.match(formatted, /📍 РФ и РБ · 📄 Full-time · 🤝 ТК РФ · 🧩 React, TypeScript, Next\.js/u);
  assert.doesNotMatch(formatted, /https:\/\/t\.me\/job_react\/1001/u);
  assert.doesNotMatch(formatted, /📝/u);
});

test("formatWeeklyVacancies explains an empty feed with rematch diagnostics", () => {
  const profile: UserSearchProfileRecord = {
    id: 7,
    userId: "777",
    name: "Frontend",
    isActive: true,
    vacancyLanguageMode: "ru_en",
    requiredContextKeywords: ["remote"],
    requiredPrimaryKeywords: ["react"],
    preferredKeywords: ["typescript"],
    excludeKeywords: ["junior"],
    sortOrder: 0,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z"
  };
  const summary: UserVacancyRematchSummary = {
    userId: "777",
    windowDays: 7,
    scannedVacancies: 20,
    evaluatedVacancies: 18,
    profileStatus: "ready",
    created: 0,
    updated: 0,
    unchanged: 0,
    removed: 0,
    totalMatched: 0,
    profileDiagnostics: [{
      profileId: 7,
      profileName: "Frontend",
      evaluatedVacancies: 18,
      matchedVacancies: 0,
      rejectionReasons: {
        missing_primary: 12,
        missing_context: 9,
        stop_words: 2,
        language: 1
      }
    }]
  };
  const page: UserWeeklyVacancyPage = {
    items: [],
    offset: 0,
    pageSize: 5,
    total: 0,
    hiddenMatchedTotal: 0
  };

  const formatted = formatWeeklyVacancies(page, config, "Frontend", {
    activeProfiles: [profile],
    profileId: 7,
    rematchSummary: summary
  });

  assert.match(formatted, /Проверено вакансий: 18/u);
  assert.match(formatted, /Поиск: Frontend/u);
  assert.match(formatted, /не совпал основной профиль/u);
  assert.match(formatted, /не совпали условия или формат работы/u);
  assert.match(formatted, /сработали стоп-слова/u);
  assert.doesNotMatch(formatted, /не подошёл выбранный язык вакансий/u);
});

test("formatWeeklyVacancies distinguishes hidden matches and missing source data", () => {
  const hiddenPage: UserWeeklyVacancyPage = {
    items: [],
    offset: 0,
    pageSize: 5,
    total: 0,
    hiddenMatchedTotal: 3
  };
  const emptyPage: UserWeeklyVacancyPage = {
    items: [],
    offset: 0,
    pageSize: 5,
    total: 0,
    hiddenMatchedTotal: 0
  };
  const noDataSummary: UserVacancyRematchSummary = {
    userId: "777",
    windowDays: 7,
    scannedVacancies: 0,
    evaluatedVacancies: 0,
    profileStatus: "ready",
    created: 0,
    updated: 0,
    unchanged: 0,
    removed: 0,
    totalMatched: 0,
    profileDiagnostics: []
  };

  assert.match(formatWeeklyVacancies(hiddenPage, config), /находятся в «Скрытых»: 3/u);
  assert.match(
    formatWeeklyVacancies(emptyPage, config, undefined, { activeProfiles: [], rematchSummary: noDataSummary }),
    /Источники пока не накопили вакансий/u
  );
});

test("vacancy surfaces show all matched search profiles once", () => {
  const vacancy = createMatchedVacancyRecord({
    matchedProfileIds: [1, 2],
    matchedProfileNames: ["Frontend", "Подработка без опыта"]
  });
  const page: UserWeeklyVacancyPage = {
    items: [vacancy],
    offset: 0,
    pageSize: 5,
    total: 1
  };

  assert.match(formatWeeklyVacancies(page, config), /🎯 Почему показал: Frontend, Подработка без опыта — /u);
  assert.match(formatVacancyNotification(vacancy, config), /🎯 Почему показал: Frontend, Подработка без опыта — /u);
});

test("formatStatusVacancies keeps compact template and current match context", () => {
  const page: UserStatusVacancyPage = {
    items: [
      createUserStatusVacancyRecord({
        userStatus: "saved",
        isCurrentlyMatched: false,
        title: "React Team Lead",
        text: "React Team Lead\nRemote\nPlatform"
      })
    ],
    offset: 0,
    pageSize: 5,
    total: 1,
    status: "saved"
  };

  const formatted = formatStatusVacancies(page, config);

  assert.match(formatted, /💾 Сохранённые вакансии/);
  assert.match(formatted, /1\. React Team Lead/);
  assert.match(formatted, /📌 💾 Сохранено • уже не входит в текущую подборку/);
  assert.match(formatted, /🎯 Почему показал: remote; react, frontend; typescript/);
  assert.doesNotMatch(formatted, /📝 Remote Platform/);
});

test("hidden status formatting shows reason only for hidden vacancies", () => {
  const hiddenPage: UserStatusVacancyPage = {
    items: [
      createUserStatusVacancyRecord({
        userStatus: "hidden",
        hiddenReason: "stack_mismatch"
      })
    ],
    offset: 0,
    pageSize: 5,
    total: 1,
    status: "hidden"
  };
  const savedPage: UserStatusVacancyPage = {
    ...hiddenPage,
    status: "saved",
    items: [
      createUserStatusVacancyRecord({
        userStatus: "saved",
        hiddenReason: "stack_mismatch"
      })
    ]
  };

  assert.ok(formatStatusVacancies(hiddenPage, config).includes(HIDDEN_VACANCY_REASON_LABELS.stack_mismatch));
  assert.ok(!formatStatusVacancies(savedPage, config).includes(HIDDEN_VACANCY_REASON_LABELS.stack_mismatch));
});

test("daily digest surfaces top hidden reasons when available", () => {
  const formatted = formatDailyDigestNotification({
    userId: "777",
    digestDate: "2026-06-17",
    scheduledFor: "2026-06-17 09:00 UTC",
    newVacanciesCount: 0,
    savedWithoutActionCount: 1,
    dueApplicationFollowUpsCount: 0,
    hiddenLastDayCount: 4,
    hiddenReasonTop: [
      { reason: "not_rf", count: 3 },
      { reason: "low_salary", count: 1 }
    ]
  });

  assert.ok(formatted.includes(HIDDEN_VACANCY_REASON_LABELS.not_rf));
  assert.ok(formatted.includes(HIDDEN_VACANCY_REASON_LABELS.low_salary));
});

test("formatApplicationStatusPage summarizes follow-up state", () => {
  const page: UserVacancyApplicationPage = {
    items: [createApplicationRecord()],
    offset: 0,
    pageSize: 5,
    total: 1,
    summary: {
      total: 1,
      waitingFollowUp: 1,
      sentFollowUp: 0,
      closedOrResponded: 0
    }
  };

  const formatted = formatApplicationStatusPage(page, config);

  assert.match(formatted, /✅ Отклики/u);
  assert.match(formatted, /Всего: 1/u);
  assert.match(formatted, /Ждут follow-up: 1/u);
  assert.match(formatted, /1\. 🔥 Frontend Developer/u);
  assert.match(formatted, /✅ Отклик:/u);
  assert.match(formatted, /⏰ Follow-up:/u);
  assert.match(formatted, /📝/u);
});

test("formatApplicationDetail shows full application note", () => {
  const formatted = formatApplicationDetail(createApplicationRecord(), config);

  assert.match(formatted, /✅ Отклик/u);
  assert.match(formatted, /✅ Откликнулся:/u);
  assert.match(formatted, /⏰ Follow-up:/u);
  assert.match(formatted, /📝 Заметка:\nSent a short React note/u);
});

test("formatVacancyNotification uses a compact structured card without full text", () => {
  const vacancy = createMatchedVacancyRecord({
    userStatus: "applied",
    text: [
      "🔥 Frontend Developer",
      "Компания: Acme",
      "Зарплата: $4 000-5 500",
      "Формат работы: Remote",
      "Стек: React, TypeScript",
      `Полное длинное описание вакансии ${"детали ".repeat(60)} СЕКРЕТ_В_КОНЦЕ`
    ].join("\n"),
    contacts: [
      { type: "telegram", value: "@hr_team" },
      { type: "url", value: "https://company.example/jobs/1" }
    ]
  });

  const formatted = formatVacancyNotification(vacancy, config);

  assert.match(formatted, /^🔥 Frontend Developer/u);
  assert.match(formatted, /🏢 Acme/u);
  assert.match(formatted, /🧩 React, TypeScript/u);
  assert.match(formatted, /🏠 Remote/u);
  assert.match(formatted, /💰 \$4 000-5 500/u);
  assert.match(formatted, /📬 @hr_team, https:\/\/company\.example\/jobs\/1/u);
  assert.match(formatted, /📌 ✅ Откликнулся/u);
  assert.match(formatted, /🎯 Почему показал: remote; react, frontend; typescript; зарплата указана/u);
  assert.doesNotMatch(formatted, /📝 Компания:|📝 Зарплата:|📝 Стек:/u);
  assert.doesNotMatch(formatted, /📝 Описание:/u);
  assert.doesNotMatch(formatted, /СЕКРЕТ_В_КОНЦЕ/u);
  assert.ok(!formatted.includes("──────────────"));
});

test("compact vacancy notification shows explicit warnings and critical unknowns only", () => {
  const vacancy = createMatchedVacancyRecord({
    title: "Senior Frontend Developer",
    text: [
      "Компания: Acme",
      "Зарплата: $4 000-5 500",
      "Формат работы: Remote",
      "Локация: только Сербия, кроме РФ",
      "Стек: React, TypeScript"
    ].join("\n")
  });

  const formatted = formatVacancyNotification(vacancy, config);

  assert.match(formatted, /⚠️ Важно: работа из РФ явно недоступна; удалёнка ограничена указанной географией/u);
  assert.match(formatted, /❓ Проверить: оформление/u);
  assert.doesNotMatch(formatted, /❓ Уточнить: зарплату/u);
  assert.doesNotMatch(formatted, /📝/u);
});

test("vacancy reminder notification reuses compact card and reminder list shows due time", () => {
  const vacancy = createMatchedVacancyRecord({ userStatus: "saved" });
  const notification = formatVacancyReminderNotification(vacancy, config);
  const reminder = {
    ...vacancy,
    remindAt: "2026-06-08T10:00:00.000Z",
    nextAttemptAt: "2026-06-08T10:00:00.000Z",
    attemptCount: 0,
    cancelledAt: null,
    lastError: null,
    reminderCreatedAt: "2026-06-07T10:00:00.000Z",
    reminderUpdatedAt: "2026-06-07T10:00:00.000Z"
  };
  const page = formatVacancyReminders({ items: [reminder], offset: 0, pageSize: 5, total: 1 }, config);

  assert.match(notification, /^⏰ Напоминание о вакансии/u);
  assert.doesNotMatch(notification, /📄 Полный текст вакансии/u);
  assert.match(page, /⏰ Напоминания/u);
  assert.match(page, /8 июня/u);
  assert.match(page, /https:\/\/t\.me\/job_react\/1001/u);
});

test("compact notification shows duplicate count while full view shows duplicate post sources", () => {
  const vacancy = createMatchedVacancyRecord({
    duplicatePosts: [
      {
        sourceName: "telegram_web_preview",
        sourceChannel: "rabotafrontend",
        sourceMessageId: "2001",
        messageDate: "2026-05-28T10:00:00.000Z",
        url: "https://t.me/rabotafrontend/2001"
      },
      {
        sourceName: "hh_api",
        sourceChannel: "hh.ru • Acme, Москва",
        sourceMessageId: "123",
        messageDate: "2026-05-28T09:00:00.000Z",
        url: "https://hh.ru/vacancy/123"
      }
    ],
    duplicatePostsTotal: 3
  });

  const compact = formatVacancyNotification(vacancy, config);
  const formatted = formatVacancyNotification(vacancy, config, "full");

  assert.match(compact, /🔁 Дубли: 3/u);
  assert.doesNotMatch(compact, /https:\/\/t\.me\/rabotafrontend\/2001/u);
  assert.match(formatted, /🔁 Дубли:/);
  assert.match(formatted, /• @rabotafrontend • /);
  assert.match(formatted, /https:\/\/t\.me\/rabotafrontend\/2001/);
  assert.match(formatted, /• hh\.ru • Acme, Москва • /);
  assert.match(formatted, /https:\/\/hh\.ru\/vacancy\/123/);
  assert.match(formatted, /…и ещё 1/);
  assert.ok(!formatted.includes("@hh.ru"));
  assert.ok(formatted.indexOf("🔁 Дубли:") < formatted.indexOf("📝 Описание:"));
});

test("full vacancy notification shows external detail URL while compact view keeps it hidden", () => {
  const vacancy = createMatchedVacancyRecord({
    canonicalUrl: "https://findmyremote.ai/companies/acme/jobs/frontend-1"
  });

  const compact = formatVacancyNotification(vacancy, config);
  const full = formatVacancyNotification(vacancy, config, "full");

  assert.doesNotMatch(compact, /findmyremote\.ai/u);
  assert.match(full, /https:\/\/findmyremote\.ai\/companies\/acme\/jobs\/frontend-1/u);
  assert.match(full, /🎯 Почему показал:\n\+ remote\n\+ react, frontend\n\+ typescript/u);
});

test("compact notification falls back to excerpt for unstructured posts", () => {
  const vacancy = createMatchedVacancyRecord({
    title: "Новая вакансия",
    text: "Пишите в личку, расскажу подробнее.",
    matchedKeywords: ["remote"],
    matchSummary: ""
  });

  const formatted = formatVacancyNotification(vacancy, config);

  assert.match(formatted, /^🔥 Новая вакансия/u);
  assert.match(formatted, /📝 Пишите в личку, расскажу подробнее\./u);
  assert.doesNotMatch(formatted, /🏢|💰|🧩|📍/u);
  assert.doesNotMatch(formatted, /\n\n\n/u);
});

test("full vacancy notification stays within Telegram limit and marks truncation", () => {
  const vacancy = createMatchedVacancyRecord({
    text: `Очень длинное описание 😀 ${"подробности ".repeat(1000)}`
  });

  const formatted = formatVacancyNotification(vacancy, config, "full");

  assert.ok(Array.from(formatted).length <= 3900);
  assert.match(formatted, /Текст сокращён — откройте исходный пост/u);
  assert.doesNotMatch(formatted, /\uFFFD/u);
});

test("formatWeeklyVacancies removes duplicated title from preview only once", () => {
  const page: UserWeeklyVacancyPage = {
    items: [
      createMatchedVacancyRecord({
        text: "🔥 Frontend Developer | React | React Native\nУдалённо\nTypeScript"
      })
    ],
    offset: 0,
    pageSize: 5,
    total: 1
  };

  const formatted = formatWeeklyVacancies(page, config);

  assert.match(formatted, /🧩 react, react native, typescript/);
  assert.doesNotMatch(formatted, /\(\?\)/);
  assert.doesNotMatch(formatted, /📝 🔥 Frontend Developer/);
});

test("formatWeeklyVacancies labels hh.ru vacancies without Telegram channel prefix", () => {
  const page: UserWeeklyVacancyPage = {
    items: [
      createMatchedVacancyRecord({
        sourceName: "hh_api",
        sourceChannel: "hh.ru • Acme, Москва",
        sourceMessageId: "123",
        url: "https://hh.ru/vacancy/123"
      })
    ],
    offset: 0,
    pageSize: 5,
    total: 1
  };

  const formatted = formatWeeklyVacancies(page, config);

  assert.match(formatted, /📣 hh\.ru • Acme, Москва • /);
  assert.doesNotMatch(formatted, /@hh\.ru/);
});

test("formatBlockedWeeklyAccess explains filled and missing profile sections", () => {
  const profile = createSearchProfile({
    requiredContextKeywords: ["remote"],
    preferredKeywords: ["typescript"]
  });
  const health = createHealthReport();

  const formatted = formatBlockedWeeklyAccess(profile, health);

  assert.match(formatted, /🗂️ Вакансии за неделю пока недоступны/);
  assert.match(formatted, /У вас заполнено:/);
  assert.match(formatted, /• Условия и формат/);
  assert.match(formatted, /• Желательные сигналы/);
  assert.match(formatted, /Нужно заполнить:/);
  assert.match(formatted, /• Основной профиль/);
  assert.match(formatted, /Перейдите в «Мои поиски»/);
});

test("formatBlockedWeeklyAccess handles completely empty profile", () => {
  const formatted = formatBlockedWeeklyAccess(
    createSearchProfile(),
    createHealthReport({
      status: "empty",
      summary: "Профиль поиска пока не настроен.",
      guidance: "Добавь обязательные блоки или выбери готовый пресет, чтобы включить поиск.",
      missingRequiredSections: ["required_context", "required_primary"],
      isSearchActive: false
    })
  );

  assert.match(formatted, /• Пока ничего/);
  assert.match(formatted, /• Условия и формат/);
  assert.match(formatted, /• Основной профиль/);
});

test("formatUserQuietDiagnostics summarizes profile, sources and latest poll cycle", () => {
  const formatted = formatUserQuietDiagnostics(
    {
      profile: createSearchProfile({
        requiredContextKeywords: ["remote"],
        requiredPrimaryKeywords: []
      }),
      health: createHealthReport({
        status: "weak",
        isSearchActive: false,
        missingRequiredSections: ["required_primary"]
      }),
      onboardingCompleted: true,
      botPaused: false,
      notifyOnEmptyCycle: true,
      dailyDigestEnabled: false,
      latestDailyDigestDelivery: null,
      hiddenFeedbackSummary: {
        totalHidden: 4,
        withReason: 3,
        withoutReason: 1,
        topReasons: [{ reason: "not_rf", count: 3 }]
      },
      filterSuggestion: {
        suggestionKey: "hidden_not_rf",
        reason: "not_rf",
        count: 3,
        totalWithReason: 3,
        share: 1
      },
      vacancyLanguageMode: "ru_en",
      weeklyMatchesCount: 0,
      telegramActiveChannelsCount: 3,
      hhSourceEnabled: false,
      hhUserEnabled: false,
      hhUserQuery: "",
      companyCareersSourceEnabled: true,
      companyCareerSourcesCount: 1,
      latestPollCycle: {
        sourceName: "telegram_web_preview",
        fetchedItemsCount: 12,
        newVacanciesCount: 0,
        checkedAtIso: "2026-05-27T20:02:00.000Z"
      }
    },
    config
  );

  assert.match(formatted, /🩺 Почему бот может молчать/);
  assert.match(formatted, /Поиск активен: нет/);
  assert.match(formatted, /Не хватает: Основной профиль/);
  assert.match(formatted, /Telegram-каналы: 3/);
  assert.match(formatted, /Company sites: источник включён; активных сайтов: 1/);
  assert.match(formatted, /Вакансий в недельной подборке: 0/);
  assert.match(formatted, /telegram_web_preview/);
  assert.ok(formatted.includes(HIDDEN_VACANCY_REASON_LABELS.not_rf));
  assert.ok(formatted.includes(FILTER_SUGGESTION_LABELS.hidden_not_rf));
  assert.match(formatted, /заполнить обязательные блоки/);
});

test("formatPublicUserRegistrationAlert shows new user identity and admin hint", () => {
  const user: BotUser = {
    userId: "123456",
    role: "member",
    isActive: true,
    username: null,
    displayName: null,
    addedByUserId: null,
    createdAt: "2026-06-02T07:00:00.000Z",
    updatedAt: "2026-06-02T07:00:00.000Z"
  };

  const formatted = formatPublicUserRegistrationAlert(
    {
      user,
      telegramUsername: "new_dev",
      telegramFirstName: "Ada",
      telegramLastName: "Lovelace"
    },
    config
  );

  assert.match(formatted, /👤 Новый пользователь в боте/);
  assert.match(formatted, /Telegram ID: 123456/);
  assert.match(formatted, /Username: @new_dev/);
  assert.match(formatted, /Имя: Ada Lovelace/);
  assert.match(formatted, /Роль: member/);
  assert.match(formatted, /\/admin -> Пользователи/);
});
