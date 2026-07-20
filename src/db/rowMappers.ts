import {
  AnalyticsEventRecord,
  AnalyticsProperties,
  BotUser,
  BotUserRole,
  ChannelDiscoveryCandidate,
  ChannelDiscoveryEvidence,
  ChannelDiscoveryProfileId,
  ChannelDiscoveryRun,
  ChannelDiscoveryRunStatus,
  ChannelDiscoverySource,
  CompanyCareerAdapter,
  CompanyCareerSourceRecord,
  DailyDigestDeliveryRecord,
  FilterSuggestionKey,
  FilterSuggestionStatus,
  ExtractedContact,
  HhEmployment,
  HhExperience,
  HhSchedule,
  HiddenVacancyReason,
  HhSearchSettings,
  KeywordKind,
  MatchedVacancyRecord,
  MonitoredChannel,
  OnboardingStep,
  RuntimeSettingKey,
  SourceName,
  TrustedVacancyServiceAdapter,
  TrustedVacancyServiceParserMode,
  TrustedVacancyServiceRecord,
  TrustedVacancyServiceStatus,
  UserKeyword,
  UserFilterSuggestionRecord,
  UserVacancyApplicationRecord,
  UserVacancyHiddenReasonRecord,
  UserSearchProfileRecord,
  UserSettings,
  UserStatusVacancyRecord,
  VacancyApplicationFollowUpRecord,
  VacancyApplicationRecord,
  VacancyDuplicatePost,
  VacancyLanguageMode,
  VacancyReminderRecord,
  VacancyRecord,
  VacancyUserStatus
} from "../types";

export type BotUserRow = {
  user_id: string;
  role: BotUserRole;
  is_active: number;
  username: string | null;
  display_name: string | null;
  added_by_user_id: string | null;
  created_at: string;
  updated_at: string;
};

export type UserSettingsRow = {
  user_id: string;
  ai_enabled: number;
  filter_mode: "keywords" | "hybrid" | "ai";
  bot_paused: number;
  notify_on_empty_cycle: number;
  daily_digest_enabled: number;
  daily_digest_time_minutes: number | null;
  weekly_page_size: number | null;
  vacancy_language_mode: VacancyLanguageMode;
  onboarding_completed: number;
  onboarding_step: OnboardingStep | null;
  pending_input_action: UserSettings["pendingInputAction"];
  pending_input_payload: string | null;
  updated_at: string;
};

export type UserKeywordRow = {
  id: number;
  user_id: string;
  kind: KeywordKind;
  keyword: string;
  created_at: string;
  updated_at: string;
};

export type HhSearchSettingsRow = {
  user_id: string;
  enabled: number;
  text: string;
  area_id: string;
  experience: HhExperience;
  schedule: HhSchedule;
  employment: HhEmployment;
  salary_from: number | null;
  period_days: number;
  updated_at: string;
};

export type MonitoredChannelRow = {
  id: number;
  username: string;
  source_name: SourceName;
  is_active: number;
  initial_backfill_completed: number;
  last_seen_message_id: string | null;
  idle_poll_streak: number;
  next_poll_after: string | null;
  last_checked_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  added_by_user_id: string | null;
  created_at: string;
  updated_at: string;
};

export type VacancyRow = {
  id: number;
  source_name: SourceName;
  source_channel: string;
  source_message_id: string;
  message_date: string;
  title: string;
  text: string;
  normalized_text: string;
  url: string;
  canonical_url: string | null;
  fingerprint: string;
  score: number;
  match_summary: string;
  matched_keywords_json: string;
  contacts_json: string;
  sent_to_owner_at: string | null;
  created_at: string;
};

export type RawMessageDuplicateRow = {
  source_name: SourceName;
  source_channel: string;
  source_message_id: string;
  message_date: string;
  url: string;
};

export type CompanyCareerSourceRow = {
  id: number;
  company_name: string;
  adapter: CompanyCareerAdapter;
  start_url: string;
  is_active: number;
  poll_interval_seconds: number;
  next_poll_after: string | null;
  last_checked_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  added_by_user_id: string | null;
  created_at: string;
  updated_at: string;
};

export type TrustedVacancyServiceRow = {
  id: number;
  hostname: string;
  display_name: string;
  adapter: TrustedVacancyServiceAdapter;
  status: TrustedVacancyServiceStatus;
  parser_mode: TrustedVacancyServiceParserMode;
  example_url: string;
  last_checked_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  added_by_user_id: string | null;
  approved_by_user_id: string | null;
  created_at: string;
  updated_at: string;
};

