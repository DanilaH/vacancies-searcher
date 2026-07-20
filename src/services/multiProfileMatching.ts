import {
  FilterResult,
  UserSearchProfileRecord,
  UserVacancyProfileMatchInput
} from "../types";
import { VacancyFilter } from "./vacancyFilter";

export interface MultiProfileMatchResult {
  filterResult: FilterResult;
  profileMatches: UserVacancyProfileMatchInput[];
}

export interface SearchProfileEvaluation {
  profileId: number;
  filterResult: FilterResult;
}

export interface SearchProfilesEvaluation {
  result: MultiProfileMatchResult | null;
  evaluations: SearchProfileEvaluation[];
}

export function evaluateSearchProfiles(
  filter: VacancyFilter,
  text: string,
  profiles: UserSearchProfileRecord[]
): SearchProfilesEvaluation {
  const evaluations = profiles
    .filter((profile) => profile.isActive)
    .map((profile) => ({
      profileId: profile.id,
      filterResult: filter.evaluateForProfile(text, profile, profile.vacancyLanguageMode)
    }));
  const profileMatches = evaluations.filter((match) => match.filterResult.matches);

  if (profileMatches.length === 0) {
    return { result: null, evaluations };
  }

  const bestMatch = profileMatches.reduce((best, current) =>
    current.filterResult.score > best.filterResult.score ? current : best
  );

  return {
    result: {
      filterResult: {
        ...bestMatch.filterResult,
        matchedKeywords: [
          ...new Set(profileMatches.flatMap((match) => match.filterResult.matchedKeywords))
        ]
      },
      profileMatches
    },
    evaluations
  };
}

export function evaluateActiveSearchProfiles(
  filter: VacancyFilter,
  text: string,
  profiles: UserSearchProfileRecord[]
): MultiProfileMatchResult | null {
  return evaluateSearchProfiles(filter, text, profiles).result;
}
