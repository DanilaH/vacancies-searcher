import fs from "node:fs";
import path from "node:path";

import BetterSqlite3 from "better-sqlite3";

import { AppConfig } from "../config";
import {
  AnalyticsCaptureInput,
  AnalyticsEventRecord,
  BotUser,
  BotUserRole,
  ChannelDiscoveryCandidate,
  ChannelDiscoveryEvidence,
  ChannelDiscoveryCandidatePage,
  ChannelDiscoveryProfileId,
  ChannelDiscoveryCandidateStats,
  ChannelDiscoveryCandidateStatus,
  ChannelDiscoveryRun,
  ChannelDiscoverySource,
  CompanyCareerAdapter,
  CompanyCareerSourcePage,
  CompanyCareerSourceRecord,
  DailyDigestDeliveryRecord,
  DailyDigestDueRecord,
  DailyDigestPayload,
  ExtractedContact,
  FilterSuggestionKey,
  FilterResult,
  HhSearchSettings,
  HiddenVacancyFeedbackSummary,
  HiddenVacancyReason,
  HiddenVacancyReasonSummaryItem,
  IngestResult,
  KeywordKind,
  MatchedVacancyRecord,
  MonitoredChannel,
  MonitoredChannelPage,
  OnboardingStep,
  RejectedAuditVacancyRecord,
  RejectedMatchAuditRecord,
  RuntimeSettingKey,
  SearchProfileWeeklyStats,
  SearchProfileSectionKey,
  SourceName,
  TrustedVacancyServiceAdapter,
  TrustedVacancyServicePage,
  TrustedVacancyServiceRecord,
  TrustedVacancyServiceStatus,
  UserKeyword,
  UserFilterSuggestionCandidate,
  UserFilterSuggestionRecord,
  UserStatusVacancyPage,
  UserStatusVacancyRecord,
  UserVacancyMatchSyncInput,
  UserVacancyMatchSyncResult,
  UserVacancyProfileMatchInput,
  UserVacancyApplicationPage,
  UserVacancyApplicationSummary,
  UserVacancyHiddenReasonRecord,
  UserSearchProfile,
  UserSearchProfileRecord,
  UserSettings,
  UserWeeklyVacancyPage,
  VacancyDuplicatePost,
  VacancyDuplicatePostPage,
  VacancyRelevanceFeedbackRecord,
  VacancyRelevanceValue,
  VacancyApplicationFollowUpRecord,
  VacancyApplicationRecord,
  VacancyLanguageMode,
  VacancyReminderPage,
  VacancyReminderRecord,
  VacancyUserStatus,
  VacancyRecord,
  WeeklyVacancyPage
} from "../types";
import { FILTER_SUGGESTION_BY_REASON } from "../services/hiddenVacancyReasons";
import { createFingerprint, extractTitle, normalizeForComparison } from "../utils/text";
import {
  type AnalyticsEventRow,
  type AppSettingRowInternal,
  type BotUserRow,
  type ChannelAlertStateRow,
  type ChannelDiscoveryCandidateRow,
  type ChannelDiscoveryRunRow,
  type CompanyCareerSourceRow,
  type CountRow,
  type DailyDigestDeliveryRow,
  type UserFilterSuggestionRow,
  type UserVacancyHiddenReasonRow,
  type HhSearchSettingsRow,
  type MatchedVacancyRow,
  type MonitoredChannelRow,
  type RawMessageDuplicateRow,
  type UserKeywordRow,
  type UserSearchProfileRow,
  type UserSettingsRow,
  type UserVacancyStateRow,
  type TrustedVacancyServiceRow,
  type VacancyApplicationFollowUpRow,
  type VacancyApplicationRow,
  type UserVacancyApplicationRow,
  type VacancyReminderRow,
  type VacancyRow,
  mapAnalyticsEvent,
  mapBotUser,
  mapChannelDiscoveryCandidate,
  mapChannelDiscoveryRun,
  mapCompanyCareerSource,
  mapDailyDigestDelivery,
  mapUserFilterSuggestion,
  mapTrustedVacancyService,
  mapHhSearchSettings,
  mapMatchedVacancy,
  mapMonitoredChannel,
  mapUserKeyword,
  mapUserSearchProfile,
  mapUserSettings,
  mapUserStatusVacancy,
  mapVacancyApplication,
  mapVacancyApplicationFollowUp,
  mapUserVacancyApplication,
  mapUserVacancyHiddenReason,
  mapVacancyReminder,
  mapVacancy,
  mapVacancyDuplicatePost
} from "./rowMappers";
import { createBaseSchema, runMigrations } from "./schema";

type SqliteDatabase = BetterSqlite3.Database;
const VACANCY_FINGERPRINT_VERSION = "3";

export type ChannelDiscoveryCandidateInput = {
  runId: number;
  username: string;
  title?: string | null;
  status?: ChannelDiscoveryCandidateStatus;
  score: number;
  sources: ChannelDiscoverySource[];
  probeUrl?: string | null;
  stats: ChannelDiscoveryCandidateStats;
  reasons: string[];
  evidence?: ChannelDiscoveryEvidence[];
};

export type ChannelDiscoveryRunCreateInput = {
  startedByUserId: string | undefined;
  profileId: ChannelDiscoveryProfileId;
  profileLabel: string;
  customQuery?: string | null;
  seedQueries: string[];
  providers?: string[];
  providerWarnings?: string[];
};

export interface ChannelPerformanceRow {
  sourceName: string;
  sourceChannel: string;
  vacancyCount: number;
  matchCount: number;
  savedCount: number;
  hiddenCount: number;
  applicationCount: number;
}

export type RecentRawMessageReference = {
  sourceChannel: string;
  text: string;
};

export type TechnicalDataCleanupSummary = {
  analyticsEventsDeleted: number;
  discoveryRunsDeleted: number;
  discoveryCandidatesDeleted: number;
  discoveryChecksDeleted: number;
};

type AppSettingValue = {
  key: RuntimeSettingKey;
  value: string;
  updatedAt: string;
  updatedByUserId: string | null;
};

type RecordMessageInput = {
  source: SourceName;
  channel: string;
  messageId: string;
  text: string;
  date?: string;
  url: string;
  canonicalUrl?: string;
};

export type CompanyCareerSourceCreateInput = {
  companyName: string;
  adapter: CompanyCareerAdapter;
  startUrl: string;
  pollIntervalSeconds?: number;
  addedByUserId?: string | null;
};

export type TrustedVacancyServiceCreateInput = {
  hostname: string;
  displayName: string;
  adapter: TrustedVacancyServiceAdapter;
  exampleUrl: string;
  addedByUserId?: string | null;
};

const SPECIALIZED_TRUSTED_VACANCY_ADAPTERS = new Set<TrustedVacancyServiceAdapter>([
  "findmyremote",
  "teletype",
  "finder_work",
  "telegraph"
]);

function nowIso(): string {
  return new Date().toISOString();
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function normalizeProfileName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("ru-RU");
}

function recentThresholdIso(days: number): string {
  const safeDays = Math.max(0, days);
  return new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000).toISOString();
}

