import type { AnalyticsEventName } from "../types";

/**
 * Whitelist of analytics event names that count as user activity for retention.
 *
 * Only user-initiated actions are included. System/background events (polling,
 * scheduling, delivery, notifications, digests, reminders) are excluded.
 *
 * --- Included (user-initiated) ---
 *
 * bot_started              — user started a chat with the bot
 * user_started             — user began using the bot
 * onboarding_started       — user started the onboarding flow
 * onboarding_skipped       — user chose to skip onboarding
 * onboarding_completed     — user completed onboarding
 * manual_profile_setup_started — user started manual profile setup
 * preset_selected          — user chose a search preset
 * profile_block_updated    — user edited a profile block
 * profile_ready            — user's profile is ready for matching
 * profile_created          — user created a search profile
 * profile_renamed          — user renamed a profile
 * profile_paused           — user paused a profile
 * profile_deleted          — user deleted a profile
 * weekly_feed_opened       — user opened the weekly vacancy feed
 * vacancy_status_changed   — user changed a vacancy status (saved/applied/hidden)
 * vacancy_application_created — user marked a vacancy as applied
 * vacancy_application_note_updated — user updated an application note
 * vacancy_hidden_reason_set    — user selected a hidden-vacancy reason
 * vacancy_hidden_reason_skipped — user skipped the hidden-reason prompt
 * vacancy_relevance_feedback   — user gave 👍/👎 relevance feedback
 * channel_added            — owner/admin added a Telegram channel
 * user_added               — owner added another user
 * user_role_changed        — owner changed a user's role
 * user_access_changed      — owner changed a user's access
 *
 * --- Excluded (system/background) ---
 *
 * vacancy_matched                     — automatic match by the matcher
 * vacancy_notified                    — automatic notification delivery
 * vacancy_reminder_scheduled          — system scheduled a reminder
 * vacancy_reminder_cancelled          — system cancelled a reminder
 * vacancy_reminder_sent               — system sent a reminder
 * vacancy_application_followup_scheduled — system scheduled a follow-up
 * vacancy_application_followup_cancelled — system cancelled a follow-up
 * vacancy_application_followup_sent   — system sent a follow-up
 * daily_digest_sent                   — system sent the daily digest
 * daily_digest_skipped                — system skipped an empty digest
 * daily_digest_failed                 — system failed to send a digest
 * vacancy_hidden_reason_prompt_shown  — system showed the hidden-reason prompt
 * empty_cycle_notice_sent             — system sent an empty-cycle notice
 * poll_cycle_completed                — system completed a polling cycle
 * poll_cycle_failed                   — system polling cycle failed
 */
export const ACTIVITY_EVENT_NAMES: readonly AnalyticsEventName[] = [
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
  "vacancy_hidden_reason_set",
  "vacancy_hidden_reason_skipped",
  "vacancy_relevance_feedback",
  "channel_added",
  "user_added",
  "user_role_changed",
  "user_access_changed"
] as const;
