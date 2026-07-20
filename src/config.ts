import "dotenv/config";

import path from "node:path";

import { SourceName, TelegramSourceMode } from "./types";

const DEFAULT_REMOTE_KEYWORDS = [
  "remote",
  "remote-first",
  "worldwide",
  "anywhere",
  "удаленно",
  "удалённо",
  "удаленка",
  "удалёнка"
];

const DEFAULT_REACT_KEYWORDS = ["react", "react.js"];
const DEFAULT_TYPESCRIPT_KEYWORDS = ["typescript", "type script", "next.js", "nextjs"];
const DEFAULT_SENIORITY_KEYWORDS = ["middle", "middle+", "senior", "strong middle", "мидл", "мидл+", "сеньор"];
const DEFAULT_EXCLUDE_KEYWORDS = [
  "junior",
  "jun",
  "intern",
  "trainee",
  "стажер",
  "стажёр",
  "vue",
  "angular",
  "php",
  "android",
  "ios",
  "qa",
  "devops",
  "backend"
];
const CHANNEL_USERNAME_PATTERN = /^[a-z0-9_]{5,32}$/;
const DEFAULT_WORKSPACE_DATA_DIR = path.resolve(process.cwd(), "data");
const DEFAULT_CONTAINER_DATA_DIR = path.resolve("/app/data");
const MAX_CONFIGURED_CHANNELS = 50;

export interface AppConfig {
  nodeEnv: string;
  logLevel: string;
  timeZone: string;
  botToken: string;
  ownerChatId?: string;
  ownerUserId?: string;
  telegramSourceMode: TelegramSourceMode;
  telegramApiId?: number;
  telegramApiHash?: string;
  telegramSession?: string;
  posthogApiKey?: string;
  posthogHost?: string;
  hhSourceEnabled: boolean;
  hhUserAgent?: string;
  hhAccessToken?: string;
  hhMaxUniqueQueriesPerCycle: number;
  hhMaxActiveUsersPerCycle: number;
  hhPerPage: number;
  hhMaxPagesPerQuery: number;
  companyCareersSourceEnabled: boolean;
  companyCareersPollIntervalSeconds: number;
  companyCareersMaxSourcesPerCycle: number;
  companyCareersRequestTimeoutMs: number;
  companyCareersMaxResponseBytes: number;
  companyCareersRequestDelayMs: number;
  companyCareersUserAgent: string;
  databaseUrl: string;
  databasePath: string;
  appDataDir: string;
  runtimeDir: string;
  heartbeatPath: string;
  channels: string[];
  checkIntervalSeconds: number;
  initialBackfillDays: number;
  weeklyPageSize: number;
  heartbeatIntervalSeconds: number;
  webPreviewMaxPagesPerChannel: number;
  webPreviewChannelDelayMs: number;
  webPreviewRetryCount: number;
  webPreviewRequestTimeoutMs: number;
  webPreviewMaxResponseBytes: number;
  webPreviewMaxItemsPerChannel: number;
  channelDiscoveryMaxQueries: number;
  channelDiscoveryQueryLimit: number;
  channelDiscoveryMaxCandidates: number;
  channelDiscoverySamplePosts: number;
  channelDiscoveryRecentRawDays: number;
  channelDiscoveryRequestDelayMs: number;
  channelDiscoveryDuckDuckGoEnabled: boolean;
  channelDiscoveryDuckDuckGoTimeoutMs: number;
  channelDiscoveryDuckDuckGoMaxResponseBytes: number;
  technicalCleanupEnabled: boolean;
  automaticBackupEnabled: boolean;
  automaticBackupIntervalHours: number;
  automaticBackupRetentionDays: number;
  analyticsRetentionDays: number;
  channelDiscoveryRunRetentionDays: number;
  channelDiscoveryCheckRetentionDays: number;
  remoteKeywords: string[];
  reactKeywords: string[];
  typescriptKeywords: string[];
  seniorityKeywords: string[];
  excludeKeywords: string[];
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function parseTelegramSourceMode(): TelegramSourceMode {
  const explicitValue = process.env.TELEGRAM_SOURCE_MODE?.trim().toLowerCase();
  if (explicitValue === "web" || explicitValue === "mtproto") {
    return explicitValue;
  }

  const legacyValue = process.env.SOURCE_MODE?.trim().toLowerCase();
  if (legacyValue === "telegram") {
    process.emitWarning("SOURCE_MODE=telegram is deprecated. Use TELEGRAM_SOURCE_MODE=mtproto.", "DeprecationWarning");
    return "mtproto";
  }
  if (legacyValue === "mock") {
    process.emitWarning("SOURCE_MODE=mock is deprecated. Falling back to TELEGRAM_SOURCE_MODE=web.", "DeprecationWarning");
  }

  return "web";
}

function parseInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }

  const normalizedValue = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalizedValue)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalizedValue)) {
    return false;
  }

  return fallback;
}