export type ChannelDiscoveryRunRow = {
  id: number;
  status: ChannelDiscoveryRunStatus;
  started_by_user_id: string | null;
  profile_id: ChannelDiscoveryProfileId;
  profile_label: string;
  custom_query: string | null;
  seed_queries_json: string;
  providers_json: string;
  provider_warnings_json: string;
  total_candidates_found: number;
  candidates_to_check: number;
  candidates_checked: number;
  candidates_recommended: number;
  candidates_filtered: number;
  error: string | null;
  started_at: string;
  completed_at: string | null;
};

export type ChannelDiscoveryCandidateRow = {
  id: number;
  run_id: number;
  username: string;
  title: string | null;
  status: ChannelDiscoveryCandidate["status"];
  score: number;
  sources_json: string;
  probe_url: string | null;
  sample_posts_count: number;
  primary_signal_posts_count: number;
  format_signal_posts_count: number;
  hiring_posts_count: number;
  vacancy_like_posts_count: number;
  resume_posts_count: number;
  resume_rate: number;
  reasons_json: string;
  evidence_json: string;
  created_at: string;
  updated_at: string;
};

export type MatchedVacancyRow = VacancyRow & {
  user_id: string;
  delivered_at: string | null;
  matched_at: string;
  user_score: number;
  user_match_summary: string;
  user_matched_keywords_json: string;
  user_status: VacancyUserStatus;
  status_updated_at: string | null;
  matched_profile_ids_json?: string;
  matched_profile_names_json?: string;
  hidden_reason?: HiddenVacancyReason | null;
};

export type UserVacancyStateRow = VacancyRow & {
  user_id: string;
  user_status: Exclude<VacancyUserStatus, "inbox">;
  status_updated_at: string;
  matched_at: string | null;
  matched_profile_ids_json?: string;
  matched_profile_names_json?: string;
  hidden_reason?: HiddenVacancyReason | null;
};

export type UserVacancyHiddenReasonRow = {
  user_id: string;
  vacancy_id: number;
  reason: HiddenVacancyReason;
  created_at: string;
  updated_at: string;
};

export type UserFilterSuggestionRow = {
  user_id: string;
  suggestion_key: FilterSuggestionKey;
  status: FilterSuggestionStatus;
  shown_at: string;
  acted_at: string | null;
  dismissed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type VacancyReminderRow = VacancyRow & {
  user_id: string;
  remind_at: string;
  next_attempt_at: string;
  attempt_count: number;
  delivered_at: string | null;
  cancelled_at: string | null;
  last_error: string | null;
  reminder_created_at: string;
  reminder_updated_at: string;
};

export type VacancyApplicationRow = {
  user_id: string;
  vacancy_id: number;
  applied_at: string;
  note: string | null;
  follow_up_at: string | null;
  next_attempt_at: string | null;
  attempt_count: number;
  delivered_at: string | null;
  cancelled_at: string | null;
  last_error: string | null;
  responded_at: string | null;
  closed_at: string | null;
  application_created_at: string;
  application_updated_at: string;
};

export type VacancyApplicationFollowUpRow = VacancyRow & VacancyApplicationRow;

export type UserVacancyApplicationRow = VacancyRow & VacancyApplicationRow & {
  user_status: "applied";
  status_updated_at: string;
  matched_at: string | null;
  matched_profile_ids_json?: string;
  matched_profile_names_json?: string;
};

export type UserSearchProfileRow = {
  id: number;
  user_id: string;
  name: string;
  normalized_name: string;
  is_active: number;
  vacancy_language_mode: VacancyLanguageMode;
  required_context_keywords_json: string;
  required_primary_keywords_json: string;
  preferred_keywords_json: string;
  exclude_keywords_json: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type AppSettingRowInternal = {
  key: RuntimeSettingKey;
  value: string;
  updated_at: string;
  updated_by_user_id: string | null;
};

export type AnalyticsEventRow = {
  id: number;
  event_name: AnalyticsEventRecord["eventName"];
  distinct_id: string;
  user_id: string | null;
  properties_json: string;
  occurred_at: string;
  created_at: string;
};

export type ChannelAlertStateRow = {
  channel_id: number;
  failure_signature: string | null;
  failure_alerted_at: string | null;
  stale_reference: string | null;
  stale_alerted_at: string | null;
  updated_at: string;
};

export type CountRow = {
  count: number;
};

export type DailyDigestDeliveryRow = {
  user_id: string;
  digest_date: string;
  scheduled_for: string;
  next_attempt_at: string | null;
  attempt_count: number;
  delivered_at: string | null;
  skipped_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

function parseJsonStringArray(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function parseJsonNumberArray(value: string | null | undefined): number[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is number => Number.isInteger(item)) : [];
  } catch {
    return [];
  }
}

function parseJsonContacts(value: string | null | undefined): ExtractedContact[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((item): item is ExtractedContact => {
      if (!item || typeof item !== "object") {
        return false;
      }

      const candidate = item as Partial<ExtractedContact>;
      return (
        (candidate.type === "telegram" || candidate.type === "email" || candidate.type === "url") &&
        typeof candidate.value === "string"
      );
    });
  } catch {
    return [];
  }
}

function parseJsonChannelDiscoverySources(value: string | null | undefined): ChannelDiscoverySource[] {
  return parseJsonStringArray(value).filter((item): item is ChannelDiscoverySource =>
    item === "mtproto_search" ||
    item === "mtproto_recommendation" ||
    item === "raw_message_link" ||
    item === "mention_graph_link" ||
    item === "mention_graph_username" ||
    item === "manual_seed" ||
    item === "duckduckgo_search"
  );
}

function parseJsonChannelDiscoveryEvidence(value: string | null | undefined): ChannelDiscoveryEvidence[] {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is ChannelDiscoveryEvidence => {
      if (!item || typeof item !== "object") {
        return false;
      }
      const evidence = item as Partial<ChannelDiscoveryEvidence>;
      return (
        typeof evidence.url === "string" &&
        (evidence.messageDate === null || typeof evidence.messageDate === "string") &&
        typeof evidence.excerpt === "string" &&
        Array.isArray(evidence.matchedSignals) &&
        evidence.matchedSignals.every((signal) => typeof signal === "string")
      );
    });
  } catch {
    return [];
  }
}

