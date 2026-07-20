const CHANNEL_USERNAME_PATTERN = /^[a-z0-9_]{5,32}$/;
const RESERVED_PREFIXES = ["joinchat", "+", "c/"];

export type ChannelValidationResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

export function parseChannelBatchInput(value: string): string[] {
  return value
    .split(/[\s,;]+/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseLimitedChannelBatchInput(value: string, maxUnique = 50): {
  totalEntries: number;
  usernames: string[];
  invalid: string[];
  duplicates: string[];
  truncated: number;
} {
  const entries = parseChannelBatchInput(value);
  const usernames: string[] = [];
  const invalid: string[] = [];
  const duplicates: string[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const validation = validateChannelInput(entry);
    if (!validation.ok) {
      invalid.push(entry);
      continue;
    }
    if (seen.has(validation.value)) {
      duplicates.push(validation.value);
      continue;
    }
    seen.add(validation.value);
    usernames.push(validation.value);
  }

  return {
    totalEntries: entries.length,
    usernames: usernames.slice(0, maxUnique),
    invalid,
    duplicates,
    truncated: Math.max(0, usernames.length - maxUnique)
  };
}

export function parseChannelDiscoverySeedBatch(value: string, maxUnique = 50): {
  totalEntries: number;
  usernames: string[];
  invalid: string[];
  duplicates: string[];
  truncated: number;
} {
  return parseLimitedChannelBatchInput(value, maxUnique);
}

function normalizeChannelPath(value: string): string {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return "";
  }

  let normalized = trimmedValue
    .replace(/^https?:\/\/t\.me\//i, "")
    .replace(/^t\.me\//i, "")
    .replace(/^@/, "")
    .trim();

  normalized = normalized.split(/[?#]/, 1)[0] ?? "";
  normalized = normalized.replace(/^\/+/, "");

  if (normalized.toLowerCase().startsWith("s/")) {
    normalized = normalized.slice(2);
  }

  const segments = normalized.split("/").filter(Boolean);
  return (segments[0] ?? "").toLowerCase();
}

export function validateChannelInput(value: string): ChannelValidationResult {
  const normalized = normalizeChannelPath(value);

  if (!normalized) {
    return {
      ok: false,
      error: "Пришли username или ссылку на публичный Telegram-канал, например @job_react или https://t.me/job_react."
    };
  }

  if (RESERVED_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return {
      ok: false,
      error: "Сейчас поддерживаются только публичные Telegram-каналы по username. Приватные invite-ссылки не подойдут."
    };
  }

  if (!CHANNEL_USERNAME_PATTERN.test(normalized)) {
    return {
      ok: false,
      error: "Username канала должен содержать от 5 до 32 символов: латиница, цифры или underscore."
    };
  }

  return {
    ok: true,
    value: normalized
  };
}
