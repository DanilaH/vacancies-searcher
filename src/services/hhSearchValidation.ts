import { HhEmployment, HhExperience, HhSchedule } from "../types";

const HH_TEXT_MAX_LENGTH = 120;
const HH_AREA_ID_PATTERN = /^\d+$/;
const MAX_SALARY_FROM = 50_000_000;

const EXPERIENCE_ORDER: HhExperience[] = ["any", "noExperience", "between1And3", "between3And6", "moreThan6"];
const SCHEDULE_ORDER: HhSchedule[] = ["remote", "any", "fullDay", "flexible", "shift"];
const EMPLOYMENT_ORDER: HhEmployment[] = ["full", "any", "part", "project", "probation"];

type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

function normalizeInput(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function cycleValue<T extends string>(order: readonly T[], value: T): T {
  const index = order.indexOf(value);
  return order[(index + 1) % order.length] ?? order[0];
}

export function validateHhTextInput(value: string): ValidationResult<string> {
  const normalized = normalizeInput(value);
  if (!normalized) {
    return { ok: false, error: "⚠️ Отправь текст hh-запроса, например: frontend react remote." };
  }

  if (normalized.length > HH_TEXT_MAX_LENGTH) {
    return { ok: false, error: `⚠️ Запрос слишком длинный. Максимум ${HH_TEXT_MAX_LENGTH} символов.` };
  }

  return { ok: true, value: normalized };
}

export function validateHhAreaInput(value: string): ValidationResult<string> {
  const normalized = normalizeInput(value);
  if (!HH_AREA_ID_PATTERN.test(normalized)) {
    return { ok: false, error: "⚠️ Отправь числовой ID региона hh.ru. Например, 113 для России." };
  }

  return { ok: true, value: normalized };
}

export function validateHhSalaryInput(value: string): ValidationResult<number | null> {
  const normalized = normalizeInput(value);
  if (normalized === "-" || normalized === "0") {
    return { ok: true, value: null };
  }

  if (!/^\d+$/.test(normalized)) {
    return { ok: false, error: "⚠️ Отправь зарплату числом или '-' чтобы очистить." };
  }

  const salary = Number.parseInt(normalized, 10);
  if (salary < 0 || salary > MAX_SALARY_FROM) {
    return { ok: false, error: `⚠️ Зарплата должна быть от 0 до ${MAX_SALARY_FROM}.` };
  }

  return { ok: true, value: salary };
}

export function validateHhPeriodInput(value: string): ValidationResult<number> {
  const normalized = normalizeInput(value);
  if (!/^\d+$/.test(normalized)) {
    return { ok: false, error: "⚠️ Отправь период числом от 1 до 30 дней." };
  }

  const periodDays = Number.parseInt(normalized, 10);
  if (periodDays < 1 || periodDays > 30) {
    return { ok: false, error: "⚠️ Период публикации должен быть от 1 до 30 дней." };
  }

  return { ok: true, value: periodDays };
}

export function nextHhExperience(value: HhExperience): HhExperience {
  return cycleValue(EXPERIENCE_ORDER, value);
}

export function nextHhSchedule(value: HhSchedule): HhSchedule {
  return cycleValue(SCHEDULE_ORDER, value);
}

export function nextHhEmployment(value: HhEmployment): HhEmployment {
  return cycleValue(EMPLOYMENT_ORDER, value);
}
