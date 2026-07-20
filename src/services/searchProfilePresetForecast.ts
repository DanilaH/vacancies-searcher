import { VacancyDatabase } from "../db/database";
import {
  SearchProfilePresetForecast,
  UserSearchProfile,
  VacancyLanguageMode
} from "../types";
import { listSearchProfilePresets } from "./searchProfilePresets";
import { VacancyFilter } from "./vacancyFilter";

interface ForecastCacheEntry {
  expiresAt: number;
  forecasts: SearchProfilePresetForecast[];
}

export class SearchProfilePresetForecastService {
  private readonly cache = new Map<string, ForecastCacheEntry>();

  constructor(
    private readonly database: VacancyDatabase,
    private readonly filter: VacancyFilter,
    private readonly cacheTtlMs = 60_000,
    private readonly now: () => number = Date.now
  ) {}

  evaluate(userId: string, languageMode: VacancyLanguageMode, days = 7): SearchProfilePresetForecast[] {
    const cacheKey = `${userId}:${languageMode}:${days}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > this.now()) {
      return cached.forecasts;
    }

    const vacancies = this.database
      .listVacanciesSince(days)
      .filter((vacancy) => vacancy.sourceName !== "hh_api" || this.database.canUserMatchHhVacancy(userId, vacancy.id));
    const forecasts = listSearchProfilePresets().map((preset) => {
      const profile: UserSearchProfile = {
        userId,
        requiredContextKeywords: preset.requiredContextKeywords,
        requiredPrimaryKeywords: preset.requiredPrimaryKeywords,
        preferredKeywords: preset.preferredKeywords,
        excludeKeywords: preset.excludeKeywords,
        updatedAt: new Date(0).toISOString()
      };
      const matchesCount = vacancies.reduce(
        (count, vacancy) =>
          count + (this.filter.evaluateForProfile(vacancy.text, profile, languageMode).matches ? 1 : 0),
        0
      );

      return {
        presetId: preset.id,
        matchesCount,
        evaluatedVacancies: vacancies.length
      };
    });

    this.cache.set(cacheKey, {
      expiresAt: this.now() + this.cacheTtlMs,
      forecasts
    });
    return forecasts;
  }
}
