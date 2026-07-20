import { SearchProfilePresetId } from "../types";

export interface SearchProfilePreset {
  id: SearchProfilePresetId;
  label: string;
  category: "general" | "it" | "creative" | "product";
  description: string;
  requiredContextKeywords: string[];
  requiredPrimaryKeywords: string[];
  preferredKeywords: string[];
  excludeKeywords: string[];
}

export interface SearchProfilePresetGroup {
  id: SearchProfilePreset["category"];
  label: string;
  presets: SearchProfilePreset[];
}

const PRESET_CATEGORY_LABELS: Record<SearchProfilePreset["category"], string> = {
  general: "Общее / Старт",
  it: "IT / Engineering",
  creative: "Creative / 3D",
  product: "Product / Management"
};

const SEARCH_PROFILE_PRESETS: SearchProfilePreset[] = [
  {
    id: "remote_no_experience",
    label: "Удалённо без опыта",
    category: "general",
    description: "Удалённая работа в любой сфере с явным указанием, что опыт не требуется.",
    requiredContextKeywords: [
      "remote",
      "remote work",
      "work from home",
      "wfh",
      "удаленно",
      "удалённо",
      "удаленка",
      "удалёнка",
      "дистанционно",
      "дистанционная работа",
      "работать онлайн"
    ],
    requiredPrimaryKeywords: [
      "без опыта",
      "без опыта работы",
      "опыт не требуется",
      "опыт работы не требуется",
      "опыт не обязателен",
      "опыт работы не обязателен",
      "можно без опыта",
      "рассматриваем без опыта",
      "обучение с нуля",
      "готовы обучить",
      "всему научим",
      "ищем новичков",
      "для новичков",
      "no experience required",
      "no experience necessary",
      "entry level",
      "entry-level",
      "training provided",
      "will train"
    ],
    preferredKeywords: [
      "оператор чата",
      "чат-оператор",
      "chat operator",
      "customer support",
      "поддержка",
      "модератор",
      "moderator",
      "ассистент",
      "assistant",
      "контент-менеджер",
      "data entry",
      "стажировка",
      "intern",
      "trainee",
      "junior",
      "гибкий график",
      "обучение"
    ],
    excludeKeywords: [
      "senior",
      "middle",
      "lead",
      "руководитель",
      "head of",
      "требуется опыт",
      "обязателен опыт",
      "опыт работы от",
      "опыт от 1 года",
      "опыт от 2 лет",
      "опыт от 3 лет",
      "1+ years",
      "2+ years",
      "3+ years",
      "платное обучение",
      "оплата за доступ",
      "вступительный взнос",
      "купить курс"
    ]
  },
  {
    id: "frontend",
    label: "Frontend",
    category: "it",
    description: "React/TypeScript и удалённый формат.",
    requiredContextKeywords: ["remote", "удаленно", "удалённо"],
    requiredPrimaryKeywords: ["react", "frontend", "front-end"],
    preferredKeywords: ["typescript", "next.js", "javascript", "middle", "senior"],
    excludeKeywords: ["vue", "angular", "php", "java", "android", "ios", "qa", "devops", "backend"]
  },
  {
    id: "backend",
    label: "Backend",
    category: "it",
    description: "Серверная разработка с упором на удалёнку.",
    requiredContextKeywords: ["remote", "удаленно", "удалённо"],
    requiredPrimaryKeywords: ["backend", "back-end", "server-side"],
    preferredKeywords: ["python", "node.js", "golang", "java", "django", "fastapi", "nestjs", "middle", "senior"],
    excludeKeywords: ["frontend", "front-end", "react", "vue", "android", "ios", "qa", "designer"]
  },
  {
    id: "fullstack",
    label: "Fullstack",
    category: "it",
    description: "Полный цикл: клиент и сервер.",
    requiredContextKeywords: ["remote", "удаленно", "удалённо"],
    requiredPrimaryKeywords: ["fullstack", "full-stack"],
    preferredKeywords: ["react", "typescript", "node.js", "next.js", "nestjs", "middle", "senior"],
    excludeKeywords: ["qa", "android", "ios", "designer"]
  },
  {
    id: "design",
    label: "Design",
    category: "creative",
    description: "Product/UI/UX design.",
    requiredContextKeywords: ["remote", "удаленно", "удалённо"],
    requiredPrimaryKeywords: ["designer", "product design", "ui/ux", "ux/ui", "ui ux"],
    preferredKeywords: ["figma", "product designer", "middle", "senior", "mobile design"],
    excludeKeywords: ["frontend", "backend", "react", "java", "qa", "devops"]
  },
  {
    id: "product",
    label: "Product",
    category: "product",
    description: "Product manager / product owner роли.",
    requiredContextKeywords: ["remote", "удаленно", "удалённо"],
    requiredPrimaryKeywords: ["product manager", "product owner", "pm"],
    preferredKeywords: ["saas", "b2b", "growth", "middle", "senior"],
    excludeKeywords: ["designer", "frontend", "backend", "qa", "android", "ios"]
  },
  {
    id: "three_d_printing",
    label: "3D Sculpt / Print",
    category: "creative",
    description: "3D sculpting, digital sculpting and print-ready models.",
    requiredContextKeywords: ["remote", "удаленно", "удалённо", "freelance", "фриланс", "project", "проект", "заказ", "заказы", "contract"],
    requiredPrimaryKeywords: [
      "3d sculptor",
      "digital sculptor",
      "3d artist",
      "3d modeler",
      "3d modeller",
      "3d modeling",
      "3д скульптор",
      "цифровой скульптор",
      "3д художник",
      "3д моделлер",
      "3д моделирование",
      "3d printing",
      "3д печать"
    ],
    preferredKeywords: [
      "zbrush",
      "blender",
      "nomad sculpt",
      "stl",
      "obj",
      "print-ready",
      "для печати",
      "миниатюра",
      "фигурка",
      "статуэтка",
      "character sculpt",
      "organic modeling"
    ],
    excludeKeywords: [
      "frontend",
      "backend",
      "react",
      "qa",
      "devops",
      "product manager",
      "smm",
      "sales",
      "archviz",
      "архвиз"
    ]
  }
];

export function listSearchProfilePresets(): SearchProfilePreset[] {
  return SEARCH_PROFILE_PRESETS;
}

export function listSearchProfilePresetGroups(): SearchProfilePresetGroup[] {
  const groupsById = new Map<SearchProfilePreset["category"], SearchProfilePreset[]>();
  for (const preset of SEARCH_PROFILE_PRESETS) {
    groupsById.set(preset.category, [...(groupsById.get(preset.category) ?? []), preset]);
  }

  return (Object.keys(PRESET_CATEGORY_LABELS) as Array<SearchProfilePreset["category"]>)
    .map((category) => ({
      id: category,
      label: PRESET_CATEGORY_LABELS[category],
      presets: groupsById.get(category) ?? []
    }))
    .filter((group) => group.presets.length > 0);
}

export function getSearchProfilePreset(id: SearchProfilePresetId): SearchProfilePreset | null {
  return SEARCH_PROFILE_PRESETS.find((preset) => preset.id === id) ?? null;
}
