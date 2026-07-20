import type { VacancyApplicationFollowUpPreset } from "../types";

const DAY_MS = 24 * 60 * 60 * 1000;

export function calculateApplicationFollowUpAt(
  preset: VacancyApplicationFollowUpPreset,
  now = new Date()
): Date {
  if (preset === "one_minute") {
    return new Date(now.getTime() + 60_000);
  }

  const days = preset === "week" ? 7 : 3;
  return new Date(now.getTime() + days * DAY_MS);
}
