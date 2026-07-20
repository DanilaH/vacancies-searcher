import { load } from "cheerio";

import { AppConfig } from "../config";
import { logger } from "../logger";
import { RuntimeSettingsService } from "../runtime/runtimeSettings";
import { ChannelCheckSuccessState, ChannelRegistry, MonitoredChannel, RawVacancyItem, VacancySource } from "../types";
import { sleep } from "../utils/sleep";
import { htmlFragmentToText } from "../utils/htmlToText";
import { splitTelegramMultiVacancyPost } from "../services/telegramMultiVacancySplitter";

type FetchLike = typeof fetch;

export type ParsedTelegramWebPreviewPage = {
  items: RawVacancyItem[];
  nextBefore?: string;
  highestMessageId?: string;
  oldestMessageId?: string;
};

type ChannelFetchResult = {
  items: RawVacancyItem[];
  highestSeenMessageId: string | null;
};

type ChannelFetchMode = {
  pageHistory: boolean;
  ignoreLastSeen: boolean;
  markBackfillCompleted: boolean;
};

const MESSAGE_ID_PATTERN = /^\d{1,20}$/;
const MAX_IDLE_BACKOFF_MS = 24 * 60 * 60 * 1000;
const CATCH_UP_STALE_MS = 6 * 60 * 60 * 1000;

const DEFAULT_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
};

function compareMessageIds(left: string, right: string): number {
  if (left.length !== right.length) {
    return left.length - right.length;
  }

  if (left === right) {
    return 0;
  }

  return left > right ? 1 : -1;
}

function maxMessageId(current: string | null, next: string | null): string | null {
  if (!current) {
    return next;
  }

  if (!next) {
    return current;
  }

  return compareMessageIds(current, next) >= 0 ? current : next;
}

function getHighestMessageId(items: RawVacancyItem[]): string | null {
  let highestMessageId: string | null = null;

  for (const item of items) {
    highestMessageId = maxMessageId(highestMessageId, item.cursorMessageId ?? item.messageId);
  }

  return highestMessageId;
}