function parseCsv(value: string | undefined, fallback: string[]): string[] {
  if (!value?.trim()) {
    return fallback;
  }

  return value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function parseDatabasePath(databaseUrl: string): string {
  if (databaseUrl.startsWith("file:")) {
    return databaseUrl.slice("file:".length);
  }

  return databaseUrl;
}

function parseOwnerUserId(ownerUserId: string | undefined, ownerChatId: string | undefined): string | undefined {
  const explicitOwnerUserId = ownerUserId?.trim();
  if (explicitOwnerUserId) {
    return explicitOwnerUserId;
  }

  const normalizedOwnerChatId = ownerChatId?.trim();
  if (normalizedOwnerChatId && /^\d+$/.test(normalizedOwnerChatId)) {
    return normalizedOwnerChatId;
  }

  return undefined;
}

function parseChannels(value: string | undefined, fallback: string[]): string[] {
  const rawChannels = value?.trim() ? value.split(",") : fallback;

  return [...new Set(rawChannels.map(normalizeChannelUsername))];
}

function normalizeChannelUsername(value: string): string {
  const trimmedValue = value.trim();
  const normalizedValue = trimmedValue.startsWith("@") ? trimmedValue.slice(1) : trimmedValue;
  const lowerCasedValue = normalizedValue.toLowerCase();

  if (!CHANNEL_USERNAME_PATTERN.test(lowerCasedValue)) {
    throw new Error(
      `Invalid channel username: ${trimmedValue}. Expected 5-32 characters matching ^[a-zA-Z0-9_]{5,32}$.`
    );
  }

  return lowerCasedValue;
}

function assertIntegerInRange(name: string, value: number, minimum: number, maximum: number): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
}

function assertMatchesPattern(name: string, value: string | undefined, pattern: RegExp, expected: string): void {
  if (value && !pattern.test(value)) {
    throw new Error(`${name} must ${expected}.`);
  }
}

