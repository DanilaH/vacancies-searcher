import test from "node:test";
import assert from "node:assert/strict";

import { getSearchProfileHealth } from "../src/services/searchProfileHealth";
import { UserSearchProfile } from "../src/types";

function createProfile(overrides: Partial<UserSearchProfile> = {}): UserSearchProfile {
  return {
    userId: "u1",
    requiredContextKeywords: ["remote"],
    requiredPrimaryKeywords: ["react"],
    preferredKeywords: ["typescript"],
    excludeKeywords: ["php"],
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

test("search profile health is empty when all positive blocks are cleared", () => {
  const profile = createProfile({
    requiredContextKeywords: [],
    requiredPrimaryKeywords: [],
    preferredKeywords: [],
    excludeKeywords: ["php", "office"]
  });

  const health = getSearchProfileHealth(profile);

  assert.equal(health.status, "empty");
  assert.equal(health.isSearchActive, false);
  assert.deepEqual(health.missingRequiredSections, ["required_context", "required_primary"]);
});

test("search profile health is weak when one required block is missing", () => {
  const profile = createProfile({
    requiredContextKeywords: [],
    requiredPrimaryKeywords: ["backend"],
    preferredKeywords: ["python", "senior"]
  });

  const health = getSearchProfileHealth(profile);

  assert.equal(health.status, "weak");
  assert.equal(health.isSearchActive, true);
  assert.deepEqual(health.missingRequiredSections, ["required_context"]);
});

test("search profile health is ready when both required blocks are filled", () => {
  const profile = createProfile({
    requiredContextKeywords: ["remote", "europe"],
    requiredPrimaryKeywords: ["product manager"],
    preferredKeywords: []
  });

  const health = getSearchProfileHealth(profile);

  assert.equal(health.status, "ready");
  assert.equal(health.isSearchActive, true);
  assert.deepEqual(health.missingRequiredSections, []);
});
