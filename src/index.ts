import fs from "node:fs";
import os from "node:os";

import { createAnalyticsService } from "./analytics/analyticsService";
import { createBotController } from "./bot/createBot";
import { formatChannelHealthAlert, formatSourcePollFailureAlert } from "./bot/formatters";
import { getSourceNameForMode, loadConfig } from "./config";
import { VacancyDatabase } from "./db/database";
import { logger } from "./logger";
import { RuntimeSettingsService } from "./runtime/runtimeSettings";
import { ChannelHealthMonitor } from "./services/channelHealthMonitor";
import { AutomaticBackupService } from "./services/automaticBackup";
import { RuntimeHeartbeat } from "./services/heartbeat";
import { SourcePoller } from "./services/sourcePoller";
import { UserVacancyRematcher } from "./services/userVacancyRematcher";
import { VacancyIngestor } from "./services/vacancyIngestor";
import { VacancyFilter } from "./services/vacancyFilter";
import { VacancyReminderScheduler } from "./services/vacancyReminderScheduler";
import { ApplicationFollowUpScheduler } from "./services/applicationFollowUpScheduler";
import { DailyDigestScheduler } from "./services/dailyDigestScheduler";
import { WeeklyOwnerReportScheduler } from "./services/weeklyOwnerReportScheduler";
import { createVacancySources } from "./sources";

const TECHNICAL_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