export function parseTelegramWebPreviewPage(
  channel: string,
  html: string,
  onWarning?: (message: string, meta?: Record<string, unknown>) => void
): ParsedTelegramWebPreviewPage {
  const $ = load(html);
  const items: RawVacancyItem[] = [];
  let oldestMessageId: string | undefined;
  let highestMessageId: string | undefined;
  const expectedChannel = channel.toLowerCase();

  $(".tgme_widget_message").each((_, element) => {
    const post = $(element).attr("data-post")?.trim();
    if (!post || !post.includes("/")) {
      onWarning?.("Skipped web preview post without data-post.", { channel });
      return;
    }

    const [postChannel, messageId] = post.split("/", 2);
    if (!postChannel || !messageId) {
      onWarning?.("Skipped web preview post with malformed data-post.", { channel, post });
      return;
    }

    const normalizedPostChannel = postChannel.toLowerCase();
    if (normalizedPostChannel !== expectedChannel) {
      onWarning?.("Skipped web preview post from unexpected channel.", {
        channel: expectedChannel,
        postChannel: normalizedPostChannel,
        messageId
      });
      return;
    }

    if (!MESSAGE_ID_PATTERN.test(messageId)) {
      onWarning?.("Skipped web preview post with invalid message id.", {
        channel: normalizedPostChannel,
        messageId
      });
      return;
    }

    oldestMessageId = !oldestMessageId || compareMessageIds(messageId, oldestMessageId) < 0 ? messageId : oldestMessageId;
    highestMessageId = !highestMessageId || compareMessageIds(messageId, highestMessageId) > 0 ? messageId : highestMessageId;

    const textContainer = $(element)
      .find(".tgme_widget_message_text, .tgme_widget_message_caption")
      .first();
    const text = htmlFragmentToText(textContainer.html());

    if (!text) {
      onWarning?.("Skipped web preview post without text.", {
        channel: postChannel,
        messageId
      });
      return;
    }

    const date = $(element).find("time[datetime]").first().attr("datetime")?.trim() || undefined;
    const linkEntities = textContainer
      .find("a[href]")
      .map((position, anchor) => ({
        text: $(anchor).text().trim(),
        url: $(anchor).attr("href")?.trim() ?? "",
        position
      }))
      .get()
      .filter((link) => link.text && /^https?:\/\//iu.test(link.url));
    const rawItem: RawVacancyItem = {
      source: "telegram_web_preview",
      channel: normalizedPostChannel,
      messageId,
      text,
      date,
      url: `https://t.me/${normalizedPostChannel}/${messageId}`,
      ...(linkEntities.length > 0 ? { linkEntities } : {})
    };
    items.push(...splitTelegramMultiVacancyPost(rawItem).items);
  });

  items.sort((left, right) => compareMessageIds(left.cursorMessageId ?? left.messageId, right.cursorMessageId ?? right.messageId));

  return {
    items,
    nextBefore: oldestMessageId,
    highestMessageId,
    oldestMessageId
  };
}

export class TelegramWebPreviewSource implements VacancySource {
  readonly name = "telegram_web_preview" as const;

  private readonly fetchImpl: FetchLike;
  private readonly backfilledChannels = new Set<string>();
  private readonly lastSeenMessageIds = new Map<string, string>();
  private readonly idlePollStreaks = new Map<string, number>();
  private readonly nextPollAfterByChannel = new Map<string, string>();
  private readonly channelRegistry?: ChannelRegistry;
  private readonly runtimeSettings?: RuntimeSettingsService;
  private stopped = false;

  constructor(
    private readonly config: AppConfig,
    options?: {
      fetchImpl?: FetchLike;
      channelRegistry?: ChannelRegistry;
      runtimeSettings?: RuntimeSettingsService;
    }
  ) {
    this.fetchImpl = options?.fetchImpl ?? fetch;
    this.channelRegistry = options?.channelRegistry;
    this.runtimeSettings = options?.runtimeSettings;
  }

  async fetchLatest(): Promise<RawVacancyItem[]> {
    const allItems: RawVacancyItem[] = [];
    const channels = this.resolveChannels();
    const settings = this.getRuntimeSnapshot();

    for (let index = 0; index < channels.length; index += 1) {
      if (this.stopped) {
        break;
      }

      const channel = channels[index];
      if (this.shouldSkipPolling(channel)) {
        continue;
      }

      const fetchMode = this.getFetchMode(channel);

      try {
        const result = await this.fetchChannel(channel, fetchMode, settings);
        allItems.push(...result.items);
        this.markChannelSuccess(
          channel,
          fetchMode.markBackfillCompleted,
          this.buildSuccessState(channel, result.highestSeenMessageId, settings.checkIntervalSeconds)
        );
      } catch (error) {
        logger.error({ err: error, channel: channel.username }, "Failed to fetch channel via Telegram web preview.");
        this.markChannelFailure(channel, error);
      }

      if (index < channels.length - 1) {
        await sleep(settings.webPreviewChannelDelayMs);
      }
    }

    return allItems;
  }

  async stop(): Promise<void> {
    this.stopped = true;
  }

  private resolveChannels(): MonitoredChannel[] {
    if (this.channelRegistry) {
      return this.channelRegistry.listActiveChannels(this.name);
    }

    return this.config.channels.map((username) => ({
      id: 0,
      username,
      sourceName: this.name,
      isActive: true,
      initialBackfillCompleted: this.backfilledChannels.has(username),
      lastSeenMessageId: this.lastSeenMessageIds.get(username) ?? null,
      idlePollStreak: this.idlePollStreaks.get(username) ?? 0,
      nextPollAfter: this.nextPollAfterByChannel.get(username) ?? null,
      lastCheckedAt: null,
      lastSuccessAt: null,
      lastError: null,
      addedByUserId: null,
      createdAt: "",
      updatedAt: ""
    }));
  }

  private shouldIncludeBackfill(channel: MonitoredChannel): boolean {
    if (this.channelRegistry) {
      return !channel.initialBackfillCompleted;
    }

    return !this.backfilledChannels.has(channel.username);
  }

  private shouldIncludeCatchUp(channel: MonitoredChannel): boolean {
    if (!this.channelRegistry || !channel.initialBackfillCompleted || !channel.lastSuccessAt) {
      return false;
    }

    const lastSuccessTimestamp = Date.parse(channel.lastSuccessAt);
    return !Number.isNaN(lastSuccessTimestamp) && Date.now() - lastSuccessTimestamp >= CATCH_UP_STALE_MS;
  }

  private getFetchMode(channel: MonitoredChannel): ChannelFetchMode {
    if (this.shouldIncludeBackfill(channel)) {
      return {
        pageHistory: true,
        ignoreLastSeen: true,
        markBackfillCompleted: true
      };
    }

    if (this.shouldIncludeCatchUp(channel)) {
      return {
        pageHistory: true,
        ignoreLastSeen: false,
        markBackfillCompleted: false
      };
    }

    return {
      pageHistory: false,
      ignoreLastSeen: false,
      markBackfillCompleted: false
    };
  }

  private shouldSkipPolling(channel: MonitoredChannel): boolean {
    if (!channel.nextPollAfter) {
      return false;
    }

    const nextPollTimestamp = Date.parse(channel.nextPollAfter);
    return !Number.isNaN(nextPollTimestamp) && nextPollTimestamp > Date.now();
  }

  private hasObservedNewMessageIds(previousLastSeenMessageId: string | null, highestSeenMessageId: string | null): boolean {
    if (!highestSeenMessageId) {
      return false;
    }

    if (!previousLastSeenMessageId) {
      return true;
    }

    return compareMessageIds(highestSeenMessageId, previousLastSeenMessageId) > 0;
  }

  private buildNextPollAfter(idlePollStreak: number, checkIntervalSeconds: number): string | null {
    if (idlePollStreak < 5) {
      return null;
    }

    const multiplier = idlePollStreak >= 30 ? 8 : idlePollStreak >= 15 ? 4 : 2;
    const baseIntervalSeconds = Number.isFinite(checkIntervalSeconds) && checkIntervalSeconds > 0 ? checkIntervalSeconds : 1;
    const delayMs = Math.min(baseIntervalSeconds * 1000 * multiplier, MAX_IDLE_BACKOFF_MS);
    return new Date(Date.now() + delayMs).toISOString();
  }

  private buildSuccessState(
    channel: MonitoredChannel,
    highestSeenMessageId: string | null,
    checkIntervalSeconds: number
  ): ChannelCheckSuccessState {
    const nextLastSeenMessageId = maxMessageId(channel.lastSeenMessageId, highestSeenMessageId);
    const hasNewMessageIds = this.hasObservedNewMessageIds(channel.lastSeenMessageId, highestSeenMessageId);
    const idlePollStreak = hasNewMessageIds ? 0 : channel.idlePollStreak + 1;

    return {
      lastSeenMessageId: nextLastSeenMessageId,
      idlePollStreak,
      nextPollAfter: this.buildNextPollAfter(idlePollStreak, checkIntervalSeconds)
    };
  }

  private markChannelSuccess(
    channel: MonitoredChannel,
    includeBackfill: boolean,
    state: ChannelCheckSuccessState
  ): void {
    if (this.channelRegistry) {
      this.channelRegistry.markChannelCheckSuccess(channel.id, state);
      if (includeBackfill) {
        this.channelRegistry.markChannelBackfillCompleted(channel.id);
      }
      return;
    }

    if (state.lastSeenMessageId) {
      this.lastSeenMessageIds.set(channel.username, state.lastSeenMessageId);
    }
    this.idlePollStreaks.set(channel.username, state.idlePollStreak);
    if (state.nextPollAfter) {
      this.nextPollAfterByChannel.set(channel.username, state.nextPollAfter);
    } else {
      this.nextPollAfterByChannel.delete(channel.username);
    }
    this.backfilledChannels.add(channel.username);
  }

  private markChannelFailure(channel: MonitoredChannel, error: unknown): void {
    if (!this.channelRegistry || channel.id <= 0) {
      return;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    this.channelRegistry.markChannelCheckFailure(channel.id, errorMessage);
  }

  private async fetchChannel(
    channel: MonitoredChannel,
    mode: ChannelFetchMode,
    settings: ReturnType<TelegramWebPreviewSource["getRuntimeSnapshot"]>
  ): Promise<ChannelFetchResult> {
    const thresholdMs = Date.now() - settings.initialBackfillDays * 24 * 60 * 60 * 1000;
    const pages: RawVacancyItem[][] = [];
    let collectedItems = 0;
    let before: string | undefined;
    let highestSeenMessageId: string | null = null;
    const previousLastSeenMessageId = mode.ignoreLastSeen ? null : channel.lastSeenMessageId;

    for (let pageIndex = 0; pageIndex < settings.webPreviewMaxPagesPerChannel; pageIndex += 1) {
      const html = await this.fetchHtmlWithRetry(this.buildPageUrl(channel.username, before), channel.username);
      const parsed = parseTelegramWebPreviewPage(channel.username, html, (message, meta) => {
        logger.warn({ channel: channel.username, ...meta }, message);
      });
      highestSeenMessageId = maxMessageId(highestSeenMessageId, parsed.highestMessageId ?? getHighestMessageId(parsed.items));

      if (parsed.items.length === 0 && (!mode.pageHistory || !parsed.nextBefore || parsed.nextBefore === before)) {
        break;
      }

      const filteredItems = parsed.items
        .filter((item) => {
          if (!item.date) {
            return true;
          }

          const parsedDate = Date.parse(item.date);
          return Number.isNaN(parsedDate) || parsedDate >= thresholdMs;
        })
        .filter((item) => {
          if (!previousLastSeenMessageId) {
            return true;
          }

          return compareMessageIds(item.cursorMessageId ?? item.messageId, previousLastSeenMessageId) > 0;
        });

      const remainingItems = settings.webPreviewMaxItemsPerChannel - collectedItems;
      if (remainingItems <= 0) {
        break;
      }

      const pageItems = filteredItems.slice(0, remainingItems);
      pages.push(pageItems);
      collectedItems += pageItems.length;

      if (!mode.pageHistory) {
        break;
      }

      if (
        previousLastSeenMessageId &&
        parsed.oldestMessageId &&
        compareMessageIds(parsed.oldestMessageId, previousLastSeenMessageId) <= 0
      ) {
        break;
      }

      if (pageItems.length < filteredItems.length) {
        break;
      }

      const oldestTimestamp = this.findOldestTimestamp(parsed.items);
      if (oldestTimestamp !== null && oldestTimestamp < thresholdMs) {
        break;
      }

      if (!parsed.nextBefore || parsed.nextBefore === before) {
        break;
      }

      before = parsed.nextBefore;
      await sleep(Math.max(250, Math.floor(settings.webPreviewChannelDelayMs / 3)));
    }

    return {
      items: pages.reverse().flat(),
      highestSeenMessageId
    };
  }

  private buildPageUrl(channel: string, before?: string): string {
    const url = new URL(`https://t.me/s/${channel}`);
    if (before) {
      url.searchParams.set("before", before);
    }
    return url.toString();
  }

  private async fetchHtmlWithRetry(url: string, channel: string): Promise<string> {
    const settings = this.getRuntimeSnapshot();
    let lastError: unknown;

    for (let attempt = 0; attempt <= settings.webPreviewRetryCount; attempt += 1) {
      try {
        const response = await this.fetchImpl(url, {
          headers: DEFAULT_HEADERS,
          redirect: "error",
          signal: AbortSignal.timeout(settings.webPreviewRequestTimeoutMs)
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status} for ${url}`);
        }

        const declaredLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
        if (Number.isFinite(declaredLength) && declaredLength > this.config.webPreviewMaxResponseBytes) {
          throw new Error(
            `HTTP response too large for ${url}. Declared ${declaredLength} bytes exceeds ${this.config.webPreviewMaxResponseBytes}.`
          );
        }

        return await this.readResponseText(response);
      } catch (error) {
        lastError = error;

        if (attempt >= settings.webPreviewRetryCount) {
          break;
        }

        logger.warn(
          {
            err: error,
            channel,
            attempt: attempt + 1,
            retryCount: settings.webPreviewRetryCount
          },
          "Telegram web preview request failed. Retrying."
        );

        await sleep((attempt + 1) * 1000);
      }
    }

    throw lastError instanceof Error ? lastError : new Error(`Failed to fetch ${url}`);
  }

  private async readResponseText(response: Response): Promise<string> {
    if (!response.body) {
      const text = await response.text();
      const textSize = Buffer.byteLength(text, "utf8");
      if (textSize > this.config.webPreviewMaxResponseBytes) {
        throw new Error(
          `HTTP response too large. Received ${textSize} bytes, limit is ${this.config.webPreviewMaxResponseBytes}.`
        );
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
      if (totalBytes > this.config.webPreviewMaxResponseBytes) {
        await reader.cancel();
        throw new Error(
          `HTTP response too large. Received more than ${this.config.webPreviewMaxResponseBytes} bytes.`
        );
      }

      chunks.push(value);
    }

    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
  }

  private findOldestTimestamp(items: RawVacancyItem[]): number | null {
    let oldestTimestamp: number | null = null;

    for (const item of items) {
      if (!item.date) {
        continue;
      }

      const timestamp = Date.parse(item.date);
      if (Number.isNaN(timestamp)) {
        continue;
      }

      if (oldestTimestamp === null || timestamp < oldestTimestamp) {
        oldestTimestamp = timestamp;
      }
    }

    return oldestTimestamp;
  }

  private getRuntimeSnapshot() {
    return (
      this.runtimeSettings?.getSnapshot() ?? {
        checkIntervalSeconds: this.config.checkIntervalSeconds,
        initialBackfillDays: this.config.initialBackfillDays,
        weeklyPageSize: this.config.weeklyPageSize,
        webPreviewMaxPagesPerChannel: this.config.webPreviewMaxPagesPerChannel,
        webPreviewChannelDelayMs: this.config.webPreviewChannelDelayMs,
        webPreviewRetryCount: this.config.webPreviewRetryCount,
        webPreviewRequestTimeoutMs: this.config.webPreviewRequestTimeoutMs,
        webPreviewMaxItemsPerChannel: this.config.webPreviewMaxItemsPerChannel
      }
    );
  }
}
