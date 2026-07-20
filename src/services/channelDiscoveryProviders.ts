import { AppConfig, hasTelegramCredentials } from "../config";
import { RecentRawMessageReference, VacancyDatabase } from "../db/database";
import { ChannelDiscoverySource } from "../types";
import { validateChannelInput } from "./channelValidation";

export type ChannelDiscoveryProviderCandidate = {
  username: string;
  title?: string | null;
  source: ChannelDiscoverySource;
  weight: number;
};

export type ChannelDiscoveryProviderResult = {
  provider: string;
  candidates: ChannelDiscoveryProviderCandidate[];
  warnings: string[];
};

export type ChannelDiscoveryProviderContext = {
  seedQueries: string[];
  manualSeeds: string[];
  activeChannelUsernames: string[];
};

export interface ChannelDiscoveryProvider {
  readonly name: string;
  isAvailable(): boolean;
  collect(context: ChannelDiscoveryProviderContext): Promise<ChannelDiscoveryProviderResult>;
}

export interface ChannelDiscoveryMtprotoSearchClient {
  searchPublicChannels(query: string, limit: number): Promise<Array<{ username: string; title?: string | null }>>;
  searchGlobalChannels(query: string, limit: number): Promise<Array<{ username: string; title?: string | null }>>;
  getChannelRecommendations(seedUsername: string, limit: number): Promise<Array<{ username: string; title?: string | null }>>;
}

function normalizeUsername(value: string): string | null {
  const validation = validateChannelInput(value);
  return validation.ok ? validation.value : null;
}

function uniqueCandidates(candidates: ChannelDiscoveryProviderCandidate[]): ChannelDiscoveryProviderCandidate[] {
  const byUsername = new Map<string, ChannelDiscoveryProviderCandidate>();
  for (const candidate of candidates) {
    const username = normalizeUsername(candidate.username);
    if (!username) {
      continue;
    }
    const existing = byUsername.get(username);
    if (!existing || candidate.weight > existing.weight) {
      byUsername.set(username, { ...candidate, username });
    }
  }
  return [...byUsername.values()];
}

export class ManualSeedDiscoveryProvider implements ChannelDiscoveryProvider {
  readonly name = "manual_seed";

  isAvailable(): boolean {
    return true;
  }

  async collect(context: ChannelDiscoveryProviderContext): Promise<ChannelDiscoveryProviderResult> {
    return {
      provider: this.name,
      candidates: uniqueCandidates(
        context.manualSeeds.map((username) => ({
          username,
          source: "manual_seed",
          weight: 100
        }))
      ),
      warnings: []
    };
  }
}

type MentionStats = {
  username: string;
  linkCount: number;
  mentionCount: number;
  sourceChannels: Set<string>;
};

