import { VacancyDatabase } from "../db/database";
import {
  UserSearchProfileRematchDiagnostic,
  UserVacancyMatchSyncInput,
  UserVacancyRematchSummary
} from "../types";
import { getSearchProfileHealth } from "./searchProfileHealth";
import { VacancyFilter } from "./vacancyFilter";
import { evaluateSearchProfiles } from "./multiProfileMatching";
import { trySaveRejectedAudit } from "./rejectedMatchAuditService";

export class UserVacancyRematcher {
  constructor(
    private readonly database: VacancyDatabase,
    private readonly filter: VacancyFilter,
    private readonly ownerUserId?: string
  ) {}

  rebuildForUser(userId: string, days: number): UserVacancyRematchSummary {
    const profiles = this.database.listUserSearchProfiles(userId, true);
    const profileStatuses = profiles.map((profile) => getSearchProfileHealth(profile).status);
    const profileStatus = profileStatuses.includes("ready")
      ? "ready"
      : profileStatuses.includes("weak")
        ? "weak"
        : "empty";
    const vacancies = this.database.listVacanciesSince(days);
    const nextMatches: UserVacancyMatchSyncInput[] = [];
    let evaluatedVacancies = 0;
    const diagnostics = new Map<number, UserSearchProfileRematchDiagnostic>(
      profiles
        .filter((profile) => profile.isActive)
        .map((profile) => [
          profile.id,
          {
            profileId: profile.id,
            profileName: profile.name,
            evaluatedVacancies: 0,
            matchedVacancies: 0,
            rejectionReasons: {}
          }
        ])
    );

    for (const vacancy of vacancies) {
      if (vacancy.sourceName === "hh_api" && !this.database.canUserMatchHhVacancy(userId, vacancy.id)) {
        continue;
      }

      evaluatedVacancies += 1;
      const evaluation = evaluateSearchProfiles(this.filter, vacancy.text, profiles);
      for (const profileEvaluation of evaluation.evaluations) {
        const diagnostic = diagnostics.get(profileEvaluation.profileId);
        if (!diagnostic) {
          continue;
        }

        diagnostic.evaluatedVacancies += 1;
        if (profileEvaluation.filterResult.matches) {
          diagnostic.matchedVacancies += 1;
          continue;
        }

        for (const reason of new Set(profileEvaluation.filterResult.rejectionReasons ?? [])) {
          diagnostic.rejectionReasons[reason] = (diagnostic.rejectionReasons[reason] ?? 0) + 1;
        }
      }

      if (!evaluation.result) {
        trySaveRejectedAudit(
          this.database,
          evaluation,
          userId,
          vacancy.id,
          this.ownerUserId
        );
        continue;
      }

      nextMatches.push({
        vacancyId: vacancy.id,
        filterResult: evaluation.result.filterResult,
        profileMatches: evaluation.result.profileMatches
      });
    }

    const syncResult = this.database.syncUserVacancyMatchesForWindow(userId, days, nextMatches);

    return {
      ...syncResult,
      userId,
      windowDays: days,
      scannedVacancies: vacancies.length,
      evaluatedVacancies,
      profileDiagnostics: [...diagnostics.values()],
      profileStatus
    };
  }
}
