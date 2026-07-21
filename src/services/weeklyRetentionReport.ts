import type { VacancyDatabase } from "../db/database";
import { ACTIVITY_EVENT_NAMES } from "./activityWhitelist";

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

function retentionLabel(value: number | null): string {
  if (value === null) return "—";
  return `${Math.round(value)}%`;
}

function formatDate(mondayIso: string): string {
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

  const blocks: string[] = [];

  for (const cohortMonday of recentCohorts) {
    const userIds = cohortMap.get(cohortMonday)!;
    const cohortSize = userIds.length;
    const cohortStart = new Date(cohortMonday);

    const weekBoundaries = [
      { offset: 7, label: "W1" },
      { offset: 14, label: "W2" },
      { offset: 21, label: "W3" },
      { offset: 28, label: "W4" }
    ];

    const values: string[] = [];

    for (const w of weekBoundaries) {
      const weekStart = new Date(cohortStart.getTime() + w.offset * 24 * 60 * 60 * 1000);
      const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
      if (weekEnd > now) {
        values.push(`${w.label}: —`);
        continue;
      }
      const activeInWeek = database.countCohortActivityUsers(
        userIds,
        ACTIVITY_EVENT_NAMES as unknown as string[],
        weekStart.toISOString(),
        weekEnd.toISOString()
      );
      const pct = cohortSize > 0 ? (activeInWeek / cohortSize) * 100 : 0;
      values.push(`${w.label}: ${retentionLabel(pct)}`);
    }

    const date = formatDate(cohortMonday);
    const header = `Неделя ${date} · ${cohortSize} ${pluralizeUsers(cohortSize)}`;
    const line = values.join(" · ");
    blocks.push(`${header}\n${line}`);
  }

  const lines: string[] = [
    "📊 Ретенция пользователей (недельные когорты)",
    "Часовой пояс: UTC",
    "",
    "Формула: Wn = пользователи когорты с активностью на неделе n / размер когорты",
    ""
  ];

  lines.push(blocks.join("\n\n"));
  return lines.join("\n");
}

function pluralizeUsers(n: number): string {
  if (n % 10 === 1 && n % 100 !== 11) return "пользователь";
  if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return "пользователя";
  return "пользователей";
}
