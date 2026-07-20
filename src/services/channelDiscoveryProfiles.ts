import { ChannelDiscoveryProfileId } from "../types";

export interface ChannelDiscoveryProfile {
  id: ChannelDiscoveryProfileId;
  label: string;
  seedQueries: string[];
  primarySignals: string[];
  formatSignals: string[];
  hiringSignals: string[];
  minimumSamplePosts: number;
  minimumVacancyLikePosts: number;
  maxResumeRate: number;
}

const COMMON_HIRING_SIGNALS = [
  "job",
  "jobs",
  "hiring",
  "vacancy",
  "vacancies",
  "position",
  "role",
  "opportunity",
  "opportunities",
  "wanted",
  "looking for",
  "we are looking",
  "needed",
  "career",
  "contract",
  "freelance",
  "project",
  "gig",
  "work",
  "developer",
  "engineer",
  "designer",
  "artist",
  "manager",
  "qa",
  "вакансия",
  "вакансии",
  "работа",
  "ищем",
  "требуется",
  "нужен",
  "нужна",
  "заказ",
  "заказы",
  "проект",
  "проекты",
  "фриланс",
  "подработка",
  "отклик"
];

export const CHANNEL_DISCOVERY_REMOTE_SIGNALS = [
  "remote",
  "remote-first",
  "worldwide",
  "anywhere",
  "remotely",
  "work from home",
  "wfh",
  "удаленно",
  "удалённо",
  "удаленка",
  "удалёнка",
  "дистанционно"
];

const PROJECT_FORMAT_SIGNALS = [
  "freelance",
  "contract",
  "project",
  "part-time",
  "gig",
  "order",
  "orders",
  "заказ",
  "заказы",
  "проект",
  "проекты",
  "фриланс",
  "подработка"
];

