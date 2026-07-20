import { load } from "cheerio";

import { AppConfig } from "../config";
import { VacancyDatabase } from "../db/database";
import { ExternalVacancyEnrichmentResult, TrustedVacancyServiceRecord } from "../types";
import { htmlFragmentToText } from "../utils/htmlToText";
import { sleep } from "../utils/sleep";
import { normalizeReadableText } from "../utils/text";
import { assertPublicTrustedVacancyUrl, isTrustedVacancyUrlShape, normalizeTrustedVacancyUrl } from "./trustedVacancyServices";

type FetchLike = typeof fetch;
type SafeUrlCheck = (urlValue: string) => Promise<string>;

export class ExternalVacancyEnrichmentError extends Error {
  constructor(
    message: string,
    readonly definitive: boolean
  ) {
    super(message);
    this.name = "ExternalVacancyEnrichmentError";
  }
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function collectJobPostingNodes(value: unknown): Array<Record<string, unknown>> {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(collectJobPostingNodes);
  const record = value as Record<string, unknown>;
  const types = Array.isArray(record["@type"]) ? record["@type"] : [record["@type"]];
  return [
    ...(types.some((type) => typeof type === "string" && type.toLowerCase() === "jobposting") ? [record] : []),
    ...collectJobPostingNodes(record["@graph"])
  ];
}

function jsonLdJobPosting(html: string): Record<string, unknown> | null {
  const $ = load(html);
  for (const element of $("script[type='application/ld+json']").toArray()) {
    try {
      const nodes = collectJobPostingNodes(JSON.parse($(element).text()));
      if (nodes[0]) return nodes[0];
    } catch {
      continue;
    }
  }
  return null;
}

function nestedName(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) {
    const names = value.map(nestedName).filter((item): item is string => Boolean(item));
    return names.length > 0 ? names.join(", ") : null;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return asString(record.name) ?? nestedName(record.address) ?? nestedName(record.addressCountry);
  }
  return null;
}

function buildText(values: {
  title: string | null;
  company: string | null;
  location: string | null;
  employment: string | null;
  remote?: boolean;
  description: string;
}): string {
  return normalizeReadableText([
    values.title,
    values.company ? `Company: ${values.company}` : null,
    values.location ? `Location: ${values.location}` : null,
    values.remote ? "Work mode: Remote" : null,
    values.employment ? `Employment: ${values.employment}` : null,
    "",
    values.description
  ].filter((value): value is string => value !== null).join("\n"));
}

function fromJsonLd(url: string, node: Record<string, unknown>): ExternalVacancyEnrichmentResult | null {
  const title = asString(node.title);
  const company = nestedName(node.hiringOrganization);
  const location = nestedName(node.applicantLocationRequirements) ?? nestedName(node.jobLocation);
  const employment = nestedName(node.employmentType);
  const description = htmlFragmentToText(asString(node.description) ?? "");
  if (!title || !description) return null;
  return {
    url,
    title,
    company,
    location,
    employment,
    parser: "json_ld",
    warnings: [],
    text: buildText({
      title,
      company,
      location,
      employment,
      remote: asString(node.jobLocationType)?.toUpperCase() === "TELECOMMUTE",
      description
    })
  };
}

function findMyRemoteFields(html: string): {
  company: string | null;
  location: string | null;
  employment: string | null;
} {
  const decoded = html.replace(/\\"/gu, "\"").replace(/\\\\n/gu, "\n");
  const company = decoded.match(/"companyName"\s*:\s*"([^"]+)"/u)?.[1] ?? null;
  const countries = decoded.match(/"countries"\s*:\s*\[([^\]]+)\]/u)?.[1]
    ?.match(/"([^"]+)"/gu)?.map((value) => value.replace(/"/gu, "").toUpperCase()) ?? [];
  const location = decoded.match(/"applicantLocationRequirements".{0,500}?"name"\s*:\s*"([^"]+)"/su)?.[1]
    ?? (countries.length > 0 ? countries.join(", ") : null);
  const employment = decoded.match(/"employmentType"\s*:\s*\[\s*"([^"]+)"/u)?.[1]
    ?? decoded.match(/"employmentTypes"\s*:\s*\[\s*"([^"]+)"/u)?.[1]
    ?? null;
  return { company, location, employment };
}

