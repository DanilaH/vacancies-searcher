import { load } from "cheerio";

import { AppConfig } from "../config";
import { VacancyDatabase } from "../db/database";
import { logger } from "../logger";
import {
  CompanyCareerAdapter,
  CompanyCareerSourceRecord,
  RawVacancyItem,
  VacancySource
} from "../types";
import {
  assertSafeCompanyCareerUrl,
  detectCompanyCareerUrl,
  normalizeCompanyCareerUrl
} from "../services/companyCareerUrls";
import { htmlFragmentToText } from "../utils/htmlToText";
import { sleep } from "../utils/sleep";
import { normalizeReadableText } from "../utils/text";

type FetchLike = typeof fetch;

type NormalizedCompanyJob = {
  id: string;
  title: string;
  companyName: string;
  url: string;
  canonicalUrl: string;
  publishedAt?: string;
  location?: string | null;
  department?: string | null;
  employment?: string | null;
  description: string;
};

type GreenhouseResponse = {
  jobs?: Array<{
    id?: number | string;
    title?: string;
    absolute_url?: string;
    updated_at?: string;
    location?: { name?: string | null } | null;
    departments?: Array<{ name?: string | null }>;
    content?: string | null;
  }>;
};

type LeverPosting = {
  id?: string;
  text?: string;
  hostedUrl?: string;
  createdAt?: number;
  categories?: {
    team?: string | null;
    location?: string | null;
    commitment?: string | null;
  };
  description?: string | null;
  descriptionPlain?: string | null;
  lists?: Array<{ text?: string | null; content?: string | null }>;
};

type AshbyResponse = {
  jobs?: Array<{
    id?: string;
    title?: string;
    jobUrl?: string;
    publishedAt?: string;
    locationName?: string | null;
    departmentName?: string | null;
    employmentType?: string | null;
    descriptionHtml?: string | null;
    descriptionPlain?: string | null;
  }>;
};

type SmartRecruitersResponse = {
  content?: Array<{
    id?: string;
    name?: string;
    ref?: string;
    releasedDate?: string;
    location?: {
      city?: string | null;
      country?: string | null;
      remote?: boolean | null;
    } | null;
    jobAd?: {
      sections?: {
        jobDescription?: { text?: string | null } | null;
        qualifications?: { text?: string | null } | null;
      } | null;
    } | null;
  }>;
};

const MAX_AVIASALES_DETAIL_LINKS = 40;

function compactParts(values: Array<string | null | undefined>, separator = ", "): string {
  return values
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .join(separator);
}

function buildJobText(job: NormalizedCompanyJob): string {
  return normalizeReadableText(
    [
      job.title,
      `Company: ${job.companyName}`,
      job.location ? `Location: ${job.location}` : null,
      job.department ? `Department: ${job.department}` : null,
      job.employment ? `Employment: ${job.employment}` : null,
      "",
      job.description
    ]
      .filter((line): line is string => line !== null)
      .join("\n")
  );
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function collectJobPostingNodes(value: unknown): Array<Record<string, unknown>> {
  if (!value || typeof value !== "object") {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectJobPostingNodes(item));
  }

  const record = value as Record<string, unknown>;
  const type = record["@type"];
  const typeValues = Array.isArray(type) ? type : [type];
  const matchesJobPosting = typeValues.some((item) => typeof item === "string" && item.toLowerCase() === "jobposting");
  const graph = record["@graph"];

  return [
    ...(matchesJobPosting ? [record] : []),
    ...collectJobPostingNodes(graph)
  ];
}

function parseJsonLdJobPostings(html: string): Array<Record<string, unknown>> {
  const $ = load(html);
  const nodes: Array<Record<string, unknown>> = [];

  $("script[type='application/ld+json']").each((_, element) => {
    const rawJson = $(element).text().trim();
    if (!rawJson) {
      return;
    }

    try {
      nodes.push(...collectJobPostingNodes(JSON.parse(rawJson)));
    } catch {
      return;
    }
  });

  return nodes;
}

