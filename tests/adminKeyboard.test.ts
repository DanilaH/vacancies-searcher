import test from "node:test";
import assert from "node:assert/strict";

import {
  createAdminKeyboard,
  createChannelDiscoveryModeKeyboard,
  createChannelDiscoveryProfileKeyboard,
  createChannelDiscoveryRunKeyboard,
  createChannelsKeyboard,
  createHhSearchSettingsKeyboard,
  createPendingInputKeyboard,
  createSearchProfilePresetsKeyboard,
  formatChannelBatchSummary,
  formatChannelDiscoveryModeMenuWithProviders,
  formatChannelDiscoveryRunPage,
  formatRawChannelList,
  formatSearchProfilesPanel,
  formatSearchProfilePresets
} from "../src/bot/admin";
import { AdminPanelState, ChannelDiscoveryCandidatePage, ChannelDiscoveryRun, HhSearchSettings, MonitoredChannel, MonitoredChannelPage } from "../src/types";

const state: AdminPanelState = {
  botPaused: false,
  sourceMode: "web",
  aiEnabled: false,
  filterMode: "keywords",
  activeChannelsCount: 3,
  includeKeywordsCount: 0,
  excludeKeywordsCount: 0,
  pendingInputAction: null
};

const hhSettings: HhSearchSettings = {
  userId: "777",
  enabled: false,
  text: "",
  areaId: "113",
  experience: "any",
  schedule: "remote",
  employment: "full",
  salaryFrom: null,
  periodDays: 7,
  updatedAt: "2026-06-05T00:00:00.000Z"
};

test("channel discovery mode screen shows provider availability", () => {
  const text = formatChannelDiscoveryModeMenuWithProviders([
    { name: "mention_graph", available: true },
    { name: "mtproto", available: false }
  ]);

  assert.match(text, /available: mention_graph/u);
  assert.match(text, /unavailable: mtproto/u);
});

test("running discovery screen shows progress and refresh action", () => {
  const run: ChannelDiscoveryRun = {
    id: 42,
    status: "running",
    startedByUserId: "777",
    profileId: "frontend",
    profileLabel: "Frontend",
    customQuery: null,
    seedQueries: [],
    providers: ["mention_graph"],
    providerWarnings: [],
    totalCandidatesFound: 228,
    candidatesToCheck: 50,
    candidatesChecked: 17,
    candidatesRecommended: 2,
    candidatesFiltered: 177,
    error: null,
    startedAt: "2026-06-05T13:00:00.000Z",
    completedAt: null
  };
  const page: ChannelDiscoveryCandidatePage = { items: [], offset: 0, pageSize: 5, total: 0, runId: run.id };

  const text = formatChannelDiscoveryRunPage(run, page);
  assert.match(text, /Найдено username-кандидатов: 228/u);
  assert.match(text, /Выбрано для проверки: 50/u);
  assert.match(text, /Прогресс проверки: 17 из 50/u);
  assert.match(text, /Прошли фильтр сейчас: 2/u);
  assert.match(text, /Отклонено после проверки сейчас: 15/u);
  assert.match(text, /Не проверено из-за лимита: 178/u);
  assert.equal(JSON.stringify(createChannelDiscoveryRunKeyboard(run, page)).includes("discovery:page:42:0"), true);
});

test("completed discovery screen separates rejected and unchecked candidates", () => {
  const run: ChannelDiscoveryRun = {
    id: 44,
    status: "completed",
    startedByUserId: "777",
    profileId: "frontend",
    profileLabel: "Frontend",
    customQuery: null,
    seedQueries: [],
    providers: ["mention_graph"],
    providerWarnings: [],
    totalCandidatesFound: 233,
    candidatesToCheck: 50,
    candidatesChecked: 50,
    candidatesRecommended: 1,
    candidatesFiltered: 232,
    error: null,
    startedAt: "2026-06-05T13:00:00.000Z",
    completedAt: "2026-06-05T13:01:00.000Z"
  };
  const page: ChannelDiscoveryCandidatePage = { items: [], offset: 0, pageSize: 5, total: 0, runId: run.id };
  const text = formatChannelDiscoveryRunPage(run, page);

  assert.match(text, /Проверено: 50 из 50/u);
  assert.match(text, /Прошли фильтр: 1/u);
  assert.match(text, /Отклонено после проверки: 49/u);
  assert.match(text, /Не проверено из-за лимита: 183/u);
  assert.match(text, /следующий автопоиск начнёт с ещё не проверенных username/u);
  assert.doesNotMatch(text, /Filtered:/u);
});

