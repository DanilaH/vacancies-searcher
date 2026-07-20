export interface VacancyCardOrigin {
  offset: number;
  profileId?: number;
  days?: number;
}

const GLOBAL_ORIGIN_PATTERN = /^w([0-9a-z]+)(?:\.([0-9a-z]+))?$/;
const PROFILE_ORIGIN_PATTERN = /^p([0-9a-z]+)\.([0-9a-z]+)(?:\.([0-9a-z]+))?$/;
const TELEGRAM_CALLBACK_DATA_MAX_LENGTH = 64;

export function encodeVacancyCardOrigin(origin: VacancyCardOrigin): string {
  const offset = Math.max(0, origin.offset).toString(36);
  const daysSuffix = origin.days && origin.days !== 7 ? `.${Math.max(1, origin.days).toString(36)}` : "";
  return origin.profileId
    ? `p${origin.profileId.toString(36)}.${offset}${daysSuffix}`
    : `w${offset}${daysSuffix}`;
}

export function parseVacancyCardOrigin(value: string | undefined): VacancyCardOrigin | undefined {
  if (!value) {
    return undefined;
  }

  const globalMatch = GLOBAL_ORIGIN_PATTERN.exec(value);
  if (globalMatch) {
    return {
      offset: Number.parseInt(globalMatch[1], 36),
      ...(globalMatch[2] ? { days: Number.parseInt(globalMatch[2], 36) } : {})
    };
  }

  const profileMatch = PROFILE_ORIGIN_PATTERN.exec(value);
  if (!profileMatch) {
    return undefined;
  }

  return {
    profileId: Number.parseInt(profileMatch[1], 36),
    offset: Number.parseInt(profileMatch[2], 36),
    ...(profileMatch[3] ? { days: Number.parseInt(profileMatch[3], 36) } : {})
  };
}

export function appendVacancyCardOrigin(callbackData: string, origin?: VacancyCardOrigin): string {
  if (!origin) {
    return callbackData;
  }

  const callbackWithOrigin = `${callbackData}:${encodeVacancyCardOrigin(origin)}`;
  return callbackWithOrigin.length <= TELEGRAM_CALLBACK_DATA_MAX_LENGTH
    ? callbackWithOrigin
    : callbackData;
}

export function weeklyCallbackForVacancyCardOrigin(origin?: VacancyCardOrigin): string {
  if (!origin) {
    return "week:0";
  }

  const days = origin.days && origin.days !== 7 ? origin.days : null;
  if (days) {
    return origin.profileId
      ? `week:profile:${origin.profileId}:${days}:${origin.offset}`
      : `week:${days}:${origin.offset}`;
  }

  return origin.profileId
    ? `week:profile:${origin.profileId}:${origin.offset}`
    : `week:${origin.offset}`;
}
