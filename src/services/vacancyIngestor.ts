import { AnalyticsService } from "../analytics/analyticsService";
import { BotController } from "../bot/createBot";
import { AppConfig } from "../config";
import { VacancyDatabase } from "../db/database";
import { logger } from "../logger";
import { AnalyticsEventName, RawVacancyItem, VacancyRecord } from "../types";
import { extractSupportedCompanyCareerUrl } from "./companyCareerUrls";
import { extractContacts } from "./contactExtractor";
import { VacancyFilter } from "./vacancyFilter";
import { evaluateSearchProfiles } from "./multiProfileMatching";
import { trySaveRejectedAudit } from "./rejectedMatchAuditService";
import { ExternalVacancyEnricher, ExternalVacancyEnrichmentError } from "./externalVacancyEnricher";
import { extractTrustedVacancyUrlCandidates, isTrustedVacancyUrlShape } from "./trustedVacancyServices";
import { computeFuzzyMatch, shouldConsiderFuzzyMatch } from "./vacancyFuzzyMatcher";

const TRUSTED_URL_SHAPE_REJECTION = "Trusted vacancy URL shape is not supported for this service.";

type TrustedVacancyUrlResolution = {
  canonicalUrl: string | null;
  definitiveRejection: string | null;
};

export class VacancyIngestor {
  private readonly externalEnricher: ExternalVacancyEnricher;

  constructor(
    private readonly config: AppConfig,
    private readonly filter: VacancyFilter,
    private readonly database: VacancyDatabase,
    private readonly bot: BotController,
    private readonly analytics: AnalyticsService,
    externalEnricher?: ExternalVacancyEnricher
  ) {
    this.externalEnricher = externalEnricher ?? new ExternalVacancyEnricher(config, database);
  }

  async handle(item: RawVacancyItem): Promise<string[]> {
    const trustedUrlResolution = item.canonicalUrl
      ? { canonicalUrl: null, definitiveRejection: null }
      : this.resolveTrustedVacancyUrl(item);
    const itemWithCanonicalUrl = {
      ...item,
      canonicalUrl: item.canonicalUrl
        ?? (trustedUrlResolution.definitiveRejection ? null : trustedUrlResolution.canonicalUrl)
        ?? (trustedUrlResolution.definitiveRejection ? null : extractSupportedCompanyCareerUrl(item.text))
        ?? undefined
    };
    const enrichment = trustedUrlResolution.definitiveRejection
      ? { item: itemWithCanonicalUrl, definitiveRejection: trustedUrlResolution.definitiveRejection }
      : await this.enrichItem(itemWithCanonicalUrl);
    const enrichedItem = enrichment.item;
    const baseFilterResult = enrichment.definitiveRejection
      ? {
          matches: false,
          score: 0,
          matchedKeywords: [],
          blockedBy: ["external_page_not_vacancy"],
          summary: enrichment.definitiveRejection
        }
      : this.filter.evaluateBaseCandidate(enrichedItem.text);
    const contacts = extractContacts(enrichedItem.text);
    const result = this.database.recordMessage(
      {
        ...enrichedItem,
        date: enrichedItem.date ?? new Date().toISOString()
      },
      baseFilterResult,
      contacts
    );

    if (result.kind === "new_vacancy") {
      const fuzzyDuplicateId = this.findAndRecordFuzzyDuplicate(result.vacancy);

      if (fuzzyDuplicateId !== null) {
        logger.info(
          {
            source: result.vacancy.sourceName,
            channel: result.vacancy.sourceChannel,
            messageId: result.vacancy.sourceMessageId,
            duplicateVacancyId: fuzzyDuplicateId
          },
          "New vacancy is a fuzzy duplicate; skipping user matching."
        );
        return [];
      }

      const matchedUserIds = await this.matchVacancyForEligibleUsers(enrichedItem, result.vacancy);

      logger.info(
        {
          source: result.vacancy.sourceName,
          channel: result.vacancy.sourceChannel,
          messageId: result.vacancy.sourceMessageId,
          score: result.vacancy.score,
          matchedUsers: matchedUserIds.length
        },
        "New vacancy saved."
      );

      return matchedUserIds;
    }

    if (result.kind === "duplicate_fingerprint" || result.kind === "duplicate_canonical_url") {
      if (enrichedItem.eligibleUserIds?.length) {
        const vacancy = this.database.getVacancy(result.duplicateVacancyId);
        if (vacancy) {
          const matchedUserIds = await this.matchVacancyForEligibleUsers(enrichedItem, vacancy);
          logger.debug(
            {
              duplicateKind: result.kind,
              fingerprint: result.kind === "duplicate_fingerprint" ? result.fingerprint : undefined,
              canonicalUrl: result.kind === "duplicate_canonical_url" ? result.canonicalUrl : undefined,
              matchedUsers: matchedUserIds.length
            },
            "Processed duplicate vacancy for eligible users."
          );
          return matchedUserIds;
        }
      }

      logger.debug(
        {
          duplicateKind: result.kind,
          fingerprint: result.kind === "duplicate_fingerprint" ? result.fingerprint : undefined,
          canonicalUrl: result.kind === "duplicate_canonical_url" ? result.canonicalUrl : undefined
        },
        "Skipped duplicate vacancy."
      );
      return [];
    }

    if (result.kind === "duplicate_raw_message") {
      if (enrichedItem.eligibleUserIds?.length && result.vacancyId) {
        const vacancy = this.database.getVacancy(result.vacancyId);
        if (vacancy) {
          const matchedUserIds = await this.matchVacancyForEligibleUsers(enrichedItem, vacancy);
          logger.debug(
            { source: result.source, channel: result.channel, messageId: result.messageId, matchedUsers: matchedUserIds.length },
            "Processed duplicate raw message for eligible users."
          );
          return matchedUserIds;
        }
      }

      logger.debug(
        { source: result.source, channel: result.channel, messageId: result.messageId },
        "Skipped duplicate raw message."
      );
      return [];
    }

    logger.debug({ summary: result.summary }, "Source item did not pass vacancy filter.");
    return [];
  }

