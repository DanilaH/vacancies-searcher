import test from "node:test";
import assert from "node:assert/strict";

import {
  canSkipOnboardingStep,
  nextOnboardingStep,
  onboardingStepToSection
} from "../src/bot/onboardingFlow";

test("onboarding helper order keeps intro to manual and language flow", () => {
  assert.equal(nextOnboardingStep("intro"), "welcome");
  assert.equal(nextOnboardingStep("welcome"), "preset");
  assert.equal(nextOnboardingStep("preset"), "language");
  assert.equal(nextOnboardingStep("manual_required_context"), "manual_required_primary");
  assert.equal(nextOnboardingStep("manual_required_primary"), "manual_preferred");
  assert.equal(nextOnboardingStep("manual_preferred"), "manual_exclude");
  assert.equal(nextOnboardingStep("manual_exclude"), "language");
  assert.equal(nextOnboardingStep("language"), null);
});

test("required onboarding steps are not skippable while optional steps are", () => {
  assert.equal(canSkipOnboardingStep("manual_required_context"), false);
  assert.equal(canSkipOnboardingStep("manual_required_primary"), false);
  assert.equal(canSkipOnboardingStep("manual_preferred"), true);
  assert.equal(canSkipOnboardingStep("manual_exclude"), true);
});

test("manual onboarding steps map to search profile sections", () => {
  assert.equal(onboardingStepToSection("manual_required_context"), "required_context");
  assert.equal(onboardingStepToSection("manual_required_primary"), "required_primary");
  assert.equal(onboardingStepToSection("manual_preferred"), "preferred");
  assert.equal(onboardingStepToSection("manual_exclude"), "exclude");
  assert.equal(onboardingStepToSection("intro"), null);
  assert.equal(onboardingStepToSection("language"), null);
});