const CHANNEL_DISCOVERY_PROFILES: ChannelDiscoveryProfile[] = [
  {
    id: "frontend",
    label: "Frontend",
    seedQueries: [
      "react remote",
      "react jobs",
      "frontend remote",
      "frontend developer remote",
      "typescript jobs",
      "next.js jobs",
      "javascript frontend vacancies",
      "frontend vacancies",
      "react vacancies",
      "удаленная frontend вакансия"
    ],
    primarySignals: ["frontend", "front-end", "front end", "react", "react.js", "typescript", "next.js", "nextjs", "javascript", "redux", "vite"],
    formatSignals: CHANNEL_DISCOVERY_REMOTE_SIGNALS,
    hiringSignals: COMMON_HIRING_SIGNALS,
    minimumSamplePosts: 3,
    minimumVacancyLikePosts: 2,
    maxResumeRate: 0.35
  },
  {
    id: "backend",
    label: "Backend",
    seedQueries: ["backend remote", "backend jobs", "node.js backend jobs", "python backend jobs", "golang jobs", "java backend vacancies", "backend вакансии", "удаленная backend вакансия"],
    primarySignals: ["backend", "back-end", "back end", "server-side", "node.js", "nestjs", "python", "django", "fastapi", "golang", "go developer", "java backend", "spring"],
    formatSignals: CHANNEL_DISCOVERY_REMOTE_SIGNALS,
    hiringSignals: COMMON_HIRING_SIGNALS,
    minimumSamplePosts: 3,
    minimumVacancyLikePosts: 2,
    maxResumeRate: 0.35
  },
  {
    id: "fullstack",
    label: "Fullstack",
    seedQueries: ["fullstack remote", "full-stack jobs", "full stack developer jobs", "react node.js jobs", "fullstack вакансии", "удаленная fullstack вакансия"],
    primarySignals: ["fullstack", "full-stack", "full stack", "react node", "node.js react", "frontend backend", "mern", "next.js node", "typescript node"],
    formatSignals: CHANNEL_DISCOVERY_REMOTE_SIGNALS,
    hiringSignals: COMMON_HIRING_SIGNALS,
    minimumSamplePosts: 3,
    minimumVacancyLikePosts: 2,
    maxResumeRate: 0.35
  },
  {
    id: "mobile",
    label: "Mobile",
    seedQueries: ["mobile developer jobs", "ios developer jobs", "android developer jobs", "flutter jobs", "react native jobs", "mobile вакансии", "ios android вакансии"],
    primarySignals: ["mobile developer", "ios", "android", "swift", "kotlin", "flutter", "react native", "rn developer", "mobile engineer"],
    formatSignals: CHANNEL_DISCOVERY_REMOTE_SIGNALS,
    hiringSignals: COMMON_HIRING_SIGNALS,
    minimumSamplePosts: 3,
    minimumVacancyLikePosts: 2,
    maxResumeRate: 0.35
  },
  {
    id: "qa",
    label: "QA",
    seedQueries: ["qa jobs", "qa engineer remote", "manual qa jobs", "automation qa jobs", "tester vacancies", "qa вакансии", "тестировщик вакансии"],
    primarySignals: ["qa", "quality assurance", "tester", "testing", "manual qa", "automation qa", "sdet", "playwright", "selenium", "тестировщик", "тестирование"],
    formatSignals: CHANNEL_DISCOVERY_REMOTE_SIGNALS,
    hiringSignals: COMMON_HIRING_SIGNALS,
    minimumSamplePosts: 3,
    minimumVacancyLikePosts: 2,
    maxResumeRate: 0.35
  },
  {
    id: "devops",
    label: "DevOps",
    seedQueries: ["devops jobs", "sre jobs", "cloud engineer jobs", "kubernetes jobs", "devops вакансии", "sre вакансии"],
    primarySignals: ["devops", "sre", "site reliability", "cloud engineer", "kubernetes", "k8s", "terraform", "aws", "gcp", "azure", "linux", "ci/cd"],
    formatSignals: CHANNEL_DISCOVERY_REMOTE_SIGNALS,
    hiringSignals: COMMON_HIRING_SIGNALS,
    minimumSamplePosts: 3,
    minimumVacancyLikePosts: 2,
    maxResumeRate: 0.35
  },
  {
    id: "data_ml",
    label: "Data / ML",
    seedQueries: ["data scientist jobs", "machine learning jobs", "ml engineer jobs", "data analyst jobs", "data вакансии", "machine learning вакансии"],
    primarySignals: ["data scientist", "data analyst", "data engineer", "machine learning", "ml engineer", "ai engineer", "python data", "pandas", "pytorch", "tensorflow", "llm"],
    formatSignals: CHANNEL_DISCOVERY_REMOTE_SIGNALS,
    hiringSignals: COMMON_HIRING_SIGNALS,
    minimumSamplePosts: 3,
    minimumVacancyLikePosts: 2,
    maxResumeRate: 0.35
  },
  {
    id: "design",
    label: "Design",
    seedQueries: ["product designer jobs", "ui ux jobs", "ux designer remote", "figma jobs", "designer вакансии", "ui ux вакансии"],
    primarySignals: ["product designer", "ui/ux", "ux/ui", "ux designer", "ui designer", "figma", "web designer", "mobile designer", "дизайнер интерфейсов", "ux", "ui"],
    formatSignals: CHANNEL_DISCOVERY_REMOTE_SIGNALS,
    hiringSignals: COMMON_HIRING_SIGNALS,
    minimumSamplePosts: 3,
    minimumVacancyLikePosts: 2,
    maxResumeRate: 0.35
  },
  {
    id: "product_pm",
    label: "Product / PM",
    seedQueries: ["product manager jobs", "product owner jobs", "project manager it jobs", "product вакансии", "project manager вакансии"],
    primarySignals: ["product manager", "product owner", "project manager", "program manager", "delivery manager", "product lead", "growth product", "продакт", "проектный менеджер"],
    formatSignals: CHANNEL_DISCOVERY_REMOTE_SIGNALS,
    hiringSignals: COMMON_HIRING_SIGNALS,
    minimumSamplePosts: 3,
    minimumVacancyLikePosts: 2,
    maxResumeRate: 0.35
  },
  {
    id: "gamedev_3d",
    label: "GameDev 3D",
    seedQueries: ["3d artist gamedev jobs", "game artist jobs", "unity 3d artist jobs", "unreal 3d artist jobs", "3d artist вакансии", "gamedev artist вакансии"],
    primarySignals: ["3d artist", "game artist", "environment artist", "character artist", "props artist", "hard surface", "unity", "unreal", "game dev", "gamedev", "substance painter", "maya"],
    formatSignals: CHANNEL_DISCOVERY_REMOTE_SIGNALS,
    hiringSignals: COMMON_HIRING_SIGNALS,
    minimumSamplePosts: 3,
    minimumVacancyLikePosts: 2,
    maxResumeRate: 0.35
  },
  {
    id: "three_d_printing",
    label: "3D Sculpt / Print",
    seedQueries: [
      "3d sculptor jobs",
      "digital sculptor jobs",
      "3d artist 3d printing",
      "3d modeler 3d printing",
      "zbrush sculptor jobs",
      "blender 3d printing",
      "3д скульптор вакансии",
      "цифровой скульптор работа",
      "модели для 3д печати заказы",
      "3d printing freelance"
    ],
    primarySignals: [
      "3d sculptor",
      "digital sculptor",
      "3d artist",
      "3d modeler",
      "3d modeller",
      "3d modeling",
      "3d printing",
      "zbrush",
      "blender",
      "nomad sculpt",
      "stl",
      "obj",
      "print-ready",
      "3д скульптор",
      "цифровой скульптор",
      "3д художник",
      "3д моделлер",
      "3д моделирование",
      "3д печать",
      "для печати",
      "модели для печати"
    ],
    formatSignals: [...CHANNEL_DISCOVERY_REMOTE_SIGNALS, ...PROJECT_FORMAT_SIGNALS],
    hiringSignals: [...COMMON_HIRING_SIGNALS, ...PROJECT_FORMAT_SIGNALS],
    minimumSamplePosts: 3,
    minimumVacancyLikePosts: 2,
    maxResumeRate: 0.35
  },
  {
    id: "no_experience",
    label: "Без опыта",
    seedQueries: [
      "работа без опыта",
      "вакансии без опыта",
      "удаленная работа без опыта",
      "подработка без опыта",
      "работа для новичков",
      "стажировки вакансии",
      "entry level jobs",
      "no experience jobs",
      "remote no experience",
      "training provided jobs"
    ],
    primarySignals: [
      "без опыта",
      "без опыта работы",
      "опыт не требуется",
      "опыт работы не требуется",
      "опыт не обязателен",
      "опыт работы не обязателен",
      "можно без опыта",
      "рассматриваем без опыта",
      "ищем новичков",
      "для новичков",
      "обучение с нуля",
      "готовы обучить",
      "готовы научить",
      "всему научим",
      "no experience required",
      "no experience necessary",
      "entry level",
      "entry-level",
      "training provided",
      "will train"
    ],
    formatSignals: [
      ...CHANNEL_DISCOVERY_REMOTE_SIGNALS,
      ...PROJECT_FORMAT_SIGNALS,
      "стажировка",
      "стажёр",
      "стажер",
      "intern",
      "internship",
      "trainee"
    ],
    hiringSignals: COMMON_HIRING_SIGNALS,
    minimumSamplePosts: 3,
    minimumVacancyLikePosts: 2,
    maxResumeRate: 0.35
  }
];

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeCustomQuery(value: string): string {
  return value.trim().replace(/\s+/gu, " ").slice(0, 80);
}

