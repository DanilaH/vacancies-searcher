import test from "node:test";
import assert from "node:assert/strict";

import { ACTIVITY_EVENT_NAMES } from "../src/services/activityWhitelist";

test("all whitelisted event names are valid non-empty strings", () => {
  for (const name of ACTIVITY_EVENT_NAMES) {
    assert.ok(typeof name === "string" && name.length > 0, `Invalid event name: ${name}`);
  }
});

test("background/system events are not whitelisted", () => {
  const backgroundEvents = [
    "vacancy_matched",
    "vacancy_notified",
    "vacancy_reminder_cancelled",
    "vacancy_reminder_sent",
    "vacancy_application_followup_sent",
    "daily_digest_sent",
    "daily_digest_skipped",
    "daily_digest_failed",
    "vacancy_hidden_reason_prompt_shown",
    "empty_cycle_notice_sent",
    "poll_cycle_completed",
    "poll_cycle_failed"
  ];
  for (const eventName of backgroundEvents) {
    assert.equal(ACTIVITY_EVENT_NAMES.includes(eventName as never), false,
      `Background event "${eventName}" must not be in ACTIVITY_EVENT_NAMES`);
  }
});

test("user-initiated events are whitelisted", () => {
  const userEvents = [
    "bot_started",
    "user_started",
    "onboarding_started",
    "onboarding_skipped",
    "onboarding_completed",
    "manual_profile_setup_started",
    "preset_selected",
    "profile_block_updated",
    "profile_ready",
    "profile_created",
    "profile_renamed",
    "profile_paused",
    "profile_deleted",
    "weekly_feed_opened",
    "vacancy_status_changed",
    "vacancy_application_created",
    "vacancy_application_note_updated",
    "vacancy_reminder_scheduled",
    "vacancy_application_followup_scheduled",
    "vacancy_application_followup_cancelled",
    "vacancy_hidden_reason_set",
    "vacancy_hidden_reason_skipped",
    "vacancy_relevance_feedback",
    "channel_added",
    "user_added",
    "user_role_changed",
    "user_access_changed"
  ];
  for (const eventName of userEvents) {
    assert.ok(ACTIVITY_EVENT_NAMES.includes(eventName as never),
      `User event "${eventName}" must be in ACTIVITY_EVENT_NAMES`);
  }
});

test("ACTIVITY_EVENT_NAMES has no duplicates", () => {
  assert.equal(new Set(ACTIVITY_EVENT_NAMES).size, ACTIVITY_EVENT_NAMES.length);
});

test("ACTIVITY_EVENT_NAMES contains exactly 27 events", () => {
  assert.equal(ACTIVITY_EVENT_NAMES.length, 27);
});
