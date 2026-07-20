import { FilterSuggestionKey, HiddenVacancyReason } from "../types";

export const HIDDEN_VACANCY_REASONS: readonly HiddenVacancyReason[] = [
  "not_rf",
  "stack_mismatch",
  "low_salary",
  "wrong_grade",
  "office_or_hybrid",
  "scam",
  "seen_before",
  "unwanted_niche",
  "unclear_company"
];

export const HIDDEN_VACANCY_REASON_LABELS: Record<HiddenVacancyReason, string> = {
  not_rf: "не РФ",
  stack_mismatch: "не мой стек",
  low_salary: "мало денег",
  wrong_grade: "не тот грейд",
  office_or_hybrid: "офис/гибрид",
  scam: "скам",
  seen_before: "уже видел",
  unwanted_niche: "не хочу нишу",
  unclear_company: "мутная компания"
};

export const HIDDEN_VACANCY_REASON_BUTTON_LABELS: Record<HiddenVacancyReason, string> = {
  not_rf: "Не РФ",
  stack_mismatch: "Не мой стек",
  low_salary: "Мало денег",
  wrong_grade: "Не тот грейд",
  office_or_hybrid: "Офис/гибрид",
  scam: "Скам",
  seen_before: "Уже видел",
  unwanted_niche: "Не хочу нишу",
  unclear_company: "Мутная компания"
};

export const FILTER_SUGGESTION_BY_REASON: Partial<Record<HiddenVacancyReason, FilterSuggestionKey>> = {
  not_rf: "hidden_not_rf",
  office_or_hybrid: "hidden_office_or_hybrid",
  stack_mismatch: "hidden_stack_mismatch",
  wrong_grade: "hidden_wrong_grade",
  low_salary: "hidden_low_salary"
};

export const FILTER_SUGGESTION_LABELS: Record<FilterSuggestionKey, string> = {
  hidden_not_rf: "часто скрываешь вакансии из-за РФ/гео. Стоит усилить географические условия.",
  hidden_office_or_hybrid: "часто скрываешь офис/гибрид. Стоит усилить remote-only условия.",
  hidden_stack_mismatch: "часто скрываешь из-за стека. Стоит обновить основной стек в фильтрах.",
  hidden_wrong_grade: "часто скрываешь из-за грейда. Стоит уточнить seniority в фильтрах.",
  hidden_low_salary: "часто скрываешь из-за денег. Зарплатный фильтр лучше добавлять отдельным шагом."
};

export function parseHiddenVacancyReason(value: string | undefined): HiddenVacancyReason | null {
  return HIDDEN_VACANCY_REASONS.includes(value as HiddenVacancyReason)
    ? value as HiddenVacancyReason
    : null;
}