function isSubPath(parentPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(parentPath, candidatePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

export class VacancyDatabase {
  private db?: SqliteDatabase;

  constructor(private readonly config: AppConfig) {}

  initialize(): void {
    if (this.db) {
      return;
    }

    this.db = new BetterSqlite3(this.config.databasePath);
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");

    createBaseSchema(this.db);
    runMigrations(this.db);
    this.reconcileVacancyFingerprints();
    this.bootstrapOwnerUser();
  }

  listTrustedVacancyServicesPage(offset: number, pageSize: number): TrustedVacancyServicePage {
    const safeOffset = Math.max(0, offset);
    const safePageSize = Math.max(1, pageSize);
    const db = this.getDb();
    const total = (db.prepare("SELECT COUNT(*) AS count FROM trusted_vacancy_services").get() as CountRow | undefined)?.count ?? 0;
    const rows = db.prepare(
      `SELECT * FROM trusted_vacancy_services
       ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END, display_name COLLATE NOCASE, id
       LIMIT ? OFFSET ?`
    ).all(safePageSize, safeOffset) as TrustedVacancyServiceRow[];
    return { items: rows.map(mapTrustedVacancyService), offset: safeOffset, pageSize: safePageSize, total };
  }

  getTrustedVacancyServiceById(id: number): TrustedVacancyServiceRecord | null {
    const row = this.getDb().prepare("SELECT * FROM trusted_vacancy_services WHERE id = ? LIMIT 1").get(id) as TrustedVacancyServiceRow | undefined;
    return row ? mapTrustedVacancyService(row) : null;
  }

  getActiveTrustedVacancyServiceByHostname(hostname: string): TrustedVacancyServiceRecord | null {
    const row = this.getDb().prepare(
      "SELECT * FROM trusted_vacancy_services WHERE hostname = ? AND status = 'active' LIMIT 1"
    ).get(hostname.toLowerCase()) as TrustedVacancyServiceRow | undefined;
    return row ? mapTrustedVacancyService(row) : null;
  }

  addTrustedVacancyService(input: TrustedVacancyServiceCreateInput): TrustedVacancyServiceRecord {
    const timestamp = nowIso();
    this.getDb().prepare(
      `INSERT INTO trusted_vacancy_services (
         hostname, display_name, adapter, status, parser_mode, example_url,
         added_by_user_id, created_at, updated_at
       ) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?)
       ON CONFLICT(hostname) DO UPDATE SET
         display_name = excluded.display_name,
         adapter = excluded.adapter,
         parser_mode = excluded.parser_mode,
         example_url = excluded.example_url,
         updated_at = excluded.updated_at`
    ).run(
      input.hostname.toLowerCase(),
      input.displayName,
      input.adapter,
      SPECIALIZED_TRUSTED_VACANCY_ADAPTERS.has(input.adapter) ? "specialized" : "json_ld_or_html",
      input.exampleUrl,
      input.addedByUserId ?? null,
      timestamp,
      timestamp
    );
    const row = this.getDb().prepare("SELECT * FROM trusted_vacancy_services WHERE hostname = ?").get(input.hostname.toLowerCase()) as TrustedVacancyServiceRow;
    return mapTrustedVacancyService(row);
  }

  setTrustedVacancyServiceStatus(id: number, status: TrustedVacancyServiceStatus, approvedByUserId?: string | null): TrustedVacancyServiceRecord | null {
    this.getDb().prepare(
      `UPDATE trusted_vacancy_services
       SET status = ?, approved_by_user_id = CASE WHEN ? = 'active' THEN ? ELSE approved_by_user_id END, updated_at = ?
       WHERE id = ?`
    ).run(status, status, approvedByUserId ?? null, nowIso(), id);
    return this.getTrustedVacancyServiceById(id);
  }

  markTrustedVacancyServiceCheck(id: number, error: string | null): void {
    const timestamp = nowIso();
    this.getDb().prepare(
      `UPDATE trusted_vacancy_services
       SET last_checked_at = ?, last_success_at = CASE WHEN ? IS NULL THEN ? ELSE last_success_at END,
           last_error = ?, updated_at = ?
       WHERE id = ?`
    ).run(timestamp, error, timestamp, error, timestamp, id);
  }

  hasVacancyByCanonicalUrl(canonicalUrl: string): boolean {
    return Boolean(this.getDb().prepare("SELECT 1 FROM vacancies WHERE canonical_url = ? LIMIT 1").get(canonicalUrl));
  }

  close(): void {
    if (!this.db) {
      return;
    }

    this.db.close();
    this.db = undefined;
  }

  healthcheck(): void {
    this.getDb().prepare("SELECT 1").get();
  }

  private reconcileVacancyFingerprints(): void {
    const db = this.getDb();
    const versionKey = "vacancy_fingerprint_version";
    const currentVersion = (
      db.prepare("SELECT value FROM app_state WHERE key = ? LIMIT 1").get(versionKey) as { value: string } | undefined
    )?.value;
    if (currentVersion === VACANCY_FINGERPRINT_VERSION) {
      return;
    }

    db.transaction(() => {
      const rawMessages = db.prepare("SELECT id, text FROM raw_messages").all() as Array<{ id: number; text: string }>;
      const updateRawFingerprint = db.prepare("UPDATE raw_messages SET fingerprint = ? WHERE id = ?");
      for (const rawMessage of rawMessages) {
        updateRawFingerprint.run(createFingerprint(rawMessage.text), rawMessage.id);
      }

      const vacancies = db.prepare("SELECT id, text, canonical_url FROM vacancies ORDER BY id ASC").all() as Array<{
        id: number;
        text: string;
        canonical_url: string | null;
      }>;
      const canonicalByFingerprint = new Map<string, Array<{ id: number; canonicalUrl: string | null }>>();
      const updateVacancyFingerprint = db.prepare("UPDATE vacancies SET fingerprint = ?, updated_at = ? WHERE id = ?");

      for (const vacancy of vacancies) {
        const fingerprint = createFingerprint(vacancy.text);
        const existingCandidates = canonicalByFingerprint.get(fingerprint) ?? [];
        const duplicate = existingCandidates.find(
          (candidate) =>
            !vacancy.canonical_url
            || !candidate.canonicalUrl
            || candidate.canonicalUrl === vacancy.canonical_url
        );
        if (!duplicate) {
          canonicalByFingerprint.set(fingerprint, [
            ...existingCandidates,
            { id: vacancy.id, canonicalUrl: vacancy.canonical_url }
          ]);
          updateVacancyFingerprint.run(fingerprint, nowIso(), vacancy.id);
          continue;
        }

        this.mergeDuplicateVacancy(db, duplicate.id, vacancy.id);
      }

      db.prepare(
        `
          INSERT INTO app_state (key, value, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        `
      ).run(versionKey, VACANCY_FINGERPRINT_VERSION, nowIso());
    })();
  }

  private mergeDuplicateVacancy(db: SqliteDatabase, canonicalVacancyId: number, duplicateVacancyId: number): void {
    db.prepare(
      `
        INSERT INTO user_vacancy_matches (
          user_id, vacancy_id, score, match_summary, matched_keywords_json,
          delivered_at, created_at, updated_at
        )
        SELECT
          user_id, ?, score, match_summary, matched_keywords_json,
          delivered_at, created_at, updated_at
        FROM user_vacancy_matches
        WHERE vacancy_id = ?
        ON CONFLICT(user_id, vacancy_id) DO UPDATE SET
          delivered_at = COALESCE(user_vacancy_matches.delivered_at, excluded.delivered_at),
          updated_at = MAX(user_vacancy_matches.updated_at, excluded.updated_at)
      `
    ).run(canonicalVacancyId, duplicateVacancyId);

    db.prepare(
      `
        INSERT INTO user_vacancy_profile_matches (
          user_id, vacancy_id, profile_id, score, match_summary,
          matched_keywords_json, created_at, updated_at
        )
        SELECT
          user_id, ?, profile_id, score, match_summary,
          matched_keywords_json, created_at, updated_at
        FROM user_vacancy_profile_matches
        WHERE vacancy_id = ?
        ON CONFLICT(user_id, vacancy_id, profile_id) DO UPDATE SET
          score = MAX(user_vacancy_profile_matches.score, excluded.score),
          updated_at = MAX(user_vacancy_profile_matches.updated_at, excluded.updated_at)
      `
    ).run(canonicalVacancyId, duplicateVacancyId);

    db.prepare(
      `
        INSERT INTO user_vacancy_states (user_id, vacancy_id, status, created_at, updated_at)
        SELECT user_id, ?, status, created_at, updated_at
        FROM user_vacancy_states
        WHERE vacancy_id = ?
        ON CONFLICT(user_id, vacancy_id) DO UPDATE SET
          status = CASE
            WHEN excluded.updated_at > user_vacancy_states.updated_at THEN excluded.status
            ELSE user_vacancy_states.status
          END,
          updated_at = MAX(user_vacancy_states.updated_at, excluded.updated_at)
      `
    ).run(canonicalVacancyId, duplicateVacancyId);

    db.prepare(
      `
        INSERT INTO user_vacancy_reminders (
          user_id, vacancy_id, remind_at, next_attempt_at, attempt_count,
          delivered_at, cancelled_at, last_error, created_at, updated_at
        )
        SELECT
          user_id, ?, remind_at, next_attempt_at, attempt_count,
          delivered_at, cancelled_at, last_error, created_at, updated_at
        FROM user_vacancy_reminders
        WHERE vacancy_id = ?
        ON CONFLICT(user_id, vacancy_id) DO UPDATE SET
          remind_at = CASE
            WHEN excluded.updated_at > user_vacancy_reminders.updated_at THEN excluded.remind_at
            ELSE user_vacancy_reminders.remind_at
          END,
          next_attempt_at = CASE
            WHEN excluded.updated_at > user_vacancy_reminders.updated_at THEN excluded.next_attempt_at
            ELSE user_vacancy_reminders.next_attempt_at
          END,
          attempt_count = CASE
            WHEN excluded.updated_at > user_vacancy_reminders.updated_at THEN excluded.attempt_count
            ELSE user_vacancy_reminders.attempt_count
          END,
          delivered_at = CASE
            WHEN excluded.updated_at > user_vacancy_reminders.updated_at THEN excluded.delivered_at
            ELSE user_vacancy_reminders.delivered_at
          END,
          cancelled_at = CASE
            WHEN excluded.updated_at > user_vacancy_reminders.updated_at THEN excluded.cancelled_at
            ELSE user_vacancy_reminders.cancelled_at
          END,
          last_error = CASE
            WHEN excluded.updated_at > user_vacancy_reminders.updated_at THEN excluded.last_error
            ELSE user_vacancy_reminders.last_error
          END,
          updated_at = MAX(user_vacancy_reminders.updated_at, excluded.updated_at)
      `
    ).run(canonicalVacancyId, duplicateVacancyId);

    db.prepare(
      `
        INSERT INTO hh_user_vacancy_candidates (user_id, vacancy_id, query_key, created_at, updated_at)
        SELECT user_id, ?, query_key, created_at, updated_at
        FROM hh_user_vacancy_candidates
        WHERE vacancy_id = ?
        ON CONFLICT(user_id, vacancy_id) DO UPDATE SET
          updated_at = MAX(hh_user_vacancy_candidates.updated_at, excluded.updated_at)
      `
    ).run(canonicalVacancyId, duplicateVacancyId);

    db.prepare("DELETE FROM vacancies WHERE id = ?").run(duplicateVacancyId);
  }

  createBackupSnapshot(fileName: string): { path: string; sizeBytes: number; createdAt: string } {
    const db = this.getDb();
    const backupDir = path.resolve(path.join(this.config.runtimeDir, "backups"));
    const sanitizedFileName = fileName.trim();
    if (!/^[A-Za-z0-9._-]+\.db$/u.test(sanitizedFileName)) {
      throw new Error("Invalid backup file name.");
    }

    const resolvedOutputPath = path.resolve(path.join(backupDir, sanitizedFileName));
    if (!isSubPath(backupDir, resolvedOutputPath)) {
      throw new Error("Backup path is outside the allowed directory.");
    }

    fs.mkdirSync(path.dirname(resolvedOutputPath), { recursive: true });

    if (fs.existsSync(resolvedOutputPath)) {
      fs.unlinkSync(resolvedOutputPath);
    }

    db.pragma("wal_checkpoint(FULL)");
    const escapedPath = resolvedOutputPath.replace(/'/g, "''");
    db.exec(`VACUUM INTO '${escapedPath}'`);

    const stats = fs.statSync(resolvedOutputPath);
    return {
      path: resolvedOutputPath,
      sizeBytes: stats.size,
      createdAt: nowIso()
    };
  }

  getStats(): { totalVacancies: number; weeklyVacancies: number } {
    const db = this.getDb();
    const totalVacancies = (db.prepare("SELECT COUNT(*) AS count FROM vacancies").get() as CountRow | undefined)?.count ?? 0;
    const weeklyVacancies =
      (
        db.prepare("SELECT COUNT(*) AS count FROM vacancies WHERE message_date >= ?").get(recentThresholdIso(7)) as
          | CountRow
          | undefined
      )?.count ?? 0;

    return {
      totalVacancies,
      weeklyVacancies
    };
  }

  recordAnalyticsEvent(input: AnalyticsCaptureInput): AnalyticsEventRecord {
    const db = this.getDb();
    const distinctId = input.distinctId ?? input.userId ?? "system:bot";
    const occurredAt = input.occurredAt ?? nowIso();
    const createdAt = nowIso();
    const result = db
      .prepare(
        `
          INSERT INTO analytics_events (
            event_name,
            distinct_id,
            user_id,
            properties_json,
            occurred_at,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        input.eventName,
        distinctId,
        input.userId ?? null,
        JSON.stringify(input.properties ?? {}),
        occurredAt,
        createdAt
      );

    const row = db
      .prepare("SELECT * FROM analytics_events WHERE id = ? LIMIT 1")
      .get(result.lastInsertRowid) as AnalyticsEventRow | undefined;

    if (!row) {
      throw new Error("Failed to read back inserted analytics event.");
    }

    return mapAnalyticsEvent(row);
  }

  listAnalyticsEvents(limit = 100, eventName?: AnalyticsEventRecord["eventName"]): AnalyticsEventRecord[] {
    const safeLimit = Math.max(1, limit);
    const rows = eventName
      ? (this.getDb()
          .prepare(
            `
              SELECT *
              FROM analytics_events
              WHERE event_name = ?
              ORDER BY occurred_at DESC, id DESC
              LIMIT ?
            `
          )
          .all(eventName, safeLimit) as AnalyticsEventRow[])
      : (this.getDb()
          .prepare(
            `
              SELECT *
              FROM analytics_events
              ORDER BY occurred_at DESC, id DESC
              LIMIT ?
            `
          )
          .all(safeLimit) as AnalyticsEventRow[]);

    return rows.map((row) => mapAnalyticsEvent(row));
  }

  countAnalyticsEvents(eventName?: AnalyticsEventRecord["eventName"]): number {
    const row = eventName
      ? (this.getDb()
          .prepare("SELECT COUNT(*) AS count FROM analytics_events WHERE event_name = ?")
          .get(eventName) as CountRow | undefined)
      : ((this.getDb().prepare("SELECT COUNT(*) AS count FROM analytics_events").get() as CountRow | undefined));

    return row?.count ?? 0;
  }

  countAnalyticsEventsSince(eventName: AnalyticsEventRecord["eventName"], sinceIso: string, untilIso?: string): number {
    const row = untilIso
      ? (this.getDb()
          .prepare("SELECT COUNT(*) AS count FROM analytics_events WHERE event_name = ? AND occurred_at >= ? AND occurred_at <= ?")
          .get(eventName, sinceIso, untilIso) as CountRow | undefined)
      : (this.getDb()
          .prepare("SELECT COUNT(*) AS count FROM analytics_events WHERE event_name = ? AND occurred_at >= ?")
          .get(eventName, sinceIso) as CountRow | undefined);
    return row?.count ?? 0;
  }

  countDistinctAnalyticsUserIdsSince(eventName: AnalyticsEventRecord["eventName"], sinceIso: string, untilIso?: string): number {
    const row = untilIso
      ? (this.getDb()
          .prepare("SELECT COUNT(DISTINCT user_id) AS count FROM analytics_events WHERE event_name = ? AND user_id IS NOT NULL AND occurred_at >= ? AND occurred_at <= ?")
          .get(eventName, sinceIso, untilIso) as CountRow | undefined)
      : (this.getDb()
          .prepare("SELECT COUNT(DISTINCT user_id) AS count FROM analytics_events WHERE event_name = ? AND user_id IS NOT NULL AND occurred_at >= ?")
          .get(eventName, sinceIso) as CountRow | undefined);
    return row?.count ?? 0;
  }

  countAllDistinctAnalyticsUserIdsSince(sinceIso: string, untilIso?: string): number {
    const row = untilIso
      ? (this.getDb()
          .prepare("SELECT COUNT(DISTINCT user_id) AS count FROM analytics_events WHERE user_id IS NOT NULL AND occurred_at >= ? AND occurred_at <= ?")
          .get(sinceIso, untilIso) as CountRow | undefined)
      : (this.getDb()
          .prepare("SELECT COUNT(DISTINCT user_id) AS count FROM analytics_events WHERE user_id IS NOT NULL AND occurred_at >= ?")
          .get(sinceIso) as CountRow | undefined);
    return row?.count ?? 0;
  }

  countAnalyticsStatusChangesSince(status: string, sinceIso: string, untilIso?: string): number {
    const row = untilIso
      ? (this.getDb()
          .prepare(
            `SELECT COUNT(*) AS count FROM analytics_events
             WHERE event_name = 'vacancy_status_changed'
               AND json_extract(properties_json, '$.next_status') = ?
               AND occurred_at >= ? AND occurred_at <= ?`
          )
          .get(status, sinceIso, untilIso) as CountRow | undefined)
      : (this.getDb()
          .prepare(
            `SELECT COUNT(*) AS count FROM analytics_events
             WHERE event_name = 'vacancy_status_changed'
               AND json_extract(properties_json, '$.next_status') = ?
               AND occurred_at >= ?`
          )
          .get(status, sinceIso) as CountRow | undefined);
    return row?.count ?? 0;
  }

  countCohortActivityUsers(
    cohortUserIds: string[],
    eventNames: string[],
    sinceIso: string,
    untilIso: string
  ): number {
    if (cohortUserIds.length === 0 || eventNames.length === 0) return 0;
    const placeholders = cohortUserIds.map(() => "?").join(",");
    const eventPlaceholders = eventNames.map(() => "?").join(",");
    const row = this.getDb()
      .prepare(
        `SELECT COUNT(DISTINCT user_id) AS count FROM analytics_events
         WHERE user_id IN (${placeholders})
           AND event_name IN (${eventPlaceholders})
           AND occurred_at >= ? AND occurred_at < ?`
      )
      .get(...cohortUserIds, ...eventNames, sinceIso, untilIso) as CountRow | undefined;
    return row?.count ?? 0;
  }

  cleanupTechnicalData(now = new Date()): TechnicalDataCleanupSummary {
    const db = this.getDb();
    const cutoffIso = (retentionDays: number) =>
      new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
    const analyticsCutoff = cutoffIso(this.config.analyticsRetentionDays);
    const discoveryRunCutoff = cutoffIso(this.config.channelDiscoveryRunRetentionDays);
    const discoveryCheckCutoff = cutoffIso(this.config.channelDiscoveryCheckRetentionDays);
    const removableDiscoveryRunsSql = `
      status IN ('completed', 'failed')
      AND datetime(started_at) < datetime(?)
      AND NOT EXISTS (
        SELECT 1
        FROM channel_discovery_candidates candidate
        WHERE candidate.run_id = channel_discovery_runs.id
          AND candidate.status IN ('pending', 'blocked')
      )
    `;

    return db.transaction(() => {
      const analyticsEventsDeleted = db
        .prepare("DELETE FROM analytics_events WHERE datetime(occurred_at) < datetime(?)")
        .run(analyticsCutoff).changes;
      const discoveryCandidatesDeleted =
        (
          db
            .prepare(
              `
                SELECT COUNT(*) AS count
                FROM channel_discovery_candidates
                WHERE run_id IN (
                  SELECT id
                  FROM channel_discovery_runs
                  WHERE ${removableDiscoveryRunsSql}
                )
              `
            )
            .get(discoveryRunCutoff) as CountRow | undefined
        )?.count ?? 0;
      const discoveryRunsDeleted = db
        .prepare(`DELETE FROM channel_discovery_runs WHERE ${removableDiscoveryRunsSql}`)
        .run(discoveryRunCutoff).changes;
      const discoveryChecksDeleted = db
        .prepare("DELETE FROM channel_discovery_checks WHERE datetime(last_checked_at) < datetime(?)")
        .run(discoveryCheckCutoff).changes;

      return {
        analyticsEventsDeleted,
        discoveryRunsDeleted,
        discoveryCandidatesDeleted,
        discoveryChecksDeleted
      };
    })();
  }

  recordMessage(input: RecordMessageInput, filterResult: FilterResult, contacts: ExtractedContact[]): IngestResult {
    const db = this.getDb();
    const messageDate = input.date ?? nowIso();
    const normalizedText = normalizeForComparison(input.text);
    const fingerprint = createFingerprint(input.text);
    const title = extractTitle(input.text);
    const canonicalUrl = input.canonicalUrl?.trim() || null;

    return db.transaction(() => {
      const rawInsert = db
        .prepare(
          `
            INSERT OR IGNORE INTO raw_messages (
              source_name,
              source_channel,
              source_message_id,
              message_date,
              text,
              normalized_text,
              url,
              canonical_url,
              fingerprint,
              imported_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `
        )
        .run(
          input.source,
          input.channel,
          input.messageId,
          messageDate,
          input.text,
          normalizedText,
          input.url,
          canonicalUrl,
          fingerprint,
          nowIso()
        );

      if (rawInsert.changes === 0) {
        const existingVacancy = this.getVacancyBySourceMessage(input.source, input.channel, input.messageId);
        return {
          kind: "duplicate_raw_message" as const,
          source: input.source,
          channel: input.channel,
          messageId: input.messageId,
          vacancyId: existingVacancy?.id ?? null
        };
      }

      if (!filterResult.matches) {
        return {
          kind: "filtered_out" as const,
          summary: filterResult.summary
        };
      }

      if (canonicalUrl) {
        const duplicateByCanonicalUrl = db
          .prepare("SELECT id FROM vacancies WHERE canonical_url = ? LIMIT 1")
          .get(canonicalUrl) as { id: number } | undefined;

        if (duplicateByCanonicalUrl) {
          return {
            kind: "duplicate_canonical_url" as const,
            duplicateVacancyId: duplicateByCanonicalUrl.id,
            canonicalUrl
          };
        }
      }

      const duplicateVacancy = db
        .prepare(
          canonicalUrl
            ? "SELECT id FROM vacancies WHERE fingerprint = ? AND canonical_url IS NULL LIMIT 1"
            : "SELECT id FROM vacancies WHERE fingerprint = ? LIMIT 1"
        )
        .get(fingerprint) as { id: number } | undefined;

      if (duplicateVacancy) {
        return {
          kind: "duplicate_fingerprint" as const,
          duplicateVacancyId: duplicateVacancy.id,
          fingerprint
        };
      }

      const createdAt = nowIso();
      const vacancyInsert = db
        .prepare(
          `
            INSERT INTO vacancies (
              source_name,
              source_channel,
              source_message_id,
              message_date,
              title,
              text,
              normalized_text,
              url,
              canonical_url,
              fingerprint,
              score,
              match_summary,
              matched_keywords_json,
              contacts_json,
              sent_to_owner_at,
              created_at,
              updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
          `
        )
        .run(
          input.source,
          input.channel,
          input.messageId,
          messageDate,
          title,
          input.text,
          normalizedText,
          input.url,
          canonicalUrl,
          fingerprint,
          filterResult.score,
          filterResult.summary,
          JSON.stringify(unique(filterResult.matchedKeywords)),
          JSON.stringify(contacts),
          createdAt,
          createdAt
        );

      const vacancy = this.getVacancyById(Number(vacancyInsert.lastInsertRowid));
      if (!vacancy) {
        throw new Error("Failed to load inserted vacancy.");
      }

      return {
        kind: "new_vacancy" as const,
        vacancy
      };
    })();
  }

  listWeeklyVacancies(offset: number, pageSize: number, days: number): WeeklyVacancyPage {
    const db = this.getDb();
    const safeOffset = Math.max(0, offset);
    const safePageSize = Math.max(1, pageSize);
    const since = recentThresholdIso(days);
    const total =
      (
        db.prepare("SELECT COUNT(*) AS count FROM vacancies WHERE message_date >= ?").get(since) as
          | CountRow
          | undefined
      )?.count ?? 0;
    const rows = db
      .prepare(
        `
          SELECT *
          FROM vacancies
          WHERE message_date >= ?
          ORDER BY message_date DESC, id DESC
          LIMIT ? OFFSET ?
        `
      )
      .all(since, safePageSize, safeOffset) as VacancyRow[];

    return {
      items: rows.map((row) => mapVacancy(row)),
      offset: safeOffset,
      pageSize: safePageSize,
      total
    };
  }

  markVacancySent(vacancyId: number): void {
    this.getDb()
      .prepare("UPDATE vacancies SET sent_to_owner_at = ?, updated_at = ? WHERE id = ?")
      .run(nowIso(), nowIso(), vacancyId);
  }

  getBotUser(userId: string | number | undefined | null): BotUser | null {
    if (userId === undefined || userId === null) {
      return null;
    }

    const row = this.getDb()
      .prepare("SELECT * FROM bot_users WHERE user_id = ? LIMIT 1")
      .get(String(userId)) as BotUserRow | undefined;

    return row ? mapBotUser(row) : null;
  }

  listActiveUsers(): BotUser[] {
    const rows = this.getDb()
      .prepare(
        `
          SELECT *
          FROM bot_users
          WHERE is_active = 1
          ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, user_id
        `
      )
      .all() as BotUserRow[];

    return rows.map((row) => mapBotUser(row));
  }

  listAllUsers(): BotUser[] {
    const rows = this.getDb()
      .prepare(
        `
          SELECT *
          FROM bot_users
          ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, user_id
        `
      )
      .all() as BotUserRow[];

    return rows.map((row) => mapBotUser(row));
  }

  isAllowedUser(userId: string | number | undefined | null): boolean {
    const user = this.getBotUser(userId);
    return Boolean(user?.isActive);
  }

  registerPublicUserIfNeeded(userId: string | number | undefined | null): { user: BotUser; created: boolean } | null {
    if (userId === undefined || userId === null) {
      return null;
    }

    const normalizedUserId = String(userId);
    const existing = this.getBotUser(normalizedUserId);
    if (existing) {
      return {
        user: existing,
        created: false
      };
    }

    const timestamp = nowIso();
    this.getDb()
      .prepare(
        `
          INSERT INTO bot_users (
            user_id,
            role,
            is_active,
            username,
            display_name,
            added_by_user_id,
            created_at,
            updated_at
          ) VALUES (?, 'member', 1, NULL, NULL, NULL, ?, ?)
        `
      )
      .run(normalizedUserId, timestamp, timestamp);

    this.ensureUserSettings(normalizedUserId);
    this.ensureUserSearchProfile(normalizedUserId);
    this.ensureUserHhSearchSettings(normalizedUserId);

    const user = this.getBotUser(normalizedUserId);
    if (!user) {
      throw new Error(`Public user was not created for ${normalizedUserId}.`);
    }

    return {
      user,
      created: true
    };
  }

  hasAdminAccess(userId: string | number | undefined | null): boolean {
    const user = this.getBotUser(userId);
    return Boolean(user?.isActive && (user.role === "owner" || user.role === "admin"));
  }

  hasOwnerAccess(userId: string | number | undefined | null): boolean {
    const user = this.getBotUser(userId);
    return Boolean(user?.isActive && user.role === "owner");
  }

  addOrActivateBotUser(
    userId: string,
    role: Exclude<BotUserRole, "owner"> | "owner",
    addedByUserId?: string
  ): { created: boolean; reactivated: boolean; user: BotUser } {
    const db = this.getDb();
    const existing = this.getBotUser(userId);
    const createdAt = nowIso();

    if (!existing) {
      db.prepare(
        `
          INSERT INTO bot_users (
            user_id,
            role,
            is_active,
            username,
            display_name,
            added_by_user_id,
            created_at,
            updated_at
          ) VALUES (?, ?, 1, NULL, NULL, ?, ?, ?)
        `
      ).run(userId, role, addedByUserId ?? null, createdAt, createdAt);

      this.ensureUserSettings(userId);
      this.ensureUserSearchProfile(userId);
      this.ensureUserHhSearchSettings(userId);

      return {
        created: true,
        reactivated: false,
        user: this.getBotUser(userId)!
      };
    }

    const nextRole = existing.role === "owner" ? "owner" : existing.role;
    db.prepare(
      `
        UPDATE bot_users
        SET role = ?,
            is_active = 1,
            added_by_user_id = COALESCE(added_by_user_id, ?),
            updated_at = ?
        WHERE user_id = ?
      `
    ).run(nextRole, addedByUserId ?? null, createdAt, userId);

    this.ensureUserSettings(userId);
    this.ensureUserHhSearchSettings(userId);

    return {
      created: false,
      reactivated: !existing.isActive,
      user: this.getBotUser(userId)!
    };
  }

  setBotUserActive(userId: string, isActive: boolean): void {
    const user = this.getBotUser(userId);
    if (!user) {
      return;
    }

    if (user.role === "owner" && !isActive) {
      return;
    }

    this.getDb()
      .prepare("UPDATE bot_users SET is_active = ?, updated_at = ? WHERE user_id = ?")
      .run(isActive ? 1 : 0, nowIso(), userId);
  }

  setBotUserRole(userId: string, role: Exclude<BotUserRole, "owner">): void {
    const user = this.getBotUser(userId);
    if (!user || user.role === "owner") {
      return;
    }

    this.getDb()
      .prepare("UPDATE bot_users SET role = ?, updated_at = ? WHERE user_id = ?")
      .run(role, nowIso(), userId);
  }

  createUserVacancyMatch(
    userId: string,
    vacancyId: number,
    filterResult: FilterResult,
    profileMatches: UserVacancyProfileMatchInput[] = []
  ): MatchedVacancyRecord | null {
    const db = this.getDb();
    const createdAt = nowIso();
    const effectiveProfileMatches =
      profileMatches.length > 0
        ? profileMatches
        : this.listUserSearchProfiles(userId, true).slice(0, 1).map((profile) => ({
            profileId: profile.id,
            filterResult
          }));

    const result = db.transaction(() => {
      const insertResult = db
        .prepare(
          `
            INSERT OR IGNORE INTO user_vacancy_matches (
              user_id,
              vacancy_id,
              score,
              match_summary,
              matched_keywords_json,
              delivered_at,
              created_at,
              updated_at
            ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
          `
        )
        .run(
          userId,
          vacancyId,
          filterResult.score,
          filterResult.summary,
          JSON.stringify(unique(filterResult.matchedKeywords)),
          createdAt,
          createdAt
        );

      this.upsertUserVacancyProfileMatches(userId, vacancyId, effectiveProfileMatches, createdAt);
      return insertResult;
    })();

    if (result.changes === 0) {
      return null;
    }

    return this.getUserVacancyMatch(userId, vacancyId);
  }

  listUserVacancyMatchedProfiles(userId: string, vacancyId: number): Array<{ id: number; name: string }> {
    return this.getDb()
      .prepare(
        `
          SELECT profiles.id, profiles.name
          FROM user_vacancy_profile_matches matches
          INNER JOIN user_search_profiles profiles ON profiles.id = matches.profile_id
          WHERE matches.user_id = ? AND matches.vacancy_id = ?
          ORDER BY profiles.sort_order ASC, profiles.id ASC
        `
      )
      .all(userId, vacancyId) as Array<{ id: number; name: string }>;
  }

  markUserVacancyDelivered(userId: string, vacancyId: number): void {
    this.getDb()
      .prepare(
        `
          UPDATE user_vacancy_matches
          SET delivered_at = ?, updated_at = ?
          WHERE user_id = ? AND vacancy_id = ?
        `
      )
      .run(nowIso(), nowIso(), userId, vacancyId);
  }

  getUserVacancyStatus(userId: string, vacancyId: number): VacancyUserStatus {
    const row = this.getDb()
      .prepare("SELECT status FROM user_vacancy_states WHERE user_id = ? AND vacancy_id = ? LIMIT 1")
      .get(userId, vacancyId) as { status: Exclude<VacancyUserStatus, "inbox"> } | undefined;

    return row?.status ?? "inbox";
  }

  getUserMatchedVacancy(userId: string, vacancyId: number): MatchedVacancyRecord | null {
    return this.getUserVacancyMatch(userId, vacancyId);
  }

  setUserVacancyStatus(
    userId: string,
    vacancyId: number,
    status: Exclude<VacancyUserStatus, "inbox">
  ): VacancyUserStatus {
    const timestamp = nowIso();
    const db = this.getDb();

    db.transaction(() => {
      db.prepare(
          `
            INSERT INTO user_vacancy_states (
              user_id,
              vacancy_id,
              status,
              created_at,
              updated_at
            ) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(user_id, vacancy_id)
            DO UPDATE SET
              status = excluded.status,
              updated_at = excluded.updated_at
          `
        )
        .run(userId, vacancyId, status, timestamp, timestamp);

      if (status === "applied" || status === "hidden") {
        db.prepare(
            `
              UPDATE user_vacancy_reminders
              SET cancelled_at = ?, updated_at = ?
              WHERE user_id = ?
                AND vacancy_id = ?
                AND delivered_at IS NULL
                AND cancelled_at IS NULL
            `
          )
          .run(timestamp, timestamp, userId, vacancyId);
      }
    })();

    return status;
  }

  clearUserVacancyStatus(userId: string, vacancyId: number): void {
    this.getDb()
      .prepare("DELETE FROM user_vacancy_states WHERE user_id = ? AND vacancy_id = ?")
      .run(userId, vacancyId);
  }

  upsertVacancyRelevanceFeedback(
    userId: string,
    vacancyId: number,
    value: VacancyRelevanceValue
  ): VacancyRelevanceFeedbackRecord {
    const existing = this.getVacancyRelevanceFeedback(userId, vacancyId);
    if (existing === value) {
      const row = this.getDb()
        .prepare("SELECT user_id, vacancy_id, value, created_at, updated_at FROM vacancy_relevance_feedback WHERE user_id = ? AND vacancy_id = ?")
        .get(userId, vacancyId) as { user_id: string; vacancy_id: number; value: string; created_at: string; updated_at: string };
      return {
        userId: row.user_id,
        vacancyId: row.vacancy_id,
        value: row.value as VacancyRelevanceValue,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
    }
    const timestamp = nowIso();
    const row = this.getDb()
      .prepare(
        `
          INSERT INTO vacancy_relevance_feedback (user_id, vacancy_id, value, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(user_id, vacancy_id)
          DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
          RETURNING user_id, vacancy_id, value, created_at, updated_at
        `
      )
      .get(userId, vacancyId, value, timestamp, timestamp) as {
        user_id: string;
        vacancy_id: number;
        value: string;
        created_at: string;
        updated_at: string;
      };
    return {
      userId: row.user_id,
      vacancyId: row.vacancy_id,
      value: row.value as VacancyRelevanceValue,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  getVacancyRelevanceFeedback(userId: string, vacancyId: number): VacancyRelevanceValue | null {
    const row = this.getDb()
      .prepare(
        "SELECT value FROM vacancy_relevance_feedback WHERE user_id = ? AND vacancy_id = ? LIMIT 1"
      )
      .get(userId, vacancyId) as { value: string } | undefined;
    if (!row) return null;
    const v = row.value;
    return v === "relevant" || v === "not_relevant" ? v : null;
  }

  clearVacancyRelevanceFeedback(userId: string, vacancyId: number): void {
    this.getDb()
      .prepare("DELETE FROM vacancy_relevance_feedback WHERE user_id = ? AND vacancy_id = ?")
      .run(userId, vacancyId);
  }

  saveRejectedAuditCandidate(
    userId: string,
    vacancyId: number,
    score: number | null,
    reason: string | null
  ): RejectedMatchAuditRecord {
    const timestamp = nowIso();
    const db = this.getDb();

    const row = db.transaction(() => {
      const r = db
        .prepare(
          `INSERT INTO rejected_match_audit (user_id, vacancy_id, resolution, score, reason, decided_at)
           VALUES (?, ?, 'rejected', ?, ?, ?)
           ON CONFLICT(user_id, vacancy_id)
           DO UPDATE SET score = excluded.score, reason = excluded.reason
           RETURNING user_id, vacancy_id, resolution, score, reason, decided_at, reviewed_at, verdict`
        )
        .get(userId, vacancyId, score, reason, timestamp) as {
          user_id: string;
          vacancy_id: number;
          resolution: string;
          score: number | null;
          reason: string | null;
          decided_at: string;
          reviewed_at: string | null;
          verdict: string | null;
        };

      const cnt = (
        db.prepare(
          "SELECT COUNT(*) AS cnt FROM rejected_match_audit WHERE user_id = ? AND reviewed_at IS NULL"
        ).get(userId) as { cnt: number }
      ).cnt;

      if (cnt > 500) {
        const excess = cnt - 500;
        db.prepare(
          `DELETE FROM rejected_match_audit
           WHERE rowid IN (
             SELECT rowid FROM rejected_match_audit
             WHERE user_id = ? AND reviewed_at IS NULL
             ORDER BY decided_at ASC
             LIMIT ?
           )`
        ).run(userId, excess);
      }

      return r;
    })();

    return {
      userId: row.user_id,
      vacancyId: row.vacancy_id,
      resolution: row.resolution,
      score: row.score,
      reason: row.reason,
      decidedAt: row.decided_at,
      reviewedAt: row.reviewed_at,
      verdict: row.verdict
    };
  }

  countUnreviewedRejectedAudit(userId: string): number {
    const row = this.getDb()
      .prepare(
        "SELECT COUNT(*) AS cnt FROM rejected_match_audit WHERE user_id = ? AND reviewed_at IS NULL"
      )
      .get(userId) as { cnt: number };
    return row.cnt;
  }

  getOldestUnreviewedAuditWithVacancy(
    userId: string
  ): RejectedAuditVacancyRecord | null {
    const row = this.getDb()
      .prepare(
        `SELECT
          a.user_id, a.vacancy_id, a.resolution, a.score, a.reason,
          a.decided_at, a.reviewed_at, a.verdict,
          v.id, v.source_name, v.source_channel, v.source_message_id,
          v.message_date, v.title, v.text, v.normalized_text, v.url,
          v.canonical_url, v.fingerprint, v.score AS vacancy_score,
          v.match_summary, v.matched_keywords_json, v.contacts_json,
          v.sent_to_owner_at, v.created_at
        FROM rejected_match_audit a
        INNER JOIN vacancies v ON v.id = a.vacancy_id
        WHERE a.user_id = ? AND a.reviewed_at IS NULL
        ORDER BY a.decided_at ASC
        LIMIT 1`
      )
      .get(userId) as {
        user_id: string;
        vacancy_id: number;
        resolution: string;
        score: number | null;
        reason: string | null;
        decided_at: string;
        reviewed_at: string | null;
        verdict: string | null;
        id: number;
        source_name: string;
        source_channel: string;
        source_message_id: string;
        message_date: string;
        title: string;
        text: string;
        normalized_text: string;
        url: string;
        canonical_url: string | null;
        fingerprint: string;
        vacancy_score: number;
        match_summary: string;
        matched_keywords_json: string;
        contacts_json: string;
        sent_to_owner_at: string | null;
        created_at: string;
      } | undefined;
    if (!row) return null;
    return {
      userId: row.user_id,
      vacancyId: row.vacancy_id,
      resolution: row.resolution,
      score: row.score,
      reason: row.reason,
      decidedAt: row.decided_at,
      reviewedAt: row.reviewed_at,
      verdict: row.verdict,
      id: row.id,
      sourceName: row.source_name as SourceName,
      sourceChannel: row.source_channel,
      sourceMessageId: row.source_message_id,
      messageDate: row.message_date,
      title: row.title,
      text: row.text,
      normalizedText: row.normalized_text,
      url: row.url,
      canonicalUrl: row.canonical_url,
      fingerprint: row.fingerprint,
      matchSummary: row.match_summary,
      matchedKeywords: JSON.parse(row.matched_keywords_json),
      contacts: JSON.parse(row.contacts_json),
      sentToOwnerAt: row.sent_to_owner_at,
      createdAt: row.created_at
    };
  }

  setAuditVerdict(userId: string, vacancyId: number, verdict: string): boolean {
    if (verdict !== "missed_relevant" && verdict !== "correct_rejection") {
      throw new Error(`Invalid audit verdict: ${verdict}`);
    }
    const result = this.getDb()
      .prepare(
        `UPDATE rejected_match_audit
         SET verdict = ?, reviewed_at = ?
         WHERE user_id = ? AND vacancy_id = ? AND reviewed_at IS NULL`
      )
      .run(verdict, new Date().toISOString(), userId, vacancyId);
    return result.changes > 0;
  }

  getRejectedMatchAudit(userId: string, vacancyId: number): RejectedMatchAuditRecord | null {
    const row = this.getDb()
      .prepare(
        "SELECT user_id, vacancy_id, resolution, score, reason, decided_at, reviewed_at, verdict FROM rejected_match_audit WHERE user_id = ? AND vacancy_id = ?"
      )
      .get(userId, vacancyId) as {
        user_id: string;
        vacancy_id: number;
        resolution: string;
        score: number | null;
        reason: string | null;
        decided_at: string;
        reviewed_at: string | null;
        verdict: string | null;
      } | undefined;
    if (!row) return null;
    return {
      userId: row.user_id,
      vacancyId: row.vacancy_id,
      resolution: row.resolution,
      score: row.score,
      reason: row.reason,
      decidedAt: row.decided_at,
      reviewedAt: row.reviewed_at,
      verdict: row.verdict
    };
  }

  pruneUnreviewedRejectedAudit(userId: string, maxRecords: number): number {
    const db = this.getDb();
    const count = (
      db.prepare(
        "SELECT COUNT(*) AS cnt FROM rejected_match_audit WHERE user_id = ? AND reviewed_at IS NULL"
      ).get(userId) as { cnt: number }
    ).cnt;
    if (count <= maxRecords) return 0;
    const excess = count - maxRecords;
    db.prepare(
      `DELETE FROM rejected_match_audit
       WHERE rowid IN (
         SELECT rowid FROM rejected_match_audit
         WHERE user_id = ? AND reviewed_at IS NULL
         ORDER BY decided_at ASC
         LIMIT ?
       )`
    ).run(userId, excess);
    return excess;
  }

  getMatchingQualityStats(
    userId: string,
    sinceIso: string,
    untilIso: string
  ): {
    totalMatches: number;
    totalWithFeedback: number;
    relevantCount: number;
    notRelevantCount: number;
  } {
    const row = this.getDb()
      .prepare(
        `SELECT
          COUNT(*) AS total_matches,
          COUNT(f.value) AS total_with_feedback,
          SUM(CASE WHEN f.value = 'relevant' THEN 1 ELSE 0 END) AS relevant_count,
          SUM(CASE WHEN f.value = 'not_relevant' THEN 1 ELSE 0 END) AS not_relevant_count
        FROM user_vacancy_matches m
        LEFT JOIN vacancy_relevance_feedback f ON f.user_id = m.user_id AND f.vacancy_id = m.vacancy_id
        WHERE m.user_id = ? AND m.created_at >= ? AND m.created_at < ?`
      )
      .get(userId, sinceIso, untilIso) as {
        total_matches: number;
        total_with_feedback: number;
        relevant_count: number;
        not_relevant_count: number;
      };
    return {
      totalMatches: row.total_matches,
      totalWithFeedback: row.total_with_feedback,
      relevantCount: row.relevant_count,
      notRelevantCount: row.not_relevant_count
    };
  }

  getAuditQualityMetrics(
    userId: string,
    sinceIso: string,
    untilIso: string
  ): {
    totalCandidates: number;
    reviewedCount: number;
    missedRelevantCount: number;
    correctRejectionCount: number;
  } {
    const row = this.getDb()
      .prepare(
        `SELECT
          COUNT(*) AS total_candidates,
          COUNT(CASE WHEN verdict IN ('missed_relevant', 'correct_rejection') THEN 1 END) AS reviewed_count,
          SUM(CASE WHEN verdict = 'missed_relevant' THEN 1 ELSE 0 END) AS missed_relevant_count,
          SUM(CASE WHEN verdict = 'correct_rejection' THEN 1 ELSE 0 END) AS correct_rejection_count
        FROM rejected_match_audit
        WHERE user_id = ? AND decided_at >= ? AND decided_at < ?`
      )
      .get(userId, sinceIso, untilIso) as {
        total_candidates: number;
        reviewed_count: number;
        missed_relevant_count: number;
        correct_rejection_count: number;
      };
    return {
      totalCandidates: row.total_candidates,
      reviewedCount: row.reviewed_count,
      missedRelevantCount: row.missed_relevant_count,
      correctRejectionCount: row.correct_rejection_count
    };
  }

  setUserVacancyHiddenReason(
    userId: string,
    vacancyId: number,
    reason: HiddenVacancyReason
  ): UserVacancyHiddenReasonRecord {
    const timestamp = nowIso();
    const row = this.getDb()
      .prepare(
        `
          INSERT INTO user_vacancy_hidden_reasons (
            user_id,
            vacancy_id,
            reason,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(user_id, vacancy_id)
          DO UPDATE SET
            reason = excluded.reason,
            updated_at = excluded.updated_at
          RETURNING
            user_id,
            vacancy_id,
            reason,
            created_at,
            updated_at
        `
      )
      .get(userId, vacancyId, reason, timestamp, timestamp) as UserVacancyHiddenReasonRow;

    return mapUserVacancyHiddenReason(row);
  }

  getUserVacancyHiddenReason(userId: string, vacancyId: number): UserVacancyHiddenReasonRecord | null {
    const row = this.getDb()
      .prepare(
        `
          SELECT user_id, vacancy_id, reason, created_at, updated_at
          FROM user_vacancy_hidden_reasons
          WHERE user_id = ?
            AND vacancy_id = ?
          LIMIT 1
        `
      )
      .get(userId, vacancyId) as UserVacancyHiddenReasonRow | undefined;

    return row ? mapUserVacancyHiddenReason(row) : null;
  }

  countHiddenVacancyFeedbackSummary(
    userId: string,
    days: number,
    now = new Date()
  ): HiddenVacancyFeedbackSummary {
    const since = new Date(now.getTime() - Math.max(1, days) * 24 * 60 * 60 * 1000).toISOString();
    const counts = this.getDb()
      .prepare(
        `
          SELECT
            COUNT(*) AS total_hidden,
            COALESCE(SUM(CASE WHEN r.reason IS NOT NULL THEN 1 ELSE 0 END), 0) AS with_reason
          FROM user_vacancy_states s
          LEFT JOIN user_vacancy_hidden_reasons r
            ON r.user_id = s.user_id
           AND r.vacancy_id = s.vacancy_id
          WHERE s.user_id = ?
            AND s.status = 'hidden'
            AND s.updated_at >= ?
        `
      )
      .get(userId, since) as { total_hidden: number; with_reason: number } | undefined;
    const topReasons = this.listTopHiddenVacancyReasons(userId, days, 3, now);
    const totalHidden = counts?.total_hidden ?? 0;
    const withReason = counts?.with_reason ?? 0;

    return {
      totalHidden,
      withReason,
      withoutReason: Math.max(0, totalHidden - withReason),
      topReasons
    };
  }

  listTopHiddenVacancyReasons(
    userId: string,
    days: number,
    limit = 3,
    now = new Date()
  ): HiddenVacancyReasonSummaryItem[] {
    const since = new Date(now.getTime() - Math.max(1, days) * 24 * 60 * 60 * 1000).toISOString();
    const rows = this.getDb()
      .prepare(
        `
          SELECT
            r.reason,
            COUNT(*) AS count
          FROM user_vacancy_states s
          INNER JOIN user_vacancy_hidden_reasons r
            ON r.user_id = s.user_id
           AND r.vacancy_id = s.vacancy_id
          WHERE s.user_id = ?
            AND s.status = 'hidden'
            AND s.updated_at >= ?
          GROUP BY r.reason
          ORDER BY count DESC, r.reason ASC
          LIMIT ?
        `
      )
      .all(userId, since, Math.max(1, limit)) as Array<{ reason: HiddenVacancyReason; count: number }>;

    return rows.map((row) => ({ reason: row.reason, count: row.count }));
  }

  getHiddenVacancyFilterSuggestionCandidate(
    userId: string,
    days = 7,
    now = new Date()
  ): UserFilterSuggestionCandidate | null {
    const summary = this.countHiddenVacancyFeedbackSummary(userId, days, now);
    if (summary.withReason === 0) {
      return null;
    }

    const top = summary.topReasons.find((item) => {
      const share = item.count / summary.withReason;
      return item.count >= 3 && share >= 0.5 && FILTER_SUGGESTION_BY_REASON[item.reason];
    });
    if (!top) {
      return null;
    }

    const suggestionKey = FILTER_SUGGESTION_BY_REASON[top.reason];
    if (!suggestionKey || this.isFilterSuggestionSuppressed(userId, suggestionKey, now)) {
      return null;
    }

    return {
      suggestionKey,
      reason: top.reason,
      count: top.count,
      totalWithReason: summary.withReason,
      share: top.count / summary.withReason
    };
  }

  markUserFilterSuggestionShown(
    userId: string,
    suggestionKey: FilterSuggestionKey,
    shownAt = nowIso()
  ): UserFilterSuggestionRecord {
    const row = this.getDb()
      .prepare(
        `
          INSERT INTO user_filter_suggestions (
            user_id,
            suggestion_key,
            status,
            shown_at,
            acted_at,
            dismissed_at,
            created_at,
            updated_at
          ) VALUES (?, ?, 'shown', ?, NULL, NULL, ?, ?)
          ON CONFLICT(user_id, suggestion_key)
          DO UPDATE SET
            status = 'shown',
            shown_at = excluded.shown_at,
            updated_at = excluded.updated_at
          RETURNING
            user_id,
            suggestion_key,
            status,
            shown_at,
            acted_at,
            dismissed_at,
            created_at,
            updated_at
        `
      )
      .get(userId, suggestionKey, shownAt, shownAt, shownAt) as UserFilterSuggestionRow;

    return mapUserFilterSuggestion(row);
  }

  dismissUserFilterSuggestion(
    userId: string,
    suggestionKey: FilterSuggestionKey,
    dismissedAt = nowIso()
  ): void {
    this.getDb()
      .prepare(
        `
          INSERT INTO user_filter_suggestions (
            user_id,
            suggestion_key,
            status,
            shown_at,
            acted_at,
            dismissed_at,
            created_at,
            updated_at
          ) VALUES (?, ?, 'dismissed', ?, NULL, ?, ?, ?)
          ON CONFLICT(user_id, suggestion_key)
          DO UPDATE SET
            status = 'dismissed',
            dismissed_at = excluded.dismissed_at,
            updated_at = excluded.updated_at
        `
      )
      .run(userId, suggestionKey, dismissedAt, dismissedAt, dismissedAt, dismissedAt);
  }

  private isFilterSuggestionSuppressed(
    userId: string,
    suggestionKey: FilterSuggestionKey,
    now = new Date()
  ): boolean {
    const row = this.getDb()
      .prepare(
        `
          SELECT user_id, suggestion_key, status, shown_at, acted_at, dismissed_at, created_at, updated_at
          FROM user_filter_suggestions
          WHERE user_id = ?
            AND suggestion_key = ?
          LIMIT 1
        `
      )
      .get(userId, suggestionKey) as UserFilterSuggestionRow | undefined;

    if (!row) {
      return false;
    }
    if (row.status === "applied") {
      return true;
    }

    const reference = row.dismissed_at ?? row.acted_at ?? row.shown_at;
    return Date.parse(reference) > now.getTime() - 7 * 24 * 60 * 60 * 1000;
  }

  scheduleUserVacancyReminder(userId: string, vacancyId: number, remindAt: string): VacancyReminderRecord | null {
    const timestamp = nowIso();
    const db = this.getDb();

    return db.transaction(() => {
      const currentStatus = this.getUserVacancyStatus(userId, vacancyId);
      if (currentStatus === "applied" || currentStatus === "hidden") {
        return null;
      }

      db.prepare(
          `
            INSERT INTO user_vacancy_states (
              user_id,
              vacancy_id,
              status,
              created_at,
              updated_at
            ) VALUES (?, ?, 'saved', ?, ?)
            ON CONFLICT(user_id, vacancy_id)
            DO UPDATE SET status = 'saved', updated_at = excluded.updated_at
          `
        )
        .run(userId, vacancyId, timestamp, timestamp);

      db.prepare(
          `
            INSERT INTO user_vacancy_reminders (
              user_id,
              vacancy_id,
              remind_at,
              next_attempt_at,
              attempt_count,
              delivered_at,
              cancelled_at,
              last_error,
              created_at,
              updated_at
            ) VALUES (?, ?, ?, ?, 0, NULL, NULL, NULL, ?, ?)
            ON CONFLICT(user_id, vacancy_id)
            DO UPDATE SET
              remind_at = excluded.remind_at,
              next_attempt_at = excluded.next_attempt_at,
              attempt_count = 0,
              delivered_at = NULL,
              cancelled_at = NULL,
              last_error = NULL,
              updated_at = excluded.updated_at
          `
        )
        .run(userId, vacancyId, remindAt, remindAt, timestamp, timestamp);

      return this.getActiveUserVacancyReminder(userId, vacancyId);
    })();
  }

  getActiveUserVacancyReminder(userId: string, vacancyId: number): VacancyReminderRecord | null {
    const row = this.getDb()
      .prepare(
        `
          SELECT
            v.*,
            r.user_id,
            r.remind_at,
            r.next_attempt_at,
            r.attempt_count,
            r.delivered_at,
            r.cancelled_at,
            r.last_error,
            r.created_at AS reminder_created_at,
            r.updated_at AS reminder_updated_at
          FROM user_vacancy_reminders r
          INNER JOIN vacancies v ON v.id = r.vacancy_id
          WHERE r.user_id = ?
            AND r.vacancy_id = ?
            AND r.delivered_at IS NULL
            AND r.cancelled_at IS NULL
          LIMIT 1
        `
      )
      .get(userId, vacancyId) as VacancyReminderRow | undefined;

    return row ? mapVacancyReminder(row) : null;
  }

  cancelUserVacancyReminder(userId: string, vacancyId: number): boolean {
    const timestamp = nowIso();
    const result = this.getDb()
      .prepare(
        `
          UPDATE user_vacancy_reminders
          SET cancelled_at = ?, updated_at = ?
          WHERE user_id = ?
            AND vacancy_id = ?
            AND delivered_at IS NULL
            AND cancelled_at IS NULL
        `
      )
      .run(timestamp, timestamp, userId, vacancyId);

    return result.changes > 0;
  }

  listUserVacancyReminders(userId: string, offset: number, pageSize: number): VacancyReminderPage {
    const safeOffset = Math.max(0, offset);
    const safePageSize = Math.max(1, pageSize);
    const total =
      (
        this.getDb()
          .prepare(
            `
              SELECT COUNT(*) AS count
              FROM user_vacancy_reminders
              WHERE user_id = ?
                AND delivered_at IS NULL
                AND cancelled_at IS NULL
            `
          )
          .get(userId) as CountRow | undefined
      )?.count ?? 0;
    const rows = this.getDb()
      .prepare(
        `
          SELECT
            v.*,
            r.user_id,
            r.remind_at,
            r.next_attempt_at,
            r.attempt_count,
            r.delivered_at,
            r.cancelled_at,
            r.last_error,
            r.created_at AS reminder_created_at,
            r.updated_at AS reminder_updated_at
          FROM user_vacancy_reminders r
          INNER JOIN vacancies v ON v.id = r.vacancy_id
          WHERE r.user_id = ?
            AND r.delivered_at IS NULL
            AND r.cancelled_at IS NULL
          ORDER BY datetime(r.remind_at) ASC, r.vacancy_id ASC
          LIMIT ? OFFSET ?
        `
      )
      .all(userId, safePageSize, safeOffset) as VacancyReminderRow[];

    return {
      items: rows.map(mapVacancyReminder),
      offset: safeOffset,
      pageSize: safePageSize,
      total
    };
  }

  listDueVacancyReminders(now = new Date(), limit = 50): VacancyReminderRecord[] {
    const rows = this.getDb()
      .prepare(
        `
          SELECT
            v.*,
            r.user_id,
            r.remind_at,
            r.next_attempt_at,
            r.attempt_count,
            r.delivered_at,
            r.cancelled_at,
            r.last_error,
            r.created_at AS reminder_created_at,
            r.updated_at AS reminder_updated_at
          FROM user_vacancy_reminders r
          INNER JOIN vacancies v ON v.id = r.vacancy_id
          INNER JOIN bot_users u ON u.user_id = r.user_id
          WHERE r.delivered_at IS NULL
            AND r.cancelled_at IS NULL
            AND u.is_active = 1
            AND datetime(r.next_attempt_at) <= datetime(?)
          ORDER BY datetime(r.next_attempt_at) ASC, r.vacancy_id ASC
          LIMIT ?
        `
      )
      .all(now.toISOString(), Math.max(1, limit)) as VacancyReminderRow[];

    return rows.map(mapVacancyReminder);
  }

  markVacancyReminderDelivered(
    userId: string,
    vacancyId: number,
    expectedNextAttemptAt: string,
    deliveredAt = nowIso()
  ): void {
    this.getDb()
      .prepare(
        `
          UPDATE user_vacancy_reminders
          SET delivered_at = ?, last_error = NULL, updated_at = ?
          WHERE user_id = ?
            AND vacancy_id = ?
            AND next_attempt_at = ?
            AND delivered_at IS NULL
            AND cancelled_at IS NULL
        `
      )
      .run(deliveredAt, deliveredAt, userId, vacancyId, expectedNextAttemptAt);
  }

  markVacancyReminderFailed(
    userId: string,
    vacancyId: number,
    expectedNextAttemptAt: string,
    nextAttemptAt: string,
    error: string
  ): void {
    this.getDb()
      .prepare(
        `
          UPDATE user_vacancy_reminders
          SET
            next_attempt_at = ?,
            attempt_count = attempt_count + 1,
            last_error = ?,
            updated_at = ?
          WHERE user_id = ?
            AND vacancy_id = ?
            AND next_attempt_at = ?
            AND delivered_at IS NULL
            AND cancelled_at IS NULL
        `
      )
      .run(nextAttemptAt, error.slice(0, 1000), nowIso(), userId, vacancyId, expectedNextAttemptAt);
  }

  upsertUserVacancyApplication(userId: string, vacancyId: number, appliedAt = nowIso()): VacancyApplicationRecord {
    const timestamp = nowIso();
    this.getDb()
      .prepare(
        `
          INSERT INTO user_vacancy_applications (
            user_id,
            vacancy_id,
            applied_at,
            note,
            follow_up_at,
            next_attempt_at,
            attempt_count,
            delivered_at,
            cancelled_at,
            last_error,
            responded_at,
            closed_at,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, NULL, NULL, NULL, 0, NULL, NULL, NULL, NULL, NULL, ?, ?)
          ON CONFLICT(user_id, vacancy_id)
          DO UPDATE SET
            follow_up_at = NULL,
            next_attempt_at = NULL,
            attempt_count = 0,
            delivered_at = NULL,
            cancelled_at = NULL,
            last_error = NULL,
            responded_at = NULL,
            closed_at = NULL,
            updated_at = excluded.updated_at
        `
      )
      .run(userId, vacancyId, appliedAt, timestamp, timestamp);

    const application = this.getUserVacancyApplication(userId, vacancyId);
    if (!application) {
      throw new Error("Vacancy application was not created.");
    }
    return application;
  }

  getUserVacancyApplication(userId: string, vacancyId: number): VacancyApplicationRecord | null {
    const row = this.getDb()
      .prepare(
        `
          SELECT
            user_id,
            vacancy_id,
            applied_at,
            note,
            follow_up_at,
            next_attempt_at,
            attempt_count,
            delivered_at,
            cancelled_at,
            last_error,
            responded_at,
            closed_at,
            created_at AS application_created_at,
            updated_at AS application_updated_at
          FROM user_vacancy_applications
          WHERE user_id = ?
            AND vacancy_id = ?
          LIMIT 1
        `
      )
      .get(userId, vacancyId) as VacancyApplicationRow | undefined;

    return row ? mapVacancyApplication(row) : null;
  }

  setUserVacancyApplicationNote(userId: string, vacancyId: number, note: string | null): VacancyApplicationRecord | null {
    if (note !== null && note.length > 500) {
      throw new Error("Application note must not exceed 500 characters.");
    }

    const timestamp = nowIso();
    this.getDb()
      .prepare(
        `
          INSERT OR IGNORE INTO user_vacancy_applications (
            user_id,
            vacancy_id,
            applied_at,
            note,
            follow_up_at,
            next_attempt_at,
            attempt_count,
            delivered_at,
            cancelled_at,
            last_error,
            responded_at,
            closed_at,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, NULL, NULL, NULL, 0, NULL, NULL, NULL, NULL, NULL, ?, ?)
        `
      )
      .run(userId, vacancyId, timestamp, timestamp, timestamp);
    this.getDb()
      .prepare(
        `
          UPDATE user_vacancy_applications
          SET note = ?, updated_at = ?
          WHERE user_id = ? AND vacancy_id = ?
        `
      )
      .run(note, timestamp, userId, vacancyId);

    return this.getUserVacancyApplication(userId, vacancyId);
  }

  scheduleUserVacancyApplicationFollowUp(
    userId: string,
    vacancyId: number,
    followUpAt: string
  ): VacancyApplicationRecord {
    this.upsertUserVacancyApplication(userId, vacancyId);
    const timestamp = nowIso();
    this.getDb()
      .prepare(
        `
          UPDATE user_vacancy_applications
          SET
            follow_up_at = ?,
            next_attempt_at = ?,
            attempt_count = 0,
            delivered_at = NULL,
            cancelled_at = NULL,
            last_error = NULL,
            responded_at = NULL,
            closed_at = NULL,
            updated_at = ?
          WHERE user_id = ?
            AND vacancy_id = ?
        `
      )
      .run(followUpAt, followUpAt, timestamp, userId, vacancyId);

    const application = this.getUserVacancyApplication(userId, vacancyId);
    if (!application) {
      throw new Error("Vacancy application follow-up was not scheduled.");
    }
    return application;
  }

  cancelUserVacancyApplicationFollowUp(userId: string, vacancyId: number, cancelledAt = nowIso()): boolean {
    const result = this.getDb()
      .prepare(
        `
          UPDATE user_vacancy_applications
          SET cancelled_at = ?, updated_at = ?
          WHERE user_id = ?
            AND vacancy_id = ?
            AND follow_up_at IS NOT NULL
            AND delivered_at IS NULL
            AND cancelled_at IS NULL
            AND responded_at IS NULL
            AND closed_at IS NULL
        `
      )
      .run(cancelledAt, cancelledAt, userId, vacancyId);

    return result.changes > 0;
  }

  closeUserVacancyApplication(userId: string, vacancyId: number, closedAt = nowIso()): boolean {
    const result = this.getDb()
      .prepare(
        `
          UPDATE user_vacancy_applications
          SET closed_at = ?, cancelled_at = COALESCE(cancelled_at, ?), updated_at = ?
          WHERE user_id = ?
            AND vacancy_id = ?
        `
      )
      .run(closedAt, closedAt, closedAt, userId, vacancyId);

    return result.changes > 0;
  }

  markUserVacancyApplicationResponded(userId: string, vacancyId: number, respondedAt = nowIso()): boolean {
    const result = this.getDb()
      .prepare(
        `
          UPDATE user_vacancy_applications
          SET responded_at = ?, cancelled_at = COALESCE(cancelled_at, ?), updated_at = ?
          WHERE user_id = ?
            AND vacancy_id = ?
        `
      )
      .run(respondedAt, respondedAt, respondedAt, userId, vacancyId);

    return result.changes > 0;
  }

  listDueVacancyApplicationFollowUps(now = new Date(), limit = 50): VacancyApplicationFollowUpRecord[] {
    const rows = this.getDb()
      .prepare(
        `
          SELECT
            v.*,
            a.user_id,
            a.vacancy_id,
            a.applied_at,
            a.note,
            a.follow_up_at,
            a.next_attempt_at,
            a.attempt_count,
            a.delivered_at,
            a.cancelled_at,
            a.last_error,
            a.responded_at,
            a.closed_at,
            a.created_at AS application_created_at,
            a.updated_at AS application_updated_at
          FROM user_vacancy_applications a
          INNER JOIN vacancies v ON v.id = a.vacancy_id
          INNER JOIN bot_users u ON u.user_id = a.user_id
          WHERE a.follow_up_at IS NOT NULL
            AND a.next_attempt_at IS NOT NULL
            AND a.delivered_at IS NULL
            AND a.cancelled_at IS NULL
            AND a.responded_at IS NULL
            AND a.closed_at IS NULL
            AND u.is_active = 1
            AND datetime(a.next_attempt_at) <= datetime(?)
          ORDER BY datetime(a.next_attempt_at) ASC, a.vacancy_id ASC
          LIMIT ?
        `
      )
      .all(now.toISOString(), Math.max(1, limit)) as VacancyApplicationFollowUpRow[];

    return rows.map(mapVacancyApplicationFollowUp);
  }

  markVacancyApplicationFollowUpDelivered(
    userId: string,
    vacancyId: number,
    expectedNextAttemptAt: string,
    deliveredAt = nowIso()
  ): void {
    this.getDb()
      .prepare(
        `
          UPDATE user_vacancy_applications
          SET delivered_at = ?, last_error = NULL, updated_at = ?
          WHERE user_id = ?
            AND vacancy_id = ?
            AND next_attempt_at = ?
            AND delivered_at IS NULL
            AND cancelled_at IS NULL
            AND responded_at IS NULL
            AND closed_at IS NULL
        `
      )
      .run(deliveredAt, deliveredAt, userId, vacancyId, expectedNextAttemptAt);
  }

  markVacancyApplicationFollowUpFailed(
    userId: string,
    vacancyId: number,
    expectedNextAttemptAt: string,
    nextAttemptAt: string,
    error: string
  ): void {
    this.getDb()
      .prepare(
        `
          UPDATE user_vacancy_applications
          SET
            next_attempt_at = ?,
            attempt_count = attempt_count + 1,
            last_error = ?,
            updated_at = ?
          WHERE user_id = ?
            AND vacancy_id = ?
            AND next_attempt_at = ?
            AND delivered_at IS NULL
            AND cancelled_at IS NULL
            AND responded_at IS NULL
            AND closed_at IS NULL
        `
      )
      .run(nextAttemptAt, error.slice(0, 1000), nowIso(), userId, vacancyId, expectedNextAttemptAt);
  }

  countUserVacancyApplicationSummary(userId: string): UserVacancyApplicationSummary {
    const row = this.getDb()
      .prepare(
        `
          SELECT
            COUNT(*) AS total,
            COALESCE(SUM(CASE
              WHEN a.follow_up_at IS NOT NULL
               AND a.delivered_at IS NULL
               AND a.cancelled_at IS NULL
               AND a.responded_at IS NULL
               AND a.closed_at IS NULL
              THEN 1 ELSE 0 END), 0) AS waiting_follow_up,
            COALESCE(SUM(CASE
              WHEN a.delivered_at IS NOT NULL
               AND a.responded_at IS NULL
               AND a.closed_at IS NULL
              THEN 1 ELSE 0 END), 0) AS sent_follow_up,
            COALESCE(SUM(CASE
              WHEN a.responded_at IS NOT NULL
                OR a.closed_at IS NOT NULL
              THEN 1 ELSE 0 END), 0) AS closed_or_responded
          FROM user_vacancy_states s
          LEFT JOIN user_vacancy_applications a
            ON a.user_id = s.user_id
           AND a.vacancy_id = s.vacancy_id
          WHERE s.user_id = ?
            AND s.status = 'applied'
        `
      )
      .get(userId) as
        | {
            total: number;
            waiting_follow_up: number;
            sent_follow_up: number;
            closed_or_responded: number;
          }
        | undefined;

    return {
      total: row?.total ?? 0,
      waitingFollowUp: row?.waiting_follow_up ?? 0,
      sentFollowUp: row?.sent_follow_up ?? 0,
      closedOrResponded: row?.closed_or_responded ?? 0
    };
  }

  listUserVacancyApplications(userId: string, offset: number, pageSize: number): UserVacancyApplicationPage {
    const safeOffset = Math.max(0, offset);
    const safePageSize = Math.max(1, pageSize);
    const summary = this.countUserVacancyApplicationSummary(userId);

    const rows = this.getDb()
      .prepare(
        `
          SELECT
            v.*,
            s.user_id,
            s.vacancy_id,
            'applied' AS user_status,
            s.updated_at AS status_updated_at,
            m.created_at AS matched_at,
            COALESCE(a.applied_at, s.updated_at) AS applied_at,
            a.note,
            a.follow_up_at,
            a.next_attempt_at,
            COALESCE(a.attempt_count, 0) AS attempt_count,
            a.delivered_at,
            a.cancelled_at,
            a.last_error,
            a.responded_at,
            a.closed_at,
            COALESCE(a.created_at, s.updated_at) AS application_created_at,
            COALESCE(a.updated_at, s.updated_at) AS application_updated_at
          FROM user_vacancy_states s
          INNER JOIN vacancies v ON v.id = s.vacancy_id
          LEFT JOIN user_vacancy_applications a
            ON a.user_id = s.user_id
           AND a.vacancy_id = s.vacancy_id
          LEFT JOIN user_vacancy_matches m
            ON m.user_id = s.user_id
           AND m.vacancy_id = s.vacancy_id
          WHERE s.user_id = ?
            AND s.status = 'applied'
          ORDER BY s.updated_at DESC, v.id DESC
          LIMIT ? OFFSET ?
        `
      )
      .all(userId, safePageSize, safeOffset) as UserVacancyApplicationRow[];

    return {
      items: rows.map((row) => mapUserVacancyApplication(row)),
      offset: safeOffset,
      pageSize: safePageSize,
      total: summary.total,
      summary
    };
  }

  listUserWeeklyVacancies(
    userId: string,
    offset: number,
    pageSize: number,
    days: number,
    profileId: number | null = null
  ): UserWeeklyVacancyPage {
    const db = this.getDb();
    const safeOffset = Math.max(0, offset);
    const safePageSize = Math.max(1, pageSize);
    const since = recentThresholdIso(days);
    const total =
      (
        db.prepare(
          `
            SELECT COUNT(*) AS count
            FROM user_vacancy_matches m
            INNER JOIN vacancies v ON v.id = m.vacancy_id
            LEFT JOIN user_vacancy_states s
              ON s.user_id = m.user_id
             AND s.vacancy_id = m.vacancy_id
            WHERE m.user_id = ?
              AND v.message_date >= ?
              AND COALESCE(s.status, 'inbox') != 'hidden'
              AND (
                ? IS NULL OR EXISTS (
                  SELECT 1
                  FROM user_vacancy_profile_matches profile_match
                  WHERE profile_match.user_id = m.user_id
                    AND profile_match.vacancy_id = m.vacancy_id
                    AND profile_match.profile_id = ?
                )
              )
          `
        ).get(userId, since, profileId, profileId) as CountRow | undefined
      )?.count ?? 0;
    const hiddenMatchedTotal =
      (
        db.prepare(
          `
            SELECT COUNT(*) AS count
            FROM user_vacancy_matches m
            INNER JOIN vacancies v ON v.id = m.vacancy_id
            INNER JOIN user_vacancy_states s
              ON s.user_id = m.user_id
             AND s.vacancy_id = m.vacancy_id
             AND s.status = 'hidden'
            WHERE m.user_id = ?
              AND v.message_date >= ?
              AND (
                ? IS NULL OR EXISTS (
                  SELECT 1
                  FROM user_vacancy_profile_matches profile_match
                  WHERE profile_match.user_id = m.user_id
                    AND profile_match.vacancy_id = m.vacancy_id
                    AND profile_match.profile_id = ?
                )
              )
          `
        ).get(userId, since, profileId, profileId) as CountRow | undefined
      )?.count ?? 0;

    const rows = db
      .prepare(
        `
          SELECT
            v.*,
            m.user_id,
            m.delivered_at,
            m.created_at AS matched_at,
            m.score AS user_score,
            m.match_summary AS user_match_summary,
            m.matched_keywords_json AS user_matched_keywords_json,
            COALESCE(s.status, 'inbox') AS user_status,
            s.updated_at AS status_updated_at,
            CASE WHEN s.status = 'hidden' THEN r.reason ELSE NULL END AS hidden_reason
          FROM user_vacancy_matches m
          INNER JOIN vacancies v ON v.id = m.vacancy_id
          LEFT JOIN user_vacancy_states s
            ON s.user_id = m.user_id
           AND s.vacancy_id = m.vacancy_id
          LEFT JOIN user_vacancy_hidden_reasons r
            ON r.user_id = m.user_id
           AND r.vacancy_id = m.vacancy_id
          WHERE m.user_id = ?
            AND v.message_date >= ?
            AND COALESCE(s.status, 'inbox') != 'hidden'
            AND (
              ? IS NULL OR EXISTS (
                SELECT 1
                FROM user_vacancy_profile_matches profile_match
                WHERE profile_match.user_id = m.user_id
                  AND profile_match.vacancy_id = m.vacancy_id
                  AND profile_match.profile_id = ?
              )
            )
          ORDER BY v.message_date DESC, v.id DESC
          LIMIT ? OFFSET ?
        `
      )
      .all(userId, since, profileId, profileId, safePageSize, safeOffset) as MatchedVacancyRow[];

    return {
      items: rows.map((row) => this.attachMatchedProfiles(mapMatchedVacancy(row))),
      offset: safeOffset,
      pageSize: safePageSize,
      total,
      hiddenMatchedTotal
    };
  }

  listUserVacanciesByStatus(
    userId: string,
    status: Exclude<VacancyUserStatus, "inbox">,
    offset: number,
    pageSize: number
  ): UserStatusVacancyPage {
    const safeOffset = Math.max(0, offset);
    const safePageSize = Math.max(1, pageSize);
    const total =
      (
        this.getDb()
          .prepare("SELECT COUNT(*) AS count FROM user_vacancy_states WHERE user_id = ? AND status = ?")
          .get(userId, status) as CountRow | undefined
      )?.count ?? 0;

    const rows = this.getDb()
      .prepare(
        `
          SELECT
            v.*,
            s.user_id,
            s.status AS user_status,
            s.updated_at AS status_updated_at,
            m.created_at AS matched_at,
            CASE WHEN s.status = 'hidden' THEN r.reason ELSE NULL END AS hidden_reason
          FROM user_vacancy_states s
          INNER JOIN vacancies v ON v.id = s.vacancy_id
          LEFT JOIN user_vacancy_matches m
            ON m.user_id = s.user_id
           AND m.vacancy_id = s.vacancy_id
          LEFT JOIN user_vacancy_hidden_reasons r
            ON r.user_id = s.user_id
           AND r.vacancy_id = s.vacancy_id
          WHERE s.user_id = ? AND s.status = ?
          ORDER BY s.updated_at DESC, v.id DESC
          LIMIT ? OFFSET ?
        `
      )
      .all(userId, status, safePageSize, safeOffset) as UserVacancyStateRow[];

    return {
      items: rows.map((row) => this.attachMatchedProfiles(mapUserStatusVacancy(row))),
      offset: safeOffset,
      pageSize: safePageSize,
      total,
      status
    };
  }

  listVacanciesSince(days: number): VacancyRecord[] {
    const since = recentThresholdIso(days);
    const rows = this.getDb()
      .prepare(
        `
          SELECT *
          FROM vacancies
          WHERE message_date >= ?
          ORDER BY message_date DESC, id DESC
        `
      )
      .all(since) as VacancyRow[];

    return rows.map((row) => mapVacancy(row));
  }

  listFuzzyMatchCandidates(vacancyId: number, days: number, limit = 200, titleTokens?: string[]): VacancyRecord[] {
    const since = recentThresholdIso(days);
    const tokenClause = titleTokens && titleTokens.length > 0
      ? `AND (${titleTokens.map(() => "title LIKE ?").join(" OR ")})`
      : "";
    const params: (string | number)[] = [since, vacancyId];
    if (titleTokens && titleTokens.length > 0) {
      for (const token of titleTokens) {
        params.push(`%${token}%`);
      }
    }
    params.push(limit);
    const rows = this.getDb()
      .prepare(
        `
          SELECT *
          FROM vacancies
          WHERE message_date >= ?
            AND id != ?
            ${tokenClause}
          ORDER BY message_date DESC, id DESC
          LIMIT ?
        `
      )
      .all(...params) as VacancyRow[];

    return rows.map((row) => mapVacancy(row));
  }

  listChannelPerformance(sinceIso: string, untilIso: string, limit = 10): ChannelPerformanceRow[] {
    const db = this.getDb();
    const safeLimit = Math.max(1, limit);
    const rows = db
      .prepare(
        `
          WITH active_sources AS (
            SELECT source_name, source_channel
            FROM vacancies
            WHERE created_at >= ? AND created_at < ?
            UNION
            SELECT v.source_name, v.source_channel
            FROM user_vacancy_matches m
            JOIN vacancies v ON v.id = m.vacancy_id
            WHERE m.created_at >= ? AND m.created_at < ?
            UNION
            SELECT v.source_name, v.source_channel
            FROM analytics_events e
            JOIN vacancies v ON v.id = json_extract(e.properties_json, '$.vacancy_id')
            WHERE e.event_name = 'vacancy_status_changed'
              AND json_extract(e.properties_json, '$.next_status') IN ('saved', 'hidden', 'applied')
              AND e.occurred_at >= ? AND e.occurred_at < ?
          )
          SELECT
            src.source_name,
            src.source_channel,
            COALESCE(vc.cnt, 0) AS vacancy_count,
            COALESCE(mc.cnt, 0) AS match_count,
            COALESCE(sc.cnt, 0) AS saved_count,
            COALESCE(hc.cnt, 0) AS hidden_count,
            COALESCE(ac.cnt, 0) AS application_count
          FROM active_sources src
          LEFT JOIN (
            SELECT source_name, source_channel, COUNT(*) AS cnt
            FROM vacancies
            WHERE created_at >= ? AND created_at < ?
            GROUP BY source_name, source_channel
          ) vc ON vc.source_name = src.source_name AND vc.source_channel = src.source_channel
          LEFT JOIN (
            SELECT v.source_name, v.source_channel, COUNT(*) AS cnt
            FROM user_vacancy_matches m
            JOIN vacancies v ON v.id = m.vacancy_id
            WHERE m.created_at >= ? AND m.created_at < ?
            GROUP BY v.source_name, v.source_channel
          ) mc ON mc.source_name = src.source_name AND mc.source_channel = src.source_channel
          LEFT JOIN (
            SELECT v.source_name, v.source_channel, COUNT(*) AS cnt
            FROM analytics_events e
            JOIN vacancies v ON v.id = json_extract(e.properties_json, '$.vacancy_id')
            WHERE e.event_name = 'vacancy_status_changed'
              AND json_extract(e.properties_json, '$.next_status') = 'saved'
              AND e.occurred_at >= ? AND e.occurred_at < ?
            GROUP BY v.source_name, v.source_channel
          ) sc ON sc.source_name = src.source_name AND sc.source_channel = src.source_channel
          LEFT JOIN (
            SELECT v.source_name, v.source_channel, COUNT(*) AS cnt
            FROM analytics_events e
            JOIN vacancies v ON v.id = json_extract(e.properties_json, '$.vacancy_id')
            WHERE e.event_name = 'vacancy_status_changed'
              AND json_extract(e.properties_json, '$.next_status') = 'hidden'
              AND e.occurred_at >= ? AND e.occurred_at < ?
            GROUP BY v.source_name, v.source_channel
          ) hc ON hc.source_name = src.source_name AND hc.source_channel = src.source_channel
          LEFT JOIN (
            SELECT v.source_name, v.source_channel, COUNT(*) AS cnt
            FROM analytics_events e
            JOIN vacancies v ON v.id = json_extract(e.properties_json, '$.vacancy_id')
            WHERE e.event_name = 'vacancy_status_changed'
              AND json_extract(e.properties_json, '$.next_status') = 'applied'
              AND e.occurred_at >= ? AND e.occurred_at < ?
            GROUP BY v.source_name, v.source_channel
          ) ac ON ac.source_name = src.source_name AND ac.source_channel = src.source_channel
          ORDER BY match_count DESC, vacancy_count DESC, src.source_name ASC, src.source_channel ASC
          LIMIT ?
        `
      )
      .all(
        sinceIso, untilIso, sinceIso, untilIso, sinceIso, untilIso,
        sinceIso, untilIso, sinceIso, untilIso, sinceIso, untilIso,
        sinceIso, untilIso, sinceIso, untilIso,
        safeLimit
      ) as Array<{
      source_name: string;
      source_channel: string;
      vacancy_count: number;
      match_count: number;
      saved_count: number;
      hidden_count: number;
      application_count: number;
    }>;

    return rows.map((row) => ({
      sourceName: row.source_name,
      sourceChannel: row.source_channel,
      vacancyCount: row.vacancy_count,
      matchCount: row.match_count,
      savedCount: row.saved_count,
      hiddenCount: row.hidden_count,
      applicationCount: row.application_count
    }));
  }

  canReplaceVacancyAggregate(vacancyId: number): boolean {
    const db = this.getDb();
    const state = db.prepare("SELECT 1 FROM user_vacancy_states WHERE vacancy_id = ? LIMIT 1").get(vacancyId);
    const activeReminder = db.prepare(
      `SELECT 1
       FROM user_vacancy_reminders
       WHERE vacancy_id = ? AND delivered_at IS NULL AND cancelled_at IS NULL
       LIMIT 1`
    ).get(vacancyId);
    return !state && !activeReminder;
  }

  deleteVacancyAggregateIfUnmanaged(vacancyId: number): boolean {
    return this.getDb().transaction(() => {
      if (!this.canReplaceVacancyAggregate(vacancyId)) {
        return false;
      }
      return this.getDb().prepare("DELETE FROM vacancies WHERE id = ?").run(vacancyId).changes > 0;
    })();
  }

  getVacancy(vacancyId: number): VacancyRecord | null {
    return this.getVacancyById(vacancyId);
  }

  listVacancyDuplicatePosts(vacancyId: number, limit = 5): VacancyDuplicatePostPage {
    const vacancy = this.getVacancyById(vacancyId);
    if (!vacancy) {
      return {
        items: [],
        total: 0
      };
    }

    const safeLimit = Math.max(1, limit);
    const db = this.getDb();
    const duplicatePredicate = vacancy.canonicalUrl
      ? "(canonical_url = ? OR (canonical_url IS NULL AND fingerprint = ?))"
      : "fingerprint = ?";
    const duplicateParams = vacancy.canonicalUrl
      ? [vacancy.canonicalUrl, vacancy.fingerprint]
      : [vacancy.fingerprint];
    const canonicalParams = [
      ...duplicateParams,
      vacancy.sourceName,
      vacancy.sourceChannel,
      vacancy.sourceMessageId
    ];

    const fuzzyLinked = db
      .prepare(`
        SELECT duplicate_vacancy_id AS linked_id FROM vacancy_fuzzy_duplicates WHERE vacancy_id = ?
        UNION
        SELECT vacancy_id AS linked_id FROM vacancy_fuzzy_duplicates WHERE duplicate_vacancy_id = ?
      `)
      .all(vacancyId, vacancyId) as Array<{ linked_id: number }>;

    const fuzzyIds: number[] = fuzzyLinked.map((r) => r.linked_id);

    const baseSql = `
      SELECT source_name, source_channel, source_message_id, message_date, url
      FROM raw_messages
      WHERE ${duplicatePredicate}
        AND NOT (source_name = ? AND source_channel = ? AND source_message_id = ?)
    `;

    const fuzzySql =
      fuzzyIds.length > 0
        ? `UNION
         SELECT v.source_name, v.source_channel, v.source_message_id, v.message_date, v.url
         FROM vacancies v
         WHERE v.id IN (${fuzzyIds.map(() => "?").join(",")})`
        : "";

    const totalParams = fuzzyIds.length > 0 ? [...canonicalParams, ...fuzzyIds] : canonicalParams;
    const selectParams = fuzzyIds.length > 0
      ? [...canonicalParams, ...fuzzyIds, safeLimit]
      : [...canonicalParams, safeLimit];

    const countSql = `SELECT COUNT(*) AS count FROM (${baseSql} ${fuzzySql})`;
    const selectSql = `${baseSql} ${fuzzySql} ORDER BY message_date DESC, source_name, source_channel LIMIT ?`;

    const total =
      (
        db.prepare(countSql).get(...totalParams) as CountRow | undefined
      )?.count ?? 0;

    const rows = db.prepare(selectSql).all(...selectParams) as RawMessageDuplicateRow[];

    return {
      items: rows.map((row) => mapVacancyDuplicatePost(row)),
      total
    };
  }

  recordVacancyFuzzyDuplicate(
    vacancyId: number,
    duplicateVacancyId: number,
    score: number,
    reasons: string[]
  ): void {
    const [first, second] =
      vacancyId < duplicateVacancyId ? [vacancyId, duplicateVacancyId] : [duplicateVacancyId, vacancyId];
    this.getDb()
      .prepare(
        `
          INSERT OR IGNORE INTO vacancy_fuzzy_duplicates (vacancy_id, duplicate_vacancy_id, score, reasons_json)
          VALUES (?, ?, ?, ?)
        `
      )
      .run(first, second, score, JSON.stringify(reasons));
  }

  getFuzzyGroupVacancyIds(vacancyId: number): number[] {
    const db = this.getDb();
    const seen = new Set<number>();
    let queue = [vacancyId];
    while (queue.length > 0) {
      const ids = db
        .prepare(
          `
            SELECT vacancy_id, duplicate_vacancy_id
            FROM vacancy_fuzzy_duplicates
            WHERE vacancy_id IN (${queue.map(() => "?").join(",")})
               OR duplicate_vacancy_id IN (${queue.map(() => "?").join(",")})
          `
        )
        .all(...queue, ...queue) as Array<{ vacancy_id: number; duplicate_vacancy_id: number }>;
      const next: number[] = [];
      for (const row of ids) {
        for (const id of [row.vacancy_id, row.duplicate_vacancy_id]) {
          if (!seen.has(id)) {
            seen.add(id);
            next.push(id);
          }
        }
      }
      queue = next;
    }
    return [...seen];
  }

  getFuzzyGroupRootId(vacancyId: number): number {
    const ids = this.getFuzzyGroupVacancyIds(vacancyId);
    return ids.length > 0 ? Math.min(...ids) : vacancyId;
  }

  hasUserMatchedAnyVacancy(userId: string, vacancyIds: number[]): boolean {
    if (vacancyIds.length === 0) return false;
    const row = this.getDb()
      .prepare(
        `
          SELECT 1 AS found
          FROM user_vacancy_matches
          WHERE user_id = ? AND vacancy_id IN (${vacancyIds.map(() => "?").join(",")})
          LIMIT 1
        `
      )
      .get(userId, ...vacancyIds) as { found: number } | undefined;
    return row !== undefined;
  }

  listRecentRawMessageTexts(days: number, limit = 500): string[] {
    const safeLimit = Math.max(1, limit);
    const since = recentThresholdIso(days);
    const rows = this.getDb()
      .prepare(
        `
          SELECT text
          FROM raw_messages
          WHERE message_date >= ?
          ORDER BY message_date DESC, id DESC
          LIMIT ?
        `
      )
      .all(since, safeLimit) as Array<{ text: string }>;

    return rows.map((row) => row.text);
  }

  listRecentActiveChannelRawMessageReferences(days: number, limit = 5000): RecentRawMessageReference[] {
    const safeLimit = Math.max(1, limit);
    const since = recentThresholdIso(days);
    return this.getDb()
      .prepare(
        `
          SELECT r.source_channel, r.text
          FROM raw_messages r
          INNER JOIN monitored_channels c
            ON c.source_name = r.source_name
           AND c.username = r.source_channel
           AND c.is_active = 1
          WHERE r.source_name = 'telegram_web_preview'
            AND r.message_date >= ?
          ORDER BY r.message_date DESC, r.id DESC
          LIMIT ?
        `
      )
      .all(since, safeLimit)
      .map((row) => {
        const value = row as { source_channel: string; text: string };
        return { sourceChannel: value.source_channel, text: value.text };
      });
  }

  createChannelDiscoveryRun(input: ChannelDiscoveryRunCreateInput): ChannelDiscoveryRun {
    const timestamp = nowIso();
    const result = this.getDb()
      .prepare(
        `
          INSERT INTO channel_discovery_runs (
            status,
            started_by_user_id,
            profile_id,
            profile_label,
            custom_query,
            seed_queries_json,
            providers_json,
            provider_warnings_json,
            total_candidates_found,
            candidates_to_check,
            candidates_checked,
            candidates_recommended,
            candidates_filtered,
            error,
            started_at,
            completed_at
          ) VALUES ('running', ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, NULL, ?, NULL)
        `
      )
      .run(
        input.startedByUserId ?? null,
        input.profileId,
        input.profileLabel,
        input.customQuery ?? null,
        JSON.stringify(unique(input.seedQueries)),
        JSON.stringify(unique(input.providers ?? [])),
        JSON.stringify(unique(input.providerWarnings ?? [])),
        timestamp
      );

    const run = this.getChannelDiscoveryRun(Number(result.lastInsertRowid));
    if (!run) {
      throw new Error("Failed to read back channel discovery run.");
    }

    return run;
  }

  getChannelDiscoveryRun(runId: number): ChannelDiscoveryRun | null {
    const row = this.getDb()
      .prepare("SELECT * FROM channel_discovery_runs WHERE id = ? LIMIT 1")
      .get(runId) as ChannelDiscoveryRunRow | undefined;

    return row ? mapChannelDiscoveryRun(row) : null;
  }

  getRunningChannelDiscoveryRun(): ChannelDiscoveryRun | null {
    const row = this.getDb()
      .prepare("SELECT * FROM channel_discovery_runs WHERE status = 'running' ORDER BY id DESC LIMIT 1")
      .get() as ChannelDiscoveryRunRow | undefined;

    return row ? mapChannelDiscoveryRun(row) : null;
  }

  failInterruptedChannelDiscoveryRuns(error: string): number {
    return this.getDb()
      .prepare(
        `
          UPDATE channel_discovery_runs
          SET status = 'failed',
              error = ?,
              completed_at = ?
          WHERE status = 'running'
        `
      )
      .run(error, nowIso()).changes;
  }

  updateChannelDiscoveryRunProgress(
    runId: number,
    progress: {
      totalCandidatesFound: number;
      candidatesToCheck: number;
      candidatesChecked: number;
      candidatesRecommended: number;
      candidatesFiltered: number;
      providers: string[];
      providerWarnings: string[];
    }
  ): ChannelDiscoveryRun {
    this.getDb()
      .prepare(
        `
          UPDATE channel_discovery_runs
          SET total_candidates_found = ?,
              candidates_to_check = ?,
              candidates_checked = ?,
              candidates_recommended = ?,
              candidates_filtered = ?,
              providers_json = ?,
              provider_warnings_json = ?
          WHERE id = ? AND status = 'running'
        `
      )
      .run(
        progress.totalCandidatesFound,
        progress.candidatesToCheck,
        progress.candidatesChecked,
        progress.candidatesRecommended,
        progress.candidatesFiltered,
        JSON.stringify(unique(progress.providers)),
        JSON.stringify(unique(progress.providerWarnings)),
        runId
      );

    const run = this.getChannelDiscoveryRun(runId);
    if (!run) {
      throw new Error(`Channel discovery run ${runId} not found after progress update.`);
    }
    return run;
  }

  completeChannelDiscoveryRun(
    runId: number,
    summary: {
      totalCandidatesFound: number;
      candidatesToCheck: number;
      candidatesChecked: number;
      candidatesRecommended: number;
      candidatesFiltered: number;
      providers?: string[];
      providerWarnings?: string[];
    }
  ): ChannelDiscoveryRun {
    this.getDb()
      .prepare(
        `
          UPDATE channel_discovery_runs
          SET status = 'completed',
              total_candidates_found = ?,
              candidates_to_check = ?,
              candidates_checked = ?,
              candidates_recommended = ?,
              candidates_filtered = ?,
              providers_json = ?,
              provider_warnings_json = ?,
              error = NULL,
              completed_at = ?
          WHERE id = ?
        `
      )
      .run(
        summary.totalCandidatesFound,
        summary.candidatesToCheck,
        summary.candidatesChecked,
        summary.candidatesRecommended,
        summary.candidatesFiltered,
        JSON.stringify(unique(summary.providers ?? [])),
        JSON.stringify(unique(summary.providerWarnings ?? [])),
        nowIso(),
        runId
      );

    const run = this.getChannelDiscoveryRun(runId);
    if (!run) {
      throw new Error(`Channel discovery run ${runId} not found after completion.`);
    }

    return run;
  }

  failChannelDiscoveryRun(runId: number, error: string): ChannelDiscoveryRun {
    this.getDb()
      .prepare(
        `
          UPDATE channel_discovery_runs
          SET status = 'failed',
              error = ?,
              completed_at = ?
          WHERE id = ?
        `
      )
      .run(error, nowIso(), runId);

    const run = this.getChannelDiscoveryRun(runId);
    if (!run) {
      throw new Error(`Channel discovery run ${runId} not found after failure.`);
    }

    return run;
  }

  upsertChannelDiscoveryCandidate(input: ChannelDiscoveryCandidateInput): ChannelDiscoveryCandidate {
    const timestamp = nowIso();
    this.getDb()
      .prepare(
        `
          INSERT INTO channel_discovery_candidates (
            run_id,
            username,
            title,
            status,
            score,
            sources_json,
            probe_url,
            sample_posts_count,
            primary_signal_posts_count,
            format_signal_posts_count,
            hiring_posts_count,
            vacancy_like_posts_count,
            resume_posts_count,
            resume_rate,
            reasons_json,
            evidence_json,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(run_id, username) DO UPDATE SET
            title = excluded.title,
            status = excluded.status,
            score = excluded.score,
            sources_json = excluded.sources_json,
            probe_url = excluded.probe_url,
            sample_posts_count = excluded.sample_posts_count,
            primary_signal_posts_count = excluded.primary_signal_posts_count,
            format_signal_posts_count = excluded.format_signal_posts_count,
            hiring_posts_count = excluded.hiring_posts_count,
            vacancy_like_posts_count = excluded.vacancy_like_posts_count,
            resume_posts_count = excluded.resume_posts_count,
            resume_rate = excluded.resume_rate,
            reasons_json = excluded.reasons_json,
            evidence_json = excluded.evidence_json,
            updated_at = excluded.updated_at
        `
      )
      .run(
        input.runId,
        input.username,
        input.title ?? null,
        input.status ?? "pending",
        input.score,
        JSON.stringify(unique(input.sources)),
        input.probeUrl ?? null,
        input.stats.samplePosts,
        input.stats.primarySignalPosts,
        input.stats.formatSignalPosts,
        input.stats.hiringPosts,
        input.stats.vacancyLikePosts,
        input.stats.resumePosts,
        input.stats.resumeRate,
        JSON.stringify(unique(input.reasons)),
        JSON.stringify((input.evidence ?? []).slice(0, 3)),
        timestamp,
        timestamp
      );

    const candidate = this.getChannelDiscoveryCandidateByRunAndUsername(input.runId, input.username);
    if (!candidate) {
      throw new Error(`Channel discovery candidate ${input.username} was not saved.`);
    }

    return candidate;
  }

  listChannelDiscoveryCandidatesPage(runId: number, offset: number, pageSize: number): ChannelDiscoveryCandidatePage {
    const safeOffset = Math.max(0, offset);
    const safePageSize = Math.max(1, pageSize);
    const db = this.getDb();
    const total =
      (
        db
          .prepare("SELECT COUNT(*) AS count FROM channel_discovery_candidates WHERE run_id = ?")
          .get(runId) as CountRow | undefined
      )?.count ?? 0;
    const rows = db
      .prepare(
        `
          SELECT *
          FROM channel_discovery_candidates
          WHERE run_id = ?
          ORDER BY
            CASE status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
            score DESC,
            id ASC
          LIMIT ? OFFSET ?
        `
      )
      .all(runId, safePageSize, safeOffset) as ChannelDiscoveryCandidateRow[];

    return {
      items: rows.map((row) => mapChannelDiscoveryCandidate(row)),
      offset: safeOffset,
      pageSize: safePageSize,
      total,
      runId
    };
  }

  listPendingChannelDiscoveryCandidatesPage(offset: number, pageSize: number): ChannelDiscoveryCandidatePage {
    const safeOffset = Math.max(0, offset);
    const safePageSize = Math.max(1, pageSize);
    const db = this.getDb();
    const total =
      (db.prepare("SELECT COUNT(DISTINCT username) AS count FROM channel_discovery_candidates WHERE status = 'pending'").get() as
        | CountRow
        | undefined)?.count ?? 0;
    const rows = db
      .prepare(
        `
          SELECT *
          FROM channel_discovery_candidates
          WHERE status = 'pending'
            AND id IN (
              SELECT MAX(id)
              FROM channel_discovery_candidates
              WHERE status = 'pending'
              GROUP BY username
            )
          ORDER BY score DESC, updated_at DESC, id DESC
          LIMIT ? OFFSET ?
        `
      )
      .all(safePageSize, safeOffset) as ChannelDiscoveryCandidateRow[];

    return {
      items: rows.map((row) => mapChannelDiscoveryCandidate(row)),
      offset: safeOffset,
      pageSize: safePageSize,
      total,
      runId: 0
    };
  }

  getChannelDiscoveryCandidate(candidateId: number): ChannelDiscoveryCandidate | null {
    const row = this.getDb()
      .prepare("SELECT * FROM channel_discovery_candidates WHERE id = ? LIMIT 1")
      .get(candidateId) as ChannelDiscoveryCandidateRow | undefined;

    return row ? mapChannelDiscoveryCandidate(row) : null;
  }

  setChannelDiscoveryCandidateStatus(
    candidateId: number,
    status: ChannelDiscoveryCandidateStatus
  ): ChannelDiscoveryCandidate | null {
    this.getDb()
      .prepare("UPDATE channel_discovery_candidates SET status = ?, updated_at = ? WHERE id = ?")
      .run(status, nowIso(), candidateId);

    return this.getChannelDiscoveryCandidate(candidateId);
  }

  blockChannelDiscoveryUsername(username: string): void {
    this.setChannelDiscoveryUsernameStatus(username, "blocked");
  }

  skipChannelDiscoveryUsername(username: string): void {
    this.getDb()
      .prepare("UPDATE channel_discovery_candidates SET status = 'skipped', updated_at = ? WHERE username = ? AND status = 'pending'")
      .run(nowIso(), username);
  }

  setChannelDiscoveryUsernameStatus(username: string, status: ChannelDiscoveryCandidateStatus): void {
    this.getDb()
      .prepare("UPDATE channel_discovery_candidates SET status = ?, updated_at = ? WHERE username = ?")
      .run(status, nowIso(), username);
  }

  isChannelDiscoveryUsernameBlocked(username: string): boolean {
    const row = this.getDb()
      .prepare(
        `
          SELECT 1
          FROM channel_discovery_candidates
          WHERE username = ? AND status = 'blocked'
          LIMIT 1
        `
      )
      .get(username) as { 1: number } | undefined;

    return Boolean(row);
  }

  listBlockedChannelDiscoveryUsernames(): Set<string> {
    const rows = this.getDb()
      .prepare("SELECT DISTINCT username FROM channel_discovery_candidates WHERE status = 'blocked'")
      .all() as Array<{ username: string }>;
    return new Set(rows.map((row) => row.username));
  }

  listChannelDiscoveryCheckTimes(searchKey: string): Map<string, string> {
    const rows = this.getDb()
      .prepare("SELECT username, last_checked_at FROM channel_discovery_checks WHERE search_key = ?")
      .all(searchKey) as Array<{ username: string; last_checked_at: string }>;
    return new Map(rows.map((row) => [row.username, row.last_checked_at]));
  }

  hasCompletedAutomaticChannelDiscoveryRun(profileId: ChannelDiscoveryProfileId, customQuery: string | null): boolean {
    const row = this.getDb()
      .prepare(
        `
          SELECT 1
          FROM channel_discovery_runs
          WHERE status = 'completed'
            AND profile_id = ?
            AND COALESCE(custom_query, '') = COALESCE(?, '')
            AND providers_json NOT LIKE '%"manual_seed"%'
          LIMIT 1
        `
      )
      .get(profileId, customQuery) as { 1: number } | undefined;
    return Boolean(row);
  }

  recordChannelDiscoveryCheck(searchKey: string, username: string): void {
    this.getDb()
      .prepare(
        `
          INSERT INTO channel_discovery_checks (search_key, username, check_count, last_checked_at)
          VALUES (?, ?, 1, ?)
          ON CONFLICT(search_key, username) DO UPDATE SET
            check_count = channel_discovery_checks.check_count + 1,
            last_checked_at = excluded.last_checked_at
        `
      )
      .run(searchKey, username, nowIso());
  }

  isChannelDiscoveryUsernameRejected(username: string): boolean {
    return this.isChannelDiscoveryUsernameBlocked(username);
  }

  syncUserVacancyMatchesForWindow(
    userId: string,
    days: number,
    inputs: UserVacancyMatchSyncInput[]
  ): UserVacancyMatchSyncResult {
    const db = this.getDb();
    const since = recentThresholdIso(days);
    const createdAt = nowIso();

    return db.transaction(() => {
      db.prepare(
        `
          DELETE FROM user_vacancy_profile_matches
          WHERE user_id = ?
            AND vacancy_id IN (
              SELECT id FROM vacancies WHERE message_date >= ?
            )
        `
      ).run(userId, since);

      const existingRows = db
        .prepare(
          `
            SELECT
              m.vacancy_id AS vacancy_id,
              m.score AS score,
              m.match_summary AS match_summary,
              m.matched_keywords_json AS matched_keywords_json
            FROM user_vacancy_matches m
            INNER JOIN vacancies v ON v.id = m.vacancy_id
            WHERE m.user_id = ? AND v.message_date >= ?
          `
        )
        .all(userId, since) as Array<{
        vacancy_id: number;
        score: number;
        match_summary: string;
        matched_keywords_json: string;
      }>;

      const existingByVacancyId = new Map(existingRows.map((row) => [row.vacancy_id, row]));
      const nextVacancyIds = new Set<number>();
      let created = 0;
      let updated = 0;
      let unchanged = 0;

      const insertStatement = db.prepare(
        `
          INSERT INTO user_vacancy_matches (
            user_id,
            vacancy_id,
            score,
            match_summary,
            matched_keywords_json,
            delivered_at,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
        `
      );
      const updateStatement = db.prepare(
        `
          UPDATE user_vacancy_matches
          SET score = ?,
              match_summary = ?,
              matched_keywords_json = ?,
              updated_at = ?
          WHERE user_id = ? AND vacancy_id = ?
        `
      );

      for (const input of inputs) {
        nextVacancyIds.add(input.vacancyId);
        this.upsertUserVacancyProfileMatches(userId, input.vacancyId, input.profileMatches ?? [], createdAt);
        const matchedKeywordsJson = JSON.stringify(unique(input.filterResult.matchedKeywords));
        const existing = existingByVacancyId.get(input.vacancyId);

        if (!existing) {
          insertStatement.run(
            userId,
            input.vacancyId,
            input.filterResult.score,
            input.filterResult.summary,
            matchedKeywordsJson,
            createdAt,
            createdAt
          );
          created += 1;
          continue;
        }

        const changed =
          existing.score !== input.filterResult.score ||
          existing.match_summary !== input.filterResult.summary ||
          existing.matched_keywords_json !== matchedKeywordsJson;

        if (changed) {
          updateStatement.run(
            input.filterResult.score,
            input.filterResult.summary,
            matchedKeywordsJson,
            createdAt,
            userId,
            input.vacancyId
          );
          updated += 1;
        } else {
          unchanged += 1;
        }
      }

      let removed = 0;
      const existingVacancyIds = [...existingByVacancyId.keys()];
      const vacancyIdsToRemove = existingVacancyIds.filter((vacancyId) => !nextVacancyIds.has(vacancyId));
      if (vacancyIdsToRemove.length > 0) {
        const placeholders = vacancyIdsToRemove.map(() => "?").join(", ");
        const result = db
          .prepare(
            `
              DELETE FROM user_vacancy_matches
              WHERE user_id = ?
                AND vacancy_id IN (${placeholders})
            `
          )
          .run(userId, ...vacancyIdsToRemove);
        removed = result.changes;
      }

      return {
        created,
        updated,
        unchanged,
        removed,
        totalMatched: inputs.length
      };
    })();
  }

  bootstrapChannels(ownerUserId: string | undefined, channels: string[], sourceName: SourceName): number {
    const uniqueChannels = unique(channels);
    if (uniqueChannels.length === 0) {
      return 0;
    }

    const db = this.getDb();
    const existingCount =
      (
        db.prepare("SELECT COUNT(*) AS count FROM monitored_channels WHERE source_name = ?").get(sourceName) as
          | CountRow
          | undefined
      )?.count ?? 0;

    if (existingCount > 0) {
      return 0;
    }

    const insert = db.prepare(
      `
        INSERT INTO monitored_channels (
          username,
          source_name,
          is_active,
          initial_backfill_completed,
          last_seen_message_id,
          idle_poll_streak,
          next_poll_after,
          last_checked_at,
          last_success_at,
          last_error,
          added_by_user_id,
          created_at,
          updated_at
        ) VALUES (?, ?, 1, 0, NULL, 0, NULL, NULL, NULL, NULL, ?, ?, ?)
      `
    );

    const timestamp = nowIso();
    const transaction = db.transaction((items: string[]) => {
      for (const username of items) {
        insert.run(username, sourceName, ownerUserId ?? null, timestamp, timestamp);
      }
    });

    transaction(uniqueChannels);
    return uniqueChannels.length;
  }

  listActiveChannels(sourceName: SourceName): MonitoredChannel[] {
    const rows = this.getDb()
      .prepare(
        `
          SELECT *
          FROM monitored_channels
          WHERE source_name = ? AND is_active = 1
          ORDER BY id ASC
        `
      )
      .all(sourceName) as MonitoredChannelRow[];

    return rows.map((row) => mapMonitoredChannel(row));
  }

  listChannels(sourceName: SourceName): MonitoredChannel[] {
    const rows = this.getDb()
      .prepare(
        `
          SELECT *
          FROM monitored_channels
          WHERE source_name = ?
          ORDER BY username COLLATE NOCASE ASC
        `
      )
      .all(sourceName) as MonitoredChannelRow[];

    return rows.map((row) => mapMonitoredChannel(row));
  }

  listChannelsPage(sourceName: SourceName, offset: number, pageSize: number): MonitoredChannelPage {
    const safeOffset = Math.max(0, offset);
    const safePageSize = Math.max(1, pageSize);
    const db = this.getDb();
    const total =
      (
        db.prepare("SELECT COUNT(*) AS count FROM monitored_channels WHERE source_name = ?").get(sourceName) as
          | CountRow
          | undefined
      )?.count ?? 0;
    const rows = db
      .prepare(
        `
          SELECT *
          FROM monitored_channels
          WHERE source_name = ?
          ORDER BY is_active DESC, id ASC
          LIMIT ? OFFSET ?
        `
      )
      .all(sourceName, safePageSize, safeOffset) as MonitoredChannelRow[];

    return {
      items: rows.map((row) => mapMonitoredChannel(row)),
      offset: safeOffset,
      pageSize: safePageSize,
      total
    };
  }

  getChannelById(channelId: number): MonitoredChannel | null {
    const row = this.getDb()
      .prepare("SELECT * FROM monitored_channels WHERE id = ? LIMIT 1")
      .get(channelId) as MonitoredChannelRow | undefined;

    return row ? mapMonitoredChannel(row) : null;
  }

  getChannelByUsername(sourceName: SourceName, username: string): MonitoredChannel | null {
    const row = this.getDb()
      .prepare("SELECT * FROM monitored_channels WHERE source_name = ? AND username = ? LIMIT 1")
      .get(sourceName, username) as MonitoredChannelRow | undefined;

    return row ? mapMonitoredChannel(row) : null;
  }

  addChannel(
    addedByUserId: string | undefined,
    sourceName: SourceName,
    username: string
  ): { added: boolean; reactivated: boolean; channel: MonitoredChannel } {
    const db = this.getDb();
    const existing = this.getChannelByUsername(sourceName, username);

    if (existing) {
      if (existing.isActive) {
        return {
          added: false,
          reactivated: false,
          channel: existing
        };
      }

      db.prepare(
        `
          UPDATE monitored_channels
          SET is_active = 1,
              initial_backfill_completed = 0,
              last_seen_message_id = NULL,
              idle_poll_streak = 0,
              next_poll_after = NULL,
              last_error = NULL,
              updated_at = ?
          WHERE id = ?
        `
      ).run(nowIso(), existing.id);

      return {
        added: true,
        reactivated: true,
        channel: this.getChannelById(existing.id)!
      };
    }

    const timestamp = nowIso();
    const result = db
      .prepare(
        `
        INSERT INTO monitored_channels (
          username,
          source_name,
          is_active,
          initial_backfill_completed,
          last_seen_message_id,
          idle_poll_streak,
          next_poll_after,
          last_checked_at,
          last_success_at,
          last_error,
          added_by_user_id,
          created_at,
          updated_at
        ) VALUES (?, ?, 1, 0, NULL, 0, NULL, NULL, NULL, NULL, ?, ?, ?)
      `
    )
      .run(username, sourceName, addedByUserId ?? null, timestamp, timestamp);

    return {
      added: true,
      reactivated: false,
      channel: this.getChannelById(Number(result.lastInsertRowid))!
    };
  }

  deactivateChannel(channelId: number): MonitoredChannel | null {
    const existing = this.getChannelById(channelId);
    if (!existing) {
      return null;
    }

    this.getDb()
      .prepare("UPDATE monitored_channels SET is_active = 0, updated_at = ? WHERE id = ?")
      .run(nowIso(), channelId);

    return this.getChannelById(channelId);
  }

  listCompanyCareerSourcesPage(offset: number, pageSize: number): CompanyCareerSourcePage {
    const safeOffset = Math.max(0, offset);
    const safePageSize = Math.max(1, pageSize);
    const db = this.getDb();
    const total =
      (db.prepare("SELECT COUNT(*) AS count FROM company_career_sources").get() as CountRow | undefined)?.count ?? 0;
    const rows = db
      .prepare(
        `
          SELECT *
          FROM company_career_sources
          ORDER BY is_active DESC, company_name COLLATE NOCASE ASC, id ASC
          LIMIT ? OFFSET ?
        `
      )
      .all(safePageSize, safeOffset) as CompanyCareerSourceRow[];

    return {
      items: rows.map((row) => mapCompanyCareerSource(row)),
      offset: safeOffset,
      pageSize: safePageSize,
      total
    };
  }

  listDueCompanyCareerSources(now: string, limit: number): CompanyCareerSourceRecord[] {
    const safeLimit = Math.max(1, limit);
    const rows = this.getDb()
      .prepare(
        `
          SELECT *
          FROM company_career_sources
          WHERE is_active = 1
            AND (next_poll_after IS NULL OR next_poll_after <= ?)
          ORDER BY COALESCE(next_poll_after, created_at) ASC, id ASC
          LIMIT ?
        `
      )
      .all(now, safeLimit) as CompanyCareerSourceRow[];

    return rows.map((row) => mapCompanyCareerSource(row));
  }

  countActiveCompanyCareerSources(): number {
    const row = this.getDb()
      .prepare("SELECT COUNT(*) AS count FROM company_career_sources WHERE is_active = 1")
      .get() as CountRow | undefined;

    return row?.count ?? 0;
  }

  getCompanyCareerSourceById(sourceId: number): CompanyCareerSourceRecord | null {
    const row = this.getDb()
      .prepare("SELECT * FROM company_career_sources WHERE id = ? LIMIT 1")
      .get(sourceId) as CompanyCareerSourceRow | undefined;

    return row ? mapCompanyCareerSource(row) : null;
  }

  addCompanyCareerSource(input: CompanyCareerSourceCreateInput): {
    added: boolean;
    reactivated: boolean;
    source: CompanyCareerSourceRecord;
  } {
    const existing = this.getDb()
      .prepare("SELECT * FROM company_career_sources WHERE start_url = ? LIMIT 1")
      .get(input.startUrl) as CompanyCareerSourceRow | undefined;

    const timestamp = nowIso();
    if (existing) {
      if (existing.is_active) {
        return {
          added: false,
          reactivated: false,
          source: mapCompanyCareerSource(existing)
        };
      }

      this.getDb()
        .prepare(
          `
            UPDATE company_career_sources
            SET is_active = 1,
                company_name = ?,
                adapter = ?,
                poll_interval_seconds = ?,
                next_poll_after = NULL,
                last_error = NULL,
                updated_at = ?
            WHERE id = ?
          `
        )
        .run(
          input.companyName,
          input.adapter,
          input.pollIntervalSeconds ?? this.config.companyCareersPollIntervalSeconds,
          timestamp,
          existing.id
        );

      return {
        added: true,
        reactivated: true,
        source: this.getCompanyCareerSourceById(existing.id)!
      };
    }

    const result = this.getDb()
      .prepare(
        `
          INSERT INTO company_career_sources (
            company_name,
            adapter,
            start_url,
            is_active,
            poll_interval_seconds,
            next_poll_after,
            last_checked_at,
            last_success_at,
            last_error,
            added_by_user_id,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, 1, ?, NULL, NULL, NULL, NULL, ?, ?, ?)
        `
      )
      .run(
        input.companyName,
        input.adapter,
        input.startUrl,
        input.pollIntervalSeconds ?? this.config.companyCareersPollIntervalSeconds,
        input.addedByUserId ?? null,
        timestamp,
        timestamp
      );

    return {
      added: true,
      reactivated: false,
      source: this.getCompanyCareerSourceById(Number(result.lastInsertRowid))!
    };
  }

  setCompanyCareerSourceActive(sourceId: number, isActive: boolean): CompanyCareerSourceRecord | null {
    const existing = this.getCompanyCareerSourceById(sourceId);
    if (!existing) {
      return null;
    }

    this.getDb()
      .prepare(
        `
          UPDATE company_career_sources
          SET is_active = ?,
              next_poll_after = CASE WHEN ? = 1 THEN NULL ELSE next_poll_after END,
              updated_at = ?
          WHERE id = ?
        `
      )
      .run(isActive ? 1 : 0, isActive ? 1 : 0, nowIso(), sourceId);

    return this.getCompanyCareerSourceById(sourceId);
  }

  markCompanyCareerSourceSuccess(sourceId: number, nextPollAfter: string): void {
    const timestamp = nowIso();
    this.getDb()
      .prepare(
        `
          UPDATE company_career_sources
          SET last_checked_at = ?,
              last_success_at = ?,
              last_error = NULL,
              next_poll_after = ?,
              updated_at = ?
          WHERE id = ?
        `
      )
      .run(timestamp, timestamp, nextPollAfter, timestamp, sourceId);
  }

  markCompanyCareerSourceFailure(sourceId: number, errorMessage: string, nextPollAfter: string): void {
    const timestamp = nowIso();
    this.getDb()
      .prepare(
        `
          UPDATE company_career_sources
          SET last_checked_at = ?,
              last_error = ?,
              next_poll_after = ?,
              updated_at = ?
          WHERE id = ?
        `
      )
      .run(timestamp, errorMessage, nextPollAfter, timestamp, sourceId);
  }

  markChannelCheckSuccess(
    channelId: number,
    state: {
      lastSeenMessageId: string | null;
      idlePollStreak: number;
      nextPollAfter: string | null;
    }
  ): void {
    const timestamp = nowIso();
    const db = this.getDb();
    db.transaction(() => {
      db.prepare(
        `
          UPDATE monitored_channels
          SET last_seen_message_id = ?,
              idle_poll_streak = ?,
              next_poll_after = ?,
              last_checked_at = ?,
              last_success_at = ?,
              last_error = NULL,
              updated_at = ?
          WHERE id = ?
        `
      ).run(
        state.lastSeenMessageId,
        state.idlePollStreak,
        state.nextPollAfter,
        timestamp,
        timestamp,
        timestamp,
        channelId
      );

      db.prepare("DELETE FROM channel_alert_state WHERE channel_id = ?").run(channelId);
    })();
  }

  markChannelCheckFailure(channelId: number, errorMessage: string): void {
    const timestamp = nowIso();
    this.getDb()
      .prepare(
        `
          UPDATE monitored_channels
          SET last_checked_at = ?,
              last_error = ?,
              updated_at = ?
          WHERE id = ?
        `
      )
      .run(timestamp, errorMessage, timestamp, channelId);
  }

  markChannelBackfillCompleted(channelId: number): void {
    this.getDb()
      .prepare(
        `
          UPDATE monitored_channels
          SET initial_backfill_completed = 1,
              updated_at = ?
          WHERE id = ?
        `
      )
      .run(nowIso(), channelId);
  }

  getChannelAlertState(channelId: number): ChannelAlertStateRow | null {
    const row = this.getDb()
      .prepare("SELECT * FROM channel_alert_state WHERE channel_id = ? LIMIT 1")
      .get(channelId) as ChannelAlertStateRow | undefined;

    return row ?? null;
  }

  markChannelFailureAlert(channelId: number, failureSignature: string): void {
    const timestamp = nowIso();
    this.getDb()
      .prepare(
        `
          INSERT INTO channel_alert_state (
            channel_id,
            failure_signature,
            failure_alerted_at,
            stale_reference,
            stale_alerted_at,
            updated_at
          ) VALUES (?, ?, ?, NULL, NULL, ?)
          ON CONFLICT(channel_id)
          DO UPDATE SET
            failure_signature = excluded.failure_signature,
            failure_alerted_at = excluded.failure_alerted_at,
            updated_at = excluded.updated_at
        `
      )
      .run(channelId, failureSignature, timestamp, timestamp);
  }

  markChannelStaleAlert(channelId: number, staleReference: string): void {
    const timestamp = nowIso();
    this.getDb()
      .prepare(
        `
          INSERT INTO channel_alert_state (
            channel_id,
            failure_signature,
            failure_alerted_at,
            stale_reference,
            stale_alerted_at,
            updated_at
          ) VALUES (?, NULL, NULL, ?, ?, ?)
          ON CONFLICT(channel_id)
          DO UPDATE SET
            stale_reference = excluded.stale_reference,
            stale_alerted_at = excluded.stale_alerted_at,
            updated_at = excluded.updated_at
        `
      )
      .run(channelId, staleReference, timestamp, timestamp);
  }

  countActiveChannels(sourceName: SourceName): number {
    return (
      this.getDb()
        .prepare("SELECT COUNT(*) AS count FROM monitored_channels WHERE source_name = ? AND is_active = 1")
        .get(sourceName) as CountRow | undefined
    )?.count ?? 0;
  }

  getAppSetting(key: RuntimeSettingKey): AppSettingValue | null {
    const row = this.getDb()
      .prepare("SELECT * FROM app_settings WHERE key = ? LIMIT 1")
      .get(key) as AppSettingRowInternal | undefined;

    return row
      ? {
          key: row.key,
          value: row.value,
          updatedAt: row.updated_at,
          updatedByUserId: row.updated_by_user_id
        }
      : null;
  }

  setAppSetting(key: RuntimeSettingKey, value: string, updatedByUserId?: string): void {
    const timestamp = nowIso();
    this.getDb()
      .prepare(
        `
          INSERT INTO app_settings (key, value, updated_at, updated_by_user_id)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            updated_at = excluded.updated_at,
            updated_by_user_id = excluded.updated_by_user_id
        `
      )
      .run(key, value, timestamp, updatedByUserId ?? null);
  }

  deleteAppSetting(key: RuntimeSettingKey): void {
    this.getDb().prepare("DELETE FROM app_settings WHERE key = ?").run(key);
  }

  getUserSettings(userId: string): UserSettings {
    this.ensureUserSettings(userId);

    const row = this.getDb()
      .prepare(
        `
          SELECT
            user_id,
            ai_enabled,
            filter_mode,
            bot_paused,
            notify_on_empty_cycle,
            daily_digest_enabled,
            daily_digest_time_minutes,
            weekly_page_size,
            vacancy_language_mode,
            onboarding_completed,
            onboarding_step,
            pending_input_action,
            pending_input_payload,
            updated_at
          FROM user_settings
          WHERE user_id = ?
          LIMIT 1
        `
      )
      .get(userId) as UserSettingsRow | undefined;

    if (!row) {
      throw new Error(`User settings were not created for ${userId}.`);
    }

    return mapUserSettings(row);
  }

  setBotPaused(userId: string, paused: boolean): void {
    this.ensureUserSettings(userId);
    this.getDb()
      .prepare("UPDATE user_settings SET bot_paused = ?, updated_at = ? WHERE user_id = ?")
      .run(paused ? 1 : 0, nowIso(), userId);
  }

  isBotPaused(userId: string | undefined): boolean {
    if (!userId) {
      return false;
    }

    return this.getUserSettings(userId).botPaused;
  }

  setNotifyOnEmptyCycle(userId: string, enabled: boolean): void {
    this.ensureUserSettings(userId);
    this.getDb()
      .prepare("UPDATE user_settings SET notify_on_empty_cycle = ?, updated_at = ? WHERE user_id = ?")
      .run(enabled ? 1 : 0, nowIso(), userId);
  }

  setDailyDigestEnabled(userId: string, enabled: boolean): void {
    this.ensureUserSettings(userId);
    this.getDb()
      .prepare("UPDATE user_settings SET daily_digest_enabled = ?, updated_at = ? WHERE user_id = ?")
      .run(enabled ? 1 : 0, nowIso(), userId);
  }

  setDailyDigestTimeMinutes(userId: string, minutes: number | null): void {
    if (minutes !== null && (!Number.isInteger(minutes) || minutes < 0 || minutes > 1439)) {
      throw new Error("Daily digest time must be an integer from 0 to 1439 minutes.");
    }

    this.ensureUserSettings(userId);
    this.getDb()
      .prepare("UPDATE user_settings SET daily_digest_time_minutes = ?, updated_at = ? WHERE user_id = ?")
      .run(minutes, nowIso(), userId);
  }

  listDailyDigestEnabledUsers(): Array<{ userId: string; dailyDigestTimeMinutes: number | null }> {
    const rows = this.getDb()
      .prepare(
        `
          SELECT
            u.user_id,
            s.daily_digest_time_minutes
          FROM bot_users u
          INNER JOIN user_settings s ON s.user_id = u.user_id
          WHERE u.is_active = 1
            AND s.daily_digest_enabled = 1
          ORDER BY u.user_id ASC
        `
      )
      .all() as Array<{ user_id: string; daily_digest_time_minutes: number | null }>;

    return rows.map((row) => ({
      userId: row.user_id,
      dailyDigestTimeMinutes: row.daily_digest_time_minutes
    }));
  }

  buildDailyDigestPayload(
    userId: string,
    digestDate: string,
    scheduledFor: string,
    now = new Date()
  ): DailyDigestPayload {
    const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const nowIsoValue = now.toISOString();
    const db = this.getDb();
    const newVacanciesCount =
      (
        db.prepare(
          `
            SELECT COUNT(*) AS count
            FROM user_vacancy_matches m
            LEFT JOIN user_vacancy_states s
              ON s.user_id = m.user_id
             AND s.vacancy_id = m.vacancy_id
            WHERE m.user_id = ?
              AND m.created_at >= ?
              AND COALESCE(s.status, 'inbox') NOT IN ('hidden', 'applied')
          `
        ).get(userId, since) as CountRow | undefined
      )?.count ?? 0;
    const savedWithoutActionCount =
      (
        db.prepare(
          `
            SELECT COUNT(*) AS count
            FROM user_vacancy_states
            WHERE user_id = ?
              AND status = 'saved'
          `
        ).get(userId) as CountRow | undefined
      )?.count ?? 0;
    const dueApplicationFollowUpsCount =
      (
        db.prepare(
          `
            SELECT COUNT(*) AS count
            FROM user_vacancy_applications a
            INNER JOIN user_vacancy_states s
              ON s.user_id = a.user_id
             AND s.vacancy_id = a.vacancy_id
             AND s.status = 'applied'
            WHERE a.user_id = ?
              AND a.follow_up_at IS NOT NULL
              AND a.next_attempt_at IS NOT NULL
              AND a.delivered_at IS NULL
              AND a.cancelled_at IS NULL
              AND a.responded_at IS NULL
              AND a.closed_at IS NULL
              AND datetime(a.next_attempt_at) <= datetime(?)
          `
        ).get(userId, nowIsoValue) as CountRow | undefined
      )?.count ?? 0;
    const hiddenLastDayCount =
      (
        db.prepare(
          `
            SELECT COUNT(*) AS count
            FROM user_vacancy_states
            WHERE user_id = ?
              AND status = 'hidden'
              AND updated_at >= ?
          `
        ).get(userId, since) as CountRow | undefined
      )?.count ?? 0;

    return {
      userId,
      digestDate,
      scheduledFor,
      newVacanciesCount,
      savedWithoutActionCount,
      dueApplicationFollowUpsCount,
      hiddenLastDayCount,
      hiddenReasonTop: this.listTopHiddenVacancyReasons(userId, 1, 3, now)
    };
  }

  getDailyDigestDelivery(userId: string, digestDate: string): DailyDigestDeliveryRecord | null {
    const row = this.getDb()
      .prepare(
        `
          SELECT
            user_id,
            digest_date,
            scheduled_for,
            next_attempt_at,
            attempt_count,
            delivered_at,
            skipped_at,
            last_error,
            created_at,
            updated_at
          FROM user_daily_digest_deliveries
          WHERE user_id = ?
            AND digest_date = ?
          LIMIT 1
        `
      )
      .get(userId, digestDate) as DailyDigestDeliveryRow | undefined;

    return row ? mapDailyDigestDelivery(row) : null;
  }

  getLatestDailyDigestDelivery(userId: string): DailyDigestDeliveryRecord | null {
    const row = this.getDb()
      .prepare(
        `
          SELECT
            user_id,
            digest_date,
            scheduled_for,
            next_attempt_at,
            attempt_count,
            delivered_at,
            skipped_at,
            last_error,
            created_at,
            updated_at
          FROM user_daily_digest_deliveries
          WHERE user_id = ?
          ORDER BY digest_date DESC
          LIMIT 1
        `
      )
      .get(userId) as DailyDigestDeliveryRow | undefined;

    return row ? mapDailyDigestDelivery(row) : null;
  }

  markDailyDigestDelivered(
    userId: string,
    digestDate: string,
    scheduledFor: string,
    deliveredAt = nowIso()
  ): void {
    this.getDb()
      .prepare(
        `
          INSERT INTO user_daily_digest_deliveries (
            user_id,
            digest_date,
            scheduled_for,
            next_attempt_at,
            attempt_count,
            delivered_at,
            skipped_at,
            last_error,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, NULL, 0, ?, NULL, NULL, ?, ?)
          ON CONFLICT(user_id, digest_date)
          DO UPDATE SET
            scheduled_for = excluded.scheduled_for,
            next_attempt_at = NULL,
            delivered_at = excluded.delivered_at,
            last_error = NULL,
            updated_at = excluded.updated_at
        `
      )
      .run(userId, digestDate, scheduledFor, deliveredAt, deliveredAt, deliveredAt);
  }

  markDailyDigestSkipped(
    userId: string,
    digestDate: string,
    scheduledFor: string,
    skippedAt = nowIso()
  ): void {
    this.getDb()
      .prepare(
        `
          INSERT INTO user_daily_digest_deliveries (
            user_id,
            digest_date,
            scheduled_for,
            next_attempt_at,
            attempt_count,
            delivered_at,
            skipped_at,
            last_error,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, NULL, 0, NULL, ?, NULL, ?, ?)
          ON CONFLICT(user_id, digest_date)
          DO UPDATE SET
            scheduled_for = excluded.scheduled_for,
            next_attempt_at = NULL,
            skipped_at = COALESCE(user_daily_digest_deliveries.skipped_at, excluded.skipped_at),
            last_error = NULL,
            updated_at = excluded.updated_at
        `
      )
      .run(userId, digestDate, scheduledFor, skippedAt, skippedAt, skippedAt);
  }

  markDailyDigestFailed(
    userId: string,
    digestDate: string,
    scheduledFor: string,
    nextAttemptAt: string,
    error: string
  ): void {
    const timestamp = nowIso();
    this.getDb()
      .prepare(
        `
          INSERT INTO user_daily_digest_deliveries (
            user_id,
            digest_date,
            scheduled_for,
            next_attempt_at,
            attempt_count,
            delivered_at,
            skipped_at,
            last_error,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, 1, NULL, NULL, ?, ?, ?)
          ON CONFLICT(user_id, digest_date)
          DO UPDATE SET
            scheduled_for = excluded.scheduled_for,
            next_attempt_at = excluded.next_attempt_at,
            attempt_count = user_daily_digest_deliveries.attempt_count + 1,
            last_error = excluded.last_error,
            updated_at = excluded.updated_at
          WHERE user_daily_digest_deliveries.delivered_at IS NULL
            AND user_daily_digest_deliveries.skipped_at IS NULL
        `
      )
      .run(userId, digestDate, scheduledFor, nextAttemptAt, error.slice(0, 1000), timestamp, timestamp);
  }

  getOwnerReportDelivery(weekKey: string): { deliveredAt: string; period: number } | null {
    const row = this.getDb()
      .prepare("SELECT delivered_at, period FROM owner_report_delivery WHERE report_week = ? LIMIT 1")
      .get(weekKey) as { delivered_at: string; period: number } | undefined;
    if (!row) return null;
    return { deliveredAt: row.delivered_at, period: row.period };
  }

  markOwnerReportDelivered(weekKey: string, period: number, deliveredAt: string): void {
    this.getDb()
      .prepare(
        "INSERT INTO owner_report_delivery (report_week, delivered_at, period) VALUES (?, ?, ?)"
      )
      .run(weekKey, deliveredAt, period);
  }

  setUserWeeklyPageSize(userId: string, pageSize: number): void {
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 5) {
      throw new Error("Weekly page size must be an integer from 1 to 5.");
    }

    this.ensureUserSettings(userId);
    this.getDb()
      .prepare("UPDATE user_settings SET weekly_page_size = ?, updated_at = ? WHERE user_id = ?")
      .run(pageSize, nowIso(), userId);
  }

  setVacancyLanguageMode(userId: string, mode: VacancyLanguageMode): void {
    this.ensureUserSettings(userId);
    const timestamp = nowIso();
    this.getDb().transaction(() => {
      this.getDb()
        .prepare("UPDATE user_settings SET vacancy_language_mode = ?, updated_at = ? WHERE user_id = ?")
        .run(mode, timestamp, userId);
      const primaryProfile = this.listUserSearchProfiles(userId)[0];
      if (primaryProfile) {
        this.getDb()
          .prepare("UPDATE user_search_profiles SET vacancy_language_mode = ?, updated_at = ? WHERE user_id = ? AND id = ?")
          .run(mode, timestamp, userId, primaryProfile.id);
      }
    })();
  }

  getUserHhSearchSettings(userId: string): HhSearchSettings {
    this.ensureUserHhSearchSettings(userId);

    const row = this.getDb()
      .prepare("SELECT * FROM user_hh_search_settings WHERE user_id = ? LIMIT 1")
      .get(userId) as HhSearchSettingsRow | undefined;

    if (!row) {
      throw new Error(`HH search settings were not created for ${userId}.`);
    }

    return mapHhSearchSettings(row);
  }

  updateUserHhSearchSettings(
    userId: string,
    patch: Partial<Omit<HhSearchSettings, "userId" | "updatedAt">>
  ): HhSearchSettings {
    this.ensureUserHhSearchSettings(userId);
    const current = this.getUserHhSearchSettings(userId);
    const next: Omit<HhSearchSettings, "userId" | "updatedAt"> = {
      enabled: patch.enabled ?? current.enabled,
      text: patch.text ?? current.text,
      areaId: patch.areaId ?? current.areaId,
      experience: patch.experience ?? current.experience,
      schedule: patch.schedule ?? current.schedule,
      employment: patch.employment ?? current.employment,
      salaryFrom: patch.salaryFrom === undefined ? current.salaryFrom : patch.salaryFrom,
      periodDays: patch.periodDays ?? current.periodDays
    };
    const timestamp = nowIso();

    this.getDb()
      .prepare(
        `
          UPDATE user_hh_search_settings
          SET enabled = ?,
              text = ?,
              area_id = ?,
              experience = ?,
              schedule = ?,
              employment = ?,
              salary_from = ?,
              period_days = ?,
              updated_at = ?
          WHERE user_id = ?
        `
      )
      .run(
        next.enabled ? 1 : 0,
        next.text,
        next.areaId,
        next.experience,
        next.schedule,
        next.employment,
        next.salaryFrom,
        next.periodDays,
        timestamp,
        userId
      );

    return this.getUserHhSearchSettings(userId);
  }

  listEnabledHhSearchSettings(limit: number): HhSearchSettings[] {
    const safeLimit = Math.max(1, limit);
    const rows = this.getDb()
      .prepare(
        `
          SELECT h.*
          FROM user_hh_search_settings h
          INNER JOIN bot_users u ON u.user_id = h.user_id
          WHERE h.enabled = 1
            AND TRIM(h.text) != ''
            AND u.is_active = 1
          ORDER BY h.updated_at DESC, h.user_id ASC
          LIMIT ?
        `
      )
      .all(safeLimit) as HhSearchSettingsRow[];

    return rows.map((row) => mapHhSearchSettings(row));
  }

  countEnabledHhSearchSettings(): number {
    return (
      this.getDb()
        .prepare(
          `
            SELECT COUNT(*) AS count
            FROM user_hh_search_settings h
            INNER JOIN bot_users u ON u.user_id = h.user_id
            WHERE h.enabled = 1
              AND TRIM(h.text) != ''
              AND u.is_active = 1
          `
        )
        .get() as CountRow | undefined
    )?.count ?? 0;
  }

  recordHhVacancyCandidate(userId: string, vacancyId: number, queryKey: string): void {
    const timestamp = nowIso();
    this.getDb()
      .prepare(
        `
          INSERT INTO hh_user_vacancy_candidates (
            user_id,
            vacancy_id,
            query_key,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(user_id, vacancy_id)
          DO UPDATE SET
            query_key = excluded.query_key,
            updated_at = excluded.updated_at
        `
      )
      .run(userId, vacancyId, queryKey, timestamp, timestamp);
  }

  canUserMatchHhVacancy(userId: string, vacancyId: number): boolean {
    const settings = this.getUserHhSearchSettings(userId);
    if (!settings.enabled || settings.text.trim().length === 0) {
      return false;
    }

    const row = this.getDb()
      .prepare("SELECT 1 FROM hh_user_vacancy_candidates WHERE user_id = ? AND vacancy_id = ? LIMIT 1")
      .get(userId, vacancyId) as { 1: number } | undefined;

    return Boolean(row);
  }

  setPendingInputAction(userId: string, action: UserSettings["pendingInputAction"], payload?: string): void {
    this.ensureUserSettings(userId);
    this.getDb()
      .prepare(
        `
          UPDATE user_settings
          SET pending_input_action = ?,
              pending_input_payload = ?,
              updated_at = ?
          WHERE user_id = ?
        `
      )
      .run(action ?? null, payload ?? null, nowIso(), userId);
  }

  clearPendingInputAction(userId: string): void {
    this.ensureUserSettings(userId);
    this.getDb()
      .prepare(
        `
          UPDATE user_settings
          SET pending_input_action = NULL,
              pending_input_payload = NULL,
              updated_at = ?
          WHERE user_id = ?
        `
      )
      .run(nowIso(), userId);
  }

  setOnboardingCompleted(userId: string, completed: boolean): void {
    this.ensureUserSettings(userId);
    this.getDb()
      .prepare(
        `
          UPDATE user_settings
          SET onboarding_completed = ?,
              updated_at = ?
          WHERE user_id = ?
        `
      )
      .run(completed ? 1 : 0, nowIso(), userId);
  }

  setOnboardingStep(userId: string, step: OnboardingStep | null): void {
    this.ensureUserSettings(userId);
    this.getDb()
      .prepare(
        `
          UPDATE user_settings
          SET onboarding_step = ?,
              updated_at = ?
          WHERE user_id = ?
        `
      )
      .run(step, nowIso(), userId);
  }

  addUserKeyword(
    userId: string,
    kind: KeywordKind,
    keyword: string
  ): { added: boolean; keyword: UserKeyword | null } {
    const db = this.getDb();
    const timestamp = nowIso();
    const result = db
      .prepare(
        `
          INSERT OR IGNORE INTO user_keywords (
            user_id,
            kind,
            keyword,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?)
        `
      )
      .run(userId, kind, keyword, timestamp, timestamp);

    const stored = db
      .prepare(
        `
          SELECT *
          FROM user_keywords
          WHERE user_id = ? AND kind = ? AND keyword = ?
          LIMIT 1
        `
      )
      .get(userId, kind, keyword) as UserKeywordRow | undefined;

    return {
      added: result.changes > 0,
      keyword: stored ? mapUserKeyword(stored) : null
    };
  }

  listUserKeywords(userId: string, kind: KeywordKind): UserKeyword[] {
    const rows = this.getDb()
      .prepare(
        `
          SELECT *
          FROM user_keywords
          WHERE user_id = ? AND kind = ?
          ORDER BY id ASC
        `
      )
      .all(userId, kind) as UserKeywordRow[];

    return rows.map((row) => mapUserKeyword(row));
  }

  getUserSearchProfile(userId: string): UserSearchProfileRecord {
    this.ensureUserSearchProfile(userId);
    const row = this.getDb()
      .prepare("SELECT * FROM user_search_profiles WHERE user_id = ? ORDER BY sort_order ASC, id ASC LIMIT 1")
      .get(userId) as UserSearchProfileRow | undefined;

    if (!row) {
      throw new Error(`User search profile was not created for ${userId}.`);
    }

    return mapUserSearchProfile(row);
  }

  listUserSearchProfiles(userId: string, activeOnly = false): UserSearchProfileRecord[] {
    const rows = this.getDb()
      .prepare(
        `
          SELECT *
          FROM user_search_profiles
          WHERE user_id = ?
            AND (? = 0 OR is_active = 1)
          ORDER BY sort_order ASC, id ASC
        `
      )
      .all(userId, activeOnly ? 1 : 0) as UserSearchProfileRow[];

    return rows.map((row) => mapUserSearchProfile(row));
  }

  listUserSearchProfileWeeklyStats(userId: string, days: number): SearchProfileWeeklyStats[] {
    const rows = this.getDb()
      .prepare(
        `
          SELECT
            profile_match.profile_id,
            SUM(CASE WHEN COALESCE(state.status, 'inbox') != 'hidden' THEN 1 ELSE 0 END) AS visible_matches,
            SUM(CASE WHEN state.status = 'hidden' THEN 1 ELSE 0 END) AS hidden_matches
          FROM user_vacancy_profile_matches profile_match
          INNER JOIN vacancies vacancy ON vacancy.id = profile_match.vacancy_id
          LEFT JOIN user_vacancy_states state
            ON state.user_id = profile_match.user_id
           AND state.vacancy_id = profile_match.vacancy_id
          WHERE profile_match.user_id = ?
            AND vacancy.message_date >= ?
          GROUP BY profile_match.profile_id
        `
      )
      .all(userId, recentThresholdIso(days)) as Array<{
        profile_id: number;
        visible_matches: number;
        hidden_matches: number;
      }>;

    return rows.map((row) => ({
      profileId: row.profile_id,
      visibleMatches: row.visible_matches,
      hiddenMatches: row.hidden_matches
    }));
  }

  getUserSearchProfileById(userId: string, profileId: number): UserSearchProfileRecord | null {
    const row = this.getDb()
      .prepare("SELECT * FROM user_search_profiles WHERE user_id = ? AND id = ? LIMIT 1")
      .get(userId, profileId) as UserSearchProfileRow | undefined;

    return row ? mapUserSearchProfile(row) : null;
  }

  createUserSearchProfile(
    userId: string,
    input: {
      name: string;
      vacancyLanguageMode?: VacancyLanguageMode;
      requiredContextKeywords?: string[];
      requiredPrimaryKeywords?: string[];
      preferredKeywords?: string[];
      excludeKeywords?: string[];
      isActive?: boolean;
    }
  ): UserSearchProfileRecord {
    this.ensureUserSettings(userId);
    if (!this.getBotUser(userId)) {
      throw new Error("Cannot create a search profile for an unknown user.");
    }
    const existing = this.listUserSearchProfiles(userId);
    if (existing.length >= 5) {
      throw new Error("Достигнут лимит: можно создать не больше пяти поисков.");
    }

    const baseName = input.name.trim().replace(/\s+/g, " ");
    if (!baseName || baseName.length > 40) {
      throw new Error("Название поиска должно содержать от 1 до 40 символов.");
    }

    const existingNames = new Set(existing.map((profile) => normalizeProfileName(profile.name)));
    let name = baseName;
    let suffix = 2;
    while (existingNames.has(normalizeProfileName(name))) {
      const suffixText = ` ${suffix}`;
      name = `${baseName.slice(0, Math.max(1, 40 - suffixText.length)).trimEnd()}${suffixText}`;
      suffix += 1;
    }

    const timestamp = nowIso();
    const sortOrder = existing.reduce((max, profile) => Math.max(max, profile.sortOrder), -1) + 1;
    const result = this.getDb()
      .prepare(
        `
          INSERT INTO user_search_profiles (
            user_id,
            name,
            normalized_name,
            is_active,
            vacancy_language_mode,
            required_context_keywords_json,
            required_primary_keywords_json,
            preferred_keywords_json,
            exclude_keywords_json,
            sort_order,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        userId,
        name,
        normalizeProfileName(name),
        input.isActive === false ? 0 : 1,
        input.vacancyLanguageMode ?? this.getUserSettings(userId).vacancyLanguageMode,
        JSON.stringify(unique(input.requiredContextKeywords ?? [])),
        JSON.stringify(unique(input.requiredPrimaryKeywords ?? [])),
        JSON.stringify(unique(input.preferredKeywords ?? [])),
        JSON.stringify(unique(input.excludeKeywords ?? [])),
        sortOrder,
        timestamp,
        timestamp
      );

    const created = this.getUserSearchProfileById(userId, Number(result.lastInsertRowid));
    if (!created) {
      throw new Error("Не удалось создать поисковый профиль.");
    }
    return created;
  }

  renameUserSearchProfile(userId: string, profileId: number, name: string): UserSearchProfileRecord {
    const current = this.getUserSearchProfileById(userId, profileId);
    const normalizedName = normalizeProfileName(name);
    const displayName = name.trim().replace(/\s+/g, " ");
    if (!current) {
      throw new Error("Поисковый профиль не найден.");
    }
    if (!displayName || displayName.length > 40) {
      throw new Error("Название поиска должно содержать от 1 до 40 символов.");
    }

    const duplicate = this.getDb()
      .prepare("SELECT 1 FROM user_search_profiles WHERE user_id = ? AND normalized_name = ? AND id <> ? LIMIT 1")
      .get(userId, normalizedName, profileId);
    if (duplicate) {
      throw new Error("Поиск с таким названием уже существует.");
    }

    this.getDb()
      .prepare("UPDATE user_search_profiles SET name = ?, normalized_name = ?, updated_at = ? WHERE user_id = ? AND id = ?")
      .run(displayName, normalizedName, nowIso(), userId, profileId);
    return this.getUserSearchProfileById(userId, profileId)!;
  }

  setUserSearchProfileActive(userId: string, profileId: number, isActive: boolean): UserSearchProfileRecord {
    this.getDb()
      .prepare("UPDATE user_search_profiles SET is_active = ?, updated_at = ? WHERE user_id = ? AND id = ?")
      .run(isActive ? 1 : 0, nowIso(), userId, profileId);
    const profile = this.getUserSearchProfileById(userId, profileId);
    if (!profile) {
      throw new Error("Search profile not found.");
    }
    return profile;
  }

  deleteUserSearchProfile(userId: string, profileId: number): boolean {
    return this.getDb()
      .prepare("DELETE FROM user_search_profiles WHERE user_id = ? AND id = ?")
      .run(userId, profileId).changes > 0;
  }

  setUserSearchProfileLanguageMode(
    userId: string,
    profileId: number,
    vacancyLanguageMode: VacancyLanguageMode
  ): UserSearchProfileRecord {
    this.getDb()
      .prepare("UPDATE user_search_profiles SET vacancy_language_mode = ?, updated_at = ? WHERE user_id = ? AND id = ?")
      .run(vacancyLanguageMode, nowIso(), userId, profileId);
    const profile = this.getUserSearchProfileById(userId, profileId);
    if (!profile) {
      throw new Error("Search profile not found.");
    }
    return profile;
  }

  setUserSearchProfileKeywords(
    userId: string,
    section: SearchProfileSectionKey,
    keywords: string[],
    profileId?: number
  ): UserSearchProfileRecord {
    const current = profileId
      ? this.getUserSearchProfileById(userId, profileId)
      : this.getUserSearchProfile(userId);
    if (!current) {
      throw new Error("Search profile not found.");
    }
    const nextProfile = {
      requiredContextKeywords: section === "required_context" ? keywords : current.requiredContextKeywords,
      requiredPrimaryKeywords: section === "required_primary" ? keywords : current.requiredPrimaryKeywords,
      preferredKeywords: section === "preferred" ? keywords : current.preferredKeywords,
      excludeKeywords: section === "exclude" ? keywords : current.excludeKeywords
    };

    return this.replaceUserSearchProfile(userId, nextProfile, current.id);
  }

  replaceUserSearchProfile(
    userId: string,
    profile: Omit<UserSearchProfile, "userId" | "updatedAt">,
    profileId?: number
  ): UserSearchProfileRecord {
    this.ensureUserSearchProfile(userId);
    const target = profileId ? this.getUserSearchProfileById(userId, profileId) : this.getUserSearchProfile(userId);
    if (!target) {
      throw new Error("Search profile not found.");
    }
    const timestamp = nowIso();
    this.getDb()
      .prepare(
        `
          UPDATE user_search_profiles
          SET required_context_keywords_json = ?,
              required_primary_keywords_json = ?,
              preferred_keywords_json = ?,
              exclude_keywords_json = ?,
              updated_at = ?
          WHERE user_id = ? AND id = ?
        `
      )
      .run(
        JSON.stringify(unique(profile.requiredContextKeywords)),
        JSON.stringify(unique(profile.requiredPrimaryKeywords)),
        JSON.stringify(unique(profile.preferredKeywords)),
        JSON.stringify(unique(profile.excludeKeywords)),
        timestamp,
        userId,
        target.id
      );

    return this.getUserSearchProfileById(userId, target.id)!;
  }

  resetUserSearchProfile(userId: string, profileId?: number): UserSearchProfileRecord {
    this.ensureUserSearchProfile(userId);
    const defaults = this.buildDefaultSearchProfile(userId);
    return this.replaceUserSearchProfile(userId, {
      requiredContextKeywords: defaults.requiredContextKeywords,
      requiredPrimaryKeywords: defaults.requiredPrimaryKeywords,
      preferredKeywords: defaults.preferredKeywords,
      excludeKeywords: defaults.excludeKeywords
    }, profileId);
  }

  private getDb(): SqliteDatabase {
    if (!this.db) {
      throw new Error("Database is not initialized.");
    }

    return this.db;
  }

  private bootstrapOwnerUser(): void {
    const ownerUserId = this.config.ownerUserId;
    if (!ownerUserId) {
      return;
    }

    const existing = this.getBotUser(ownerUserId);
    const timestamp = nowIso();

    if (!existing) {
      this.getDb()
        .prepare(
          `
            INSERT INTO bot_users (
              user_id,
              role,
              is_active,
              username,
              display_name,
              added_by_user_id,
              created_at,
              updated_at
            ) VALUES (?, 'owner', 1, NULL, NULL, NULL, ?, ?)
          `
        )
        .run(ownerUserId, timestamp, timestamp);
    } else {
      this.getDb()
        .prepare(
          `
            UPDATE bot_users
            SET role = 'owner',
                is_active = 1,
                updated_at = ?
            WHERE user_id = ?
          `
        )
        .run(timestamp, ownerUserId);
    }

    this.ensureUserSettings(ownerUserId);
    if (!existing) {
      this.ensureUserSearchProfile(ownerUserId);
    }
    this.ensureUserHhSearchSettings(ownerUserId);
  }

  private ensureUserSettings(userId: string): void {
    const timestamp = nowIso();
    this.getDb()
      .prepare(
        `
          INSERT OR IGNORE INTO user_settings (
            user_id,
            ai_enabled,
            filter_mode,
            bot_paused,
            notify_on_empty_cycle,
            daily_digest_enabled,
            daily_digest_time_minutes,
            weekly_page_size,
            vacancy_language_mode,
            onboarding_completed,
            onboarding_step,
            pending_input_action,
            pending_input_payload,
            pending_keyword_kind,
            updated_at
          ) VALUES (?, 0, 'keywords', 0, 0, 0, NULL, NULL, 'ru_en', 0, NULL, NULL, NULL, NULL, ?)
        `
      )
      .run(userId, timestamp);
  }

  private ensureUserHhSearchSettings(userId: string): void {
    const timestamp = nowIso();
    this.getDb()
      .prepare(
        `
          INSERT OR IGNORE INTO user_hh_search_settings (
            user_id,
            enabled,
            text,
            area_id,
            experience,
            schedule,
            employment,
            salary_from,
            period_days,
            updated_at
          ) VALUES (?, 0, '', '113', 'any', 'remote', 'full', NULL, 7, ?)
        `
      )
      .run(userId, timestamp);
  }

  private ensureUserSearchProfile(userId: string): void {
    if (!this.getBotUser(userId)) {
      const role: BotUserRole = this.config.ownerUserId === userId ? "owner" : "member";
      const timestamp = nowIso();
      this.getDb()
        .prepare(
          `
            INSERT OR IGNORE INTO bot_users (
              user_id,
              role,
              is_active,
              username,
              display_name,
              added_by_user_id,
              created_at,
              updated_at
            ) VALUES (?, ?, 1, NULL, NULL, NULL, ?, ?)
          `
        )
        .run(userId, role, timestamp, timestamp);
    }

    const exists = this.getDb()
      .prepare("SELECT 1 FROM user_search_profiles WHERE user_id = ? LIMIT 1")
      .get(userId) as { 1: number } | undefined;

    if (exists) {
      return;
    }

    const defaults = this.buildDefaultSearchProfile(userId);
    const vacancyLanguageMode = this.getUserSettings(userId).vacancyLanguageMode;
    this.getDb()
      .prepare(
        `
          INSERT INTO user_search_profiles (
            user_id,
            name,
            normalized_name,
            is_active,
            vacancy_language_mode,
            required_context_keywords_json,
            required_primary_keywords_json,
            preferred_keywords_json,
            exclude_keywords_json,
            sort_order,
            created_at,
            updated_at
          ) VALUES (?, 'Мой поиск', 'мой поиск', 1, ?, ?, ?, ?, ?, 0, ?, ?)
        `
      )
      .run(
        userId,
        vacancyLanguageMode,
        JSON.stringify(defaults.requiredContextKeywords),
        JSON.stringify(defaults.requiredPrimaryKeywords),
        JSON.stringify(defaults.preferredKeywords),
        JSON.stringify(defaults.excludeKeywords),
        defaults.updatedAt,
        defaults.updatedAt
      );
  }

  private buildDefaultSearchProfile(userId: string): UserSearchProfile {
    return {
      userId,
      requiredContextKeywords: [],
      requiredPrimaryKeywords: [],
      preferredKeywords: [],
      excludeKeywords: [],
      updatedAt: nowIso()
    };
  }

  private upsertUserVacancyProfileMatches(
    userId: string,
    vacancyId: number,
    profileMatches: UserVacancyProfileMatchInput[],
    timestamp: string
  ): void {
    const statement = this.getDb().prepare(
      `
        INSERT INTO user_vacancy_profile_matches (
          user_id,
          vacancy_id,
          profile_id,
          score,
          match_summary,
          matched_keywords_json,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, vacancy_id, profile_id) DO UPDATE SET
          score = excluded.score,
          match_summary = excluded.match_summary,
          matched_keywords_json = excluded.matched_keywords_json,
          updated_at = excluded.updated_at
      `
    );

    for (const profileMatch of profileMatches) {
      statement.run(
        userId,
        vacancyId,
        profileMatch.profileId,
        profileMatch.filterResult.score,
        profileMatch.filterResult.summary,
        JSON.stringify(unique(profileMatch.filterResult.matchedKeywords)),
        timestamp,
        timestamp
      );
    }
  }

  private getVacancyById(vacancyId: number): VacancyRecord | null {
    const row = this.getDb()
      .prepare("SELECT * FROM vacancies WHERE id = ? LIMIT 1")
      .get(vacancyId) as VacancyRow | undefined;

    return row ? mapVacancy(row) : null;
  }

  private getVacancyBySourceMessage(source: SourceName, channel: string, messageId: string): VacancyRecord | null {
    const row = this.getDb()
      .prepare(
        `
          SELECT *
          FROM vacancies
          WHERE source_name = ?
            AND source_channel = ?
            AND source_message_id = ?
          LIMIT 1
        `
      )
      .get(source, channel, messageId) as VacancyRow | undefined;

    return row ? mapVacancy(row) : null;
  }

  private getUserVacancyMatch(userId: string, vacancyId: number): MatchedVacancyRecord | null {
    const row = this.getDb()
      .prepare(
        `
          SELECT
            v.*,
            m.user_id,
            m.delivered_at,
            m.created_at AS matched_at,
            m.score AS user_score,
            m.match_summary AS user_match_summary,
            m.matched_keywords_json AS user_matched_keywords_json,
            COALESCE(s.status, 'inbox') AS user_status,
            s.updated_at AS status_updated_at,
            CASE WHEN s.status = 'hidden' THEN r.reason ELSE NULL END AS hidden_reason
          FROM user_vacancy_matches m
          INNER JOIN vacancies v ON v.id = m.vacancy_id
          LEFT JOIN user_vacancy_states s
            ON s.user_id = m.user_id
           AND s.vacancy_id = m.vacancy_id
          LEFT JOIN user_vacancy_hidden_reasons r
            ON r.user_id = m.user_id
           AND r.vacancy_id = m.vacancy_id
          WHERE m.user_id = ? AND m.vacancy_id = ?
          LIMIT 1
        `
      )
      .get(userId, vacancyId) as MatchedVacancyRow | undefined;

    return row ? this.attachMatchedProfiles(mapMatchedVacancy(row)) : null;
  }

  private attachMatchedProfiles<T extends MatchedVacancyRecord | UserStatusVacancyRecord>(vacancy: T): T {
    const profiles = this.listUserVacancyMatchedProfiles(vacancy.userId, vacancy.id);
    return {
      ...vacancy,
      matchedProfileIds: profiles.map((profile) => profile.id),
      matchedProfileNames: profiles.map((profile) => profile.name)
    };
  }

  private getChannelDiscoveryCandidateByRunAndUsername(
    runId: number,
    username: string
  ): ChannelDiscoveryCandidate | null {
    const row = this.getDb()
      .prepare("SELECT * FROM channel_discovery_candidates WHERE run_id = ? AND username = ? LIMIT 1")
      .get(runId, username) as ChannelDiscoveryCandidateRow | undefined;

    return row ? mapChannelDiscoveryCandidate(row) : null;
  }
}
