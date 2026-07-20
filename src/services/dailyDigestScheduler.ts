import { VacancyDatabase } from "../db/database";
import { logger } from "../logger";
import { DailyDigestDueRecord, DailyDigestPayload } from "../types";
import {
  formatDigestScheduledFor,
  getLocalDigestDateParts,
  resolveDailyDigestTimeMinutes
} from "./dailyDigestSchedule";

type DailyDigestDelivery = (digest: DailyDigestDueRecord) => Promise<boolean>;
type DailyDigestSkipped = (payload: DailyDigestPayload) => Promise<void>;
type DailyDigestFailed = (digest: DailyDigestDueRecord, error: string) => Promise<void>;

const DEFAULT_INTERVAL_MS = 5 * 60_000;
const RETRY_BASE_MS = 5 * 60_000;
const RETRY_MAX_MS = 6 * 60 * 60_000;

export function hasActionableDailyDigest(payload: DailyDigestPayload): boolean {
  return payload.newVacanciesCount + payload.savedWithoutActionCount + payload.dueApplicationFollowUpsCount > 0;
}

export class DailyDigestScheduler {
  private timer?: NodeJS.Timeout;
  private inFlight?: Promise<void>;
  private stopped = false;

  constructor(
    private readonly database: VacancyDatabase,
    private readonly timeZone: string,
    private readonly deliver: DailyDigestDelivery,
    private readonly onSkipped: DailyDigestSkipped = async () => {},
    private readonly onFailed: DailyDigestFailed = async () => {},
    private readonly intervalMs = DEFAULT_INTERVAL_MS
  ) {}

  async start(): Promise<void> {
    this.stopped = false;
    await this.runDueCycle();
    this.scheduleNextRun();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    await this.inFlight;
  }

  async runDueCycle(now = new Date()): Promise<void> {
    if (this.stopped || this.inFlight) {
      return this.inFlight;
    }

    this.inFlight = (async () => {
      const local = getLocalDigestDateParts(now, this.timeZone);

      for (const user of this.database.listDailyDigestEnabledUsers()) {
        if (this.stopped) {
          break;
        }

        const scheduledMinutes = resolveDailyDigestTimeMinutes(user.dailyDigestTimeMinutes);
        if (local.minutes < scheduledMinutes) {
          continue;
        }

        const scheduledFor = formatDigestScheduledFor(local.date, scheduledMinutes, this.timeZone);
        const deliveryState = this.database.getDailyDigestDelivery(user.userId, local.date);
        if (deliveryState?.deliveredAt || deliveryState?.skippedAt) {
          continue;
        }
        if (deliveryState?.nextAttemptAt && Date.parse(deliveryState.nextAttemptAt) > now.getTime()) {
          continue;
        }

        const payload = this.database.buildDailyDigestPayload(user.userId, local.date, scheduledFor, now);
        const digest: DailyDigestDueRecord = {
          ...payload,
          nextAttemptAt: deliveryState?.nextAttemptAt ?? now.toISOString(),
          attemptCount: deliveryState?.attemptCount ?? 0,
          lastError: deliveryState?.lastError ?? null
        };

        if (!hasActionableDailyDigest(payload)) {
          this.database.markDailyDigestSkipped(user.userId, local.date, scheduledFor, now.toISOString());
          await this.onSkipped(payload);
          continue;
        }

        try {
          const delivered = await this.deliver(digest);
          if (delivered) {
            this.database.markDailyDigestDelivered(user.userId, local.date, scheduledFor, now.toISOString());
            continue;
          }

          await this.markFailed(digest, now, "Daily digest delivery returned false.");
        } catch (error) {
          logger.warn({ err: error, userId: user.userId }, "Failed to deliver daily digest.");
          await this.markFailed(digest, now, error instanceof Error ? error.message : String(error));
        }
      }
    })();

    try {
      await this.inFlight;
    } finally {
      this.inFlight = undefined;
    }
  }

  private async markFailed(digest: DailyDigestDueRecord, now: Date, error: string): Promise<void> {
    const retryDelay = Math.min(RETRY_BASE_MS * 2 ** digest.attemptCount, RETRY_MAX_MS);
    const nextAttemptAt = new Date(now.getTime() + retryDelay).toISOString();
    this.database.markDailyDigestFailed(
      digest.userId,
      digest.digestDate,
      digest.scheduledFor,
      nextAttemptAt,
      error
    );
    await this.onFailed(digest, error);
  }

  private scheduleNextRun(): void {
    if (this.stopped) {
      return;
    }
    this.timer = setTimeout(() => {
      void this.runScheduledCycle();
    }, this.intervalMs);
    this.timer.unref();
  }

  private async runScheduledCycle(): Promise<void> {
    await this.runDueCycle();
    this.scheduleNextRun();
  }
}