function buildNextPollAfter(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function adapterExternalUrl(adapter: CompanyCareerAdapter, externalId: string | null, startUrl: string): string {
  if (!externalId) {
    return startUrl;
  }

  switch (adapter) {
    case "greenhouse_job_board":
      return `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(externalId)}/jobs?content=true`;
    case "lever_postings":
      return `https://api.lever.co/v0/postings/${encodeURIComponent(externalId)}?mode=json`;
    case "ashby_posting":
      return `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(externalId)}`;
    case "smartrecruiters_postings":
      return `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(externalId)}/postings`;
    default:
      return startUrl;
  }
}

export class CompanyCareersSource implements VacancySource {
  readonly name = "company_careers" as const;
  private stopped = false;

  constructor(
    private readonly config: AppConfig,
    private readonly database: VacancyDatabase,
    private readonly fetchImpl: FetchLike = fetch
  ) {}

  async fetchLatest(): Promise<RawVacancyItem[]> {
    if (!this.config.companyCareersSourceEnabled) {
      return [];
    }

    const dueAt = new Date().toISOString();
    const sources = this.database.listDueCompanyCareerSources(dueAt, this.config.companyCareersMaxSourcesPerCycle);
    const items: RawVacancyItem[] = [];

    for (let index = 0; index < sources.length; index += 1) {
      if (this.stopped) {
        break;
      }

      const source = sources[index];
      const result = await this.checkSource(source);
      if (result.ok) {
        items.push(...result.items);
      }

      if (index < sources.length - 1) {
        await sleep(this.config.companyCareersRequestDelayMs);
      }
    }

    return items;
  }

  async stop(): Promise<void> {
    this.stopped = true;
  }

  async checkSourceById(sourceId: number): Promise<
    | { ok: true; source: CompanyCareerSourceRecord; items: RawVacancyItem[] }
    | { ok: false; source: CompanyCareerSourceRecord | null; error: string }
  > {
    const source = this.database.getCompanyCareerSourceById(sourceId);
    if (!source) {
      return {
        ok: false,
        source: null,
        error: "Company source not found."
      };
    }

    const result = await this.checkSource(source);
    return result.ok
      ? { ok: true, source, items: result.items }
      : { ok: false, source, error: result.error };
  }

  private async checkSource(source: CompanyCareerSourceRecord): Promise<
    | { ok: true; items: RawVacancyItem[] }
    | { ok: false; error: string }
  > {
    try {
      const jobs = await this.fetchCompanyJobs(source);
      const items = jobs.map((job) => this.mapJob(source, job));
      this.database.markCompanyCareerSourceSuccess(source.id, buildNextPollAfter(source.pollIntervalSeconds));
      return {
        ok: true,
        items
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn({ err: error, sourceId: source.id, companyName: source.companyName }, "Company careers source failed.");
      this.database.markCompanyCareerSourceFailure(source.id, message, buildNextPollAfter(source.pollIntervalSeconds));
      return {
        ok: false,
        error: message
      };
    }
  }

  private async fetchCompanyJobs(source: CompanyCareerSourceRecord): Promise<NormalizedCompanyJob[]> {
    const detected = detectCompanyCareerUrl(source.startUrl);
    const externalId = detected?.externalId ?? null;
    const adapterUrl = adapterExternalUrl(source.adapter, externalId, source.startUrl);

    switch (source.adapter) {
      case "aviasales_html":
        return this.fetchAviasalesJobs(source);
      case "greenhouse_job_board":
        return this.fetchGreenhouseJobs(source, adapterUrl);
      case "lever_postings":
        return this.fetchLeverJobs(source, adapterUrl);
      case "ashby_posting":
        return this.fetchAshbyJobs(source, adapterUrl);
      case "smartrecruiters_postings":
        return this.fetchSmartRecruitersJobs(source, adapterUrl);
      default:
        return this.fetchGenericHtmlJobs(source);
    }
  }

  private async fetchAviasalesJobs(source: CompanyCareerSourceRecord): Promise<NormalizedCompanyJob[]> {
    const startUrl = assertSafeCompanyCareerUrl(source.startUrl);
    const startPath = new URL(startUrl).pathname;
    const detailUrls = startPath.match(/\/about\/vacancies\/\d+$/u)
      ? [startUrl]
      : this.extractAviasalesDetailUrls(await this.fetchText(startUrl), startUrl);

    const jobs: NormalizedCompanyJob[] = [];
    for (const detailUrl of detailUrls.slice(0, MAX_AVIASALES_DETAIL_LINKS)) {
      const html = await this.fetchText(detailUrl);
      const job = this.parseHtmlDetailJob(source.companyName, detailUrl, html);
      if (job) {
        jobs.push(job);
      }
    }

    return jobs;
  }

  private extractAviasalesDetailUrls(html: string, baseUrl: string): string[] {
    const $ = load(html);
    const urls = new Set<string>();
    $("a[href]").each((_, element) => {
      const href = $(element).attr("href")?.trim();
      if (!href) {
        return;
      }

      try {
        const url = new URL(href, baseUrl);
        if (!/\/about\/vacancies\/\d+$/u.test(url.pathname)) {
          return;
        }

        const normalized = normalizeCompanyCareerUrl(url.toString());
        if (normalized) {
          urls.add(normalized);
        }
      } catch {
        return;
      }
    });

    return [...urls];
  }

  private async fetchGreenhouseJobs(source: CompanyCareerSourceRecord, apiUrl: string): Promise<NormalizedCompanyJob[]> {
    const payload = (await this.fetchJson(apiUrl)) as GreenhouseResponse;
    return (payload.jobs ?? []).flatMap((item): NormalizedCompanyJob[] => {
      const url = normalizeCompanyCareerUrl(item.absolute_url ?? "");
      const title = item.title?.trim();
      if (!item.id || !url || !title) {
        return [];
      }

      return [
        {
          id: String(item.id),
          title,
          companyName: source.companyName,
          url,
          canonicalUrl: url,
          publishedAt: item.updated_at,
          location: item.location?.name ?? null,
          department: compactParts(item.departments?.map((department) => department.name) ?? []),
          description: htmlFragmentToText(item.content ?? "")
        }
      ];
    });
  }

  private async fetchLeverJobs(source: CompanyCareerSourceRecord, apiUrl: string): Promise<NormalizedCompanyJob[]> {
    const payload = (await this.fetchJson(apiUrl)) as LeverPosting[];
    return (Array.isArray(payload) ? payload : []).flatMap((item): NormalizedCompanyJob[] => {
      const url = normalizeCompanyCareerUrl(item.hostedUrl ?? "");
      const title = item.text?.trim();
      if (!item.id || !url || !title) {
        return [];
      }

      const listText = (item.lists ?? [])
        .map((list) => compactParts([list.text, htmlFragmentToText(list.content ?? "")], "\n"))
        .filter(Boolean)
        .join("\n\n");

      return [
        {
          id: item.id,
          title,
          companyName: source.companyName,
          url,
          canonicalUrl: url,
          publishedAt: item.createdAt ? new Date(item.createdAt).toISOString() : undefined,
          location: item.categories?.location ?? null,
          department: item.categories?.team ?? null,
          employment: item.categories?.commitment ?? null,
          description: normalizeReadableText(compactParts([item.descriptionPlain, htmlFragmentToText(item.description ?? ""), listText], "\n\n"))
        }
      ];
    });
  }

  private async fetchAshbyJobs(source: CompanyCareerSourceRecord, apiUrl: string): Promise<NormalizedCompanyJob[]> {
    const payload = (await this.fetchJson(apiUrl)) as AshbyResponse;
    return (payload.jobs ?? []).flatMap((item): NormalizedCompanyJob[] => {
      const url = normalizeCompanyCareerUrl(item.jobUrl ?? "");
      const title = item.title?.trim();
      if (!item.id || !url || !title) {
        return [];
      }

      return [
        {
          id: item.id,
          title,
          companyName: source.companyName,
          url,
          canonicalUrl: url,
          publishedAt: item.publishedAt,
          location: item.locationName ?? null,
          department: item.departmentName ?? null,
          employment: item.employmentType ?? null,
          description: normalizeReadableText(item.descriptionPlain ?? htmlFragmentToText(item.descriptionHtml ?? ""))
        }
      ];
    });
  }

  private async fetchSmartRecruitersJobs(source: CompanyCareerSourceRecord, apiUrl: string): Promise<NormalizedCompanyJob[]> {
    const payload = (await this.fetchJson(apiUrl)) as SmartRecruitersResponse;
    return (payload.content ?? []).flatMap((item): NormalizedCompanyJob[] => {
      const url = normalizeCompanyCareerUrl(item.ref ?? "");
      const title = item.name?.trim();
      if (!item.id || !url || !title) {
        return [];
      }

      const location = compactParts([
        item.location?.remote ? "remote" : null,
        item.location?.city,
        item.location?.country
      ]);
      const description = compactParts([
        htmlFragmentToText(item.jobAd?.sections?.jobDescription?.text ?? ""),
        htmlFragmentToText(item.jobAd?.sections?.qualifications?.text ?? "")
      ], "\n\n");

      return [
        {
          id: item.id,
          title,
          companyName: source.companyName,
          url,
          canonicalUrl: url,
          publishedAt: item.releasedDate,
          location,
          description
        }
      ];
    });
  }

  private async fetchGenericHtmlJobs(source: CompanyCareerSourceRecord): Promise<NormalizedCompanyJob[]> {
    const url = assertSafeCompanyCareerUrl(source.startUrl);
    const html = await this.fetchText(url);
    return parseJsonLdJobPostings(html).flatMap((node, index): NormalizedCompanyJob[] => {
      const title = asString(node.title);
      const canonicalUrl = normalizeCompanyCareerUrl(asString(node.url) ?? url);
      if (!title || !canonicalUrl) {
        return [];
      }

      return [
        {
          id: asString(node.identifier) ?? canonicalUrl,
          title,
          companyName: source.companyName,
          url: canonicalUrl,
          canonicalUrl,
          publishedAt: asString(node.datePosted) ?? asString(node.validThrough) ?? undefined,
          location: asString(node.jobLocation),
          employment: asString(node.employmentType),
          description: htmlFragmentToText(asString(node.description) ?? ""),
        }
      ];
    });
  }

  private parseHtmlDetailJob(companyName: string, url: string, html: string): NormalizedCompanyJob | null {
    const $ = load(html);
    const title =
      $("h1").first().text().trim() ||
      $("title").first().text().replace(/\s*[|—-].*$/u, "").trim();
    const description = htmlFragmentToText($("main").html() ?? $("body").html() ?? html);
    const canonicalUrl = normalizeCompanyCareerUrl($("link[rel='canonical']").attr("href") ?? url);

    if (!title || !description || !canonicalUrl) {
      return null;
    }

    const id = new URL(canonicalUrl).pathname.split("/").filter(Boolean).at(-1) ?? canonicalUrl;
    return {
      id,
      title,
      companyName,
      url: canonicalUrl,
      canonicalUrl,
      description
    };
  }

  private mapJob(source: CompanyCareerSourceRecord, job: NormalizedCompanyJob): RawVacancyItem {
    return {
      source: this.name,
      channel: source.companyName,
      messageId: `${source.id}:${job.id}`,
      date: job.publishedAt,
      text: buildJobText(job),
      url: job.url,
      canonicalUrl: job.canonicalUrl
    };
  }

  private async fetchJson(url: string): Promise<unknown> {
    return JSON.parse(await this.fetchText(url));
  }

  private async fetchText(url: string): Promise<string> {
    const safeUrl = assertSafeCompanyCareerUrl(url);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.companyCareersRequestTimeoutMs);
    timeout.unref();

    try {
      const response = await this.fetchImpl(safeUrl, {
        signal: controller.signal,
        redirect: "error",
        headers: {
          "user-agent": this.config.companyCareersUserAgent,
          accept: "application/json,text/html;q=0.9,*/*;q=0.8"
        }
      });

      if (!response.ok) {
        throw new Error(`Company careers endpoint returned HTTP ${response.status}.`);
      }

      const contentLength = Number.parseInt(response.headers.get("content-length") ?? "0", 10);
      if (contentLength > this.config.companyCareersMaxResponseBytes) {
        throw new Error("Company careers response is too large.");
      }

      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > this.config.companyCareersMaxResponseBytes) {
        throw new Error("Company careers response is too large.");
      }

      return new TextDecoder().decode(buffer);
    } finally {
      clearTimeout(timeout);
    }
  }
}
