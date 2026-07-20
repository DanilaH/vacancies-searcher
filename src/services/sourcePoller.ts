import { logger } from "../logger";
import { PollCycleSummary, RawVacancyItem, VacancySource } from "../types";

type SourceItemHandler = (item: RawVacancyItem) => Promise<string[]>;
type PauseCheck = () => boolean | Promise<boolean>;
type IntervalSecondsProvider = () => number | Promise<number>;
type IntervalChangeSubscriber = (listener: () => void) => () => void;
type CycleCompletedHandler = (summary: PollCycleSummary) => Promise<void>;
type CycleFailedHandler = (error: unknown, sourceName: VacancySource["name"]) => Promise<void>;

export class SourcePoller {
  private timer?: NodeJS.Timeout;
  private inFlight?: Promise<void>;
  private stopped = false;
  private lastCycleCompletedAt?: number;
  private unsubscribeIntervalChanges?: () => void;

  constructor(
    private readonly source: VacancySource,
    private readonly intervalSecondsProvider: IntervalSecondsProvider,
    private readonly handler: SourceItemHandler,
    private readonly pauseCheck?: PauseCheck,
    private readonly subscribeToIntervalChanges?: IntervalChangeSubscriber,
    private readonly cycleCompleted?: CycleCompletedHandler,
    private readonly cycleFailed?: CycleFailedHandler
  ) {}

  async start(): Promise<void> {
    this.stopped = false;

    if (this.subscribeToIntervalChanges) {
      this.unsubscribeIntervalChanges = this.subscribeToIntervalChanges(() => {
        void this.handleIntervalChange();
      });
    }

    logger.info({ source: this.source.name }, "Initial vacancy source search started.");
    await this.runCycle();
    logger.info({ source: this.source.name }, "Initial vacancy source search completed.");
    await this.scheduleNextRun();
  }

  async stop(): Promise<void> {
    this.stopped = true;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }

    this.unsubscribeIntervalChanges?.();
    this.unsubscribeIntervalChanges = undefined;
    await this.inFlight;
  }

  private async scheduleNextRun(): Promise<void> {
    if (this.stopped) {
      return;
    }

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }

    const intervalSeconds = await this.intervalSecondsProvider();
    const safeIntervalSeconds = Number.isFinite(intervalSeconds) && intervalSeconds > 0 ? intervalSeconds : 60;
    const baseTimestamp = this.lastCycleCompletedAt ?? Date.now();
    const scheduledAt = baseTimestamp + safeIntervalSeconds * 1000;
    const delayMs = Math.max(0, scheduledAt - Date.now());

    this.timer = setTimeout(() => {
      void this.runScheduledCycle();
    }, delayMs);
    this.timer.unref();
  }

  private async runScheduledCycle(): Promise<void> {
    await this.runCycle();
    await this.scheduleNextRun();
  }

  private async runCycle(): Promise<void> {
    if (this.stopped || this.inFlight) {
      return;
    }

    this.inFlight = (async () => {
      try {
        if (this.pauseCheck && (await this.pauseCheck())) {
          logger.debug({ source: this.source.name }, "Vacancy source polling skipped because bot is paused.");
          return;
        }

        const items = await this.source.fetchLatest();
        let newVacanciesCount = 0;
        const usersWithNewVacancies = new Set<string>();

        for (const item of items) {
          if (this.stopped) {
            break;
          }

          const matchedUserIds = await this.handler(item);
          if (matchedUserIds.length > 0) {
            newVacanciesCount += 1;
            for (const userId of matchedUserIds) {
              usersWithNewVacancies.add(userId);
            }
          }
        }

        if (!this.stopped && this.cycleCompleted) {
          await this.cycleCompleted({
            sourceName: this.source.name,
            fetchedItemsCount: items.length,
            newVacanciesCount,
            usersWithNewVacancies: [...usersWithNewVacancies]
          });
        }
      } catch (error) {
        logger.error({ err: error, source: this.source.name }, "Vacancy source polling cycle failed.");
        if (this.cycleFailed && !this.stopped) {
          await this.cycleFailed(error, this.source.name);
        }
      } finally {
        this.lastCycleCompletedAt = Date.now();
        this.inFlight = undefined;
      }
    })();

    await this.inFlight;
  }

  private async handleIntervalChange(): Promise<void> {
    if (this.stopped || this.inFlight || !this.timer) {
      return;
    }

    await this.scheduleNextRun();
  }
}
