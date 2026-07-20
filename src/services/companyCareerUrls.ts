import net from "node:net";

import { CompanyCareerAdapter } from "../types";

export type DetectedCompanyCareerUrl = {
  adapter: CompanyCareerAdapter;
  companyName: string;
  normalizedStartUrl: string;
  externalId: string | null;
};

const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "yclid",
  "mc_cid",
  "mc_eid",
  "igshid"
]);

const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/giu;

function trimUrlPunctuation(value: string): string {
  return value.replace(/[.,;:!?]+$/u, "");
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return false;
  }

  const [first, second] = parts;
  return (
    first === 10 ||
    first === 127 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254) ||
    first === 0
  );
}

function isUnsafeHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal")
  ) {
    return true;
  }

  const ipVersion = net.isIP(normalized);
  if (ipVersion === 4) {
    return isPrivateIpv4(normalized);
  }
  if (ipVersion === 6) {
    return normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80");
  }

  return false;
}

function titleFromSlug(value: string): string {
  return value
    .split(/[-_]/u)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

export function normalizeCompanyCareerUrl(value: string): string | null {
  try {
    const url = new URL(trimUrlPunctuation(value.trim()));
    if (url.protocol !== "https:") {
      return null;
    }

    url.hostname = url.hostname.toLowerCase();
    url.hash = "";

    for (const key of [...url.searchParams.keys()]) {
      const normalizedKey = key.toLowerCase();
      if (normalizedKey.startsWith("utm_") || TRACKING_PARAMS.has(normalizedKey)) {
        url.searchParams.delete(key);
      }
    }

    if (url.pathname.length > 1) {
      url.pathname = url.pathname.replace(/\/+$/u, "");
    }

    return url.toString();
  } catch {
    return null;
  }
}

export function assertSafeCompanyCareerUrl(value: string): string {
  const normalized = normalizeCompanyCareerUrl(value);
  if (!normalized) {
    throw new Error("Company careers URL must be a valid HTTPS URL.");
  }

  const hostname = new URL(normalized).hostname;
  if (isUnsafeHostname(hostname)) {
    throw new Error("Company careers URL must point to a public hostname.");
  }

  return normalized;
}

export function detectCompanyCareerUrl(value: string): DetectedCompanyCareerUrl | null {
  const normalizedStartUrl = assertSafeCompanyCareerUrl(value);
  const url = new URL(normalizedStartUrl);
  const hostname = url.hostname.toLowerCase();
  const segments = url.pathname.split("/").filter(Boolean);

  if ((hostname === "aviasales.ru" || hostname === "www.aviasales.ru") && segments[0] === "about" && segments[1] === "vacancies") {
    return {
      adapter: "aviasales_html",
      companyName: "Aviasales",
      normalizedStartUrl,
      externalId: null
    };
  }

  if ((hostname === "boards.greenhouse.io" || hostname === "job-boards.greenhouse.io") && segments[0]) {
    return {
      adapter: "greenhouse_job_board",
      companyName: titleFromSlug(segments[0]),
      normalizedStartUrl,
      externalId: segments[0]
    };
  }

  if (hostname === "jobs.lever.co" && segments[0]) {
    return {
      adapter: "lever_postings",
      companyName: titleFromSlug(segments[0]),
      normalizedStartUrl,
      externalId: segments[0]
    };
  }

  if (hostname === "jobs.ashbyhq.com" && segments[0]) {
    return {
      adapter: "ashby_posting",
      companyName: titleFromSlug(segments[0]),
      normalizedStartUrl,
      externalId: segments[0]
    };
  }

  if (hostname === "jobs.smartrecruiters.com" && segments[0]) {
    return {
      adapter: "smartrecruiters_postings",
      companyName: titleFromSlug(segments[0]),
      normalizedStartUrl,
      externalId: segments[0]
    };
  }

  if (hostname === "api.smartrecruiters.com" && segments[0] === "v1" && segments[1] === "companies" && segments[2]) {
    return {
      adapter: "smartrecruiters_postings",
      companyName: titleFromSlug(segments[2]),
      normalizedStartUrl,
      externalId: segments[2]
    };
  }

  return {
    adapter: "generic_html",
    companyName: titleFromSlug(hostname.replace(/^www\./u, "").split(".")[0] ?? "Company"),
    normalizedStartUrl,
    externalId: null
  };
}

export function extractSupportedCompanyCareerUrl(text: string): string | null {
  const urls = text.match(URL_PATTERN) ?? [];
  for (const candidate of urls) {
    try {
      const detected = detectCompanyCareerUrl(candidate);
      if (detected && detected.adapter !== "generic_html") {
        return detected.normalizedStartUrl;
      }
    } catch {
      continue;
    }
  }

  return null;
}
