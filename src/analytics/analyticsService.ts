import { PostHog } from "posthog-node";

import { AppConfig } from "../config";
import { VacancyDatabase } from "../db/database";
import { logger } from "../logger";
import {
  AnalyticsCaptureInput,
  AnalyticsEventName,
  AnalyticsIdentifyInput,
  AnalyticsProperties
} from "../types";

type AnalyticsSinkCapture = {
  eventName: AnalyticsEventName;
  distinctId: string;
  userId: string | null;
  properties: AnalyticsProperties;
  occurredAt: string;
};

interface AnalyticsSink {
  capture(event: AnalyticsSinkCapture): Promise<void>;
  identify?(input: AnalyticsIdentifyInput): Promise<void>;
  shutdown?(): Promise<void>;
}

class PostHogAnalyticsSink implements AnalyticsSink {
  private readonly client: PostHog;

  constructor(apiKey: string, host: string) {
    this.client = new PostHog(apiKey, {
      host,
      flushAt: 1,
      flushInterval: 0
    });
  }

  async capture(event: AnalyticsSinkCapture): Promise<void> {
    this.client.capture({
      distinctId: event.distinctId,
      event: event.eventName,
      properties: event.properties
    });
  }

  async identify(input: AnalyticsIdentifyInput): Promise<void> {
    this.client.identify({
      distinctId: input.distinctId,
      properties: input.properties ?? {}
    });
  }

  async shutdown(): Promise<void> {
    await this.client.shutdown();
  }
}

export class AnalyticsService {
  constructor(
    private readonly database: VacancyDatabase,
    private readonly config: AppConfig,
    private readonly sinks: AnalyticsSink[] = []
  ) {}

  async capture(input: AnalyticsCaptureInput): Promise<void> {
    const event = this.buildCaptureEvent(input);

    try {
      this.database.recordAnalyticsEvent({
        eventName: event.eventName,
        distinctId: event.distinctId,
        userId: event.userId,
        properties: event.properties,
        occurredAt: event.occurredAt
      });
    } catch (error) {
      logger.warn({ err: error, eventName: event.eventName }, "Failed to persist analytics event locally.");
    }

    for (const sink of this.sinks) {
      try {
        await sink.capture(event);
      } catch (error) {
        logger.warn({ err: error, eventName: event.eventName }, "Failed to forward analytics event to external sink.");
      }
    }
  }

  async identify(input: AnalyticsIdentifyInput): Promise<void> {
    if (this.sinks.length === 0) {
      return;
    }

    const properties = {
      ...this.buildCommonProperties(),
      ...(input.properties ?? {})
    };

    for (const sink of this.sinks) {
      if (!sink.identify) {
        continue;
      }

      try {
        await sink.identify({
          distinctId: input.distinctId,
          userId: input.userId ?? null,
          properties
        });
      } catch (error) {
        logger.warn({ err: error, distinctId: input.distinctId }, "Failed to identify analytics user in external sink.");
      }
    }
  }

  async shutdown(): Promise<void> {
    for (const sink of this.sinks) {
      if (!sink.shutdown) {
        continue;
      }

      try {
        await sink.shutdown();
      } catch (error) {
        logger.warn({ err: error }, "Failed to shut down analytics sink cleanly.");
      }
    }
  }

  private buildCaptureEvent(input: AnalyticsCaptureInput): AnalyticsSinkCapture {
    const distinctId = input.distinctId ?? input.userId ?? "system:bot";

    return {
      eventName: input.eventName,
      distinctId,
      userId: input.userId ?? null,
      properties: {
        ...this.buildCommonProperties(),
        ...(input.properties ?? {})
      },
      occurredAt: input.occurredAt ?? new Date().toISOString()
    };
  }

  private buildCommonProperties(): AnalyticsProperties {
    return {
      environment: this.config.nodeEnv,
      telegram_source_mode: this.config.telegramSourceMode
    };
  }
}

export function createAnalyticsService(config: AppConfig, database: VacancyDatabase): AnalyticsService {
  const sinks: AnalyticsSink[] = [];

  if (config.posthogApiKey) {
    sinks.push(new PostHogAnalyticsSink(config.posthogApiKey, config.posthogHost ?? "https://us.i.posthog.com"));
  }

  return new AnalyticsService(database, config, sinks);
}
