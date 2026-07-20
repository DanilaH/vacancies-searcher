import test from "node:test";
import assert from "node:assert/strict";

import {
  nextHhEmployment,
  nextHhExperience,
  nextHhSchedule,
  validateHhPeriodInput,
  validateHhSalaryInput,
  validateHhTextInput
} from "../src/services/hhSearchValidation";

test("validateHhTextInput trims and rejects empty query", () => {
  assert.deepEqual(validateHhTextInput("  frontend   react  "), {
    ok: true,
    value: "frontend react"
  });
  assert.equal(validateHhTextInput("   ").ok, false);
});

test("validateHhSalaryInput accepts numbers and clear marker", () => {
  assert.deepEqual(validateHhSalaryInput("250000"), { ok: true, value: 250000 });
  assert.deepEqual(validateHhSalaryInput("-"), { ok: true, value: null });
  assert.equal(validateHhSalaryInput("many").ok, false);
});

test("validateHhPeriodInput accepts only 1-30 days", () => {
  assert.deepEqual(validateHhPeriodInput("7"), { ok: true, value: 7 });
  assert.equal(validateHhPeriodInput("0").ok, false);
  assert.equal(validateHhPeriodInput("31").ok, false);
});

test("hh enum cyclers follow UI order", () => {
  assert.equal(nextHhExperience("any"), "noExperience");
  assert.equal(nextHhSchedule("remote"), "any");
  assert.equal(nextHhEmployment("full"), "any");
});
