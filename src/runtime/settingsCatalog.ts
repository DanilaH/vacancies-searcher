import { AppConfig } from "../config";
import { RuntimeSettingKey, RuntimeSettingValue } from "../types";

export interface RuntimeSettingDefinition {
  key: RuntimeSettingKey;
  property: keyof RuntimeSettingSnapshotSeed;
  label: string;
  description: string;
  min: number;
  max: number;
  unit: string | null;
  applyHint: string;
}

type RuntimeSettingSnapshotSeed = {
  checkIntervalSeconds: number;
  initialBackfillDays: number;
  weeklyPageSize: number;
  webPreviewMaxPagesPerChannel: number;
  webPreviewChannelDelayMs: number;
  webPreviewRetryCount: number;
  webPreviewRequestTimeoutMs: number;
  webPreviewMaxItemsPerChannel: number;
};

const DEFINITIONS: RuntimeSettingDefinition[] = [
  {
    key: "CHECK_INTERVAL_SECONDS",
    property: "checkIntervalSeconds",
    label: "Интервал проверки",
    description: "Как часто бот запускает новый цикл поиска вакансий.",
    min: 10,
    max: 86_400,
    unit: "сек",
    applyHint: "Применяется в следующем цикле проверки."
  },
  {
    key: "INITIAL_BACKFILL_DAYS",
    property: "initialBackfillDays",
    label: "Глубина первой загрузки",
    description: "За сколько дней назад читать историю, когда канал подключается впервые.",
    min: 0,
    max: 30,
    unit: "дн",
    applyHint: "Влияет только на будущие первые загрузки, а не на уже завершённые."
  },
  {
    key: "WEEKLY_PAGE_SIZE",
    property: "weeklyPageSize",
    label: "Размер страницы подборки",
    description: "Сколько вакансий показывать на одной странице в разделе за неделю.",
    min: 1,
    max: 5,
    unit: "шт",
    applyHint: "Применяется при следующем открытии подборки за неделю."
  },
  {
    key: "WEB_PREVIEW_MAX_PAGES_PER_CHANNEL",
    property: "webPreviewMaxPagesPerChannel",
    label: "Лимит страниц на канал",
    description: "Сколько страниц Telegram preview можно просканировать у одного канала за цикл.",
    min: 1,
    max: 20,
    unit: "стр",
    applyHint: "Применяется в следующем цикле чтения источника."
  },
  {
    key: "WEB_PREVIEW_CHANNEL_DELAY_MS",
    property: "webPreviewChannelDelayMs",
    label: "Пауза между каналами",
    description: "Небольшая пауза между запросами к разным каналам.",
    min: 250,
    max: 60_000,
    unit: "мс",
    applyHint: "Применяется в следующем цикле чтения источника."
  },
  {
    key: "WEB_PREVIEW_RETRY_COUNT",
    property: "webPreviewRetryCount",
    label: "Повторные попытки",
    description: "Сколько повторных попыток делать при временной ошибке чтения Telegram preview.",
    min: 0,
    max: 5,
    unit: "раз",
    applyHint: "Применяется в следующем цикле чтения источника."
  },
  {
    key: "WEB_PREVIEW_REQUEST_TIMEOUT_MS",
    property: "webPreviewRequestTimeoutMs",
    label: "Таймаут запроса",
    description: "Сколько ждать один запрос к Telegram preview перед отменой.",
    min: 1_000,
    max: 60_000,
    unit: "мс",
    applyHint: "Применяется в следующем цикле чтения источника."
  },
  {
    key: "WEB_PREVIEW_MAX_ITEMS_PER_CHANNEL",
    property: "webPreviewMaxItemsPerChannel",
    label: "Лимит постов на канал",
    description: "Максимум постов, который бот обработает у одного канала за цикл.",
    min: 1,
    max: 500,
    unit: "шт",
    applyHint: "Применяется в следующем цикле чтения источника."
  }
];

const DEFINITION_MAP = new Map(DEFINITIONS.map((definition) => [definition.key, definition]));

export function listRuntimeSettingDefinitions(): RuntimeSettingDefinition[] {
  return DEFINITIONS;
}

export function getRuntimeSettingDefinition(key: RuntimeSettingKey): RuntimeSettingDefinition {
  const definition = DEFINITION_MAP.get(key);
  if (!definition) {
    throw new Error(`Unknown runtime setting key: ${key}`);
  }

  return definition;
}

export function getRuntimeSettingDefaultValue(config: AppConfig, key: RuntimeSettingKey): number {
  const definition = getRuntimeSettingDefinition(key);
  return config[definition.property];
}

export function buildRuntimeSettingValue(
  config: AppConfig,
  key: RuntimeSettingKey,
  value: number,
  source: "default" | "override",
  updatedAt: string | null,
  updatedByUserId: string | null
): RuntimeSettingValue {
  const definition = getRuntimeSettingDefinition(key);

  return {
    key,
    label: definition.label,
    description: definition.description,
    min: definition.min,
    max: definition.max,
    unit: definition.unit,
    applyHint: definition.applyHint,
    defaultValue: getRuntimeSettingDefaultValue(config, key),
    value,
    source,
    updatedAt,
    updatedByUserId
  };
}
