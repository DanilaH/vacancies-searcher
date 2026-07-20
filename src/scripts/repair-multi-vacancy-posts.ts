import { loadConfig } from "../config";
import { VacancyDatabase } from "../db/database";
import { ExternalVacancyEnricher, ExternalVacancyEnrichmentError } from "../services/externalVacancyEnricher";
import { extractContacts } from "../services/contactExtractor";
import { UserVacancyRematcher } from "../services/userVacancyRematcher";
import { VacancyFilter } from "../services/vacancyFilter";
import { parseTelegramWebPreviewPage } from "../sources/telegramWebPreviewSource";
import type { RawVacancyItem, VacancyRecord } from "../types";

const CHANNEL_PATTERN = /^[a-z0-9_]{5,32}$/u;

type RepairSummary = {
  candidates: number;
  splitPosts: number;
  childItems: number;
  insertedOrLinkedChildren: number;
  replacedAggregates: number;
  protectedAggregates: number;
  failedAggregates: number;
};

function parseArguments(argv: string[]): { days: number; apply: boolean } {
  const daysArgument = argv.find((argument) => argument.startsWith("--days="));
  const days = Number.parseInt(daysArgument?.slice("--days=".length) ?? "30", 10);
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    throw new Error("--days must be an integer between 1 and 365.");
  }
  return { days, apply: argv.includes("--apply") };
}

function looksLikeMultiVacancyAggregate(vacancy: VacancyRecord): boolean {
  if (vacancy.sourceName !== "telegram_web_preview" || !/^\d+$/u.test(vacancy.sourceMessageId)) {
    return false;
  }
  const structuredLines = vacancy.text.match(/^(?:posted|employment|locations?)\s*:/gimu)?.length ?? 0;
  const postedLines = vacancy.text.match(/^posted\s*:/gimu)?.length ?? 0;
  return postedLines >= 2 && structuredLines >= 4;
}

async function fetchAggregateChildren(config: ReturnType<typeof loadConfig>, vacancy: VacancyRecord): Promise<RawVacancyItem[]> {
  if (!CHANNEL_PATTERN.test(vacancy.sourceChannel)) {
    throw new Error(`Unsafe Telegram channel username: ${vacancy.sourceChannel}`);
  }
  const before = (BigInt(vacancy.sourceMessageId) + 1n).toString();
  const url = `https://t.me/s/${vacancy.sourceChannel}?before=${before}`;
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(config.webPreviewRequestTimeoutMs),
    headers: {
      "user-agent": "job-tg-bot/multi-vacancy-repair",
      accept: "text/html,application/xhtml+xml;q=0.9"
    }
  });
  if (!response.ok) {
    throw new Error(`Telegram preview returned HTTP ${response.status}.`);
  }
  const declaredLength = Number.parseInt(response.headers.get("content-length") ?? "0", 10);
  if (declaredLength > config.webPreviewMaxResponseBytes) {
    throw new Error("Telegram preview response is too large.");
  }
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > config.webPreviewMaxResponseBytes) {
    throw new Error("Telegram preview response is too large.");
  }
  return parseTelegramWebPreviewPage(vacancy.sourceChannel, new TextDecoder().decode(buffer)).items
    .filter((item) => item.cursorMessageId === vacancy.sourceMessageId && item.messageId !== vacancy.sourceMessageId);
}

async function enrichChild(enricher: ExternalVacancyEnricher, child: RawVacancyItem): Promise<RawVacancyItem | null> {
  if (!child.canonicalUrl) return child;
  try {
    const enrichment = await enricher.enrich(child.canonicalUrl);
    return enrichment ? { ...child, text: `${child.text}\n\nExternal vacancy details:\n${enrichment.text}` } : child;
  } catch (error) {
    if (error instanceof ExternalVacancyEnrichmentError && error.definitive) {
      return null;
    }
    return child;
  }
}

async function main(): Promise<void> {
  const { days, apply } = parseArguments(process.argv.slice(2));
  const config = loadConfig();
  const database = new VacancyDatabase(config);
  database.initialize();
  const filter = new VacancyFilter(config);
  const enricher = new ExternalVacancyEnricher(config, database);
  const candidates = database.listVacanciesSince(days).filter(looksLikeMultiVacancyAggregate);
  const summary: RepairSummary = {
    candidates: candidates.length,
    splitPosts: 0,
    childItems: 0,
    insertedOrLinkedChildren: 0,
    replacedAggregates: 0,
    protectedAggregates: 0,
    failedAggregates: 0
  };

  try {
    for (const vacancy of candidates) {
      if (!database.canReplaceVacancyAggregate(vacancy.id)) {
        summary.protectedAggregates += 1;
        continue;
      }
      try {
        const children = await fetchAggregateChildren(config, vacancy);
        if (children.length < 2) {
          summary.failedAggregates += 1;
          continue;
        }
        summary.splitPosts += 1;
        summary.childItems += children.length;
        if (!apply) continue;

        let processedChildren = 0;
        for (const rawChild of children) {
          const child = await enrichChild(enricher, rawChild);
          if (!child) {
            continue;
          }
          const result = database.recordMessage(
            child,
            filter.evaluateBaseCandidate(child.text),
            extractContacts(child.text)
          );
          if (
            result.kind === "new_vacancy"
            || result.kind === "duplicate_raw_message"
            || result.kind === "duplicate_fingerprint"
            || result.kind === "duplicate_canonical_url"
          ) {
            processedChildren += 1;
          }
        }
        summary.insertedOrLinkedChildren += processedChildren;
        if (processedChildren >= 2 && database.deleteVacancyAggregateIfUnmanaged(vacancy.id)) {
          summary.replacedAggregates += 1;
        } else {
          summary.failedAggregates += 1;
        }
      } catch (error) {
        summary.failedAggregates += 1;
        console.warn(`Skipped @${vacancy.sourceChannel}/${vacancy.sourceMessageId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (apply && summary.replacedAggregates > 0) {
      const rematcher = new UserVacancyRematcher(database, filter);
      for (const user of database.listActiveUsers()) {
        rematcher.rebuildForUser(user.userId, days);
      }
    }
  } finally {
    database.close();
  }

  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", days, ...summary }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