function explicitField(text: string, labels: string[]): string | null {
  const normalizedLabels = new Set(labels.map((label) => label.toLocaleLowerCase("ru-RU")));
  for (const line of normalizeReadableText(text).split("\n")) {
    const separatorIndex = line.search(/[:\-–—]/u);
    if (separatorIndex < 1) continue;
    const label = line.slice(0, separatorIndex).trim().toLocaleLowerCase("ru-RU");
    const value = line.slice(separatorIndex + 1).trim();
    if (normalizedLabels.has(label) && value) {
      return value;
    }
  }
  return null;
}

function longestTextFromSelectors(html: string, selectors: string[]): string {
  const $ = load(html);
  return selectors
    .flatMap((selector) => $(selector).toArray())
    .map((element) => {
      const content = $(element).clone();
      content.find("script, style, noscript, h1").remove();
      return htmlFragmentToText(content.html());
    })
    .sort((left, right) => right.length - left.length)[0] ?? "";
}

function isMissingPageContent(text: string): boolean {
  return /\b(?:404|page[_\s-]?not[_\s-]?found|publication not found|article not found|does not exist|no longer available)\b|страниц[аы]\s+(?:не\s+найден[аы]|не\s+существу(?:ет|ют))|публикаци[яи]\s+(?:не\s+найден[аы]|удален[аы]?)/iu.test(text);
}

function hasConfidentVacancyContent(title: string, description: string): boolean {
  const combined = `${title}\n${description}`;
  const strongSections = [
    /(?:^|\n)\s*(?:ваканси[яи]|vacancy|job opening|position)\s*[:\-–—]?/imu,
    /(?:^|\n)\s*(?:обязанности|задачи|responsibilities|requirements|требования|условия|what you will do|what we offer)\s*[:\-–—]?/imu,
    /(?:^|\n)\s*(?:зарплата|зп|salary|compensation|занятость|employment|job type|локация|location|формат работы|work mode)\s*[:\-–—]/imu,
    /\b(?:откликнуться|для отклика|apply now|apply for|send your cv|присылайте резюме)\b/iu
  ].filter((pattern) => pattern.test(combined)).length;
  const roleSignal = /\b(?:developer|engineer|designer|manager|analyst|architect|qa|tester|devops|recruiter|artist|sculptor|разработчик|инженер|дизайнер|менеджер|аналитик|архитектор|тестировщик|художник|скульптор)\b/iu.test(title);
  return description.length >= 180 && (strongSections >= 2 || (roleSignal && strongSections >= 1));
}

function fromTeletype(url: string, html: string): ExternalVacancyEnrichmentResult | null {
  const $ = load(html);
  const title = $("h1").first().text().trim() || $("meta[property='og:title']").attr("content")?.trim() || null;
  const description = longestTextFromSelectors(html, [
    "[data-testid='article-content']",
    ".article__content",
    ".article-content",
    "article",
    "main"
  ]);
  const pageText = normalizeReadableText(`${title ?? ""}\n${description}`);
  if (isMissingPageContent(pageText)) {
    throw new ExternalVacancyEnrichmentError("Teletype page does not exist or is no longer available.", true);
  }
  if (!title || !hasConfidentVacancyContent(title, description)) {
    return null;
  }
  const company = explicitField(description, ["компания", "company"]);
  const location = explicitField(description, ["локация", "локация работы", "location", "locations", "география"]);
  const employment = explicitField(description, ["занятость", "employment", "job type"]);
  return {
    url,
    title,
    company,
    location,
    employment,
    parser: "teletype",
    warnings: [],
    text: buildText({
      title,
      company,
      location,
      employment,
      remote: /\bremote\b|удал[её]н/iu.test(description),
      description
    })
  };
}

