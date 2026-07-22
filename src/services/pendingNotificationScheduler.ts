import { VacancyDatabase } from "../db/database";
import { logger } from "../logger";
import { PendingNotificationRecord } from "../types";

type PendingNotificationDelivery = (userId: string, vacancyId: number) => Promise<boolean>;

const DEFAULT_INTERVAL_MS = 60_000;
const RETRY_BASE_MS = 5 * 60_000;
const RETRY_MAX_MS = 6 * 60 * 60_000;
const MAX_DELIVERY_ATTEMPTS = 10;

export class PendingNotificationScheduler {
  private timer?: NodeJS.Timeout;
  private inFlight?: Promise<void>;
  private stopped = false;

  constructor(
    private readonly database: VacancyDatabase,
    private readonly deliver: PendingNotificationDelivery,
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
      for (const item of this.database.listDuePendingNotifications(now.toISOString())) {
        if (this.stopped) {
          break;
        }

        try {
          const result = await this.processItem(item, now);
          if (result === "skip") {
            continue;
          }
        } catch (error) {
          logger.warn(
            { err: error, userId: item.userId, vacancyId: item.vacancyId, pendingId: item.id },
            "Failed to process pending notification."
          );
          this.markFailed(item, now, error instanceof Error ? error.message : String(error));
        }
      }
    })();

    try {
      await this.inFlight;
    } finally {
      this.inFlight = undefined;
    }
  }

  private async processItem(
    item: PendingNotificationRecord,
    now: Date
  ): Promise<"delivered" | "cancelled" | "skip"> {
    const status = this.database.getUserVacancyStatus(item.userId, item.vacancyId);
    if (status === "hidden" || status === "applied") {
      this.database.cancelPendingNotificationsForVacancy(item.userId, item.vacancyId);
      logger.info(
        { userId: item.userId, vacancyId: item.vacancyId, status },
        "Pending notification cancelled because vacancy is hidden or applied."
      );
      return "cancelled";
    }

    const delivered = await this.deliver(item.userId, item.vacancyId);
    if (delivered) {
      this.database.markPendingNotificationDelivered(item.id);
      this.database.markUserVacancyDelivered(item.userId, item.vacancyId);
      logger.info(
        { userId: item.userId, vacancyId: item.vacancyId, pendingId: item.id },
        "Pending notification delivered."
      );
      return "delivered";
    }

    this.markFailed(item, now, "Pending notification delivery returned false.");
    logger.info(
      { userId: item.userId, vacancyId: item.vacancyId, pendingId: item.id },
      "Pending notification delivery failed, will retry."
    );
    return "skip";
  }

  private markFailed(item: PendingNotificationRecord, now: Date, error: string): void {
    if (item.retryCount >= MAX_DELIVERY_ATTEMPTS - 1) {
      this.database.markPendingNotificationDeadLetter(
        item.id,
        `max_delivery_attempts_exceeded: ${error}`
      );
      logger.warn(
        { userId: item.userId, vacancyId: item.vacancyId, retryCount: item.retryCount },
        "Pending notification dead-lettered after max delivery attempts."
      );
      return;
    }
    const retryDelay = Math.min(RETRY_BASE_MS * 2 ** item.retryCount, RETRY_MAX_MS);
    const nextScheduledAt = new Date(now.getTime() + retryDelay).toISOString();
    this.database.markPendingNotificationFailed(item.id, error, nextScheduledAt);
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
