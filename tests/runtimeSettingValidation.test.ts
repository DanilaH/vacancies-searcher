import test from "node:test";
import assert from "node:assert/strict";

import { validateRuntimeSettingInput } from "../src/services/runtimeSettingValidation";

test("runtime setting validation rejects empty input", () => {
  const result = validateRuntimeSettingInput("CHECK_INTERVAL_SECONDS", "   ");
  assert.equal(result.ok, false);
});

test("runtime setting validation rejects negative numbers and floats", () => {
  assert.equal(validateRuntimeSettingInput("CHECK_INTERVAL_SECONDS", "-10").ok, false);
  assert.equal(validateRuntimeSettingInput("CHECK_INTERVAL_SECONDS", "12.5").ok, false);
});

test("runtime setting validation rejects huge or out-of-range values", () => {
  assert.equal(validateRuntimeSettingInput("CHECK_INTERVAL_SECONDS", "999999999999999999").ok, false);
  assert.equal(validateRuntimeSettingInput("CHECK_INTERVAL_SECONDS", "9").ok, false);
  assert.equal(validateRuntimeSettingInput("WEB_PREVIEW_RETRY_COUNT", "6").ok, false);
});

test("runtime setting validation accepts a sane integer", () => {
  const result = validateRuntimeSettingInput("CHECK_INTERVAL_SECONDS", "120");

  assert.deepEqual(result, {
    ok: true,
    value: 120
  });
});