function parseJsonObject(value: string | null | undefined): AnalyticsProperties {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return parsed as AnalyticsProperties;
  } catch {
    return {};
  }
}

export function mapVacancy(row: VacancyRow): VacancyRecord {
  return {
    id: row.id,
    sourceName: row.source_name,
    sourceChannel: row.source_channel,
    sourceMessageId: row.source_message_id,
    messageDate: row.message_date,
    title: row.title,
    text: row.text,
    normalizedText: row.normalized_text,
    url: row.url,
    canonicalUrl: row.canonical_url,
    fingerprint: row.fingerprint,
    score: row.score,
    matchSummary: row.match_summary,
    matchedKeywords: parseJsonStringArray(row.matched_keywords_json),
    contacts: parseJsonContacts(row.contacts_json),
    sentToOwnerAt: row.sent_to_owner_at,
    createdAt: row.created_at
  };
}

export function mapVacancyDuplicatePost(row: RawMessageDuplicateRow): VacancyDuplicatePost {
  return {
    sourceName: row.source_name,
    sourceChannel: row.source_channel,
    sourceMessageId: row.source_message_id,
    messageDate: row.message_date,
    url: row.url
  };
}

export function mapCompanyCareerSource(row: CompanyCareerSourceRow): CompanyCareerSourceRecord {
  return {
    id: row.id,
    companyName: row.company_name,
    adapter: row.adapter,
    startUrl: row.start_url,
    isActive: Boolean(row.is_active),
    pollIntervalSeconds: row.poll_interval_seconds,
    nextPollAfter: row.next_poll_after,
    lastCheckedAt: row.last_checked_at,
    lastSuccessAt: row.last_success_at,
    lastError: row.last_error,
    addedByUserId: row.added_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function mapTrustedVacancyService(row: TrustedVacancyServiceRow): TrustedVacancyServiceRecord {
  return {
    id: row.id,
    hostname: row.hostname,
    displayName: row.display_name,
    adapter: row.adapter,
    status: row.status,
    parserMode: row.parser_mode,
    exampleUrl: row.example_url,
    lastCheckedAt: row.last_checked_at,
    lastSuccessAt: row.last_success_at,
    lastError: row.last_error,
    addedByUserId: row.added_by_user_id,
    approvedByUserId: row.approved_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function mapChannelDiscoveryRun(row: ChannelDiscoveryRunRow): ChannelDiscoveryRun {
  return {
    id: row.id,
    status: row.status,
    startedByUserId: row.started_by_user_id,
    profileId: row.profile_id,
    profileLabel: row.profile_label,
    customQuery: row.custom_query,
    seedQueries: parseJsonStringArray(row.seed_queries_json),
    providers: parseJsonStringArray(row.providers_json),
    providerWarnings: parseJsonStringArray(row.provider_warnings_json),
    totalCandidatesFound: row.total_candidates_found,
    candidatesToCheck: row.candidates_to_check,
    candidatesChecked: row.candidates_checked,
    candidatesRecommended: row.candidates_recommended,
    candidatesFiltered: row.candidates_filtered,
    error: row.error,
    startedAt: row.started_at,
    completedAt: row.completed_at
  };
}

export function mapChannelDiscoveryCandidate(row: ChannelDiscoveryCandidateRow): ChannelDiscoveryCandidate {
  return {
    id: row.id,
    runId: row.run_id,
    username: row.username,
    title: row.title,
    status: row.status,
    score: row.score,
    sources: parseJsonChannelDiscoverySources(row.sources_json),
    probeUrl: row.probe_url,
    stats: {
      samplePosts: row.sample_posts_count,
      primarySignalPosts: row.primary_signal_posts_count,
      formatSignalPosts: row.format_signal_posts_count,
      hiringPosts: row.hiring_posts_count,
      vacancyLikePosts: row.vacancy_like_posts_count,
      resumePosts: row.resume_posts_count,
      resumeRate: row.resume_rate
    },
    reasons: parseJsonStringArray(row.reasons_json),
    evidence: parseJsonChannelDiscoveryEvidence(row.evidence_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function mapMatchedVacancy(row: MatchedVacancyRow): MatchedVacancyRecord {
  const base = mapVacancy(row);
  return {
    ...base,
    userId: row.user_id,
    deliveredAt: row.delivered_at,
    matchedAt: row.matched_at,
    userStatus: row.user_status,
    statusUpdatedAt: row.status_updated_at,
    matchedProfileIds: parseJsonNumberArray(row.matched_profile_ids_json),
    matchedProfileNames: parseJsonStringArray(row.matched_profile_names_json),
    hiddenReason: row.hidden_reason ?? null,
    score: row.user_score,
    matchSummary: row.user_match_summary,
    matchedKeywords: parseJsonStringArray(row.user_matched_keywords_json)
  };
}

export function mapUserStatusVacancy(row: UserVacancyStateRow): UserStatusVacancyRecord {
  const base = mapVacancy(row);
  return {
    ...base,
    userId: row.user_id,
    userStatus: row.user_status,
    statusUpdatedAt: row.status_updated_at,
    isCurrentlyMatched: row.matched_at !== null,
    matchedAt: row.matched_at,
    matchedProfileIds: parseJsonNumberArray(row.matched_profile_ids_json),
    matchedProfileNames: parseJsonStringArray(row.matched_profile_names_json),
    hiddenReason: row.hidden_reason ?? null
  };
}

export function mapUserVacancyHiddenReason(row: UserVacancyHiddenReasonRow): UserVacancyHiddenReasonRecord {
  return {
    userId: row.user_id,
    vacancyId: row.vacancy_id,
    reason: row.reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function mapUserFilterSuggestion(row: UserFilterSuggestionRow): UserFilterSuggestionRecord {
  return {
    userId: row.user_id,
    suggestionKey: row.suggestion_key,
    status: row.status,
    shownAt: row.shown_at,
    actedAt: row.acted_at,
    dismissedAt: row.dismissed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function mapVacancyReminder(row: VacancyReminderRow): VacancyReminderRecord {
  return {
    ...mapVacancy(row),
    userId: row.user_id,
    remindAt: row.remind_at,
    nextAttemptAt: row.next_attempt_at,
    attemptCount: row.attempt_count,
    deliveredAt: row.delivered_at,
    cancelledAt: row.cancelled_at,
    lastError: row.last_error,
    reminderCreatedAt: row.reminder_created_at,
    reminderUpdatedAt: row.reminder_updated_at
  };
}

export function mapVacancyApplication(row: VacancyApplicationRow): VacancyApplicationRecord {
  return {
    userId: row.user_id,
    vacancyId: row.vacancy_id,
    appliedAt: row.applied_at,
    note: row.note,
    followUpAt: row.follow_up_at,
    nextAttemptAt: row.next_attempt_at,
    attemptCount: row.attempt_count,
    deliveredAt: row.delivered_at,
    cancelledAt: row.cancelled_at,
    lastError: row.last_error,
    respondedAt: row.responded_at,
    closedAt: row.closed_at,
    applicationCreatedAt: row.application_created_at,
    applicationUpdatedAt: row.application_updated_at
  };
}

export function mapVacancyApplicationFollowUp(row: VacancyApplicationFollowUpRow): VacancyApplicationFollowUpRecord {
  return {
    ...mapVacancy(row),
    userId: row.user_id,
    appliedAt: row.applied_at,
    note: row.note,
    followUpAt: row.follow_up_at ?? row.next_attempt_at ?? row.applied_at,
    nextAttemptAt: row.next_attempt_at ?? row.follow_up_at ?? row.applied_at,
    attemptCount: row.attempt_count,
    deliveredAt: row.delivered_at,
    cancelledAt: row.cancelled_at,
    lastError: row.last_error,
    respondedAt: row.responded_at,
    closedAt: row.closed_at,
    applicationCreatedAt: row.application_created_at,
    applicationUpdatedAt: row.application_updated_at
  };
}

export function mapUserVacancyApplication(row: UserVacancyApplicationRow): UserVacancyApplicationRecord {
  return {
    ...mapVacancy(row),
    userId: row.user_id,
    userStatus: "applied",
    statusUpdatedAt: row.status_updated_at,
    isCurrentlyMatched: row.matched_at !== null,
    matchedAt: row.matched_at,
    matchedProfileIds: parseJsonNumberArray(row.matched_profile_ids_json),
    matchedProfileNames: parseJsonStringArray(row.matched_profile_names_json),
    application: mapVacancyApplication(row)
  };
}

export function mapBotUser(row: BotUserRow): BotUser {
  return {
    userId: row.user_id,
    role: row.role,
    isActive: Boolean(row.is_active),
    username: row.username,
    displayName: row.display_name,
    addedByUserId: row.added_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function mapUserSettings(row: UserSettingsRow): UserSettings {
  return {
    userId: row.user_id,
    aiEnabled: Boolean(row.ai_enabled),
    filterMode: row.filter_mode,
    botPaused: Boolean(row.bot_paused),
    notifyOnEmptyCycle: Boolean(row.notify_on_empty_cycle),
    dailyDigestEnabled: Boolean(row.daily_digest_enabled),
    dailyDigestTimeMinutes: row.daily_digest_time_minutes,
    weeklyPageSize: row.weekly_page_size,
    vacancyLanguageMode: row.vacancy_language_mode,
    onboardingCompleted: Boolean(row.onboarding_completed),
    onboardingStep: row.onboarding_step,
    pendingInputAction: row.pending_input_action,
    pendingInputPayload: row.pending_input_payload,
    updatedAt: row.updated_at
  };
}

export function mapDailyDigestDelivery(row: DailyDigestDeliveryRow): DailyDigestDeliveryRecord {
  return {
    userId: row.user_id,
    digestDate: row.digest_date,
    scheduledFor: row.scheduled_for,
    nextAttemptAt: row.next_attempt_at,
    attemptCount: row.attempt_count,
    deliveredAt: row.delivered_at,
    skippedAt: row.skipped_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function mapHhSearchSettings(row: HhSearchSettingsRow): HhSearchSettings {
  return {
    userId: row.user_id,
    enabled: Boolean(row.enabled),
    text: row.text,
    areaId: row.area_id,
    experience: row.experience,
    schedule: row.schedule,
    employment: row.employment,
    salaryFrom: row.salary_from,
    periodDays: row.period_days,
    updatedAt: row.updated_at
  };
}

export function mapUserKeyword(row: UserKeywordRow): UserKeyword {
  return {
    id: row.id,
    userId: row.user_id,
    kind: row.kind,
    keyword: row.keyword,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function mapMonitoredChannel(row: MonitoredChannelRow): MonitoredChannel {
  return {
    id: row.id,
    username: row.username,
    sourceName: row.source_name,
    isActive: Boolean(row.is_active),
    initialBackfillCompleted: Boolean(row.initial_backfill_completed),
    lastSeenMessageId: row.last_seen_message_id,
    idlePollStreak: row.idle_poll_streak ?? 0,
    nextPollAfter: row.next_poll_after,
    lastCheckedAt: row.last_checked_at,
    lastSuccessAt: row.last_success_at,
    lastError: row.last_error,
    addedByUserId: row.added_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function mapUserSearchProfile(row: UserSearchProfileRow): UserSearchProfileRecord {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    isActive: Boolean(row.is_active),
    vacancyLanguageMode: row.vacancy_language_mode,
    requiredContextKeywords: parseJsonStringArray(row.required_context_keywords_json),
    requiredPrimaryKeywords: parseJsonStringArray(row.required_primary_keywords_json),
    preferredKeywords: parseJsonStringArray(row.preferred_keywords_json),
    excludeKeywords: parseJsonStringArray(row.exclude_keywords_json),
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function mapAnalyticsEvent(row: AnalyticsEventRow): AnalyticsEventRecord {
  return {
    id: row.id,
    eventName: row.event_name,
    distinctId: row.distinct_id,
    userId: row.user_id,
    properties: parseJsonObject(row.properties_json),
    occurredAt: row.occurred_at,
    createdAt: row.created_at
  };
}