  private resolveTrustedVacancyUrl(item: RawVacancyItem): TrustedVacancyUrlResolution {
    const activeCandidates: string[] = [];
    let hasInvalidActiveTrustedCandidate = false;
    for (const url of extractTrustedVacancyUrlCandidates(item)) {
      const service = this.database.getActiveTrustedVacancyServiceByHostname(new URL(url).hostname);
      if (!service) {
        continue;
      }
      if (isTrustedVacancyUrlShape(service.adapter, url)) {
        activeCandidates.push(url);
      } else {
        hasInvalidActiveTrustedCandidate = true;
      }
    }
    if (activeCandidates.length === 1) {
      return { canonicalUrl: activeCandidates[0]!, definitiveRejection: null };
    }
    if (activeCandidates.length === 0 && hasInvalidActiveTrustedCandidate) {
      return { canonicalUrl: null, definitiveRejection: TRUSTED_URL_SHAPE_REJECTION };
    }
    return { canonicalUrl: null, definitiveRejection: null };
  }

  private async enrichItem(item: RawVacancyItem): Promise<{
    item: RawVacancyItem;
    definitiveRejection: string | null;
  }> {
    if (!item.canonicalUrl) return { item, definitiveRejection: null };
    try {
      const enrichment = await this.externalEnricher.enrich(item.canonicalUrl);
      if (!enrichment) return { item, definitiveRejection: null };
      return {
        item: {
          ...item,
          text: `${item.text}\n\nExternal vacancy details:\n${enrichment.text}`
        },
        definitiveRejection: null
      };
    } catch (error) {
      if (error instanceof ExternalVacancyEnrichmentError && error.definitive) {
        logger.info(
          { canonicalUrl: item.canonicalUrl, channel: item.channel, messageId: item.messageId, reason: error.message },
          "Trusted external page definitively rejected the vacancy candidate."
        );
        return { item, definitiveRejection: error.message };
      }
      logger.warn(
        { err: error, canonicalUrl: item.canonicalUrl, channel: item.channel, messageId: item.messageId },
        "Trusted vacancy enrichment failed; continuing with Telegram data."
      );
      return { item, definitiveRejection: null };
    }
  }

