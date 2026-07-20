import fs from "node:fs";

import { loadConfig } from "./config";
import { VacancyDatabase } from "./db/database";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

try {
  const config = loadConfig();

  fs.accessSync(config.appDataDir, fs.constants.R_OK | fs.constants.W_OK);

  const database = new VacancyDatabase(config);
  try {
    database.initialize();
    database.healthcheck();
  } finally {
    database.close();
  }

  if (!fs.existsSync(config.heartbeatPath)) {
    fail(`Heartbeat file is missing: ${config.heartbeatPath}`);
  }

  const heartbeat = JSON.parse(fs.readFileSync(config.heartbeatPath, "utf8")) as { updatedAt?: string };
  if (!heartbeat.updatedAt) {
    fail("Heartbeat file does not contain updatedAt.");
  }

  const heartbeatAgeMs = Date.now() - Date.parse(heartbeat.updatedAt);
  const maxAgeMs = config.heartbeatIntervalSeconds * 3000;
  if (Number.isNaN(heartbeatAgeMs) || heartbeatAgeMs > maxAgeMs) {
    fail(`Heartbeat is stale. Age ms: ${heartbeatAgeMs}`);
  }

  console.log("ok");
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
