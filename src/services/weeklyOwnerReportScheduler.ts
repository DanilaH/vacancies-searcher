import { VacancyDatabase } from "../db/database";
import { logger } from "../logger";
import { buildWeeklyReport } from "./weeklyReport";
import type { AppConfig } from "../config";

const CHECK_INTERVAL_MS = 5 * 60_000;
const SCHEDULE_DAY = 1;
const SCHEDULE_HOUR = 9;
const SCHEDULE_MINUTE = 0;

type ReportDelivery = (text: string) => Promise<boolean>;

export interface LocalTimeInfo {
  weekKey: string;
  isMonday: boolean;
  minutes: number;
}

export class WeeklyOwnerReportScheduler {
  private timer?: NodeJS.Timeout;
  private inFlight?: Promise<void>;
  private stopped = false;

  constructor(
    private readonly database: VacancyDatabase,
    private readonly config: AppConfig,
    private readonly deliver: ReportDelivery,
    private readonly getNow: () => Date = () => new Date()
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

  async runDueCycle(now = this.getNow()): Promise<void> {
    if (this.stopped) {
      return;
    }

    const ownerId = this.config.ownerUserId;
    if (!ownerId) {
      return;
    }

    const local = this.getLocalTimeInfo(now);
    if (!local.isMonday || local.minutes < SCHEDULE_HOUR * 60 + SCHEDULE_MINUTE) {
      return;
    }

    const existing = this.database.getOwnerReportDelivery(local.weekKey);
    if (existing) {
      return;
    }

    this.inFlight = (async () => {
      try {
        const report = buildWeeklyReport(this.database, now, 7);
        const delivered = await this.deliver(report);
        if (delivered) {
          this.database.markOwnerReportDelivered(local.weekKey, 7, now.toISOString());
        }
      } catch (error) {
        logger.error({ err: error }, "Failed to deliver weekly owner report.");
      }
    })();

    try {
      await this.inFlight;
    } finally {
      this.inFlight = undefined;
    }
  }

  getLocalTimeInfo(now: Date): LocalTimeInfo {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: this.config.timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "long",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).formatToParts(now);

    const get = (type: string): string =>
      parts.find((p) => p.type === type)?.value ?? "00";

    const year = Number.parseInt(get("year"), 10);
    const month = Number.parseInt(get("month"), 10);
    const day = Number.parseInt(get("day"), 10);
    const weekday = get("weekday");
    const hour = Number.parseInt(get("hour"), 10);
    const minute = Number.parseInt(get("minute"), 10);

    const dayOffsets: Record<string, number> = {
      Monday: 0, Tuesday: 1, Wednesday: 2, Thursday: 3,
      Friday: 4, Saturday: 5, Sunday: 6
    };
    const dow = dayOffsets[weekday] ?? 0;
    const mondayDate = new Date(Date.UTC(year, month - 1, day - dow));
    const mYear = mondayDate.getUTCFullYear();
    const mMonth = String(mondayDate.getUTCMonth() + 1).padStart(2, "0");
    const mDay = String(mondayDate.getUTCDate()).padStart(2, "0");

    return {
      weekKey: `${mYear}-${mMonth}-${mDay}`,
      isMonday: weekday === "Monday",
      minutes: hour * 60 + minute
    };
  }

  private scheduleNextRun(): void {
    if (this.stopped) {
      return;
    }
    this.timer = setTimeout(() => {
      void this.runScheduledCycle();
    }, CHECK_INTERVAL_MS);
    this.timer.unref();
  }

  private async runScheduledCycle(): Promise<void> {
    await this.runDueCycle();
    this.scheduleNextRun();
  }
}