function customSeedQueries(query: string): string[] {
  return unique([
    query,
    `${query} jobs`,
    `${query} remote`,
    `${query} vacancies`,
    `${query} freelance`,
    `${query} вакансии`,
    `${query} работа`,
    `${query} удаленно`
  ]);
}

function customSignals(query: string): string[] {
  const tokens = query
    .split(/[\s,;|/]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
  return unique([query, ...tokens]);
}

export function listChannelDiscoveryProfiles(): ChannelDiscoveryProfile[] {
  return CHANNEL_DISCOVERY_PROFILES;
}

export function getChannelDiscoveryProfile(id: ChannelDiscoveryProfileId): ChannelDiscoveryProfile | null {
  if (id === "custom") {
    return null;
  }

  return CHANNEL_DISCOVERY_PROFILES.find((profile) => profile.id === id) ?? null;
}

export function buildCustomChannelDiscoveryProfile(query: string): ChannelDiscoveryProfile | null {
  const normalizedQuery = normalizeCustomQuery(query);
  if (normalizedQuery.length < 2) {
    return null;
  }

  return {
    id: "custom",
    label: `Custom: ${normalizedQuery}`,
    seedQueries: customSeedQueries(normalizedQuery),
    primarySignals: customSignals(normalizedQuery),
    formatSignals: [...CHANNEL_DISCOVERY_REMOTE_SIGNALS, ...PROJECT_FORMAT_SIGNALS],
    hiringSignals: COMMON_HIRING_SIGNALS,
    minimumSamplePosts: 3,
    minimumVacancyLikePosts: 2,
    maxResumeRate: 0.35
  };
}
