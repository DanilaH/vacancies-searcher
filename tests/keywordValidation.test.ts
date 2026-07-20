import test from "node:test";
import assert from "node:assert/strict";

import { KEYWORD_MAX_COUNT, KEYWORD_MAX_LENGTH, validateKeywordInput } from "../src/services/keywordValidation";

test("keyword validation trims and lowercases input", () => {
  const result = validateKeywordInput("  React Native  ", 0);

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value, "react native");
  }
});

test("keyword validation rejects empty input", () => {
  const result = validateKeywordInput("   ", 0);

  assert.equal(result.ok, false);
});

test("keyword validation rejects too many keywords", () => {
  const result = validateKeywordInput("react", KEYWORD_MAX_COUNT);

  assert.equal(result.ok, false);
});

test("keyword validation rejects too long values", () => {
  const result = validateKeywordInput("x".repeat(KEYWORD_MAX_LENGTH + 1), 0);

  assert.equal(result.ok, false);
});