function fromTelegraph(url: string, html: string): ExternalVacancyEnrichmentResult | null {
  const $ = load(html);
  const title = $("article h1").first().text().trim()
    || $("h1").first().text().trim()
    || $("meta[property='og:title']").attr("content")?.trim()
    || null;
  const description = longestTextFromSelectors(html, [
    ".tl_article_content",
    "article",
    "main"
  ]);
  const pageText = normalizeReadableText(`${title ?? ""}\n${description}\n${$("body").text()}`);
  if (isMissingPageContent(pageText)) {
    throw new ExternalVacancyEnrichmentError("Telegraph page does not exist or is no longer available.", true);
  }
  if (!title || !hasConfidentVacancyContent(title, description)) {
    return null;
  }
  const company = explicitField(description, ["company"]);
  const location = explicitField(description, ["location", "locations", "geography", "work location"]);
  const employment = explicitField(description, ["employment", "job type"]);
  return {
    url,
    title,
    company,
    location,
    employment,
    parser: "telegraph",
    warnings: [],
    text: buildText({
      title,
      company,
      location,
      employment,
      remote: /\bremote\b|удал[её]н/iu.test(description),
      description
    })
  };
}

function htmlFieldValues(description: string, labels: {
  company: string[];
  location: string[];
  employment: string[];
}): { company: string | null; location: string | null; employment: string | null } {
  return {
    company: explicitField(description, labels.company),
    location: explicitField(description, labels.location),
    employment: explicitField(description, labels.employment)
  };
}

function htmlFallbackParser(service: TrustedVacancyServiceRecord): ExternalVacancyEnrichmentResult["parser"] {
  if (service.adapter === "findmyremote") return "findmyremote";
  if (service.adapter === "finder_work") return "finder_work";
  return "html_fallback";
}

function prefersJsonLdFirst(service: TrustedVacancyServiceRecord): boolean {
  return service.adapter === "finder_work"
    || service.adapter === "generic"
    || service.adapter === "aviasales_careers"
    || service.adapter === "cloud_careers"
    || service.adapter === "tbank_careers"
    || service.adapter === "yandex_jobs";
}

function fromHtml(url: string, html: string, service: TrustedVacancyServiceRecord): ExternalVacancyEnrichmentResult | null {
  if (service.adapter === "teletype") {
    return fromTeletype(url, html);
  }
  if (service.adapter === "telegraph") {
    return fromTelegraph(url, html);
  }
  const $ = load(html);
  const title = $("h1").first().text().trim() || $("meta[property='og:title']").attr("content")?.trim() || null;
  const content = ($("main").first().length ? $("main").first() : $("article").first()).clone();
  content.find("script, style, noscript, h1").remove();
  const description = htmlFragmentToText(content.html() ?? "");
  const specialized = service.adapter === "findmyremote"
    ? findMyRemoteFields(html)
    : service.adapter === "finder_work"
      ? htmlFieldValues(description, {
          company: ["company"],
          location: ["location", "locations", "geography", "work location"],
          employment: ["employment", "job type"]
        })
      : null;
  if (!title || description.length < 120 || !/\b(?:job|vacan|role|developer|engineer|manager|designer|работ|вакан)/iu.test(`${title}\n${description}`)) {
    return null;
  }
  return {
    url,
    title,
    company: specialized?.company ?? null,
    location: specialized?.location ?? null,
    employment: specialized?.employment ?? null,
    parser: htmlFallbackParser(service),
    warnings: [],
    text: buildText({
      title,
      company: specialized?.company ?? null,
      location: specialized?.location ?? null,
      employment: specialized?.employment ?? null,
      remote: /\bremote\b|удал[её]н/iu.test(description),
      description
    })
  };
}

