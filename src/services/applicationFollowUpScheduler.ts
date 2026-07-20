import { VacancyDatabase } from "../db/database";
import { logger } from "../logger";
import { VacancyApplicationFollowUpRecord } from "../types";

type FollowUpDelivery = (followUp: VacancyApplicationFollowUpRecord) => Promise<boolean>;

const DEFAULT_INTERVAL_MS = 60_000;
const RETRY_BASE_MS = 5 * 60_000;
const RETRY_MAX_MS = 6 * 60 * 60_000;

export class ApplicationFollowUpScheduler {
  private timer?: NodeJS.Timeout;
  private inFlight?: Promise<void>;
  private stopped = false;

  constructor(
    private readonly database: VacancyDatabase,
    private readonly deliver: FollowUpDelivery,
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
      for (const followUp of this.database.listDueVacancyApplicationFollowUps(now)) {
        if (this.stopped) {
          break;
        }

        try {
          const delivered = await this.deliver(followUp);
          if (delivered) {
            this.database.markVacancyApplicationFollowUpDelivered(
              followUp.userId,
              followUp.id,
              followUp.nextAttemptAt,
              now.toISOString()
            );
            continue;
          }

          this.markFailed(followUp, now, "Application follow-up delivery returned false.");
        } catch (error) {
          logger.warn(
            { err: error, userId: followUp.userId, vacancyId: followUp.id },
            "Failed to deliver application follow-up."
          );
          this.markFailed(followUp, now, error instanceof Error ? error.message : String(error));
        }
      }
    })();

    try {
      await this.inFlight;
    } finally {
      this.inFlight = undefined;
    }
  }

  private markFailed(followUp: VacancyApplicationFollowUpRecord, now: Date, error: string): void {
    const retryDelay = Math.min(RETRY_BASE_MS * 2 ** followUp.attemptCount, RETRY_MAX_MS);
    const nextAttemptAt = new Date(now.getTime() + retryDelay).toISOString();
    this.database.markVacancyApplicationFollowUpFailed(
      followUp.userId,
      followUp.id,
      followUp.nextAttemptAt,
      nextAttemptAt,
      error
    );
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
