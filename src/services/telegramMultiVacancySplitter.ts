import crypto from "node:crypto";

import { RawVacancyItem, TelegramPostLinkEntity, TelegramVacancySplitResult } from "../types";
import { normalizeForComparison, normalizeReadableText } from "../utils/text";

const STRUCTURED_FIELD_PATTERN =
  /^(?:🗓️?\s*)?posted\s*:|^(?:💼?\s*)?employment\s*:|^(?:📍?\s*)?locations?\s*:|^(?:💰?\s*)?(?:salary|compensation)\s*:/iu;
const MAX_CHILDREN = 20;

function normalizeExternalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname.toLowerCase() === "t.me") {
      return null;
    }
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function childId(parentMessageId: string, canonicalUrl: string): string {
  const hash = crypto.createHash("sha256").update(canonicalUrl).digest("hex").slice(0, 16);
  return `${parentMessageId}:child:${hash}`;
}

function blockIndexForLink(blocks: string[], link: TelegramPostLinkEntity, usedIndexes: Set<number>): number {
  const normalizedLabel = normalizeForComparison(link.text);
  return blocks.findIndex((block, index) => {
    if (usedIndexes.has(index)) {
      return false;
    }
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    if (lines.length < 2 || !normalizeForComparison(lines[0] ?? "").includes(normalizedLabel)) {
      return false;
    }
    return lines.slice(1).some((line) => STRUCTURED_FIELD_PATTERN.test(line));
  });
}

export function splitTelegramMultiVacancyPost(item: RawVacancyItem): TelegramVacancySplitResult {
  if (!item.linkEntities?.length || item.source !== "telegram_web_preview") {
    return { items: [item], split: false, reason: "No Telegram link entities." };
  }

  const blocks = normalizeReadableText(item.text).split(/\n\s*\n/u).map((block) => block.trim()).filter(Boolean);
  const seenUrls = new Set<string>();
  const usedBlockIndexes = new Set<number>();
  const children: RawVacancyItem[] = [];

  for (const link of [...item.linkEntities].sort((left, right) => left.position - right.position)) {
    const canonicalUrl = normalizeExternalUrl(link.url);
    if (!canonicalUrl || seenUrls.has(canonicalUrl)) {
      continue;
    }
    const blockIndex = blockIndexForLink(blocks, link, usedBlockIndexes);
    if (blockIndex < 0) {
      continue;
    }
    const block = blocks[blockIndex]!;
    seenUrls.add(canonicalUrl);
    usedBlockIndexes.add(blockIndex);
    children.push({
      ...item,
      messageId: childId(item.messageId, canonicalUrl),
      cursorMessageId: item.cursorMessageId ?? item.messageId,
      text: block,
      canonicalUrl,
      linkEntities: [link]
    });
  }

  if (children.length < 2 || children.length > MAX_CHILDREN) {
    return { items: [item], split: false, reason: "Not enough high-confidence vacancy blocks." };
  }

  return {
    items: children,
    split: true,
    reason: `Split into ${children.length} linked vacancy blocks.`
  };
}