test("discovery screen caps old verbose warnings", () => {
  const run: ChannelDiscoveryRun = {
    id: 43,
    status: "completed",
    startedByUserId: "777",
    profileId: "frontend",
    profileLabel: "Frontend",
    customQuery: null,
    seedQueries: [],
    providers: ["mention_graph"],
    providerWarnings: Array.from({ length: 12 }, (_, index) => `warning ${index + 1}`),
    totalCandidatesFound: 12,
    candidatesToCheck: 12,
    candidatesChecked: 12,
    candidatesRecommended: 0,
    candidatesFiltered: 12,
    error: null,
    startedAt: "2026-06-05T13:00:00.000Z",
    completedAt: "2026-06-05T13:01:00.000Z"
  };
  const page: ChannelDiscoveryCandidatePage = { items: [], offset: 0, pageSize: 5, total: 0, runId: run.id };
  const text = formatChannelDiscoveryRunPage(run, page);

  assert.match(text, /Warning: warning 5/u);
  assert.doesNotMatch(text, /Warning: warning 6/u);
  assert.match(text, /\.\.\.and 7 more warnings\./u);
});

function keyboardRows(keyboard: unknown): Array<Array<{ text: string; callback_data?: string }>> {
  return (keyboard as { inline_keyboard?: Array<Array<{ text: string; callback_data?: string }>> }).inline_keyboard ?? [];
}

function assertHomeIsLastStandaloneRow(keyboard: unknown): void {
  assert.deepEqual(keyboardRows(keyboard).at(-1), [{ text: "🏠 Меню", callback_data: "menu:home" }]);
}

test("admin keyboard hides owner-only controls for non-owner admins", () => {
  const keyboard = createAdminKeyboard(state, false) as unknown as { inline_keyboard?: Array<Array<{ text: string }>> };
  const serialized = JSON.stringify(keyboard);

  assert.equal(serialized.includes("Пользователи"), false);
  assert.equal(serialized.includes("Backup"), false);
});

test("admin keyboard shows owner-only controls for owner", () => {
  const keyboard = createAdminKeyboard(state, true) as unknown as { inline_keyboard?: Array<Array<{ text: string }>> };
  const serialized = JSON.stringify(keyboard);

  assert.equal(serialized.includes("Пользователи"), true);
  assert.equal(serialized.includes("Backup"), true);
});

test("channels keyboard exposes discovery only to owner controls", () => {
  const page: MonitoredChannelPage = {
    items: [],
    offset: 0,
    pageSize: 8,
    total: 0
  };

  assert.equal(JSON.stringify(createChannelsKeyboard(page, false)).includes("channels:discover"), false);
  assert.equal(JSON.stringify(createChannelsKeyboard(page, true)).includes("channels:discover"), true);
  assert.equal(JSON.stringify(createChannelsKeyboard(page, false)).includes("channels:export"), true);
  assertHomeIsLastStandaloneRow(createChannelsKeyboard(page, true));
});

test("raw channel list is alphabet-ready and copyable as one line", () => {
  const channels = [
    { username: "job_react" },
    { username: "remoteit" }
  ] as MonitoredChannel[];

  assert.equal(formatRawChannelList(channels), "@job_react, @remoteit");
});

test("channel discovery profile keyboard exposes presets and custom search", () => {
  const keyboard = createChannelDiscoveryProfileKeyboard();
  const serialized = JSON.stringify(keyboard);

  assert.equal(serialized.includes("discovery:run:backend"), true);
  assert.equal(serialized.includes("discovery:run:three_d_printing"), true);
  assert.equal(serialized.includes("discovery:run:no_experience"), true);
  assert.equal(serialized.includes("discovery:custom"), true);
  assertHomeIsLastStandaloneRow(keyboard);
});

