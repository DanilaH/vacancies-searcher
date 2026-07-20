import { VacancyDatabase } from "../db/database";
import { MonitoredChannel, SourceName } from "../types";

export type ChannelHealthAlert =
  | {
      kind: "failure";
      channel: MonitoredChannel;
      errorMessage: string;
      alertedAt: string;
    }
  | {
      kind: "stale";
      channel: MonitoredChannel;
      staleForMs: number;
      staleThresholdMs: number;
      alertedAt: string;
    };

export class ChannelHealthMonitor {
  constructor(
    private readonly database: VacancyDatabase,
    private readonly nowProvider: () => number = () => Date.now()
  ) {}

  collectAlerts(sourceName: SourceName, checkIntervalSeconds: number): ChannelHealthAlert[] {
    const channels = this.database.listActiveChannels(sourceName);
    const nowMs = this.nowProvider();
    const staleThresholdMs = Math.max(checkIntervalSeconds * 4 * 1000, 15 * 60 * 1000);
    const alerts: ChannelHealthAlert[] = [];

    for (const channel of channels) {
      const alertState = this.database.getChannelAlertState(channel.id);

      if (channel.lastError) {
        const signature = channel.lastError.trim();
        if (!signature) {
          continue;
        }

        if (alertState?.failure_signature === signature) {
          continue;
        }

        this.database.markChannelFailureAlert(channel.id, signature);
        alerts.push({
          kind: "failure",
          channel,
          errorMessage: signature,
          alertedAt: new Date(nowMs).toISOString()
        });
        continue;
      }

      const referenceTimestamp = channel.lastSuccessAt ?? channel.lastCheckedAt;
      if (!referenceTimestamp) {
        continue;
      }

      const parsedReference = Date.parse(referenceTimestamp);
      if (Number.isNaN(parsedReference)) {
        continue;
      }

      const staleForMs = nowMs - parsedReference;
      if (staleForMs < staleThresholdMs) {
        continue;
      }

      if (alertState?.stale_reference === referenceTimestamp) {
        continue;
      }

      this.database.markChannelStaleAlert(channel.id, referenceTimestamp);
      alerts.push({
        kind: "stale",
        channel,
        staleForMs,
        staleThresholdMs,
        alertedAt: new Date(nowMs).toISOString()
      });
    }

    return alerts;
  }
}