export class ExternalVacancyEnricher {
  private readonly fetchImpl: FetchLike;
  private readonly assertSafeUrl: SafeUrlCheck;
  private lastRequestAt = 0;

  constructor(
    private readonly config: AppConfig,
    private readonly database: VacancyDatabase,
    options?: {
      fetchImpl?: FetchLike;
      assertSafeUrl?: SafeUrlCheck;
    }
  ) {
    this.fetchImpl = options?.fetchImpl ?? fetch;
    this.assertSafeUrl = options?.assertSafeUrl ?? assertPublicTrustedVacancyUrl;
  }

  async enrich(urlValue: string, allowExisting = false): Promise<ExternalVacancyEnrichmentResult | null> {
    const normalizedUrl = normalizeTrustedVacancyUrl(urlValue);
    if (!allowExisting && this.database.hasVacancyByCanonicalUrl(normalizedUrl)) return null;
    const hostname = new URL(normalizedUrl).hostname;
    const service = this.database.getActiveTrustedVacancyServiceByHostname(hostname);
    if (!service) return null;
    return this.fetchAndParse(normalizedUrl, service);
  }

  async probeService(service: TrustedVacancyServiceRecord): Promise<ExternalVacancyEnrichmentResult> {
    return this.fetchAndParse(service.exampleUrl, service);
  }

  private async fetchAndParse(urlValue: string, service: TrustedVacancyServiceRecord): Promise<ExternalVacancyEnrichmentResult> {
    try {
      if (!isTrustedVacancyUrlShape(service.adapter, urlValue)) {
        throw new ExternalVacancyEnrichmentError("Trusted vacancy URL shape is not supported for this service.", true);
      }
      const safeUrl = await this.assertSafeUrl(urlValue);
      if (new URL(safeUrl).hostname !== service.hostname) {
        throw new Error("Trusted vacancy URL hostname does not match the configured service.");
      }
      const waitMs = Math.max(0, this.config.companyCareersRequestDelayMs - (Date.now() - this.lastRequestAt));
      if (waitMs > 0) {
        await sleep(waitMs);
      }
      this.lastRequestAt = Date.now();
      const response = await this.fetchImpl(safeUrl, {
        redirect: "error",
        signal: AbortSignal.timeout(this.config.companyCareersRequestTimeoutMs),
        headers: {
          "user-agent": this.config.companyCareersUserAgent,
          accept: "text/html,application/xhtml+xml;q=0.9"
        }
      });
      if (response.status === 404 || response.status === 410) {
        throw new ExternalVacancyEnrichmentError(`Trusted vacancy page returned HTTP ${response.status}.`, true);
      }
      if (!response.ok) throw new Error(`Trusted vacancy service returned HTTP ${response.status}.`);
      const declaredLength = Number.parseInt(response.headers.get("content-length") ?? "0", 10);
      if (declaredLength > this.config.companyCareersMaxResponseBytes) throw new Error("Trusted vacancy response is too large.");
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > this.config.companyCareersMaxResponseBytes) throw new Error("Trusted vacancy response is too large.");
      const html = new TextDecoder().decode(buffer);
      const jobPosting = jsonLdJobPosting(html);
      const jsonLdResult = jobPosting ? fromJsonLd(safeUrl, jobPosting) : null;
      const htmlResult = () => fromHtml(safeUrl, html, service);
      const result = prefersJsonLdFirst(service)
        ? jsonLdResult ?? htmlResult()
        : htmlResult() ?? jsonLdResult;
      if (!result) {
        throw new ExternalVacancyEnrichmentError("Page does not contain a confident vacancy description.", true);
      }
      this.database.markTrustedVacancyServiceCheck(service.id, null);
      return result;
    } catch (error) {
      this.database.markTrustedVacancyServiceCheck(service.id, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }
}
