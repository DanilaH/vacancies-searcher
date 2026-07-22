import dns from "node:dns/promises";
import net from "node:net";

import { RawVacancyItem, TrustedVacancyServiceAdapter } from "../types";

type TrustedServiceDetection = {
  hostname: string;
  displayName: string;
  adapter: TrustedVacancyServiceAdapter;
  exampleUrl: string;
};

const PATH_SCOPED_HOSTS = new Set([
  "www.aviasales.ru",
  "cloud.ru",
  "www.tbank.ru",
  "yandex.ru"
]);

const INGAMEJOB_SUPPORTED_LOCALES = new Set(["en", "pl", "uk", "ru"]);

const DESIGNER_RU_VACANCY_CATEGORIES = new Set(["t", "u", "r", "m"]);

const TELEGRAPH_RESERVED_SLUGS = new Set([
  "api",
  "edit",
  "upload",
  "create",
  "static"
]);

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map((part) => Number.parseInt(part, 10));
  const [first, second] = parts;
  return first === 0
    || first === 10
    || first === 127
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168);
}

function isPrivateIp(address: string): boolean {
  const normalized = address.toLowerCase();
  if (net.isIP(normalized) === 4) {
    return isPrivateIpv4(normalized);
  }
  if (net.isIP(normalized) === 6) {
    return normalized === "::1"
      || normalized.startsWith("fc")
      || normalized.startsWith("fd")
      || normalized.startsWith("fe80")
      || normalized === "::";
  }
  return true;
}

export function normalizeTrustedVacancyUrl(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== "https:") {
    throw new Error("Trusted vacancy service URL must use HTTPS.");
  }
  url.hostname = url.hostname.toLowerCase();
  url.hash = "";
  if (
    url.hostname === "localhost"
    || url.hostname.endsWith(".localhost")
    || url.hostname.endsWith(".local")
    || url.hostname.endsWith(".internal")
    || (net.isIP(url.hostname) > 0 && isPrivateIp(url.hostname))
  ) {
    throw new Error("Trusted vacancy service URL must use a public hostname.");
  }
  return url.toString();
}

export async function assertPublicTrustedVacancyUrl(value: string): Promise<string> {
  const normalized = normalizeTrustedVacancyUrl(value);
  const hostname = new URL(normalized).hostname;
  const addresses = await dns.lookup(hostname, { all: true });
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateIp(address))) {
    throw new Error("Trusted vacancy service hostname resolved to a non-public address.");
  }
  return normalized;
}

function titleFromHost(hostname: string): string {
  const displayName = hostname.replace(/^www\./u, "").split(".")[0] ?? hostname;
  return displayName.slice(0, 1).toUpperCase() + displayName.slice(1);
}

function knownHostDetection(hostname: string, exampleUrl: string): Omit<TrustedServiceDetection, "exampleUrl"> | null {
  if (hostname === "findmyremote.ai") {
    return { hostname, displayName: "Find My Remote", adapter: "findmyremote" };
  }
  if (hostname === "teletype.in") {
    return { hostname, displayName: "Teletype", adapter: "teletype" };
  }
  if (hostname === "finder.work") {
    return { hostname, displayName: "Finder Work", adapter: "finder_work" };
  }
  if (hostname === "telegra.ph") {
    return { hostname, displayName: "Telegraph", adapter: "telegraph" };
  }
  if (hostname === "ingamejob.com") {
    return { hostname, displayName: "InGame Job", adapter: "ingamejob" };
  }
  if (hostname === "designer.ru") {
    return { hostname, displayName: "Designer.ru", adapter: "designer_ru" };
  }
  if (hostname === "www.aviasales.ru" && isTrustedVacancyUrlShape("aviasales_careers", exampleUrl)) {
    return { hostname, displayName: "Aviasales", adapter: "aviasales_careers" };
  }
  if (hostname === "cloud.ru" && isTrustedVacancyUrlShape("cloud_careers", exampleUrl)) {
    return { hostname, displayName: "Cloud", adapter: "cloud_careers" };
  }
  if (hostname === "www.tbank.ru" && isTrustedVacancyUrlShape("tbank_careers", exampleUrl)) {
    return { hostname, displayName: "T-Bank", adapter: "tbank_careers" };
  }
  if (hostname === "yandex.ru" && isTrustedVacancyUrlShape("yandex_jobs", exampleUrl)) {
    return { hostname, displayName: "Yandex Jobs", adapter: "yandex_jobs" };
  }
  return null;
}