function collectMentionStats(rows: RecentRawMessageReference[]): MentionStats[] {
  const stats = new Map<string, MentionStats>();
  const get = (value: string): MentionStats | null => {
    const username = normalizeUsername(value);
    if (!username) {
      return null;
    }
    const current = stats.get(username) ?? {
      username,
      linkCount: 0,
      mentionCount: 0,
      sourceChannels: new Set<string>()
    };
    stats.set(username, current);
    return current;
  };

  for (const row of rows) {
    for (const match of row.text.matchAll(/(?:https?:\/\/)?t\.me\/(?:s\/)?([a-zA-Z0-9_]{5,32})(?:[/?#]\S*)?/giu)) {
      const current = get(match[1] ?? "");
      if (current) {
        current.linkCount += 1;
        current.sourceChannels.add(row.sourceChannel);
      }
    }
    for (const match of row.text.matchAll(/(^|[^a-zA-Z0-9_])@([a-zA-Z0-9_]{5,32})\b/gu)) {
      const current = get(match[2] ?? "");
      if (current) {
        current.mentionCount += 1;
        current.sourceChannels.add(row.sourceChannel);
      }
    }
  }
  return [...stats.values()];
}

export class TelegramMentionGraphProvider implements ChannelDiscoveryProvider {
  readonly name = "mention_graph";

  constructor(
    private readonly config: AppConfig,
    private readonly database: VacancyDatabase
  ) {}

  isAvailable(): boolean {
    return true;
  }

  async collect(): Promise<ChannelDiscoveryProviderResult> {
    const rows = this.database.listRecentActiveChannelRawMessageReferences(
      this.config.channelDiscoveryRecentRawDays,
      this.config.channelDiscoveryMaxCandidates * 100
    );
    const candidates: ChannelDiscoveryProviderCandidate[] = [];
    for (const stat of collectMentionStats(rows)) {
      if (stat.username.endsWith("_bot")) {
        continue;
      }
      if (stat.linkCount > 0) {
        candidates.push({
          username: stat.username,
          source: "mention_graph_link",
          weight: 20 + stat.linkCount * 3 + stat.sourceChannels.size * 8
        });
      }
      if (stat.mentionCount >= 3 || stat.sourceChannels.size >= 2) {
        candidates.push({
          username: stat.username,
          source: "mention_graph_username",
          weight: stat.mentionCount + stat.sourceChannels.size * 6
        });
      }
    }
    return { provider: this.name, candidates: uniqueCandidates(candidates), warnings: [] };
  }
}

export class MtprotoDiscoveryProvider implements ChannelDiscoveryProvider {
  readonly name = "mtproto";

  constructor(
    private readonly config: AppConfig,
    private readonly client: ChannelDiscoveryMtprotoSearchClient,
    private readonly forceAvailable = false
  ) {}

  isAvailable(): boolean {
    return this.forceAvailable || hasTelegramCredentials(this.config);
  }

  async collect(context: ChannelDiscoveryProviderContext): Promise<ChannelDiscoveryProviderResult> {
    if (!this.isAvailable()) {
      return { provider: this.name, candidates: [], warnings: [] };
    }
    const candidates: ChannelDiscoveryProviderCandidate[] = [];
    const warnings: string[] = [];
    for (const query of context.seedQueries) {
      for (const [method, weight] of [
        ["searchPublicChannels", 20],
        ["searchGlobalChannels", 18]
      ] as const) {
        try {
          const refs = await this.client[method](query, this.config.channelDiscoveryQueryLimit);
          candidates.push(...refs.map((ref) => ({ ...ref, source: "mtproto_search" as const, weight })));
        } catch (error) {
          warnings.push(`${method} failed for "${query}": ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    for (const username of context.activeChannelUsernames) {
      try {
        const refs = await this.client.getChannelRecommendations(username, this.config.channelDiscoveryQueryLimit);
        candidates.push(...refs.map((ref) => ({ ...ref, source: "mtproto_recommendation" as const, weight: 30 })));
      } catch (error) {
        warnings.push(`recommendations failed for @${username}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { provider: this.name, candidates: uniqueCandidates(candidates), warnings };
  }
}

export class DuckDuckGoDiscoveryProvider implements ChannelDiscoveryProvider {
  readonly name = "duckduckgo";

  constructor(
    private readonly config: AppConfig,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  isAvailable(): boolean {
    return this.config.channelDiscoveryDuckDuckGoEnabled;
  }

  async collect(context: ChannelDiscoveryProviderContext): Promise<ChannelDiscoveryProviderResult> {
    if (!this.isAvailable()) {
      return { provider: this.name, candidates: [], warnings: [] };
    }
    const candidates: ChannelDiscoveryProviderCandidate[] = [];
    const warnings: string[] = [];
    for (const query of context.seedQueries) {
      try {
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(`site:t.me/s ${query}`)}`;
        const response = await this.fetchImpl(url, {
          headers: { "user-agent": "Mozilla/5.0 (compatible; JobChannelDiscovery/0.1)" },
          redirect: "error",
          signal: AbortSignal.timeout(this.config.channelDiscoveryDuckDuckGoTimeoutMs)
        });
        const declaredLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
        if (Number.isFinite(declaredLength) && declaredLength > this.config.channelDiscoveryDuckDuckGoMaxResponseBytes) {
          throw new Error("response is too large");
        }
        const html = await response.text();
        if (Buffer.byteLength(html, "utf8") > this.config.channelDiscoveryDuckDuckGoMaxResponseBytes) {
          throw new Error("response is too large");
        }
        if (response.status === 202 || /captcha|anomaly-modal|bots use duckduckgo/iu.test(html)) {
          warnings.push("DuckDuckGo blocked the request with a CAPTCHA.");
          break;
        }
        if (!response.ok) {
          warnings.push(`DuckDuckGo returned HTTP ${response.status}.`);
          continue;
        }
        if (!/result__a|result-link|links_main/iu.test(html)) {
          warnings.push("DuckDuckGo returned unexpected HTML.");
          continue;
        }
        for (const match of html.matchAll(/t\.me(?:%2F|\/)(?:s(?:%2F|\/))?([A-Za-z0-9_]{5,32})/giu)) {
          candidates.push({ username: match[1] ?? "", source: "duckduckgo_search", weight: 15 });
        }
      } catch (error) {
        warnings.push(`DuckDuckGo failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { provider: this.name, candidates: uniqueCandidates(candidates), warnings: [...new Set(warnings)] };
  }
}
