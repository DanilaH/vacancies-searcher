import { Api, TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";

import { AppConfig, hasTelegramCredentials } from "../config";
import { VacancyDatabase } from "../db/database";
import { logger } from "../logger";
import {
  ChannelDiscoveryEvidence,
  ChannelDiscoveryProfileId,
  ChannelDiscoveryRun,
  ChannelDiscoverySource,
  RawVacancyItem
} from "../types";
import { normalizeForComparison, shorten } from "../utils/text";
import { sleep } from "../utils/sleep";
import { detectCandidatePost } from "./candidatePostDetection";
import {
  buildCustomChannelDiscoveryProfile,
  ChannelDiscoveryProfile,
  getChannelDiscoveryProfile
} from "./channelDiscoveryProfiles";
import { validateChannelInput } from "./channelValidation";
import { parseTelegramWebPreviewPage } from "../sources/telegramWebPreviewSource";
import {
  ChannelDiscoveryProvider,
  DuckDuckGoDiscoveryProvider,
  ManualSeedDiscoveryProvider,
  MtprotoDiscoveryProvider,
  TelegramMentionGraphProvider
} from "./channelDiscoveryProviders";

type FetchLike = typeof fetch;

export type ChannelDiscoveryRef = {
  username: string;
  title?: string | null;
};

export interface ChannelDiscoveryMtprotoClient {
  searchPublicChannels(query: string, limit: number): Promise<ChannelDiscoveryRef[]>;
  searchGlobalChannels(query: string, limit: number): Promise<ChannelDiscoveryRef[]>;
  getChannelRecommendations(seedUsername: string, limit: number): Promise<ChannelDiscoveryRef[]>;
}

type CandidateAccumulator = {
  username: string;
  title: string | null;
  sources: Set<ChannelDiscoverySource>;
  weight: number;
};

export type ChannelDiscoveryRunInput =
  | { profileId: Exclude<ChannelDiscoveryProfileId, "custom">; customQuery?: null; manualSeeds?: string[] }
  | { profileId: "custom"; customQuery: string; manualSeeds?: string[] };

export type ChannelDiscoveryProviderAvailability = {
  name: string;
  available: boolean;
};

const DEFAULT_SEED_QUERIES = [
  "react remote",
  "react jobs",
  "frontend remote",
  "frontend developer remote",
  "typescript jobs",
  "next.js jobs",
  "javascript frontend вакансии",
  "frontend вакансии",
  "react вакансии",
  "удаленная frontend вакансия"
];

const DEFAULT_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
};

