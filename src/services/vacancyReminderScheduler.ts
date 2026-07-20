import { VacancyDatabase } from "../db/database";
import { logger } from "../logger";
import { VacancyReminderRecord } from "../types";

type ReminderDelivery = (reminder: VacancyReminderRecord) => Promise<boolean>;

const DEFAULT_INTERVAL_MS = 60_000;
const RETRY_BASE_MS = 5 * 60_000;
const RETRY_MAX_MS = 6 * 60 * 60_000;

export class VacancyReminderScheduler {
  private timer?: NodeJS.Timeout;
  private inFlight?: Promise<void>;
  private stopped = false;

  constructor(
    private readonly database: VacancyDatabase,
    private readonly deliver: ReminderDelivery,
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
      for (const reminder of this.database.listDueVacancyReminders(now)) {
        if (this.stopped) {
          break;
        }

        try {
          const delivered = await this.deliver(reminder);
          if (delivered) {
            this.database.markVacancyReminderDelivered(
              reminder.userId,
              reminder.id,
              reminder.nextAttemptAt,
              now.toISOString()
            );
            continue;
          }

          this.markFailed(reminder, now, "Reminder delivery returned false.");
        } catch (error) {
          logger.warn(
            { err: error, userId: reminder.userId, vacancyId: reminder.id },
            "Failed to deliver vacancy reminder."
          );
          this.markFailed(reminder, now, error instanceof Error ? error.message : String(error));
        }
      }
    })();

    try {
      await this.inFlight;
    } finally {
      this.inFlight = undefined;
    }
  }

  private markFailed(reminder: VacancyReminderRecord, now: Date, error: string): void {
    const retryDelay = Math.min(RETRY_BASE_MS * 2 ** reminder.attemptCount, RETRY_MAX_MS);
    const nextAttemptAt = new Date(now.getTime() + retryDelay).toISOString();
    this.database.markVacancyReminderFailed(
      reminder.userId,
      reminder.id,
      reminder.nextAttemptAt,
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
