import { AppConfig } from "../config";
import { VacancyDatabase } from "../db/database";
import { RuntimeSettingsService } from "../runtime/runtimeSettings";
import { ChannelRegistry, VacancySource } from "../types";
import { CompanyCareersSource } from "./companyCareersSource";
import { HhApiSource } from "./hhApiSource";
import { TelegramWebPreviewSource } from "./telegramWebPreviewSource";

export async function createVacancySource(
  config: AppConfig,
  channelRegistry?: ChannelRegistry,
  runtimeSettings?: RuntimeSettingsService
): Promise<VacancySource> {
  if (config.telegramSourceMode === "mtproto") {
    const { TelegramMtprotoSource } = await import("./telegramMtprotoSource.js");
    return new TelegramMtprotoSource(config, { channelRegistry });
  }

  return new TelegramWebPreviewSource(config, { channelRegistry, runtimeSettings });
}

export async function createVacancySources(
  config: AppConfig,
  database: VacancyDatabase,
  channelRegistry?: ChannelRegistry,
  runtimeSettings?: RuntimeSettingsService
): Promise<VacancySource[]> {
  const sources = [await createVacancySource(config, channelRegistry, runtimeSettings)];

  if (config.hhSourceEnabled) {
    sources.push(new HhApiSource(config, database));
  }

  if (config.companyCareersSourceEnabled) {
    sources.push(new CompanyCareersSource(config, database));
  }

  return sources;
}
