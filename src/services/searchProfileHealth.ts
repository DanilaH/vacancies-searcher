import {
  SearchProfileHealthReport,
  SearchProfileSectionKey,
  UserSearchProfile
} from "../types";

function sectionLabel(section: SearchProfileSectionKey): string {
  switch (section) {
    case "required_context":
      return "блок «Условия и формат»";
    case "required_primary":
      return "блок «Основной профиль»";
    case "preferred":
      return "блок «Желательные сигналы»";
    case "exclude":
      return "блок «Стоп-слова»";
  }
}

export function getSearchProfileHealth(profile: UserSearchProfile): SearchProfileHealthReport {
  const hasContext = profile.requiredContextKeywords.length > 0;
  const hasPrimary = profile.requiredPrimaryKeywords.length > 0;
  const hasPreferred = profile.preferredKeywords.length > 0;

  const missingRequiredSections: SearchProfileSectionKey[] = [];
  if (!hasContext) {
    missingRequiredSections.push("required_context");
  }
  if (!hasPrimary) {
    missingRequiredSections.push("required_primary");
  }

  const hasAnyPositiveSignals = hasContext || hasPrimary || hasPreferred;

  if (!hasAnyPositiveSignals) {
    return {
      status: "empty",
      summary: "Профиль поиска пока не настроен.",
      guidance: "Добавь обязательные блоки или выбери готовый пресет, чтобы включить поиск.",
      missingRequiredSections,
      isSearchActive: false
    };
  }

  if (missingRequiredSections.length > 0) {
    return {
      status: "weak",
      summary: "Профиль настроен частично.",
      guidance: `Для более точного поиска заполни ${missingRequiredSections.map(sectionLabel).join(" и ")}.`,
      missingRequiredSections,
      isSearchActive: true
    };
  }

  return {
    status: "ready",
    summary: "Профиль готов к поиску.",
    guidance: hasPreferred
      ? "Поиск активен. При желании можно тонко настроить сигналы и стоп-слова."
      : "Поиск активен. Блок «Желательные сигналы» можно заполнить позже для более точной выдачи.",
    missingRequiredSections: [],
    isSearchActive: true
  };
}
