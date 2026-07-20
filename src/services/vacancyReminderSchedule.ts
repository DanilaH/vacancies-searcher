import { VacancyReminderPreset } from "../types";

type ZonedDateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function getZonedDateParts(date: Date, timeZone: string): ZonedDateParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number.parseInt(parts.find((part) => part.type === type)?.value ?? "0", 10);

  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second")
  };
}

function addCalendarDays(parts: ZonedDateParts, days: number): ZonedDateParts {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    ...parts,
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  };
}

function zonedDateTimeToUtc(parts: ZonedDateParts, timeZone: string): Date {
  const desiredAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  let timestamp = desiredAsUtc;

  // Iterating compensates for the current IANA timezone offset, including DST.
  for (let index = 0; index < 3; index += 1) {
    const observed = getZonedDateParts(new Date(timestamp), timeZone);
    const observedAsUtc = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
      observed.second
    );
    timestamp += desiredAsUtc - observedAsUtc;
  }

  return new Date(timestamp);
}

export function calculateVacancyReminderAt(
  preset: VacancyReminderPreset,
  now: Date,
  timeZone: string
): Date {
  const current = getZonedDateParts(now, timeZone);
  let target = { ...current, second: 0 };

  if (preset === "evening") {
    target.hour = 19;
    target.minute = 0;
    let result = zonedDateTimeToUtc(target, timeZone);
    if (result.getTime() < now.getTime()) {
      target = addCalendarDays(target, 1);
      result = zonedDateTimeToUtc(target, timeZone);
    }
    return result;
  }

  target = addCalendarDays(target, preset === "tomorrow" ? 1 : 3);
  target.hour = 10;
  target.minute = 0;
  return zonedDateTimeToUtc(target, timeZone);
}
