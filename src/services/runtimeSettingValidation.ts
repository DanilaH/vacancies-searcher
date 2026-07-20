import { getRuntimeSettingDefinition } from "../runtime/settingsCatalog";
import { RuntimeSettingKey } from "../types";

type ValidationResult =
  | { ok: true; value: number }
  | { ok: false; error: string };

const INTEGER_PATTERN = /^(0|[1-9]\d{0,11})$/;
const MAX_INPUT_LENGTH = 32;

export function validateRuntimeSettingInput(key: RuntimeSettingKey, rawValue: string): ValidationResult {
  const definition = getRuntimeSettingDefinition(key);
  const trimmedValue = rawValue.trim();

  if (!trimmedValue) {
    return {
      ok: false,
      error: "Отправь непустое целое число."
    };
  }

  if (trimmedValue.length > MAX_INPUT_LENGTH) {
    return {
      ok: false,
      error: "Значение получилось слишком длинным. Отправь обычное число без лишнего текста."
    };
  }

  if (!INTEGER_PATTERN.test(trimmedValue)) {
    return {
      ok: false,
      error: "Поддерживаются только неотрицательные целые числа без пробелов, знаков, дробей и лишнего текста."
    };
  }

  const parsedValue = Number.parseInt(trimmedValue, 10);
  if (!Number.isSafeInteger(parsedValue)) {
    return {
      ok: false,
      error: "Число слишком большое, его нельзя безопасно сохранить."
    };
  }

  if (parsedValue < definition.min || parsedValue > definition.max) {
    const rangeSuffix = definition.unit ? ` ${definition.unit}` : "";
    return {
      ok: false,
      error: `Для настройки «${definition.label}» допустим диапазон ${definition.min}-${definition.max}${rangeSuffix}.`
    };
  }

  return {
    ok: true,
    value: parsedValue
  };
}
