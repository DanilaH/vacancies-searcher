export function isInQuietHours(now: Date, timeZone: string): boolean {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour: "2-digit",
    hour12: false
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  return hour >= 23 || hour < 8;
}

export function computeNextQuietHoursEnd(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const hour = get("hour");
  let year = get("year");
  let month = get("month");
  let day = get("day");

  if (hour >= 23) {
    const d = new Date(year, month - 1, day + 1);
    year = d.getFullYear();
    month = d.getMonth() + 1;
    day = d.getDate();
  }

  const dateStr = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const noonRef = new Date(`${dateStr}T12:00:00Z`);
  const refParts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(noonRef);
  const refHour = Number(refParts.find((p) => p.type === "hour")?.value ?? 12);
  const refMinute = Number(refParts.find((p) => p.type === "minute")?.value ?? 0);
  const offsetMinutes = (refHour * 60 + refMinute) - 12 * 60;
  const targetUtcMinutes = 8 * 60 - offsetMinutes;
  const targetUtc = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0) + targetUtcMinutes * 60 * 1000);
  return targetUtc.toISOString();
}
