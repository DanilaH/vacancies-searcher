import test from "node:test";
import assert from "node:assert/strict";

import {
  getSearchProfilePreset,
  listSearchProfilePresetGroups,
  listSearchProfilePresets
} from "../src/services/searchProfilePresets";

test("search profile presets expose expected ids and content", () => {
  const presets = listSearchProfilePresets();
  const frontend = getSearchProfilePreset("frontend");
  const backend = getSearchProfilePreset("backend");
  const threeDPrinting = getSearchProfilePreset("three_d_printing");
  const remoteNoExperience = getSearchProfilePreset("remote_no_experience");

  assert.equal(presets.length, 7);
  assert.ok(frontend);
  assert.ok(backend);
  assert.ok(threeDPrinting);
  assert.ok(remoteNoExperience);
  assert.ok(frontend.requiredPrimaryKeywords.includes("react"));
  assert.ok(frontend.requiredContextKeywords.includes("remote"));
  assert.ok(backend.requiredPrimaryKeywords.includes("backend"));
  assert.ok(threeDPrinting.requiredPrimaryKeywords.includes("3d printing"));
  assert.ok(threeDPrinting.requiredContextKeywords.includes("заказы"));
  assert.ok(threeDPrinting.preferredKeywords.includes("zbrush"));
  assert.ok(remoteNoExperience.requiredContextKeywords.includes("remote"));
  assert.ok(remoteNoExperience.requiredPrimaryKeywords.includes("опыт не обязателен"));
  assert.ok(remoteNoExperience.preferredKeywords.includes("оператор чата"));
});

test("search profile presets are grouped by user-facing categories", () => {
  const groups = listSearchProfilePresetGroups();
  const itGroup = groups.find((group) => group.id === "it");
  const creativeGroup = groups.find((group) => group.id === "creative");
  const productGroup = groups.find((group) => group.id === "product");
  const generalGroup = groups.find((group) => group.id === "general");

  assert.ok(generalGroup);
  assert.ok(itGroup);
  assert.ok(creativeGroup);
  assert.ok(productGroup);
  assert.deepEqual(generalGroup.presets.map((preset) => preset.id), ["remote_no_experience"]);
  assert.deepEqual(itGroup.presets.map((preset) => preset.id), ["frontend", "backend", "fullstack"]);
  assert.deepEqual(creativeGroup.presets.map((preset) => preset.id), ["design", "three_d_printing"]);
  assert.deepEqual(productGroup.presets.map((preset) => preset.id), ["product"]);
});