async function main(): Promise<void> {
  const config = loadConfig();

  fs.mkdirSync(config.appDataDir, { recursive: true });
  fs.mkdirSync(config.runtimeDir, { recursive: true });

  const database = new VacancyDatabase(config);
  database.initialize();
  const cleanupTechnicalData = (): void => {
    if (!config.technicalCleanupEnabled) {
      return;
    }
    try {
      const summary = database.cleanupTechnicalData();
      logger.info({ ...summary }, "Technical data cleanup completed.");
    } catch (error) {
      logger.warn({ err: error }, "Technical data cleanup failed; bot startup and polling will continue.");
    }
  };
  cleanupTechnicalData();
  const technicalCleanupTimer = config.technicalCleanupEnabled
    ? setInterval(cleanupTechnicalData, TECHNICAL_CLEANUP_INTERVAL_MS)
    : null;
  technicalCleanupTimer?.unref();
  const telegramSourceName = getSourceNameForMode(config.telegramSourceMode);
  const bootstrappedChannels = database.bootstrapChannels(config.ownerUserId, config.channels, telegramSourceName);

  logger.info(
    {
      telegramSourceMode: config.telegramSourceMode,
      channels: config.channels,
      bootstrappedChannels,
      ownerChatConfigured: Boolean(config.ownerChatId),
      ownerUserConfigured: Boolean(config.ownerUserId)
    },
    "Starting vacancy bot."
  );

  const filter = new VacancyFilter(config);
  const rematcher = new UserVacancyRematcher(database, filter);
  const runtimeSettings = new RuntimeSettingsService(config, database);
  const analytics = createAnalyticsService(config, database);
  const bot = createBotController(config, database, runtimeSettings, analytics, rematcher);
  const automaticBackup = new AutomaticBackupService(config, database, async (error) => {
    await bot.sendAdminAlert(
      [
        "⚠️ Автоматический backup не создан",
        "",
        "Бот продолжает работать. Проверьте свободное место и доступ к data/runtime/backups.",
        `Ошибка: ${error instanceof Error ? error.message : String(error)}`
      ].join("\n")
    );
  });
  const reminderScheduler = new VacancyReminderScheduler(database, (reminder) => bot.sendVacancyReminder(reminder));
  const applicationFollowUpScheduler = new ApplicationFollowUpScheduler(
    database,
    (followUp) => bot.sendApplicationFollowUp ? bot.sendApplicationFollowUp(followUp) : Promise.resolve(false)
  );
  const ownerReportScheduler = new WeeklyOwnerReportScheduler(
    database,
    config,
    (_recipientId, text) => bot.sendOwnerReport(text)
  );
  const dailyDigestScheduler = new DailyDigestScheduler(
    database,
    config.timeZone,
    (digest) => bot.sendDailyDigest ? bot.sendDailyDigest(digest) : Promise.resolve(false),
    async (payload) => {
      await analytics.capture({
        eventName: "daily_digest_skipped",
        userId: payload.userId,
        properties: {
          digest_date: payload.digestDate,
          scheduled_for: payload.scheduledFor,
          reason: "empty",
          new_vacancies_count: payload.newVacanciesCount,
          saved_without_action_count: payload.savedWithoutActionCount,
          due_application_followups_count: payload.dueApplicationFollowUpsCount,
          hidden_last_day_count: payload.hiddenLastDayCount
        }
      });
    },
    async (digest, error) => {
      await analytics.capture({
        eventName: "daily_digest_failed",
        userId: digest.userId,
        properties: {
          digest_date: digest.digestDate,
          scheduled_for: digest.scheduledFor,
          error_message: error,
          attempt_count: digest.attemptCount
        }
      });
    }
  );
  const sources = await createVacancySources(config, database, database, runtimeSettings);
  const ingestor = new VacancyIngestor(config, filter, database, bot, analytics);
  const channelHealthMonitor = new ChannelHealthMonitor(database);
  const heartbeat = new RuntimeHeartbeat(config.heartbeatPath, config.heartbeatIntervalSeconds, {
    telegramSourceMode: config.telegramSourceMode
  });
  const pollers = sources.map((source) =>
    new SourcePoller(
      source,
      async () => runtimeSettings.getSnapshot().checkIntervalSeconds,
      async (item) => ingestor.handle(item),
      async () => database.isBotPaused(config.ownerUserId),
      (listener) =>
        runtimeSettings.subscribe((key) => {
          if (key === "CHECK_INTERVAL_SECONDS") {
            listener();
          }
        }),
      async (summary) => {
        const checkedAtIso = new Date().toISOString();
        const notifiedUserIds = new Set(summary.usersWithNewVacancies);

        await analytics.capture({
          eventName: "poll_cycle_completed",
          distinctId: "system:poller",
          properties: {
            source_name: summary.sourceName,
            channels_count:
              summary.sourceName === "company_careers"
                ? database.countActiveCompanyCareerSources()
                : database.countActiveChannels(summary.sourceName),
            fetched_items_count: summary.fetchedItemsCount,
            new_vacancies_count: summary.newVacanciesCount,
            users_with_new_vacancies_count: summary.usersWithNewVacancies.length
          },
          occurredAt: checkedAtIso
        });

        for (const user of database.listActiveUsers()) {
          if (notifiedUserIds.has(user.userId)) {
            continue;
          }

          await bot.sendNoNewVacanciesNotification(user.userId, {
            sourceName: summary.sourceName,
            channelsCount:
              summary.sourceName === "company_careers"
                ? database.countActiveCompanyCareerSources()
                : database.countActiveChannels(summary.sourceName),
            fetchedItemsCount: summary.fetchedItemsCount,
            checkedAtIso
          });
        }

        for (const alert of channelHealthMonitor.collectAlerts(summary.sourceName, runtimeSettings.getSnapshot().checkIntervalSeconds)) {
          await bot.sendAdminAlert(formatChannelHealthAlert(alert, config));
        }

        heartbeat.ping();
      },
      async (error, failedSourceName) => {
        await analytics.capture({
          eventName: "poll_cycle_failed",
          distinctId: "system:poller",
          properties: {
            source_name: failedSourceName,
            error_message: error instanceof Error ? error.message : String(error)
          }
        });

        if (failedSourceName === "hh_api" || failedSourceName === "company_careers") {
          await bot.sendAdminAlert(formatSourcePollFailureAlert(failedSourceName, error, config));
        }

        for (const alert of channelHealthMonitor.collectAlerts(failedSourceName, runtimeSettings.getSnapshot().checkIntervalSeconds)) {
          await bot.sendAdminAlert(formatChannelHealthAlert(alert, config));
        }
      }
    )
  );

  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    logger.info({ signal }, "Shutting down vacancy bot.");

    heartbeat.stop();
    await automaticBackup.stop();
    await reminderScheduler.stop();
    await applicationFollowUpScheduler.stop();
    await dailyDigestScheduler.stop();
    await ownerReportScheduler.stop();
    if (technicalCleanupTimer) {
      clearInterval(technicalCleanupTimer);
    }
    await Promise.all(pollers.map((poller) => poller.stop()));
    await Promise.all(sources.map((source) => source.stop()));
    await bot.stop();
    await analytics.shutdown();
    database.close();

    logger.info("Shutdown complete.");
  };

  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });

  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  try {
    await bot.start();
    await automaticBackup.start();
    await reminderScheduler.start();
    await applicationFollowUpScheduler.start();
    await dailyDigestScheduler.start();
    await ownerReportScheduler.start();
    heartbeat.start();

    const stats = database.getStats();
    const runtimeSnapshot = runtimeSettings.getSnapshot();
    const sourceNames = sources.map((source) => source.name);
    await analytics.capture({
      eventName: "bot_started",
      distinctId: "system:bot",
      properties: {
        source_name: sourceNames.join(","),
        source_names: sourceNames,
        source_mode: config.telegramSourceMode,
        channels_count: database.countActiveChannels(telegramSourceName),
        check_interval_seconds: runtimeSnapshot.checkIntervalSeconds,
        total_vacancies: stats.totalVacancies,
        weekly_vacancies: stats.weeklyVacancies
      }
    });
    await bot.sendStartupDiagnostic({
      host: os.hostname(),
      sourceMode: config.telegramSourceMode,
      sourceName: sourceNames.join(", "),
      channelsCount: database.countActiveChannels(telegramSourceName),
      checkIntervalSeconds: runtimeSnapshot.checkIntervalSeconds,
      databaseUrl: config.databaseUrl,
      totalVacancies: stats.totalVacancies,
      weeklyVacancies: stats.weeklyVacancies,
      telegramSessionLoaded: Boolean(config.telegramSession)
    });

    heartbeat.ping();

    await Promise.all(pollers.map((poller) => poller.start()));
  } catch (error) {
    await shutdown("startup-failure");
    throw error;
  }
}

void main().catch((error) => {
  logger.fatal({ err: error }, "Vacancy bot failed to start.");
  process.exitCode = 1;
});
