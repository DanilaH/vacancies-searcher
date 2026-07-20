import test from "node:test";
import assert from "node:assert/strict";

import { createFingerprint, normalizeForComparison, normalizeForFingerprint, normalizeReadableText, shorten } from "../src/utils/text";

test("normalizeForComparison lowercases text, normalizes yo and strips links/mentions", () => {
  const normalized = normalizeForComparison("Удалённо   React\nhttps://example.com  @frontend_jobs");

  assert.equal(normalized, "удаленно react");
});

test("normalizeReadableText keeps readable line breaks", () => {
  const normalized = normalizeReadableText("  Senior React Engineer \r\n\r\n  Remote-first  \n\n");

  assert.equal(normalized, "Senior React Engineer\n\nRemote-first");
});

test("shorten keeps emoji boundaries valid", () => {
  const shortened = shorten("Locations: 🇺🇸🇨🇦🇬🇧 Remote available", 16);
  const badCodeUnits: number[] = [];

  for (let index = 0; index < shortened.length; index += 1) {
    const code = shortened.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = shortened.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        badCodeUnits.push(index);
      }
      continue;
    }

    if (code >= 0xdc00 && code <= 0xdfff) {
      const previous = shortened.charCodeAt(index - 1);
      if (!(previous >= 0xd800 && previous <= 0xdbff)) {
        badCodeUnits.push(index);
      }
    }
  }

  assert.deepEqual(badCodeUnits, []);
  assert.match(shortened, /\.\.\.$/);
});

test("fingerprint normalization removes only trailing cross-post boilerplate", () => {
  const body = "Senior Frontend developer\nКомпания: СДЭК\nReact Native\nДля нас важно: опыт от 3 лет";
  const first = `${body}\n\nОткликнуться (https://example.com/job)\n\n| | ()\n\n@frontend_rabota`;
  const second = `${body}\n\nОткликнуться\n\nReact Jobв Telegram | в VK | в Max`;

  assert.equal(createFingerprint(first), createFingerprint(second));
  assert.equal(normalizeForFingerprint(first), normalizeForFingerprint(second));
  assert.match(normalizeForFingerprint(first), /для нас важно/u);
});

test("fingerprint normalization keeps meaningful differences in vacancy body", () => {
  const first = "Frontend Developer\nКомпания: Acme\nReact\nЗарплата: 200 000";
  const second = "Frontend Developer\nКомпания: Acme\nReact\nЗарплата: 300 000";

  assert.notEqual(createFingerprint(first), createFingerprint(second));
});