export function detectTrustedVacancyService(value: string): TrustedServiceDetection {
  const exampleUrl = normalizeTrustedVacancyUrl(value);
  const hostname = new URL(exampleUrl).hostname;
  const known = knownHostDetection(hostname, exampleUrl);
  if (known) {
    if (!isTrustedVacancyUrlShape(known.adapter, exampleUrl)) {
      throw new Error("Trusted vacancy service URL path is not supported for this adapter.");
    }
    return { ...known, exampleUrl };
  }

  if (PATH_SCOPED_HOSTS.has(hostname)) {
    throw new Error("Trusted vacancy service URL path is not supported for this hostname.");
  }

  return {
    hostname,
    displayName: titleFromHost(hostname),
    adapter: "generic",
    exampleUrl
  };
}

export function isTrustedVacancyUrlShape(adapter: TrustedVacancyServiceAdapter, value: string): boolean {
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase();
  const segments = url.pathname.split("/").filter(Boolean);

  switch (adapter) {
    case "findmyremote":
      return hostname === "findmyremote.ai";
    case "teletype":
      return hostname === "teletype.in" && segments.length === 2 && segments[0]?.startsWith("@") === true && segments[1]!.length >= 3;
    case "finder_work":
      return hostname === "finder.work" && segments.length === 2 && segments[0] === "vacancies" && segments[1]!.length > 0;
    case "telegraph": {
      const slug = segments[0]?.toLowerCase();
      return hostname === "telegra.ph"
        && segments.length === 1
        && Boolean(slug)
        && slug!.length >= 3
        && !TELEGRAPH_RESERVED_SLUGS.has(slug!);
    }
    case "aviasales_careers":
      return hostname === "www.aviasales.ru" && segments[0] === "about" && segments[1] === "vacancies" && segments.length >= 3;
    case "cloud_careers":
      return hostname === "cloud.ru" && segments[0] === "career" && segments[1] === "vacancies" && segments.length >= 3;
    case "tbank_careers": {
      const vacancyIndex = segments.indexOf("vacancy");
      return hostname === "www.tbank.ru" && segments[0] === "career" && vacancyIndex > 0 && vacancyIndex < segments.length - 1;
    }
    case "yandex_jobs":
      return hostname === "yandex.ru" && segments[0] === "jobs" && segments[1] === "vacancies" && segments.length >= 3;
    case "ingamejob":
      return hostname === "ingamejob.com" && segments.length === 3 && INGAMEJOB_SUPPORTED_LOCALES.has(segments[0]!) && segments[1] === "job" && segments[2]!.length >= 1;
    case "designer_ru":
      return hostname === "designer.ru" && segments.length === 2 && DESIGNER_RU_VACANCY_CATEGORIES.has(segments[0]!) && segments[1]!.length >= 1;
    case "generic":
      return true;
  }
}

export function extractTrustedVacancyUrlCandidates(item: Pick<RawVacancyItem, "text" | "linkEntities">): string[] {
  const rawUrls = [
    ...(item.linkEntities ?? []).map((link) => link.url),
    ...[...item.text.matchAll(/https:\/\/[^\s)<>]+/giu)].map((match) => match[0])
  ];
  const candidates = new Set<string>();
  for (const rawUrl of rawUrls) {
    try {
      candidates.add(normalizeTrustedVacancyUrl(rawUrl.replace(/[.,;:!?]+$/u, "")));
    } catch {
      continue;
    }
  }
  return [...candidates];
}