test("channel discovery mode keyboard exposes auto search, manual seeds and candidates", () => {
  const serialized = JSON.stringify(createChannelDiscoveryModeKeyboard());
  assert.equal(serialized.includes("discovery:auto"), true);
  assert.equal(serialized.includes("discovery:seeds"), true);
  assert.equal(serialized.includes("discovery:candidates:0"), true);
});

test("channel discovery seed profile keyboard routes presets to batch input", () => {
  const serialized = JSON.stringify(createChannelDiscoveryProfileKeyboard("seeds"));
  assert.equal(serialized.includes("discovery:seed_profile:backend"), true);
  assert.equal(serialized.includes("discovery:custom"), false);
});

test("pending input keeps cancel, contextual return and home on separate rows", () => {
  const rows = keyboardRows(createPendingInputKeyboard("menu:filters"));

  assert.deepEqual(rows.map((row) => row.map((button) => button.callback_data)), [
    ["admin:cancel_input"],
    ["menu:filters"],
    ["menu:home"]
  ]);
  assertHomeIsLastStandaloneRow(createPendingInputKeyboard("menu:filters"));
});

test("hh settings keep home as the final standalone row", () => {
  assertHomeIsLastStandaloneRow(createHhSearchSettingsKeyboard(hhSettings));
});

test("search profile presets are grouped in UI", () => {
  const text = formatSearchProfilePresets();
  const keyboard = JSON.stringify(createSearchProfilePresetsKeyboard());

  assert.match(text, /Общее \/ Старт: Удалённо без опыта/u);
  assert.equal(keyboard.includes("filters:preset:remote_no_experience"), true);
  assert.match(text, /IT \/ Engineering: Frontend, Backend, Fullstack/);
  assert.match(text, /Creative \/ 3D: Design, 3D Sculpt \/ Print/);
  assert.equal(keyboard.includes("— IT / Engineering —"), true);
  assert.equal(keyboard.includes("filters:preset:three_d_printing"), true);
});

test("search profile preset forecasts change labels without changing callbacks", () => {
  const keyboard = JSON.stringify(createSearchProfilePresetsKeyboard("new", [
    { presetId: "frontend", matchesCount: 24, evaluatedVacancies: 100 },
    { presetId: "three_d_printing", matchesCount: 0, evaluatedVacancies: 100 }
  ]));

  assert.match(keyboard, /Frontend · ~24/);
  assert.match(keyboard, /3D Sculpt \/ Print · мало данных/);
  assert.match(keyboard, /filters:preset_new:frontend/);
  assert.match(keyboard, /filters:preset_new:three_d_printing/);
});

test("search profiles panel shows visible and hidden weekly stats", () => {
  const text = formatSearchProfilesPanel([{
    profile: {
      id: 42,
      userId: "777",
      name: "Frontend",
      isActive: true,
      vacancyLanguageMode: "ru_en",
      requiredContextKeywords: ["remote"],
      requiredPrimaryKeywords: ["frontend"],
      preferredKeywords: [],
      excludeKeywords: [],
      sortOrder: 0,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString()
    },
    health: {
      status: "ready",
      summary: "Поиск активен",
      guidance: null,
      missingRequiredSections: [],
      isSearchActive: true
    },
    weeklyStats: {
      profileId: 42,
      visibleMatches: 5,
      hiddenMatches: 2
    }
  }]);

  assert.match(text, /За 7 дней: 5 вакансий · скрыто: 2/);
});

test("channel batch summary reports entries skipped above the hard limit", () => {
  const text = formatChannelBatchSummary({
    totalEntries: 53,
    totalActiveChannels: 10,
    added: ["@channel_1"],
    reactivated: [],
    alreadyActive: [],
    duplicatesInBatch: [],
    invalid: [],
    probeFailed: [],
    truncated: 3
  });

  assert.match(text, /Сверх лимита 50: 3/u);
  assert.match(text, /Не добавлено: 3/u);
});
