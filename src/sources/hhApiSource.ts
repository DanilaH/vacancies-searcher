import { AppConfig } from "../config";
import { VacancyDatabase } from "../db/database";
import { logger } from "../logger";
import { HhSearchSettings, RawVacancyItem, VacancySource } from "../types";
import { htmlFragmentToText } from "../utils/htmlToText";
import { normalizeReadableText } from "../utils/text";

type FetchLike = typeof fetch;

type HhVacanciesResponse = {
  items?: HhVacancyItem[];
  page?: number;
  pages?: number;
};

type HhVacancyItem = {
  id?: string;
  name?: string;
  alternate_url?: string;
  published_at?: string;
  employer?: {
    name?: string;
  } | null;
  area?: {
    name?: string;
  } | null;
  salary?: {
    from?: number | null;
    to?: number | null;
    currency?: string | null;
    gross?: boolean | null;
  } | null;
  experience?: {
    name?: string;
  } | null;
  schedule?: {
    name?: string;
  } | null;
  employment?: {
    name?: string;
  } | null;
  snippet?: {
    requirement?: string | null;
    responsibility?: string | null;
  } | null;
};

type QueryGroup = {
  key: string;
  settings: HhSearchSettings;
  userIds: string[];
};

const HH_API_BASE_URL = "https://api.hh.ru/vacancies";

function canonicalQueryKey(settings: HhSearchSettings): string {
  return JSON.stringify({
    text: settings.text.trim(),
    areaId: settings.areaId,
    experience: settings.experience,
    schedule: settings.schedule,
    employment: settings.employment,
    salaryFrom: settings.salaryFrom,
    periodDays: settings.periodDays
  });
}

function buildQueryParams(settings: HhSearchSettings, page: number, perPage: number): URLSearchParams {
  const params = new URLSearchParams();
  params.set("text", settings.text.trim());
  params.set("area", settings.areaId);
  params.set("period", String(settings.periodDays));
  params.set("per_page", String(perPage));
  params.set("page", String(page));
  params.set("order_by", "publication_time");

  if (settings.experience !== "any") {
    params.set("experience", settings.experience);
  }

  if (settings.schedule !== "any") {
    params.set("schedule", settings.schedule);
  }

  if (settings.employment !== "any") {
    params.set("employment", settings.employment);
  }

  if (settings.salaryFrom !== null) {
    params.set("salary", String(settings.salaryFrom));
    params.set("only_with_salary", "true");
  }

  return params;
}

export function buildHhVacanciesUrl(settings: HhSearchSettings, page: number, perPage: number): string {
  const params = buildQueryParams(settings, page, perPage);
  return `${HH_API_BASE_URL}?${params.toString()}`;
}

function formatSalary(salary: HhVacancyItem["salary"]): string | null {
  if (!salary) {
    return null;
  }

  const currency = salary.currency ? ` ${salary.currency}` : "";
  if (salary.from && salary.to) {
    return `${salary.from}-${salary.to}${currency}${salary.gross ? " gross" : ""}`;
  }

  if (salary.from) {
    return `от ${salary.from}${currency}${salary.gross ? " gross" : ""}`;
  }

  if (salary.to) {
    return `до ${salary.to}${currency}${salary.gross ? " gross" : ""}`;
  }

  return null;
}

function normalizeSnippet(value: string | null | undefined): string {
  return htmlFragmentToText(value ?? "");
}

function compactParts(values: Array<string | null | undefined>): string {
  return values
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .join(", ");
}

function buildSourceChannel(item: HhVacancyItem): string {
  const details = compactParts([item.employer?.name, item.area?.name]);
  return details ? `hh.ru • ${details}` : "hh.ru";
}

function buildVacancyText(item: HhVacancyItem): string {
  const salary = formatSalary(item.salary);
  const requirement = normalizeSnippet(item.snippet?.requirement);
  const responsibility = normalizeSnippet(item.snippet?.responsibility);
  const lines = [
    item.name ?? "Вакансия hh.ru",
    item.employer?.name ? `Компания: ${item.employer.name}` : null,
    item.area?.name ? `Регион: ${item.area.name}` : null,
    salary ? `Зарплата: ${salary}` : null,
    item.experience?.name ? `Опыт: ${item.experience.name}` : null,
    item.schedule?.name ? `График: ${item.schedule.name}` : null,
    item.employment?.name ? `Занятость: ${item.employment.name}` : null,
    requirement ? `Требования: ${requirement}` : null,
    responsibility ? `Задачи: ${responsibility}` : null
  ].filter((line): line is string => Boolean(line));

  return normalizeReadableText(lines.join("\n"));
}

