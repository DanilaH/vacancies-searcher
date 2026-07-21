import type { AnalyticsEventName } from "../types";

/**
 * Whitelist of analytics event names that count as user activity for retention.
 *
 * Only user-initiated actions are included. System/background events (polling,
 * delivery, notifications, digests, automated reminders) are excluded.
 *
 * Classification is based on producer audit: each event's .capture() call
 * site was checked to determine whether the trigger is a direct user action
 * (bot callback/command handler) or a system process (timer, scheduler, loop).
 *
 * --- Included (user-initiated, 27 events) ---
 *
 * bot_started                        — user started a chat with the bot
 * user_started                       — user began using the bot
 * onboarding_started                 — user started the onboarding flow
 * onboarding_skipped                 — user chose to skip onboarding
 * onboarding_completed               — user completed onboarding
 * manual_profile_setup_started       — user started manual profile setup
 * preset_selected                    — user chose a search preset
 * profile_block_updated              — user edited a profile block
 * profile_ready                      — user's profile is ready for matching
 * profile_created                    — user created a search profile
 * profile_renamed                    — user renamed a profile
 * profile_paused                     — user paused a profile
 * profile_deleted                    — user deleted a profile
 * weekly_feed_opened                 — user opened the weekly vacancy feed
 * vacancy_status_changed             — user changed a vacancy status (saved/applied/hidden)
 * vacancy_application_created        — user marked a vacancy as applied
 * vacancy_application_note_updated   — user updated an application note
 * vacancy_reminder_scheduled         — user explicitly set a reminder (reminder preset callback)
 * vacancy_application_followup_scheduled  — user explicitly scheduled a follow-up (follow-up preset callback)
 * vacancy_application_followup_cancelled  — user cancelled a follow-up (all 6 call sites are user-initiated: status clear, app clear, inbox toggle, skip, responded, closed)
 * vacancy_hidden_reason_set          — user selected a hidden-vacancy reason
 * vacancy_hidden_reason_skipped      — user skipped the hidden-reason prompt
 * vacancy_relevance_feedback         — user gave 👍/👎 relevance feedback
 * channel_added                      — owner/admin added a Telegram channel
 * user_added                         — owner added another user
 * user_role_changed                  — owner changed a user's role
 * user_access_changed                — owner changed a user's access
 *
 * --- Excluded (system/background, 14 events) ---
 *
 * vacancy_matched                    — automatic match by the matcher
 * vacancy_notified                   — automatic notification delivery
 * vacancy_reminder_cancelled         — mixed: 2 user-direct + 1 auto side-effect paths; cannot filter by event_name alone
 * vacancy_reminder_sent              — sent by VacancyReminderScheduler timer loop
 * vacancy_application_followup_sent  — sent by ApplicationFollowUpScheduler timer loop
 * daily_digest_sent                  — system sent the daily digest
 * daily_digest_skipped               — system skipped an empty digest
 * daily_digest_failed                — system failed to send a digest
 * vacancy_hidden_reason_prompt_shown — system auto-shows the prompt after hide (bot side-effect, not user action)
 * empty_cycle_notice_sent            — system sent an empty-cycle notice
 * poll_cycle_completed               — system completed a polling cycle
 * poll_cycle_failed                  — system polling cycle failed
 */
export const ACTIVITY_EVENT_NAMES: readonly AnalyticsEventName[] = Object.freeze([
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
]);
