import "dotenv/config";

import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";

function requireTelegramEnv(name: "TELEGRAM_API_ID" | "TELEGRAM_API_HASH"): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name} in .env`);
  }

  return value;
}

async function main(): Promise<void> {
  const apiId = Number.parseInt(requireTelegramEnv("TELEGRAM_API_ID"), 10);
  const apiHash = requireTelegramEnv("TELEGRAM_API_HASH");

  if (!Number.isInteger(apiId) || apiId <= 0) {
    throw new Error("TELEGRAM_API_ID must be a positive integer.");
  }

  const rl = createInterface({ input, output });
  const stringSession = new StringSession("");
  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5
  });

  try {
    await client.start({
      phoneNumber: async () => rl.question("Phone number in international format: "),
      password: async () => rl.question("2FA password (leave empty if disabled): "),
      phoneCode: async () => rl.question("Telegram login code: "),
      onError: (error) => {
        console.error("Telegram auth error:", error);
      }
    });

    console.log("");
    console.error("Treat TELEGRAM_SESSION as a secret. Do not paste it into chats, tickets, or shell logs.");
    console.log("Copy this value into .env:");
    console.log(`TELEGRAM_SESSION=${client.session.save()}`);
  } finally {
    rl.close();
    await client.disconnect();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
