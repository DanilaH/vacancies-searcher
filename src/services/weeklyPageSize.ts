import type { UserSettings } from "../types";

export const MIN_WEEKLY_PAGE_SIZE = 1;
export const MAX_WEEKLY_PAGE_SIZE = 5;
export const DEFAULT_WEEKLY_PAGE_SIZE = 3;

export function clampWeeklyPageSize(value: number, fallback = DEFAULT_WEEKLY_PAGE_SIZE): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  const integer = Math.trunc(value);
  return Math.min(MAX_WEEKLY_PAGE_SIZE, Math.max(MIN_WEEKLY_PAGE_SIZE, integer));
}

export function getEffectiveWeeklyPageSize(
  settings: Pick<UserSettings, "weeklyPageSize"> | null | undefined,
  globalWeeklyPageSize: number
): number {
  const fallback = clampWeeklyPageSize(globalWeeklyPageSize);
  return settings?.weeklyPageSize === null || settings?.weeklyPageSize === undefined
    ? fallback
    : clampWeeklyPageSize(settings.weeklyPageSize, fallback);
}

export function nextWeeklyPageSize(currentEffectivePageSize: number): number {
  const current = clampWeeklyPageSize(currentEffectivePageSize);
  return current >= MAX_WEEKLY_PAGE_SIZE ? MIN_WEEKLY_PAGE_SIZE : current + 1;
}

export function normalizeWeeklyOffset(offset: number, pageSize: number, total?: number): number {
  const safePageSize = clampWeeklyPageSize(pageSize);
  const safeOffset = Number.isFinite(offset) ? Math.max(0, Math.trunc(offset)) : 0;
  const pageOffset = Math.floor(safeOffset / safePageSize) * safePageSize;

  if (total !== undefined && total > 0 && pageOffset >= total) {
    return Math.floor((total - 1) / safePageSize) * safePageSize;
  }

  return pageOffset;
}
