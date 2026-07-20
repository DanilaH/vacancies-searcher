import pino from "pino";

const transport =
  process.env.NODE_ENV !== "production"
    ? pino.transport({
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
          ignore: "pid,hostname"
        }
      })
    : undefined;

export const logger = pino(
  {
    level: process.env.LOG_LEVEL ?? "info",
    redact: {
      paths: [
        "config.botToken",
        "config.ownerChatId",
        "config.ownerUserId",
        "config.telegramApiId",
        "config.telegramApiHash",
        "config.telegramSession",
        "botToken",
        "ownerChatId",
        "ownerNotificationChatId",
        "ownerUserId",
        "telegramApiId",
        "telegramApiHash",
        "telegramSession"
      ],
      censor: "[REDACTED]"
    }
  },
  transport
);
