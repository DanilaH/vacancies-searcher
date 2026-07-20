export const DEFAULT_DAILY_DIGEST_TIME_MINUTES = 9 * 60;

export function getLocalDigestDateParts(now: Date, timeZone: string): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "00";
  const hour = Number.parseInt(value("hour"), 10);
  const minute = Number.parseInt(value("minute"), 10);

  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    minutes: hour * 60 + minute
  };
}

export function formatDigestScheduledFor(digestDate: string, minutes: number, timeZone: string): string {
  const hour = Math.floor(minutes / 60).toString().padStart(2, "0");
  const minute = (minutes % 60).toString().padStart(2, "0");
  return `${digestDate} ${hour}:${minute} ${timeZone}`;
}

export function resolveDailyDigestTimeMinutes(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 1439) {
    return DEFAULT_DAILY_DIGEST_TIME_MINUTES;
  }

  return value;
}
