import test from "node:test";
import assert from "node:assert/strict";

import { loadConfig } from "../src/config";

function withEnv(overrides: Record<string, string | undefined>, run: () => void): void {
  const previousEnv = { ...process.env };

  try {
    process.env = {
      ...previousEnv,
      NODE_ENV: "development",
      BOT_TOKEN: "test-token",
      DATABASE_URL: "file:./data/bot.db",
      CHANNELS: "job_react,rabotafrontend",
      ...overrides
    };

    run();
  } finally {
    process.env = previousEnv;
  }
}

test("loadConfig normalizes @channel usernames safely", () => {
  withEnv(
    {
      CHANNELS: "@job_react, @rabotafrontend"
    },
    () => {
      const config = loadConfig();
      assert.deepEqual(config.channels, ["job_react", "rabotafrontend"]);
    }
  );
});

test("loadConfig rejects unsafe channel usernames", () => {
  withEnv(
    {
      CHANNELS: "job_react,https://evil.com"
    },
    () => {
      assert.throws(() => loadConfig(), /Invalid channel username/);
    }
  );
});

test("loadConfig rejects database paths outside the data directory", () => {
  withEnv(
    {
      DATABASE_URL: "file:../bot.db"
    },
    () => {
      assert.throws(() => loadConfig(), /DATABASE_URL must point to a SQLite file inside/);
    }
  );
});

test("loadConfig requires HH_USER_AGENT when hh source is enabled", () => {
  withEnv(
    {
      HH_SOURCE_ENABLED: "true",
      HH_USER_AGENT: undefined
    },
    () => {
      assert.throws(() => loadConfig(), /HH_SOURCE_ENABLED=true requires HH_USER_AGENT/);
    }
  );
});

test("loadConfig keeps web mode independent from MTProto discovery credentials", () => {
  withEnv(
    {
      TELEGRAM_SOURCE_MODE: "web",
      TELEGRAM_API_ID: undefined,
      TELEGRAM_API_HASH: undefined,
      TELEGRAM_SESSION: undefined,
      CHANNEL_DISCOVERY_MAX_CANDIDATES: "25"
    },
    () => {
      const config = loadConfig();
      assert.equal(config.telegramSourceMode, "web");
      assert.equal(config.telegramApiId, undefined);
      assert.equal(config.channelDiscoveryMaxCandidates, 25);
    }
  );
});

test("loadConfig requires MTProto credentials only when MTProto polling mode is enabled", () => {
  withEnv(
    {
      TELEGRAM_SOURCE_MODE: "mtproto",
      TELEGRAM_API_ID: "123",
      TELEGRAM_API_HASH: "hash",
      TELEGRAM_SESSION: undefined
    },
    () => {
      assert.throws(
        () => loadConfig(),
        /TELEGRAM_SOURCE_MODE=mtproto requires TELEGRAM_API_ID, TELEGRAM_API_HASH and TELEGRAM_SESSION/
      );
    }
  );
});

test("loadConfig enables conservative technical cleanup defaults", () => {
  withEnv(
    {
      TECHNICAL_CLEANUP_ENABLED: undefined,
      ANALYTICS_RETENTION_DAYS: undefined,
      CHANNEL_DISCOVERY_RUN_RETENTION_DAYS: undefined,
      CHANNEL_DISCOVERY_CHECK_RETENTION_DAYS: undefined
    },
    () => {
      const config = loadConfig();
      assert.equal(config.technicalCleanupEnabled, true);
      assert.equal(config.analyticsRetentionDays, 90);
      assert.equal(config.channelDiscoveryRunRetentionDays, 30);
      assert.equal(config.channelDiscoveryCheckRetentionDays, 180);
    }
  );
});

test("loadConfig rejects unsafe technical cleanup retention values", () => {
  withEnv(
    {
      ANALYTICS_RETENTION_DAYS: "0"
    },
    () => {
      assert.throws(() => loadConfig(), /ANALYTICS_RETENTION_DAYS must be an integer between 1 and 3650/);
    }
  );
});

test("loadConfig enables conservative automatic backup defaults", () => {
  withEnv(
    {
      AUTOMATIC_BACKUP_ENABLED: undefined,
      AUTOMATIC_BACKUP_INTERVAL_HOURS: undefined,
      AUTOMATIC_BACKUP_RETENTION_DAYS: undefined
    },
    () => {
      const config = loadConfig();
      assert.equal(config.automaticBackupEnabled, true);
      assert.equal(config.automaticBackupIntervalHours, 24);
      assert.equal(config.automaticBackupRetentionDays, 14);
    }
  );
});

test("loadConfig rejects unsafe automatic backup values", () => {
  withEnv(
    {
      AUTOMATIC_BACKUP_INTERVAL_HOURS: "0"
    },
    () => {
      assert.throws(() => loadConfig(), /AUTOMATIC_BACKUP_INTERVAL_HOURS must be an integer between 1 and 168/);
    }
  );
});
