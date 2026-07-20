import fs from "node:fs";
import path from "node:path";

import { AppConfig } from "../config";
import { VacancyDatabase } from "../db/database";
import { logger } from "../logger";

const AUTO_BACKUP_FILE_PATTERN = /^auto-backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.db$/u;

export interface AutomaticBackupSummary {
  path: string;
  sizeBytes: number;
  createdAt: string;
  expiredBackupsDeleted: number;
}

type BackupFailureHandler = (error: unknown) => Promise<void> | void;

export class AutomaticBackupService {
  private timer?: NodeJS.Timeout;
  private inFlight?: Promise<AutomaticBackupSummary | null>;
  private stopped = false;

  constructor(
    private readonly config: AppConfig,
    private readonly database: VacancyDatabase,
    private readonly onFailure?: BackupFailureHandler
  ) {}

  async start(): Promise<void> {
    if (!this.config.automaticBackupEnabled) {
      return;
    }

    this.stopped = false;
    await this.runBackup();
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

  async runBackup(now = new Date()): Promise<AutomaticBackupSummary | null> {
    if (!this.config.automaticBackupEnabled || this.inFlight) {
      return this.inFlight ?? null;
    }

    this.inFlight = (async () => {
      try {
        const fileName = `auto-backup-${now.toISOString().replace(/[:.]/gu, "-")}.db`;
        const snapshot = this.database.createBackupSnapshot(fileName);
        const expiredBackupsDeleted = this.deleteExpiredBackups(now);
        const summary = { ...snapshot, expiredBackupsDeleted };
        logger.info(summary, "Automatic SQLite backup completed.");
        return summary;
      } catch (error) {
        logger.error({ err: error }, "Automatic SQLite backup failed.");
        await this.onFailure?.(error);
        return null;
      }
    })();

    try {
      return await this.inFlight;
    } finally {
      this.inFlight = undefined;
    }
  }

  private deleteExpiredBackups(now: Date): number {
    const backupDir = path.resolve(path.join(this.config.runtimeDir, "backups"));
    if (!fs.existsSync(backupDir)) {
      return 0;
    }

    const cutoff = now.getTime() - this.config.automaticBackupRetentionDays * 24 * 60 * 60 * 1000;
    let deleted = 0;

    for (const entry of fs.readdirSync(backupDir, { withFileTypes: true })) {
      if (!entry.isFile() || !AUTO_BACKUP_FILE_PATTERN.test(entry.name)) {
        continue;
      }
      const filePath = path.resolve(path.join(backupDir, entry.name));
      const relative = path.relative(backupDir, filePath);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        continue;
      }
      if (fs.statSync(filePath).mtimeMs >= cutoff) {
        continue;
      }
      fs.unlinkSync(filePath);
      deleted += 1;
    }

    return deleted;
  }

  private scheduleNextRun(): void {
    if (this.stopped || !this.config.automaticBackupEnabled) {
      return;
    }
    const delayMs = this.config.automaticBackupIntervalHours * 60 * 60 * 1000;
    this.timer = setTimeout(() => {
      void this.runScheduledBackup();
    }, delayMs);
    this.timer.unref();
  }

  private async runScheduledBackup(): Promise<void> {
    await this.runBackup();
    this.scheduleNextRun();
  }
}
