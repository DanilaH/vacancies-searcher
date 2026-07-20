export const DEFAULT_WEEKLY_WINDOW_DAYS = 7;
export const WEEKLY_WINDOW_DAYS_OPTIONS = [7, 14, 30] as const;
export type WeeklyWindowDays = (typeof WEEKLY_WINDOW_DAYS_OPTIONS)[number];

export function normalizeWeeklyWindowDays(value: number | null | undefined): WeeklyWindowDays {
  if (value === 14 || value === 30) {
    return value;
  }

  return DEFAULT_WEEKLY_WINDOW_DAYS;
}