  private async matchVacancyForEligibleUsers(item: RawVacancyItem, vacancy: VacancyRecord): Promise<string[]> {
    const eligibleUserIds = item.eligibleUserIds
      ? new Set(item.eligibleUserIds.map((userId) => String(userId)))
      : null;
    const activeUsers = this.database.listActiveUsers();
    const users = eligibleUserIds
      ? activeUsers.filter((user) => eligibleUserIds.has(user.userId))
      : activeUsers;
    const matchedUserIds: string[] = [];

    for (const user of users) {
      if (eligibleUserIds) {
        this.database.recordHhVacancyCandidate(user.userId, vacancy.id, item.sourceQueryKey ?? "hh_api");
      }

      const evaluation = evaluateSearchProfiles(
        this.filter,
        item.text,
        this.database.listUserSearchProfiles(user.userId, true)
      );
      if (!evaluation.result) {
        trySaveRejectedAudit(
          this.database,
          evaluation,
          user.userId,
          vacancy.id,
          this.config.ownerUserId
        );
        continue;
      }

      const matchedVacancy = this.database.createUserVacancyMatch(
        user.userId,
        vacancy.id,
        evaluation.result.filterResult,
        evaluation.result.profileMatches
      );
      if (!matchedVacancy) {
        continue;
      }

      await this.analytics.capture({
        eventName: "vacancy_matched",
        userId: user.userId,
        properties: {
          role: user.role,
          vacancy_id: matchedVacancy.id,
          source_name: matchedVacancy.sourceName,
          source_channel: matchedVacancy.sourceChannel,
          source_message_id: matchedVacancy.sourceMessageId,
          score: matchedVacancy.score,
          matched_keywords_count: matchedVacancy.matchedKeywords.length
        }
      });

      matchedUserIds.push(user.userId);
      const notificationSent = await this.bot.notifyVacancy(matchedVacancy);
      if (!notificationSent) {
        logger.info(
          { userId: user.userId, vacancyId: matchedVacancy.id },
          "Vacancy matched a user, but notification was not delivered."
        );
      }
    }

    return matchedUserIds;
  }

  private findAndRecordFuzzyDuplicate(vacancy: VacancyRecord): number | null {
    const candidates = this.database.listFuzzyMatchCandidates(vacancy.id, 30, 200);
    for (const candidate of candidates) {
      if (!shouldConsiderFuzzyMatch(vacancy, candidate)) {
        continue;
      }
      const match = computeFuzzyMatch(vacancy, candidate);
      if (!match.isMatch) {
        continue;
      }
      this.database.recordVacancyFuzzyDuplicate(vacancy.id, candidate.id, match.score, match.reasons);
      this.analytics.capture({
        eventName: "vacancy_fuzzy_duplicate_found" as AnalyticsEventName,
        distinctId: "system",
        properties: {
          vacancy_id: vacancy.id,
          duplicate_vacancy_id: candidate.id,
          score: match.score,
          reasons: match.reasons.join("; "),
          source_name: vacancy.sourceName,
          duplicate_source_name: candidate.sourceName,
          source_channel: vacancy.sourceChannel,
          duplicate_source_channel: candidate.sourceChannel
        }
      }).catch((error: unknown) => {
        logger.warn({ err: error }, "Failed to capture fuzzy duplicate analytics.");
      });
      logger.info(
        {
          vacancyId: vacancy.id,
          duplicateVacancyId: candidate.id,
          score: match.score,
          reasons: match.reasons
        },
        "Fuzzy duplicate link created."
      );
      return candidate.id;
    }
    return null;
  }
}