async function readResponseText(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) {
      throw new Error(`Telegram preview response exceeds ${maxBytes} bytes.`);
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (!value) {
      continue;
    }
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new Error(`Telegram preview response exceeds ${maxBytes} bytes.`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

function errorChainMessages(error: unknown): string[] {
  const messages: string[] = [];
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current && !seen.has(current)) {
    seen.add(current);
    if (current instanceof Error) {
      messages.push(current.message);
      current = current.cause;
      continue;
    }
    messages.push(String(current));
    break;
  }
  return messages;
}

function isExpectedTelegramPreviewRejection(error: unknown): boolean {
  return errorChainMessages(error).some((message) => /unexpected redirect/iu.test(message));
}

function candidateCheckFailureLabel(error: unknown): string {
  const messages = errorChainMessages(error);
  if (messages.some((message) => /timeout|timed out/iu.test(message))) {
    return "timeout";
  }
  if (messages.some((message) => /fetch failed|network/iu.test(message))) {
    return "network error";
  }
  return shorten(messages.at(-1) ?? "unknown error", 80);
}

const FRONTEND_SIGNALS = [
  "frontend",
  "front-end",
  "front end",
  "react",
  "react.js",
  "typescript",
  "type script",
  "next.js",
  "nextjs",
  "javascript",
  "redux",
  "vite"
];

const REMOTE_SIGNALS = [
  "remote",
  "remote-first",
  "worldwide",
  "anywhere",
  "удаленно",
  "удалённо",
  "удаленка",
  "удалёнка",
  "remotely"
];

const HIRING_SIGNALS = [
  "job",
  "jobs",
  "hiring",
  "vacancy",
  "position",
  "role",
  "developer",
  "engineer",
  "ищем",
  "вакансия",
  "требуется",
  "компания",
  "обязанности",
  "требования",
  "условия",
  "отклик"
];

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function containsAnySignal(normalizedText: string, signals: string[]): boolean {
  return signals.some((signal) => normalizedText.includes(normalizeForComparison(signal)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}

function extractUsernameFromUnknownChat(chat: unknown): ChannelDiscoveryRef | null {
  if (!isRecord(chat)) {
    return null;
  }

  if (chat.className && chat.className !== "Channel") {
    return null;
  }

  if (chat.fake === true || chat.scam === true) {
    return null;
  }

  const primaryUsername = typeof chat.username === "string" ? chat.username : null;
  const usernames = Array.isArray(chat.usernames) ? chat.usernames : [];
  const alternateUsername =
    usernames
      .map((item) => (isRecord(item) && typeof item.username === "string" ? item.username : null))
      .find((item): item is string => Boolean(item)) ?? null;
  const username = primaryUsername ?? alternateUsername;

  if (!username) {
    return null;
  }

  return {
    username,
    title: typeof chat.title === "string" ? chat.title : null
  };
}

function extractChannelRefs(result: unknown): ChannelDiscoveryRef[] {
  if (!isRecord(result) || !Array.isArray(result.chats)) {
    return [];
  }

  return result.chats
    .map(extractUsernameFromUnknownChat)
    .filter((item): item is ChannelDiscoveryRef => item !== null);
}

function normalizeCandidateUsername(value: string): string | null {
  const validation = validateChannelInput(value);
  return validation.ok ? validation.value : null;
}

function extractTelegramLinks(texts: string[]): ChannelDiscoveryRef[] {
  const refs: ChannelDiscoveryRef[] = [];
  const seen = new Set<string>();
  const pattern = /(?:https?:\/\/)?t\.me\/(?:s\/)?([a-zA-Z0-9_]{5,32})(?:[/?#]\S*)?/giu;

  for (const text of texts) {
    for (const match of text.matchAll(pattern)) {
      const username = normalizeCandidateUsername(match[1] ?? "");
      if (!username || seen.has(username)) {
        continue;
      }

      seen.add(username);
      refs.push({ username });
    }
  }

  return refs;
}

function analyzeSample(profile: ChannelDiscoveryProfile, items: RawVacancyItem[]) {
  let primarySignalPosts = 0;
  let formatSignalPosts = 0;
  let hiringPosts = 0;
  let vacancyLikePosts = 0;
  let resumePosts = 0;

  for (const item of items) {
    const normalized = normalizeForComparison(item.text);
    const hasPrimarySignal = containsAnySignal(normalized, profile.primarySignals);
    const hasFormatSignal = containsAnySignal(normalized, profile.formatSignals);
    const hasHiring = containsAnySignal(normalized, profile.hiringSignals);
    const candidatePost = detectCandidatePost(item.text);

    if (hasPrimarySignal) {
      primarySignalPosts += 1;
    }
    if (hasFormatSignal) {
      formatSignalPosts += 1;
    }
    if (hasHiring) {
      hiringPosts += 1;
    }
    if (candidatePost.isCandidatePost) {
      resumePosts += 1;
    }
    if (!candidatePost.isCandidatePost && hasPrimarySignal && hasHiring) {
      vacancyLikePosts += 1;
    }
  }

  const samplePosts = items.length;
  const resumeRate = samplePosts > 0 ? resumePosts / samplePosts : 0;

  return {
    samplePosts,
    primarySignalPosts,
    formatSignalPosts,
    hiringPosts,
    vacancyLikePosts,
    resumePosts,
    resumeRate
  };
}

function buildCandidateEvidence(profile: ChannelDiscoveryProfile, items: RawVacancyItem[]): ChannelDiscoveryEvidence[] {
  return items
    .map((item) => {
      const normalized = normalizeForComparison(item.text);
      const matchedSignals = unique(
        [...profile.primarySignals, ...profile.formatSignals, ...profile.hiringSignals].filter((signal) =>
          normalized.includes(normalizeForComparison(signal))
        )
      );
      return {
        evidence: {
          url: item.url,
          messageDate: item.date ?? null,
          excerpt: shorten(item.text.replace(/\s+/gu, " ").trim(), 180),
          matchedSignals: matchedSignals.slice(0, 8)
        },
        rank:
          matchedSignals.filter((signal) => profile.primarySignals.includes(signal)).length * 3 +
          matchedSignals.filter((signal) => profile.hiringSignals.includes(signal)).length * 2 +
          matchedSignals.length
      };
    })
    .filter((item) => item.rank > 0)
    .sort((left, right) => right.rank - left.rank)
    .slice(0, 3)
    .map((item) => item.evidence);
}

function buildCandidateScore(stats: ReturnType<typeof analyzeSample>, sources: Set<ChannelDiscoverySource>): number {
  if (stats.samplePosts === 0) {
    return 0;
  }

  const primarySignalRate = stats.primarySignalPosts / stats.samplePosts;
  const formatSignalRate = stats.formatSignalPosts / stats.samplePosts;
  const hiringRate = stats.hiringPosts / stats.samplePosts;
  const vacancyRate = stats.vacancyLikePosts / stats.samplePosts;
  const sourceBoost = sources.size * 4 + (sources.has("mtproto_recommendation") ? 8 : 0);
  const score =
    vacancyRate * 40 +
    primarySignalRate * 25 +
    formatSignalRate * 15 +
    hiringRate * 10 +
    sourceBoost -
    stats.resumeRate * 35;

  return Math.max(0, Math.min(100, Math.round(score)));
}

function buildCandidateReasons(
  profile: ChannelDiscoveryProfile,
  stats: ReturnType<typeof analyzeSample>,
  sources: Set<ChannelDiscoverySource>
): string[] {
  const reasons = [
    `${stats.vacancyLikePosts} ${profile.label} vacancy-like posts`,
    `${stats.primarySignalPosts}/${stats.samplePosts} profile signals`,
    `${stats.formatSignalPosts}/${stats.samplePosts} format boost signals`,
    `resume rate ${Math.round(stats.resumeRate * 100)}%`
  ];

  if (sources.has("mtproto_recommendation")) {
    reasons.push("found via similar-channel recommendations");
  }
  if (sources.has("mtproto_search")) {
    reasons.push("found via Telegram search");
  }
  if (sources.has("raw_message_link")) {
    reasons.push("linked from existing raw messages");
  }

  return reasons;
}

function isRecommendedCandidate(profile: ChannelDiscoveryProfile, stats: ReturnType<typeof analyzeSample>): boolean {
  return (
    stats.samplePosts >= profile.minimumSamplePosts &&
    stats.vacancyLikePosts >= profile.minimumVacancyLikePosts &&
    stats.resumeRate <= profile.maxResumeRate
  );
}

export class GramjsChannelDiscoveryClient implements ChannelDiscoveryMtprotoClient {
  private client?: TelegramClient;

  constructor(private readonly config: AppConfig) {}

  async searchPublicChannels(query: string, limit: number): Promise<ChannelDiscoveryRef[]> {
    const client = await this.ensureConnected();
    const result = await client.invoke(new Api.contacts.Search({ q: query, limit }));
    return extractChannelRefs(result);
  }

  async searchGlobalChannels(query: string, limit: number): Promise<ChannelDiscoveryRef[]> {
    const client = await this.ensureConnected();
    const result = await client.invoke(
      new Api.messages.SearchGlobal({
        broadcastsOnly: true,
        q: query,
        filter: new Api.InputMessagesFilterEmpty(),
        minDate: 0,
        maxDate: 0,
        offsetRate: 0,
        offsetPeer: new Api.InputPeerEmpty(),
        offsetId: 0,
        limit
      })
    );
    return extractChannelRefs(result);
  }

  async getChannelRecommendations(seedUsername: string, limit: number): Promise<ChannelDiscoveryRef[]> {
    const client = await this.ensureConnected();
    const result = await client.invoke(new Api.channels.GetChannelRecommendations({ channel: seedUsername }));
    return extractChannelRefs(result).slice(0, limit);
  }

  private async ensureConnected(): Promise<TelegramClient> {
    if (this.client) {
      return this.client;
    }

    if (!hasTelegramCredentials(this.config)) {
      throw new Error("MTProto discovery requires TELEGRAM_API_ID, TELEGRAM_API_HASH and TELEGRAM_SESSION.");
    }

    const client = new TelegramClient(
      new StringSession(this.config.telegramSession),
      this.config.telegramApiId!,
      this.config.telegramApiHash!,
      { connectionRetries: 5 }
    );
    const connected = await client.connect();
    if (!connected) {
      throw new Error("GramJS failed to connect to Telegram for channel discovery.");
    }

    const authorized = await client.checkAuthorization();
    if (!authorized) {
      throw new Error("TELEGRAM_SESSION is not authorized. Re-run npm run auth:telegram.");
    }

    this.client = client;
    return client;
  }
}

export class ChannelDiscoveryService {
  private readonly mtprotoClient: ChannelDiscoveryMtprotoClient;
  private readonly fetchImpl: FetchLike;
  private readonly providers: ChannelDiscoveryProvider[];
  private activeRunPromise: Promise<ChannelDiscoveryRun> | null = null;

  constructor(
    private readonly config: AppConfig,
    private readonly database: VacancyDatabase,
    options?: {
      mtprotoClient?: ChannelDiscoveryMtprotoClient;
      fetchImpl?: FetchLike;
      providers?: ChannelDiscoveryProvider[];
    }
  ) {
    this.mtprotoClient = options?.mtprotoClient ?? new GramjsChannelDiscoveryClient(config);
    this.fetchImpl = options?.fetchImpl ?? fetch;
    this.providers =
      options?.providers ??
      [
        new ManualSeedDiscoveryProvider(),
        new TelegramMentionGraphProvider(config, database),
        new MtprotoDiscoveryProvider(config, this.mtprotoClient, Boolean(options?.mtprotoClient)),
        new DuckDuckGoDiscoveryProvider(config, this.fetchImpl)
      ];

    const interruptedRuns = this.database.failInterruptedChannelDiscoveryRuns("Discovery interrupted by process restart.");
    if (interruptedRuns > 0) {
      logger.warn({ interruptedRuns }, "Marked interrupted channel discovery runs as failed.");
    }
  }

  hasMtprotoDiscoveryAccess(): boolean {
    return hasTelegramCredentials(this.config);
  }

  getProviderAvailability(): ChannelDiscoveryProviderAvailability[] {
    return this.providers.map((provider) => ({
      name: provider.name,
      available: provider.isAvailable()
    }));
  }

  getSeedQueries(profileId: Exclude<ChannelDiscoveryProfileId, "custom"> = "frontend"): string[] {
    const profile = getChannelDiscoveryProfile(profileId);
    return (profile?.seedQueries ?? []).slice(0, this.config.channelDiscoveryMaxQueries);
  }

  async runFrontendDiscovery(startedByUserId: string | undefined): Promise<ChannelDiscoveryRun> {
    return this.runDiscovery(startedByUserId, { profileId: "frontend" });
  }

  startDiscovery(startedByUserId: string | undefined, input: ChannelDiscoveryRunInput): ChannelDiscoveryRun {
    const existingRun = this.database.getRunningChannelDiscoveryRun();
    if (existingRun) {
      return existingRun;
    }

    const prepared = this.prepareRun(startedByUserId, input);
    const task = this.executeDiscovery(
      prepared.run,
      prepared.profile,
      prepared.seedQueries,
      input.manualSeeds ?? [],
      prepared.searchKey
    );
    this.activeRunPromise = task;
    void task
      .catch((error) => {
        logger.error({ err: error, runId: prepared.run.id }, "Background channel discovery task failed.");
      })
      .finally(() => {
        if (this.activeRunPromise === task) {
          this.activeRunPromise = null;
        }
      });
    return prepared.run;
  }

  async runDiscovery(startedByUserId: string | undefined, input: ChannelDiscoveryRunInput): Promise<ChannelDiscoveryRun> {
    if (this.activeRunPromise) {
      return this.activeRunPromise;
    }
    const existingRun = this.database.getRunningChannelDiscoveryRun();
    if (existingRun) {
      return existingRun;
    }

    const prepared = this.prepareRun(startedByUserId, input);
    const task = this.executeDiscovery(
      prepared.run,
      prepared.profile,
      prepared.seedQueries,
      input.manualSeeds ?? [],
      prepared.searchKey
    );
    this.activeRunPromise = task;
    try {
      return await task;
    } finally {
      if (this.activeRunPromise === task) {
        this.activeRunPromise = null;
      }
    }
  }

  private prepareRun(startedByUserId: string | undefined, input: ChannelDiscoveryRunInput) {
    const profile = this.resolveProfile(input);
    const seedQueries = profile.seedQueries.slice(0, this.config.channelDiscoveryMaxQueries);
    const availableProviders = this.selectProviders(input.manualSeeds ?? []);
    const run = this.database.createChannelDiscoveryRun({
      startedByUserId,
      profileId: profile.id,
      profileLabel: profile.label,
      customQuery: input.profileId === "custom" ? input.customQuery : null,
      seedQueries,
      providers: availableProviders.map((provider) => provider.name)
    });
    const searchKey =
      input.profileId === "custom"
        ? `custom:${normalizeForComparison(input.customQuery)}`
        : input.profileId;
    return { run, profile, seedQueries, searchKey };
  }

  private async executeDiscovery(
    run: ChannelDiscoveryRun,
    profile: ChannelDiscoveryProfile,
    seedQueries: string[],
    manualSeeds: string[],
    searchKey: string
  ): Promise<ChannelDiscoveryRun> {
    try {
      const { candidates, providers, warnings } = await this.collectCandidates(seedQueries, manualSeeds);
      const activeUsernames = new Set(
        this.database.listActiveChannels("telegram_web_preview").map((channel) => channel.username)
      );
      const blockedUsernames = this.database.listBlockedChannelDiscoveryUsernames();
      const eligibleCandidates = [...candidates.values()].filter(
        (candidate) => !activeUsernames.has(candidate.username) && !blockedUsernames.has(candidate.username)
      );
      const useRotation = manualSeeds.length === 0;
      const checkTimes = useRotation ? this.database.listChannelDiscoveryCheckTimes(searchKey) : new Map<string, string>();
      if (
        useRotation &&
        checkTimes.size === 0 &&
        this.database.hasCompletedAutomaticChannelDiscoveryRun(run.profileId, run.customQuery)
      ) {
        for (const candidate of [...eligibleCandidates]
          .sort((left, right) => this.rankCandidate(right) - this.rankCandidate(left))
          .slice(0, this.config.channelDiscoveryMaxCandidates)) {
          this.database.recordChannelDiscoveryCheck(searchKey, candidate.username);
        }
        for (const [username, checkedAt] of this.database.listChannelDiscoveryCheckTimes(searchKey)) {
          checkTimes.set(username, checkedAt);
        }
      }
      const candidatesToCheck = eligibleCandidates
        .sort((left, right) => {
          const leftCheckedAt = checkTimes.get(left.username);
          const rightCheckedAt = checkTimes.get(right.username);
          if (!leftCheckedAt && rightCheckedAt) {
            return -1;
          }
          if (leftCheckedAt && !rightCheckedAt) {
            return 1;
          }
          if (leftCheckedAt && rightCheckedAt && leftCheckedAt !== rightCheckedAt) {
            return leftCheckedAt.localeCompare(rightCheckedAt);
          }
          return this.rankCandidate(right) - this.rankCandidate(left);
        })
        .slice(0, this.config.channelDiscoveryMaxCandidates);
      let candidatesChecked = 0;
      let candidatesRecommended = 0;
      let candidatesFiltered = Math.max(0, eligibleCandidates.length - candidatesToCheck.length);
      const candidateFailureCounts = new Map<string, number>();
      const persistProgress = () =>
        this.database.updateChannelDiscoveryRunProgress(run.id, {
          totalCandidatesFound: eligibleCandidates.length,
          candidatesToCheck: candidatesToCheck.length,
          candidatesChecked,
          candidatesRecommended,
          candidatesFiltered,
          providers,
          providerWarnings: warnings
        });

      persistProgress();

      for (const candidate of candidatesToCheck) {
        try {
          let checked: Awaited<ReturnType<ChannelDiscoveryService["checkCandidate"]>>;
          try {
            checked = await this.checkCandidate(profile, candidate);
          } catch (error) {
            candidatesFiltered += 1;
            const failureLabel = candidateCheckFailureLabel(error);
            candidateFailureCounts.set(failureLabel, (candidateFailureCounts.get(failureLabel) ?? 0) + 1);
            logger.debug({ username: candidate.username, runId: run.id, failureLabel }, "Channel discovery candidate check failed.");
            continue;
          }
          if (!checked.recommended) {
            candidatesFiltered += 1;
            continue;
          }

          this.database.upsertChannelDiscoveryCandidate({
            runId: run.id,
            username: candidate.username,
            title: candidate.title,
            score: checked.score,
            sources: [...candidate.sources],
            probeUrl: checked.probeUrl,
            stats: checked.stats,
            reasons: checked.reasons,
            evidence: checked.evidence
          });
          candidatesRecommended += 1;
        } finally {
          if (useRotation) {
            this.database.recordChannelDiscoveryCheck(searchKey, candidate.username);
          }
          candidatesChecked += 1;
          persistProgress();
          if (this.config.channelDiscoveryRequestDelayMs > 0) {
            await sleep(this.config.channelDiscoveryRequestDelayMs);
          }
        }
      }

      if (candidateFailureCounts.size > 0) {
        const totalFailures = [...candidateFailureCounts.values()].reduce((sum, count) => sum + count, 0);
        const details = [...candidateFailureCounts.entries()].map(([label, count]) => `${label}: ${count}`).join(", ");
        warnings.push(`Candidate checks failed: ${totalFailures} (${details}).`);
      }

      return this.database.completeChannelDiscoveryRun(run.id, {
        totalCandidatesFound: eligibleCandidates.length,
        candidatesToCheck: candidatesToCheck.length,
        candidatesChecked,
        candidatesRecommended,
        candidatesFiltered,
        providers,
        providerWarnings: warnings
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn({ err: error, runId: run.id }, "Channel discovery run failed.");
      return this.database.failChannelDiscoveryRun(run.id, message);
    }
  }

  private resolveProfile(input: ChannelDiscoveryRunInput): ChannelDiscoveryProfile {
    if (input.profileId === "custom") {
      const profile = buildCustomChannelDiscoveryProfile(input.customQuery);
      if (!profile) {
        throw new Error("Custom channel discovery query is too short.");
      }
      return profile;
    }

    const profile = getChannelDiscoveryProfile(input.profileId);
    if (!profile) {
      throw new Error(`Unknown channel discovery profile: ${input.profileId}.`);
    }

    return profile;
  }

  private async collectCandidates(
    seedQueries: string[],
    manualSeeds: string[]
  ): Promise<{ candidates: Map<string, CandidateAccumulator>; providers: string[]; warnings: string[] }> {
    const candidates = new Map<string, CandidateAccumulator>();
    const addRefs = (refs: Array<ChannelDiscoveryRef & { source: ChannelDiscoverySource; weight: number }>) => {
      for (const ref of refs) {
        const username = normalizeCandidateUsername(ref.username);
        if (!username) {
          continue;
        }

        const existing = candidates.get(username);
        if (existing) {
          existing.sources.add(ref.source);
          existing.title = existing.title ?? ref.title ?? null;
          existing.weight += ref.weight;
          continue;
        }

        candidates.set(username, {
          username,
          title: ref.title ?? null,
          sources: new Set([ref.source]),
          weight: ref.weight
        });
      }
    };
    const providers: string[] = [];
    const warnings: string[] = [];
    const context = {
      seedQueries,
      manualSeeds,
      activeChannelUsernames: this.database.listActiveChannels("telegram_web_preview").map((channel) => channel.username)
    };
    for (const provider of this.selectProviders(manualSeeds)) {
      providers.push(provider.name);
      try {
        const result = await provider.collect(context);
        addRefs(result.candidates);
        warnings.push(...result.warnings);
      } catch (error) {
        warnings.push(`${provider.name} failed: ${error instanceof Error ? error.message : String(error)}`);
        logger.warn({ err: error, provider: provider.name }, "Channel discovery provider failed.");
      }
    }
    return { candidates, providers, warnings: unique(warnings) };
  }

  private selectProviders(manualSeeds: string[]): ChannelDiscoveryProvider[] {
    const isManualRun = manualSeeds.length > 0;
    return this.providers.filter(
      (provider) => provider.isAvailable() && (isManualRun ? provider.name === "manual_seed" : provider.name !== "manual_seed")
    );
  }

  private rankCandidate(candidate: CandidateAccumulator): number {
    return candidate.weight + candidate.sources.size * 5;
  }

  private async checkCandidate(profile: ChannelDiscoveryProfile, candidate: CandidateAccumulator): Promise<
    | {
        recommended: true;
        score: number;
        probeUrl: string;
        stats: ReturnType<typeof analyzeSample>;
        reasons: string[];
        evidence: ChannelDiscoveryEvidence[];
      }
    | { recommended: false }
  > {
    const existingChannel = this.database.getChannelByUsername("telegram_web_preview", candidate.username);
    if (existingChannel?.isActive || this.database.isChannelDiscoveryUsernameBlocked(candidate.username)) {
      return { recommended: false };
    }

    const items = await this.fetchChannelSample(candidate.username);
    if (items.length === 0) {
      return { recommended: false };
    }
    const stats = analyzeSample(profile, items);
    if (!isRecommendedCandidate(profile, stats)) {
      return { recommended: false };
    }

    return {
      recommended: true,
      score: buildCandidateScore(stats, candidate.sources),
      probeUrl: `https://t.me/s/${candidate.username}`,
      stats,
      reasons: buildCandidateReasons(profile, stats, candidate.sources),
      evidence: buildCandidateEvidence(profile, items)
    };
  }

  private async fetchChannelSample(username: string): Promise<RawVacancyItem[]> {
    const url = `https://t.me/s/${username}`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers: DEFAULT_HEADERS,
        redirect: "error",
        signal: AbortSignal.timeout(this.config.webPreviewRequestTimeoutMs)
      });
    } catch (error) {
      if (isExpectedTelegramPreviewRejection(error)) {
        return [];
      }
      throw error;
    }

    if (!response.ok) {
      throw new Error(`Telegram preview returned HTTP ${response.status} for @${username}.`);
    }

    const declaredLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
    if (Number.isFinite(declaredLength) && declaredLength > this.config.webPreviewMaxResponseBytes) {
      throw new Error(`Telegram preview response for @${username} is too large.`);
    }

    const html = await readResponseText(response, this.config.webPreviewMaxResponseBytes);

    return parseTelegramWebPreviewPage(username, html).items.slice(0, this.config.channelDiscoverySamplePosts);
  }
}