function isSubPath(parentPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(parentPath, candidatePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function validateDatabasePath(nodeEnv: string, databasePath: string): void {
  if (nodeEnv === "test") {
    return;
  }

  const allowedDirectories = [DEFAULT_WORKSPACE_DATA_DIR, DEFAULT_CONTAINER_DATA_DIR];
  const matchesAllowedDirectory = allowedDirectories.some((allowedDirectory) => isSubPath(allowedDirectory, databasePath));

  if (!matchesAllowedDirectory) {
    throw new Error(
      `DATABASE_URL must point to a SQLite file inside ${DEFAULT_WORKSPACE_DATA_DIR} or ${DEFAULT_CONTAINER_DATA_DIR}.`
    );
  }
}

export function hasTelegramCredentials(config: AppConfig): boolean {
  return Boolean(config.telegramApiId && config.telegramApiHash && config.telegramSession);
}

export function getSourceNameForMode(mode: TelegramSourceMode): SourceName {
  return mode === "mtproto" ? "telegram_mtproto" : "telegram_web_preview";
}

export function getOwnerNotificationChatId(config: AppConfig): string | undefined {
  return config.ownerChatId ?? config.ownerUserId;
}

export function loadConfig(): AppConfig {
  const botToken = requireEnv("BOT_TOKEN");
  const ownerChatId = process.env.OWNER_CHAT_ID?.trim() || undefined;
  const ownerUserId = parseOwnerUserId(process.env.OWNER_USER_ID?.trim(), ownerChatId);
  const databaseUrl = process.env.DATABASE_URL?.trim() || "file:./data/bot.db";
  const databasePath = path.resolve(process.cwd(), parseDatabasePath(databaseUrl));
  const appDataDir = path.dirname(databasePath);
  const runtimeDir = path.join(appDataDir, "runtime");
  const heartbeatPath = path.join(runtimeDir, "heartbeat.json");
  const telegramSourceMode = parseTelegramSourceMode();
  const channels = parseChannels(process.env.CHANNELS, [
    "job_react",
    "rabotafrontend",
    "findmyremote_frontend"
  ]);

  if (channels.length === 0) {
    throw new Error("CHANNELS must contain at least one channel username.");
  }

  const telegramApiId = process.env.TELEGRAM_API_ID
    ? parseInteger(process.env.TELEGRAM_API_ID, 0)
    : undefined;
  const telegramApiHash = process.env.TELEGRAM_API_HASH?.trim() || undefined;
  const telegramSession = process.env.TELEGRAM_SESSION?.trim() || undefined;
  const posthogApiKey = process.env.POSTHOG_API_KEY?.trim() || undefined;
  const posthogHost = process.env.POSTHOG_HOST?.trim() || undefined;
  const hhSourceEnabled = parseBoolean(process.env.HH_SOURCE_ENABLED, false);
  const hhUserAgent = process.env.HH_USER_AGENT?.trim() || undefined;
  const hhAccessToken = process.env.HH_ACCESS_TOKEN?.trim() || undefined;
  const companyCareersSourceEnabled = parseBoolean(process.env.COMPANY_CAREERS_SOURCE_ENABLED, false);
  const companyCareersUserAgent =
    process.env.COMPANY_CAREERS_USER_AGENT?.trim() ||
    "job-tg-bot/company-careers (+https://github.com/local/job-tg-bot)";

  const config: AppConfig = {
    nodeEnv: process.env.NODE_ENV?.trim() || "development",
    logLevel: process.env.LOG_LEVEL?.trim() || "info",
    timeZone: process.env.TIME_ZONE?.trim() || "UTC",
    botToken,
    ownerChatId,
    ownerUserId,
    telegramSourceMode,
    telegramApiId,
    telegramApiHash,
    telegramSession,
    posthogApiKey,
    posthogHost,
    hhSourceEnabled,
    hhUserAgent,
    hhAccessToken,
    hhMaxUniqueQueriesPerCycle: parseInteger(process.env.HH_MAX_UNIQUE_QUERIES_PER_CYCLE, 10),
    hhMaxActiveUsersPerCycle: parseInteger(process.env.HH_MAX_ACTIVE_USERS_PER_CYCLE, 10),
    hhPerPage: parseInteger(process.env.HH_PER_PAGE, 20),
    hhMaxPagesPerQuery: parseInteger(process.env.HH_MAX_PAGES_PER_QUERY, 1),
    companyCareersSourceEnabled,
    companyCareersPollIntervalSeconds: parseInteger(process.env.COMPANY_CAREERS_POLL_INTERVAL_SECONDS, 21_600),
    companyCareersMaxSourcesPerCycle: parseInteger(process.env.COMPANY_CAREERS_MAX_SOURCES_PER_CYCLE, 20),
    companyCareersRequestTimeoutMs: parseInteger(process.env.COMPANY_CAREERS_REQUEST_TIMEOUT_MS, 10_000),
    companyCareersMaxResponseBytes: parseInteger(process.env.COMPANY_CAREERS_MAX_RESPONSE_BYTES, 1_000_000),
    companyCareersRequestDelayMs: parseInteger(process.env.COMPANY_CAREERS_REQUEST_DELAY_MS, 1_000),
    companyCareersUserAgent,
    databaseUrl,
    databasePath,
    appDataDir,
    runtimeDir,
    heartbeatPath,
    channels,
    checkIntervalSeconds: parseInteger(process.env.CHECK_INTERVAL_SECONDS, 300),
    initialBackfillDays: parseInteger(process.env.INITIAL_BACKFILL_DAYS, 7),
    weeklyPageSize: parseInteger(process.env.WEEKLY_PAGE_SIZE, 3),
    heartbeatIntervalSeconds: parseInteger(process.env.HEARTBEAT_INTERVAL_SECONDS, 15),
    webPreviewMaxPagesPerChannel: parseInteger(process.env.WEB_PREVIEW_MAX_PAGES_PER_CHANNEL, 5),
    webPreviewChannelDelayMs: parseInteger(process.env.WEB_PREVIEW_CHANNEL_DELAY_MS, 1500),
    webPreviewRetryCount: parseInteger(process.env.WEB_PREVIEW_RETRY_COUNT, 2),
    webPreviewRequestTimeoutMs: parseInteger(process.env.WEB_PREVIEW_REQUEST_TIMEOUT_MS, 10000),
    webPreviewMaxResponseBytes: parseInteger(process.env.WEB_PREVIEW_MAX_RESPONSE_BYTES, 1_000_000),
    webPreviewMaxItemsPerChannel: parseInteger(process.env.WEB_PREVIEW_MAX_ITEMS_PER_CHANNEL, 200),
    channelDiscoveryMaxQueries: parseInteger(process.env.CHANNEL_DISCOVERY_MAX_QUERIES, 10),
    channelDiscoveryQueryLimit: parseInteger(process.env.CHANNEL_DISCOVERY_QUERY_LIMIT, 20),
    channelDiscoveryMaxCandidates: parseInteger(process.env.CHANNEL_DISCOVERY_MAX_CANDIDATES, 50),
    channelDiscoverySamplePosts: parseInteger(process.env.CHANNEL_DISCOVERY_SAMPLE_POSTS, 30),
    channelDiscoveryRecentRawDays: parseInteger(process.env.CHANNEL_DISCOVERY_RECENT_RAW_DAYS, 30),
    channelDiscoveryRequestDelayMs: parseInteger(process.env.CHANNEL_DISCOVERY_REQUEST_DELAY_MS, 1000),
    channelDiscoveryDuckDuckGoEnabled: parseBoolean(process.env.CHANNEL_DISCOVERY_DUCKDUCKGO_ENABLED, false),
    channelDiscoveryDuckDuckGoTimeoutMs: parseInteger(process.env.CHANNEL_DISCOVERY_DUCKDUCKGO_TIMEOUT_MS, 10_000),
    channelDiscoveryDuckDuckGoMaxResponseBytes: parseInteger(
      process.env.CHANNEL_DISCOVERY_DUCKDUCKGO_MAX_RESPONSE_BYTES,
      500_000
    ),
    technicalCleanupEnabled: parseBoolean(process.env.TECHNICAL_CLEANUP_ENABLED, true),
    automaticBackupEnabled: parseBoolean(process.env.AUTOMATIC_BACKUP_ENABLED, true),
    automaticBackupIntervalHours: parseInteger(process.env.AUTOMATIC_BACKUP_INTERVAL_HOURS, 24),
    automaticBackupRetentionDays: parseInteger(process.env.AUTOMATIC_BACKUP_RETENTION_DAYS, 14),
    analyticsRetentionDays: parseInteger(process.env.ANALYTICS_RETENTION_DAYS, 90),
    channelDiscoveryRunRetentionDays: parseInteger(process.env.CHANNEL_DISCOVERY_RUN_RETENTION_DAYS, 30),
    channelDiscoveryCheckRetentionDays: parseInteger(process.env.CHANNEL_DISCOVERY_CHECK_RETENTION_DAYS, 180),
    remoteKeywords: parseCsv(process.env.FILTER_REMOTE_KEYWORDS, DEFAULT_REMOTE_KEYWORDS),
    reactKeywords: parseCsv(process.env.FILTER_REACT_KEYWORDS, DEFAULT_REACT_KEYWORDS),
    typescriptKeywords: parseCsv(process.env.FILTER_TYPESCRIPT_KEYWORDS, DEFAULT_TYPESCRIPT_KEYWORDS),
    seniorityKeywords: parseCsv(process.env.FILTER_SENIORITY_KEYWORDS, DEFAULT_SENIORITY_KEYWORDS),
    excludeKeywords: parseCsv(process.env.FILTER_EXCLUDE_KEYWORDS, DEFAULT_EXCLUDE_KEYWORDS)
  };

  assertMatchesPattern("OWNER_CHAT_ID", config.ownerChatId, /^-?\d+$/, "contain only digits and an optional leading minus");
  assertMatchesPattern("OWNER_USER_ID", config.ownerUserId, /^\d+$/, "contain only digits");

  if (config.channels.length > MAX_CONFIGURED_CHANNELS) {
    throw new Error(`CHANNELS must not contain more than ${MAX_CONFIGURED_CHANNELS} entries.`);
  }

  assertIntegerInRange("CHECK_INTERVAL_SECONDS", config.checkIntervalSeconds, 10, 86_400);
  assertIntegerInRange("INITIAL_BACKFILL_DAYS", config.initialBackfillDays, 0, 30);
  assertIntegerInRange("WEEKLY_PAGE_SIZE", config.weeklyPageSize, 1, 5);
  assertIntegerInRange("HEARTBEAT_INTERVAL_SECONDS", config.heartbeatIntervalSeconds, 5, 300);
  assertIntegerInRange("WEB_PREVIEW_MAX_PAGES_PER_CHANNEL", config.webPreviewMaxPagesPerChannel, 1, 20);
  assertIntegerInRange("WEB_PREVIEW_CHANNEL_DELAY_MS", config.webPreviewChannelDelayMs, 250, 60_000);
  assertIntegerInRange("WEB_PREVIEW_RETRY_COUNT", config.webPreviewRetryCount, 0, 5);
  assertIntegerInRange("WEB_PREVIEW_REQUEST_TIMEOUT_MS", config.webPreviewRequestTimeoutMs, 1_000, 60_000);
  assertIntegerInRange("WEB_PREVIEW_MAX_RESPONSE_BYTES", config.webPreviewMaxResponseBytes, 16_384, 5_000_000);
  assertIntegerInRange("WEB_PREVIEW_MAX_ITEMS_PER_CHANNEL", config.webPreviewMaxItemsPerChannel, 1, 500);
  assertIntegerInRange("CHANNEL_DISCOVERY_MAX_QUERIES", config.channelDiscoveryMaxQueries, 1, 50);
  assertIntegerInRange("CHANNEL_DISCOVERY_QUERY_LIMIT", config.channelDiscoveryQueryLimit, 1, 100);
  assertIntegerInRange("CHANNEL_DISCOVERY_MAX_CANDIDATES", config.channelDiscoveryMaxCandidates, 1, 500);
  assertIntegerInRange("CHANNEL_DISCOVERY_SAMPLE_POSTS", config.channelDiscoverySamplePosts, 3, 100);
  assertIntegerInRange("CHANNEL_DISCOVERY_RECENT_RAW_DAYS", config.channelDiscoveryRecentRawDays, 1, 365);
  assertIntegerInRange("CHANNEL_DISCOVERY_REQUEST_DELAY_MS", config.channelDiscoveryRequestDelayMs, 0, 60_000);
  assertIntegerInRange("CHANNEL_DISCOVERY_DUCKDUCKGO_TIMEOUT_MS", config.channelDiscoveryDuckDuckGoTimeoutMs, 1_000, 60_000);
  assertIntegerInRange(
    "CHANNEL_DISCOVERY_DUCKDUCKGO_MAX_RESPONSE_BYTES",
    config.channelDiscoveryDuckDuckGoMaxResponseBytes,
    16_384,
    5_000_000
  );
  assertIntegerInRange("ANALYTICS_RETENTION_DAYS", config.analyticsRetentionDays, 1, 3_650);
  assertIntegerInRange("AUTOMATIC_BACKUP_INTERVAL_HOURS", config.automaticBackupIntervalHours, 1, 168);
  assertIntegerInRange("AUTOMATIC_BACKUP_RETENTION_DAYS", config.automaticBackupRetentionDays, 1, 3_650);
  assertIntegerInRange("CHANNEL_DISCOVERY_RUN_RETENTION_DAYS", config.channelDiscoveryRunRetentionDays, 1, 3_650);
  assertIntegerInRange("CHANNEL_DISCOVERY_CHECK_RETENTION_DAYS", config.channelDiscoveryCheckRetentionDays, 1, 3_650);
  assertIntegerInRange("HH_MAX_UNIQUE_QUERIES_PER_CYCLE", config.hhMaxUniqueQueriesPerCycle, 1, 100);
  assertIntegerInRange("HH_MAX_ACTIVE_USERS_PER_CYCLE", config.hhMaxActiveUsersPerCycle, 1, 1_000);
  assertIntegerInRange("HH_PER_PAGE", config.hhPerPage, 1, 50);
  assertIntegerInRange("HH_MAX_PAGES_PER_QUERY", config.hhMaxPagesPerQuery, 1, 20);
  assertIntegerInRange("COMPANY_CAREERS_POLL_INTERVAL_SECONDS", config.companyCareersPollIntervalSeconds, 300, 86_400);
  assertIntegerInRange("COMPANY_CAREERS_MAX_SOURCES_PER_CYCLE", config.companyCareersMaxSourcesPerCycle, 1, 500);
  assertIntegerInRange("COMPANY_CAREERS_REQUEST_TIMEOUT_MS", config.companyCareersRequestTimeoutMs, 1_000, 60_000);
  assertIntegerInRange("COMPANY_CAREERS_MAX_RESPONSE_BYTES", config.companyCareersMaxResponseBytes, 16_384, 5_000_000);
  assertIntegerInRange("COMPANY_CAREERS_REQUEST_DELAY_MS", config.companyCareersRequestDelayMs, 0, 60_000);
  validateDatabasePath(config.nodeEnv, config.databasePath);

  if (config.hhSourceEnabled && !config.hhUserAgent) {
    throw new Error("HH_SOURCE_ENABLED=true requires HH_USER_AGENT.");
  }

  if (config.telegramSourceMode === "mtproto" && !hasTelegramCredentials(config)) {
    throw new Error(
      "TELEGRAM_SOURCE_MODE=mtproto requires TELEGRAM_API_ID, TELEGRAM_API_HASH and TELEGRAM_SESSION."
    );
  }

  return config;
}