function mergeEligibleUserIds(current: string[] | undefined, next: string[]): string[] {
  return [...new Set([...(current ?? []), ...next])];
}

export class HhApiSource implements VacancySource {
  readonly name = "hh_api" as const;

  constructor(
    private readonly config: AppConfig,
    private readonly database: VacancyDatabase,
    private readonly fetchImpl: FetchLike = fetch
  ) {}

  async fetchLatest(): Promise<RawVacancyItem[]> {
    if (!this.config.hhSourceEnabled) {
      return [];
    }

    if (!this.config.hhUserAgent) {
      logger.warn("HH source is enabled but HH_USER_AGENT is missing.");
      return [];
    }

    const groups = this.buildQueryGroups();
    if (groups.length === 0) {
      return [];
    }

    const itemsByMessageId = new Map<string, RawVacancyItem>();

    for (const group of groups) {
      const fetchedItems = await this.fetchGroup(group);
      for (const item of fetchedItems) {
        const existing = itemsByMessageId.get(item.messageId);
        if (existing) {
          existing.eligibleUserIds = mergeEligibleUserIds(existing.eligibleUserIds, item.eligibleUserIds ?? []);
          continue;
        }

        itemsByMessageId.set(item.messageId, item);
      }
    }

    return [...itemsByMessageId.values()];
  }

  async stop(): Promise<void> {}

  private buildQueryGroups(): QueryGroup[] {
    const totalEnabled = this.database.countEnabledHhSearchSettings();
    const settings = this.database.listEnabledHhSearchSettings(this.config.hhMaxActiveUsersPerCycle);
    const skippedUsers = Math.max(0, totalEnabled - settings.length);
    if (skippedUsers > 0) {
      logger.warn({ skippedUsers }, "Skipped enabled HH users because HH_MAX_ACTIVE_USERS_PER_CYCLE was reached.");
    }

    const groupsByKey = new Map<string, QueryGroup>();
    for (const item of settings) {
      const key = canonicalQueryKey(item);
      const group = groupsByKey.get(key);
      if (group) {
        group.userIds.push(item.userId);
        continue;
      }

      if (groupsByKey.size >= this.config.hhMaxUniqueQueriesPerCycle) {
        logger.warn({ userId: item.userId }, "Skipped HH query because HH_MAX_UNIQUE_QUERIES_PER_CYCLE was reached.");
        continue;
      }

      groupsByKey.set(key, {
        key,
        settings: item,
        userIds: [item.userId]
      });
    }

    return [...groupsByKey.values()];
  }

  private async fetchGroup(group: QueryGroup): Promise<RawVacancyItem[]> {
    const result: RawVacancyItem[] = [];
    for (let page = 0; page < this.config.hhMaxPagesPerQuery; page += 1) {
      const url = buildHhVacanciesUrl(group.settings, page, this.config.hhPerPage);
      const response = await this.fetchImpl(url, {
        headers: this.buildHeaders()
      });

      if (!response.ok) {
        const message = `HH vacancies API returned HTTP ${response.status}.`;
        logger.warn(
          { status: response.status, url },
          "HH vacancies API returned a non-success response."
        );
        throw new Error(message);
      }

      const payload = (await response.json()) as HhVacanciesResponse;
      const items = payload.items ?? [];
      for (const item of items) {
        const rawItem = this.mapVacancy(item, group);
        if (rawItem) {
          result.push(rawItem);
        }
      }

      if (items.length === 0 || page + 1 >= (payload.pages ?? 0)) {
        break;
      }
    }

    return result;
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "HH-User-Agent": this.config.hhUserAgent ?? ""
    };

    if (this.config.hhAccessToken) {
      headers.Authorization = `Bearer ${this.config.hhAccessToken}`;
    }

    return headers;
  }

  private mapVacancy(item: HhVacancyItem, group: QueryGroup): RawVacancyItem | null {
    if (!item.id || !item.alternate_url) {
      return null;
    }

    const text = buildVacancyText(item);
    if (!text) {
      return null;
    }

    return {
      source: this.name,
      channel: buildSourceChannel(item),
      messageId: item.id,
      date: item.published_at,
      text,
      url: item.alternate_url,
      eligibleUserIds: group.userIds,
      sourceQueryKey: group.key
    };
  }
}
