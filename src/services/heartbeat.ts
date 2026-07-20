import fs from "node:fs";

import { logger } from "../logger";

export class RuntimeHeartbeat {
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly heartbeatPath: string,
    private readonly intervalSeconds: number,
    private readonly metadata: Record<string, unknown>
  ) {}

  start(): void {
    this.writeHeartbeat();
    this.timer = setInterval(() => this.writeHeartbeat(), this.intervalSeconds * 1000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.writeHeartbeat("stopping");
  }

  ping(): void {
    this.writeHeartbeat();
  }

  private writeHeartbeat(status = "ok"): void {
    try {
      fs.writeFileSync(
        this.heartbeatPath,
        JSON.stringify(
          {
            status,
            updatedAt: new Date().toISOString(),
            pid: process.pid,
            ...this.metadata
          },
          null,
          2
        )
      );
    } catch (error) {
      logger.warn({ err: error }, "Failed to write heartbeat file.");
    }
  }
}
