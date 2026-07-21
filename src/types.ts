export type TelegramSourceMode = "web" | "mtproto";

export type SourceName = "telegram_web_preview" | "telegram_mtproto" | "hh_api" | "company_careers";

export type BotUserRole = "owner" | "admin" | "member";

export type ChannelDiscoverySource =
  | "mtproto_search"
  | "mtproto_recommendation"
  | "raw_message_link"
  | "mention_graph_link"
  | "mention_graph_username"
  | "manual_seed"
  | "duckduckgo_search";

export type ChannelDiscoveryRunStatus = "running" | "completed" | "failed";

export type ChannelDiscoveryCandidateStatus = "pending" | "approved" | "skipped" | "blocked";

export type ChannelDiscoveryProfileId =
  | "frontend"
  | "backend"
  | "fullstack"
  | "mobile"
  | "qa"
  | "devops"
  | "data_ml"
  | "design"
  | "product_pm"
  | "gamedev_3d"
  | "three_d_printing"
  | "no_experience"
  | "custom";

export type FilterMode = "keywords" | "hybrid" | "ai";

export type KeywordKind = "include" | "exclude";

export type PendingInputAction =
  | "add_include_keyword"
  | "add_exclude_keyword"
  | "add_channel"
  | "add_company_career_source"
  | "add_trusted_vacancy_service"
  | "add_user"
  | "set_profile_required_context"
  | "set_profile_required_primary"
  | "set_profile_preferred"
  | "set_profile_exclude"
  | "rename_search_profile"
  | "set_hh_text"
  | "set_hh_area"
  | "set_hh_salary"
  | "set_hh_period"
  | "run_channel_discovery_custom"
  | "run_channel_discovery_seeds"
  | "set_application_note"
  | "set_runtime_setting";

export type RuntimeSettingKey =
  | "CHECK_INTERVAL_SECONDS"
  | "INITIAL_BACKFILL_DAYS"
  | "WEEKLY_PAGE_SIZE"
  | "WEB_PREVIEW_MAX_PAGES_PER_CHANNEL"
  | "WEB_PREVIEW_CHANNEL_DELAY_MS"
  | "WEB_PREVIEW_RETRY_COUNT"
  | "WEB_PREVIEW_REQUEST_TIMEOUT_MS"
  | "WEB_PREVIEW_MAX_ITEMS_PER_CHANNEL";

export type RawVacancyItem = {
  source: SourceName;
  channel: string;
  messageId: string;
  text: string;
  date?: string;
  url: string;
  canonicalUrl?: string;
  cursorMessageId?: string;
  linkEntities?: TelegramPostLinkEntity[];
  eligibleUserIds?: string[];
  sourceQueryKey?: string;
};

export interface TelegramPostLinkEntity {
  text: string;
  url: string;
  position: number;
}

export interface TelegramVacancySplitResult {
  items: RawVacancyItem[];
  split: boolean;
  reason: string;
}

export type TrustedVacancyServiceAdapter =
  | "findmyremote"
  | "teletype"
  | "finder_work"
  | "telegraph"
  | "aviasales_careers"
  | "cloud_careers"
  | "tbank_careers"
  | "yandex_jobs"
  | "generic";
export type TrustedVacancyServiceStatus = "pending" | "active" | "disabled";
export type TrustedVacancyServiceParserMode = "specialized" | "json_ld_or_html";

