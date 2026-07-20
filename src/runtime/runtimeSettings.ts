import { AppConfig } from "../config";
import { VacancyDatabase } from "../db/database";
import {
  RuntimeSettingKey,
  RuntimeSettingsSnapshot,
  RuntimeSettingValue
} from "../types";
import {
  buildRuntimeSettingValue,
  getRuntimeSettingDefaultValue,
  listRuntimeSettingDefinitions
} from "./settingsCatalog";

export class RuntimeSettingsService {
  private readonly listeners = new Set<(key: RuntimeSettingKey, value: number) => void>();

  constructor(
    private readonly config: AppConfig,
    private readonly database: VacancyDatabase
  ) {}

  getSnapshot(): RuntimeSettingsSnapshot {
    return {
      checkIntervalSeconds: this.getNumericValue("CHECK_INTERVAL_SECONDS"),
      initialBackfillDays: this.getNumericValue("INITIAL_BACKFILL_DAYS"),
      weeklyPageSize: this.getNumericValue("WEEKLY_PAGE_SIZE"),
      webPreviewMaxPagesPerChannel: this.getNumericValue("WEB_PREVIEW_MAX_PAGES_PER_CHANNEL"),
      webPreviewChannelDelayMs: this.getNumericValue("WEB_PREVIEW_CHANNEL_DELAY_MS"),
      webPreviewRetryCount: this.getNumericValue("WEB_PREVIEW_RETRY_COUNT"),
      webPreviewRequestTimeoutMs: this.getNumericValue("WEB_PREVIEW_REQUEST_TIMEOUT_MS"),
      webPreviewMaxItemsPerChannel: this.getNumericValue("WEB_PREVIEW_MAX_ITEMS_PER_CHANNEL")
    };
  }

  listValues(): RuntimeSettingValue[] {
    return listRuntimeSettingDefinitions().map((definition) => this.getValue(definition.key));
  }

  getValue(key: RuntimeSettingKey): RuntimeSettingValue {
    const override = this.database.getAppSetting(key);
    const defaultValue = getRuntimeSettingDefaultValue(this.config, key);
    const value = override ? Number.parseInt(override.value, 10) : defaultValue;

    return buildRuntimeSettingValue(
      this.config,
      key,
      Number.isSafeInteger(value) ? value : defaultValue,
      override ? "override" : "default",
      override?.updatedAt ?? null,
      override?.updatedByUserId ?? null
    );
  }

  setNumericValue(key: RuntimeSettingKey, value: number, updatedByUserId: string | undefined): RuntimeSettingValue {
    this.database.setAppSetting(key, String(value), updatedByUserId);
    const savedValue = this.getValue(key);
    this.notifyListeners(savedValue.key, savedValue.value);
    return savedValue;
  }

  resetValue(key: RuntimeSettingKey): RuntimeSettingValue {
    this.database.deleteAppSetting(key);
    const resetValue = this.getValue(key);
    this.notifyListeners(resetValue.key, resetValue.value);
    return resetValue;
  }

  subscribe(listener: (key: RuntimeSettingKey, value: number) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private getNumericValue(key: RuntimeSettingKey): number {
    return this.getValue(key).value;
  }

  private notifyListeners(key: RuntimeSettingKey, value: number): void {
    for (const listener of this.listeners) {
      listener(key, value);
    }
  }
}
