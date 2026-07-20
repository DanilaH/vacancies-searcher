import { load } from "cheerio";

import { normalizeReadableText } from "./text";

const BLOCK_TAGS = new Set(["div", "p", "section", "article", "blockquote", "li", "ul", "ol", "pre"]);

type HtmlNode = {
  type?: string;
  data?: string;
  tagName?: string;
  attribs?: Record<string, string>;
  children?: HtmlNode[];
};

function isTextNode(node: HtmlNode): boolean {
  return node.type === "text";
}

function isElementNode(node: HtmlNode): boolean {
  return node.type === "tag";
}

function renderNode(node: HtmlNode): string {
  if (isTextNode(node)) {
    if (!/\S/.test(node.data ?? "")) {
      return "";
    }

    return (node.data ?? "").replace(/\s+/g, " ");
  }

  if (!isElementNode(node)) {
    return "";
  }

  const tagName = node.tagName?.toLowerCase() ?? "";
  if (tagName === "br") {
    return "\n";
  }

  const childrenText = (node.children ?? []).map((child) => renderNode(child)).join("");

  if (tagName === "a") {
    const href = node.attribs?.href?.trim();
    const visibleText = childrenText.trim();

    if (!visibleText && href && /^https?:\/\/\S+$/i.test(href)) {
      return href;
    }

    return childrenText;
  }

  if (BLOCK_TAGS.has(tagName)) {
    return `${childrenText}\n`;
  }

  return childrenText;
}

export function htmlFragmentToText(html: string | null | undefined): string {
  if (!html?.trim()) {
    return "";
  }

  const $ = load(`<div id="root">${html}</div>`);
  const root = $("#root").get(0);
  if (!root) {
    return "";
  }

  const text = ((root.children ?? []) as HtmlNode[]).map((child) => renderNode(child)).join("");
  return normalizeReadableText(text);
}
