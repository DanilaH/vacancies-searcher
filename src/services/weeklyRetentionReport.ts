import type { VacancyDatabase } from "../db/database";
import { ACTIVITY_EVENT_NAMES } from "./activityWhitelist";

export interface CohortRow {
  cohortMonday: string;
  cohortSize: number;
  w1: number | null;
  w2: number | null;
  w3: number | null;
  w4: number | null;
}

/**
 * Compute the Monday (start of the ISO week, UTC) for a given ISO date string.
 */
export function computeCohortMonday(isoDate: string): string {
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) {
    throw new Error(`Invalid date: ${isoDate}`);
  }
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

function formatRetentionValue(value: number | null): string {
  if (value === null) return "—";
  return `${Math.round(value)}%`;
}

function formatCohortDate(mondayIso: string): string {
  const d = new Date(mondayIso);
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const year = d.getUTCFullYear();
  return `${day}.${month}.${year}`;
}

export function buildWeeklyRetentionReport(
  database: VacancyDatabase,
  now = new Date()
): string {
  const nowIso = now.toISOString();
  const allUsers = database.listAllUsers().filter((u) => u.role !== "owner" && u.role !== "admin");
  if (allUsers.length === 0) {
    return "📊 Ретенция пользователей\n\nНет данных. В базе нет пользователей.";
  }

  const cohortMap = new Map<string, string[]>();
  for (const user of allUsers) {
    const monday = computeCohortMonday(user.createdAt);
    const list = cohortMap.get(monday);
    if (list) {
      list.push(user.userId);
    } else {
      cohortMap.set(monday, [user.userId]);
    }
  }

  const sortedMondays = [...cohortMap.keys()].sort().reverse();
  const recentCohorts = sortedMondays.slice(0, 8);

  const rows: CohortRow[] = [];
  for (const cohortMonday of recentCohorts) {
    const userIds = cohortMap.get(cohortMonday)!;
    const cohortSize = userIds.length;
    const cohortStart = new Date(cohortMonday);

    const weeks: Array<{ offset: number; label: string }> = [
      { offset: 7, label: "w1" },
      { offset: 14, label: "w2" },
      { offset: 21, label: "w3" },
      { offset: 28, label: "w4" }
    ];

    const result: CohortRow = {
      cohortMonday,
      cohortSize,
      w1: null,
      w2: null,
      w3: null,
      w4: null
    };

    for (const w of weeks) {
      const weekStart = new Date(cohortStart.getTime() + w.offset * 24 * 60 * 60 * 1000);
      const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
      if (weekStart >= now) {
        break;
      }
      const activeInWeek = database.countCohortActivityUsers(
        userIds,
        ACTIVITY_EVENT_NAMES as unknown as string[],
        weekStart.toISOString(),
        weekEnd.toISOString()
      );
      const retentionPct = cohortSize > 0 ? (activeInWeek / cohortSize) * 100 : 0;
      if (w.label === "w1") result.w1 = retentionPct;
      else if (w.label === "w2") result.w2 = retentionPct;
      else if (w.label === "w3") result.w3 = retentionPct;
      else if (w.label === "w4") result.w4 = retentionPct;
    }

    rows.push(result);
  }

  const lines: string[] = [
    "📊 Ретенция пользователей (недельные когорты)",
    "Часовой пояс: UTC",
    "",
    "Формула: Wn = пользователи когорты с активностью",
    "           на неделе n / размер когорты",
    "",
    "Неделя начала | Размер | W1   | W2   | W3   | W4"
  ];

  for (const row of rows) {
    const date = formatCohortDate(row.cohortMonday);
    const size = String(row.cohortSize);
    const w1 = formatRetentionValue(row.w1).padStart(4);
    const w2 = formatRetentionValue(row.w2).padStart(4);
    const w3 = formatRetentionValue(row.w3).padStart(4);
    const w4 = formatRetentionValue(row.w4).padStart(4);
    lines.push(`${date} | ${size.padStart(5)} | ${w1} | ${w2} | ${w3} | ${w4}`);
  }

  return lines.join("\n");
}
