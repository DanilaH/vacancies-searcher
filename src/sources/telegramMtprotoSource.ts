import { Api, TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";

import { AppConfig, hasTelegramCredentials } from "../config";
import { logger } from "../logger";
import { ChannelRegistry, MonitoredChannel, RawVacancyItem, VacancySource } from "../types";

export class TelegramMtprotoSource implements VacancySource {
  readonly name = "telegram_mtproto" as const;

  private client?: TelegramClient;
  private readonly backfilledChannels = new Set<string>();
  private readonly channelRegistry?: ChannelRegistry;

  constructor(
    private readonly config: AppConfig,
    options?: {
      channelRegistry?: ChannelRegistry;
    }
  ) {
    this.channelRegistry = options?.channelRegistry;
  }

  async fetchLatest(): Promise<RawVacancyItem[]> {
    if (!hasTelegramCredentials(this.config)) {
      throw new Error(
        "TELEGRAM_SOURCE_MODE=mtproto requires TELEGRAM_API_ID, TELEGRAM_API_HASH and TELEGRAM_SESSION."
      );
    }

    await this.ensureConnected();

    const allItems: RawVacancyItem[] = [];
    const channels = this.resolveChannels();

    for (const channel of channels) {
      try {
        const includeBackfill = this.shouldIncludeBackfill(channel);
        const channelItems = includeBackfill
          ? await this.backfillRecentHistory(channel.username)
          : await this.fetchRecentMessages(channel.username);

        allItems.push(...channelItems);
        this.markChannelSuccess(channel, includeBackfill);
      } catch (error) {
        logger.error({ err: error, channel: channel.username }, "Failed to fetch channel via MTProto.");
        this.markChannelFailure(channel, error);
      }
    }

    return allItems;
  }

  async stop(): Promise<void> {
    if (this.client) {
      await this.client.disconnect();
      this.client = undefined;
    }
  }

  private async ensureConnected(): Promise<void> {
    if (this.client) {
      return;
    }

    const session = new StringSession(this.config.telegramSession);
    const client = new TelegramClient(session, this.config.telegramApiId!, this.config.telegramApiHash!, {
      connectionRetries: 5
    });

    const connected = await client.connect();
    if (!connected) {
      throw new Error("GramJS failed to connect to Telegram.");
    }

    const authorized = await client.checkAuthorization();
    if (!authorized) {
      throw new Error("TELEGRAM_SESSION is not authorized. Re-run npm run auth:telegram.");
    }

    this.client = client;
    logger.info({ channels: this.resolveChannels().map((channel) => channel.username) }, "Telegram MTProto source connected.");
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
      initialBackfillCompleted: false,
      lastSeenMessageId: null,
      idlePollStreak: 0,
      nextPollAfter: null,
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

  private markChannelSuccess(channel: MonitoredChannel, includeBackfill: boolean): void {
    if (this.channelRegistry) {
      this.channelRegistry.markChannelCheckSuccess(channel.id, {
        lastSeenMessageId: channel.lastSeenMessageId,
        idlePollStreak: 0,
        nextPollAfter: null
      });
      if (includeBackfill) {
        this.channelRegistry.markChannelBackfillCompleted(channel.id);
      }
      return;
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

  private async backfillRecentHistory(channel: string): Promise<RawVacancyItem[]> {
    if (!this.client) {
      return [];
    }

    const thresholdMs = Date.now() - this.config.initialBackfillDays * 24 * 60 * 60 * 1000;
    const items: RawVacancyItem[] = [];

    for await (const message of this.client.iterMessages(channel)) {
      const mapped = this.mapApiMessageToItem(channel, message);
      if (!mapped) {
        continue;
      }

      const messageTime = Date.parse(mapped.date ?? "");
      if (!Number.isNaN(messageTime) && messageTime < thresholdMs) {
        break;
      }

      items.push(mapped);
    }

    return items.reverse();
  }

  private async fetchRecentMessages(channel: string): Promise<RawVacancyItem[]> {
    if (!this.client) {
      return [];
    }

    const messages = await this.client.getMessages(channel, { limit: 50 });

    return [...messages]
      .reverse()
      .map((message) => this.mapApiMessageToItem(channel, message))
      .filter((item): item is RawVacancyItem => item !== null);
  }

  private mapApiMessageToItem(channel: string, message: Api.Message): RawVacancyItem | null {
    if (!(message instanceof Api.Message)) {
      return null;
    }

    const text = message.message?.trim();
    if (!text) {
      return null;
    }

    return {
      source: this.name,
      channel,
      messageId: String(message.id),
      date: this.toIsoDate(message.date) ?? undefined,
      text,
      url: `https://t.me/${channel}/${message.id}`
    };
  }

  private toIsoDate(value: Date | number | undefined): string | null {
    if (!value) {
      return null;
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    const milliseconds = value > 10_000_000_000 ? value : value * 1000;
    const date = new Date(milliseconds);
    if (Number.isNaN(date.getTime())) {
      return null;
    }

    return date.toISOString();
  }
}