export interface TrustedVacancyServiceRecord {
  id: number;
  hostname: string;
  displayName: string;
  adapter: TrustedVacancyServiceAdapter;
  status: TrustedVacancyServiceStatus;
  parserMode: TrustedVacancyServiceParserMode;
  exampleUrl: string;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  addedByUserId: string | null;
  approvedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TrustedVacancyServicePage {
  items: TrustedVacancyServiceRecord[];
  offset: number;
  pageSize: number;
  total: number;
}

export interface ExternalVacancyEnrichmentResult {
  url: string;
  text: string;
  title: string | null;
  company: string | null;
  location: string | null;
  employment: string | null;
  parser: "findmyremote" | "teletype" | "finder_work" | "telegraph" | "json_ld" | "html_fallback";
  warnings: string[];
}

export type CompanyCareerAdapter =
  | "aviasales_html"
  | "greenhouse_job_board"
  | "lever_postings"
  | "ashby_posting"
  | "smartrecruiters_postings"
  | "generic_html";

export interface CompanyCareerSourceRecord {
  id: number;
  companyName: string;
  adapter: CompanyCareerAdapter;
  startUrl: string;
  isActive: boolean;
  pollIntervalSeconds: number;
  nextPollAfter: string | null;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  addedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CompanyCareerSourcePage {
  items: CompanyCareerSourceRecord[];
  offset: number;
  pageSize: number;
  total: number;
}

export type HhExperience = "any" | "noExperience" | "between1And3" | "between3And6" | "moreThan6";

export type HhSchedule = "any" | "remote" | "fullDay" | "flexible" | "shift";

export type HhEmployment = "any" | "full" | "part" | "project" | "probation";

export interface HhSearchSettings {
  userId: string;
  enabled: boolean;
  text: string;
  areaId: string;
  experience: HhExperience;
  schedule: HhSchedule;
  employment: HhEmployment;
  salaryFrom: number | null;
  periodDays: number;
  updatedAt: string;
}

export type ExtractedContact = {
  type: "telegram" | "email" | "url";
  value: string;
};

export interface PersonalKeywordSet {
  includeKeywords: string[];
  excludeKeywords: string[];
}

export type SearchProfileSectionKey =
  | "required_context"
  | "required_primary"
  | "preferred"
  | "exclude";

export type SearchProfileHealth = "empty" | "weak" | "ready";

export type VacancyLanguageMode = "ru_en" | "ru_only" | "en_only";

export type DetectedVacancyLanguage = "russian" | "english" | "mixed" | "unknown";

export type VacancyUserStatus = "inbox" | "saved" | "hidden" | "applied";

export type VacancyReminderPreset = "evening" | "tomorrow" | "three_days";
export type VacancyApplicationFollowUpPreset = "one_minute" | "three_days" | "week";
export type HiddenVacancyReason =
  | "not_rf"
  | "stack_mismatch"
  | "low_salary"
  | "wrong_grade"
  | "office_or_hybrid"
  | "scam"
  | "seen_before"
  | "unwanted_niche"
  | "unclear_company";
export type VacancyRelevanceValue = "relevant" | "not_relevant";

export type FilterSuggestionKey =
  | "hidden_not_rf"
  | "hidden_office_or_hybrid"
  | "hidden_stack_mismatch"
  | "hidden_wrong_grade"
  | "hidden_low_salary";
export type FilterSuggestionStatus = "shown" | "applied" | "dismissed";

export type SearchProfilePresetId =
  | "frontend"
  | "backend"
  | "fullstack"
  | "design"
  | "product"
  | "remote_no_experience"
  | "three_d_printing";

export type AnalyticsEventName =
  | "bot_started"
  | "user_started"
  | "onboarding_started"
  | "manual_profile_setup_started"
  | "onboarding_skipped"
  | "onboarding_completed"
  | "preset_selected"
  | "profile_block_updated"
  | "profile_ready"
  | "profile_created"
  | "profile_renamed"
  | "profile_paused"
  | "profile_deleted"
  | "weekly_feed_opened"
  | "vacancy_matched"
  | "vacancy_notified"
  | "vacancy_reminder_scheduled"
  | "vacancy_reminder_cancelled"
  | "vacancy_reminder_sent"
  | "vacancy_application_created"
  | "vacancy_application_followup_scheduled"
  | "vacancy_application_followup_cancelled"
  | "vacancy_application_followup_sent"
  | "vacancy_application_note_updated"
  | "daily_digest_sent"
  | "daily_digest_skipped"
  | "daily_digest_failed"
  | "vacancy_hidden_reason_prompt_shown"
  | "vacancy_hidden_reason_set"
  | "vacancy_hidden_reason_skipped"
  | "empty_cycle_notice_sent"
  | "channel_added"
  | "user_added"
  | "user_role_changed"
  | "user_access_changed"
  | "vacancy_status_changed"
  | "vacancy_relevance_feedback"
  | "poll_cycle_completed"
  | "poll_cycle_failed";

export type AnalyticsPropertyValue =
  | string
  | number
  | boolean
  | null
  | AnalyticsPropertyValue[]
  | { [key: string]: AnalyticsPropertyValue };

export type AnalyticsProperties = Record<string, AnalyticsPropertyValue>;

export interface AnalyticsEventRecord {
  id: number;
  eventName: AnalyticsEventName;
  distinctId: string;
  userId: string | null;
  properties: AnalyticsProperties;
  occurredAt: string;
  createdAt: string;
}

export interface AnalyticsCaptureInput {
  eventName: AnalyticsEventName;
  distinctId?: string;
  userId?: string | null;
  properties?: AnalyticsProperties;
  occurredAt?: string;
}

export interface AnalyticsIdentifyInput {
  distinctId: string;
  userId?: string | null;
  properties?: AnalyticsProperties;
}

export interface UserVacancyMatchSyncInput {
  vacancyId: number;
  filterResult: FilterResult;
  profileMatches?: UserVacancyProfileMatchInput[];
}

export interface UserVacancyProfileMatchInput {
  profileId: number;
  filterResult: FilterResult;
}

export interface UserVacancyMatchSyncResult {
  created: number;
  updated: number;
  unchanged: number;
  removed: number;
  totalMatched: number;
}

export type VacancyRejectionReason =
  | "candidate_post"
  | "language"
  | "stop_words"
  | "missing_context"
  | "missing_primary"
  | "preferred_signals";

export interface UserSearchProfileRematchDiagnostic {
  profileId: number;
  profileName: string;
  evaluatedVacancies: number;
  matchedVacancies: number;
  rejectionReasons: Partial<Record<VacancyRejectionReason, number>>;
}

export interface UserVacancyRematchSummary extends UserVacancyMatchSyncResult {
  userId: string;
  windowDays: number;
  scannedVacancies: number;
  evaluatedVacancies: number;
  profileDiagnostics: UserSearchProfileRematchDiagnostic[];
  profileStatus: SearchProfileHealth;
}

export type OnboardingStep =
  | "intro"
  | "welcome"
  | "preset"
  | "language"
  | "manual_required_context"
  | "manual_required_primary"
  | "manual_preferred"
  | "manual_exclude";

export interface UserSearchProfile {
  userId: string;
  requiredContextKeywords: string[];
  requiredPrimaryKeywords: string[];
  preferredKeywords: string[];
  excludeKeywords: string[];
  updatedAt: string;
}

export interface UserSearchProfileRecord extends UserSearchProfile {
  id: number;
  name: string;
  isActive: boolean;
  vacancyLanguageMode: VacancyLanguageMode;
  sortOrder: number;
  createdAt: string;
}

export interface SearchProfileWeeklyStats {
  profileId: number;
  visibleMatches: number;
  hiddenMatches: number;
}

export interface SearchProfilePresetForecast {
  presetId: SearchProfilePresetId;
  matchesCount: number;
  evaluatedVacancies: number;
}

export interface SearchProfileHealthReport {
  status: SearchProfileHealth;
  summary: string;
  guidance: string | null;
  missingRequiredSections: SearchProfileSectionKey[];
  isSearchActive: boolean;
}

export interface UserSettings {
  userId: string;
  aiEnabled: boolean;
  filterMode: FilterMode;
  botPaused: boolean;
  notifyOnEmptyCycle: boolean;
  dailyDigestEnabled: boolean;
  dailyDigestTimeMinutes: number | null;
  weeklyPageSize: number | null;
  vacancyLanguageMode: VacancyLanguageMode;
  onboardingCompleted: boolean;
  onboardingStep: OnboardingStep | null;
  pendingInputAction: PendingInputAction | null;
  pendingInputPayload: string | null;
  updatedAt: string;
}

export interface BotUser {
  userId: string;
  role: BotUserRole;
  isActive: boolean;
  username: string | null;
  displayName: string | null;
  addedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserKeyword {
  id: number;
  userId: string;
  kind: KeywordKind;
  keyword: string;
  createdAt: string;
  updatedAt: string;
}

export interface MonitoredChannel {
  id: number;
  username: string;
  sourceName: SourceName;
  isActive: boolean;
  initialBackfillCompleted: boolean;
  lastSeenMessageId: string | null;
  idlePollStreak: number;
  nextPollAfter: string | null;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  addedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChannelCheckSuccessState {
  lastSeenMessageId: string | null;
  idlePollStreak: number;
  nextPollAfter: string | null;
}

export interface MonitoredChannelPage {
  items: MonitoredChannel[];
  offset: number;
  pageSize: number;
  total: number;
}

export interface ChannelDiscoveryRun {
  id: number;
  status: ChannelDiscoveryRunStatus;
  startedByUserId: string | null;
  profileId: ChannelDiscoveryProfileId;
  profileLabel: string;
  customQuery: string | null;
  seedQueries: string[];
  providers: string[];
  providerWarnings: string[];
  totalCandidatesFound: number;
  candidatesToCheck: number;
  candidatesChecked: number;
  candidatesRecommended: number;
  candidatesFiltered: number;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
}

export interface ChannelDiscoveryEvidence {
  url: string;
  messageDate: string | null;
  excerpt: string;
  matchedSignals: string[];
}

export interface ChannelDiscoveryCandidateStats {
  samplePosts: number;
  primarySignalPosts: number;
  formatSignalPosts: number;
  hiringPosts: number;
  vacancyLikePosts: number;
  resumePosts: number;
  resumeRate: number;
}

export interface ChannelDiscoveryCandidate {
  id: number;
  runId: number;
  username: string;
  title: string | null;
  status: ChannelDiscoveryCandidateStatus;
  score: number;
  sources: ChannelDiscoverySource[];
  probeUrl: string | null;
  stats: ChannelDiscoveryCandidateStats;
  reasons: string[];
  evidence: ChannelDiscoveryEvidence[];
  createdAt: string;
  updatedAt: string;
}

export interface ChannelDiscoveryCandidatePage {
  items: ChannelDiscoveryCandidate[];
  offset: number;
  pageSize: number;
  total: number;
  runId: number;
}

export interface ChannelRegistry {
  listActiveChannels(sourceName: SourceName): MonitoredChannel[];
  markChannelCheckSuccess(channelId: number, state: ChannelCheckSuccessState): void;
  markChannelCheckFailure(channelId: number, errorMessage: string): void;
  markChannelBackfillCompleted(channelId: number): void;
}

export interface RuntimeSettingsSnapshot {
  checkIntervalSeconds: number;
  initialBackfillDays: number;
  weeklyPageSize: number;
  webPreviewMaxPagesPerChannel: number;
  webPreviewChannelDelayMs: number;
  webPreviewRetryCount: number;
  webPreviewRequestTimeoutMs: number;
  webPreviewMaxItemsPerChannel: number;
}

export interface RuntimeSettingValue {
  key: RuntimeSettingKey;
  label: string;
  description: string;
  min: number;
  max: number;
  unit: string | null;
  applyHint: string;
  defaultValue: number;
  value: number;
  source: "default" | "override";
  updatedAt: string | null;
  updatedByUserId: string | null;
}

export interface AdminPanelState {
  botPaused: boolean;
  sourceMode: TelegramSourceMode;
  aiEnabled: boolean;
  filterMode: FilterMode;
  activeChannelsCount: number;
  includeKeywordsCount: number;
  excludeKeywordsCount: number;
  pendingInputAction: PendingInputAction | null;
}

export interface FilterResult {
  matches: boolean;
  score: number;
  matchedKeywords: string[];
  blockedBy: string[];
  summary: string;
  rejectionReasons?: VacancyRejectionReason[];
}

export interface VacancyDuplicatePost {
  sourceName: SourceName;
  sourceChannel: string;
  sourceMessageId: string;
  messageDate: string;
  url: string;
}

export interface VacancyDuplicatePostPage {
  items: VacancyDuplicatePost[];
  total: number;
}

export interface VacancyRecord {
  id: number;
  sourceName: SourceName;
  sourceChannel: string;
  sourceMessageId: string;
  messageDate: string;
  title: string;
  text: string;
  normalizedText: string;
  url: string;
  canonicalUrl: string | null;
  fingerprint: string;
  score: number;
  matchSummary: string;
  matchedKeywords: string[];
  contacts: ExtractedContact[];
  sentToOwnerAt: string | null;
  createdAt: string;
  duplicatePosts?: VacancyDuplicatePost[];
  duplicatePostsTotal?: number;
}

export interface MatchedVacancyRecord extends VacancyRecord {
  userId: string;
  deliveredAt: string | null;
  matchedAt: string;
  userStatus: VacancyUserStatus;
  statusUpdatedAt: string | null;
  matchedProfileIds?: number[];
  matchedProfileNames?: string[];
  application?: VacancyApplicationRecord | null;
  hiddenReason?: HiddenVacancyReason | null;
}

export interface UserStatusVacancyRecord extends VacancyRecord {
  userId: string;
  userStatus: Exclude<VacancyUserStatus, "inbox">;
  statusUpdatedAt: string;
  isCurrentlyMatched: boolean;
  matchedAt: string | null;
  matchedProfileIds?: number[];
  matchedProfileNames?: string[];
  application?: VacancyApplicationRecord | null;
  hiddenReason?: HiddenVacancyReason | null;
}

export interface VacancyRelevanceFeedbackRecord {
  userId: string;
  vacancyId: number;
  value: VacancyRelevanceValue;
  createdAt: string;
  updatedAt: string;
}

export interface RejectedMatchAuditRecord {
  userId: string;
  vacancyId: number;
  resolution: string;
  score: number | null;
  reason: string | null;
  decidedAt: string;
  reviewedAt: string | null;
  verdict: string | null;
}

export interface UserVacancyHiddenReasonRecord {
  userId: string;
  vacancyId: number;
  reason: HiddenVacancyReason;
  createdAt: string;
  updatedAt: string;
}

export interface VacancyReminderRecord extends VacancyRecord {
  userId: string;
  remindAt: string;
  nextAttemptAt: string;
  attemptCount: number;
  deliveredAt: string | null;
  cancelledAt: string | null;
  lastError: string | null;
  reminderCreatedAt: string;
  reminderUpdatedAt: string;
}

export interface VacancyReminderPage {
  items: VacancyReminderRecord[];
  offset: number;
  pageSize: number;
  total: number;
}

export interface VacancyApplicationRecord {
  userId: string;
  vacancyId: number;
  appliedAt: string;
  note: string | null;
  followUpAt: string | null;
  nextAttemptAt: string | null;
  attemptCount: number;
  deliveredAt: string | null;
  cancelledAt: string | null;
  lastError: string | null;
  respondedAt: string | null;
  closedAt: string | null;
  applicationCreatedAt: string;
  applicationUpdatedAt: string;
}

export interface VacancyApplicationFollowUpRecord extends VacancyRecord {
  userId: string;
  appliedAt: string;
  note: string | null;
  followUpAt: string;
  nextAttemptAt: string;
  attemptCount: number;
  deliveredAt: string | null;
  cancelledAt: string | null;
  lastError: string | null;
  respondedAt: string | null;
  closedAt: string | null;
  applicationCreatedAt: string;
  applicationUpdatedAt: string;
}

export interface UserVacancyApplicationRecord extends VacancyRecord {
  userId: string;
  userStatus: "applied";
  statusUpdatedAt: string;
  matchedAt: string | null;
  isCurrentlyMatched: boolean;
  matchedProfileIds?: number[];
  matchedProfileNames?: string[];
  application: VacancyApplicationRecord;
}

export interface UserVacancyApplicationPage {
  items: UserVacancyApplicationRecord[];
  offset: number;
  pageSize: number;
  total: number;
  summary: UserVacancyApplicationSummary;
}

export interface UserVacancyApplicationSummary {
  total: number;
  waitingFollowUp: number;
  sentFollowUp: number;
  closedOrResponded: number;
}

export interface DailyDigestPayload {
  userId: string;
  digestDate: string;
  scheduledFor: string;
  newVacanciesCount: number;
  savedWithoutActionCount: number;
  dueApplicationFollowUpsCount: number;
  hiddenLastDayCount: number;
  hiddenReasonTop?: HiddenVacancyReasonSummaryItem[];
}

export interface DailyDigestDueRecord extends DailyDigestPayload {
  nextAttemptAt: string;
  attemptCount: number;
  lastError: string | null;
}

export interface DailyDigestDeliveryRecord {
  userId: string;
  digestDate: string;
  scheduledFor: string;
  nextAttemptAt: string | null;
  attemptCount: number;
  deliveredAt: string | null;
  skippedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HiddenVacancyReasonSummaryItem {
  reason: HiddenVacancyReason;
  count: number;
}

export interface HiddenVacancyFeedbackSummary {
  totalHidden: number;
  withReason: number;
  withoutReason: number;
  topReasons: HiddenVacancyReasonSummaryItem[];
}

export interface UserFilterSuggestionRecord {
  userId: string;
  suggestionKey: FilterSuggestionKey;
  status: FilterSuggestionStatus;
  shownAt: string;
  actedAt: string | null;
  dismissedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserFilterSuggestionCandidate {
  suggestionKey: FilterSuggestionKey;
  reason: HiddenVacancyReason;
  count: number;
  totalWithReason: number;
  share: number;
}

export interface WeeklyVacancyPage {
  items: VacancyRecord[];
  offset: number;
  pageSize: number;
  total: number;
}

export interface UserWeeklyVacancyPage {
  items: MatchedVacancyRecord[];
  offset: number;
  pageSize: number;
  total: number;
  hiddenMatchedTotal?: number;
}

export interface UserStatusVacancyPage {
  items: UserStatusVacancyRecord[];
  offset: number;
  pageSize: number;
  total: number;
  status: Exclude<VacancyUserStatus, "inbox">;
}

export type IngestResult =
  | { kind: "new_vacancy"; vacancy: VacancyRecord }
  | { kind: "duplicate_raw_message"; source: SourceName; channel: string; messageId: string; vacancyId: number | null }
  | { kind: "duplicate_fingerprint"; duplicateVacancyId: number; fingerprint: string }
  | { kind: "duplicate_canonical_url"; duplicateVacancyId: number; canonicalUrl: string }
  | { kind: "filtered_out"; summary: string };

export interface VacancySource {
  readonly name: SourceName;
  fetchLatest(): Promise<RawVacancyItem[]>;
  stop(): Promise<void>;
}

export interface PollCycleSummary {
  sourceName: SourceName;
  fetchedItemsCount: number;
  newVacanciesCount: number;
  usersWithNewVacancies: string[];
}
