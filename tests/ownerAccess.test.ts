import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createPublicAccessMiddleware, DISABLED_USER_MESSAGE } from "../src/bot/access";
import { VacancyDatabase } from "../src/db/database";
import { createTestConfig } from "./helpers";

function createTempDatabaseConfig() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-tg-bot-access-"));
  return createTestConfig({
    ownerUserId: "777",
    ownerChatId: "777",
    databasePath: path.join(tempDir, "bot.db"),
    databaseUrl: `file:${path.join(tempDir, "bot.db")}`,
    appDataDir: tempDir,
    runtimeDir: path.join(tempDir, "runtime")
  });
}

test("unknown user is auto-registered and can use commands", async () => {
  let nextCalled = false;
  const registeredUserIds: string[] = [];
  const config = createTempDatabaseConfig();
  const database = new VacancyDatabase(config);
  database.initialize();

  const middleware = createPublicAccessMiddleware(database, {
    onPublicUserRegistered: async (_ctx, user) => {
      registeredUserIds.push(user.userId);
    }
  });
  await middleware(
    {
      from: { id: 123456 },
      message: { text: "/start" },
      callbackQuery: undefined,
      reply: async () => {}
    } as never,
    async () => {
      nextCalled = true;
    }
  );

  const createdUser = database.getBotUser("123456");
  database.close();

  assert.equal(nextCalled, true);
  assert.deepEqual(registeredUserIds, ["123456"]);
  assert.equal(createdUser?.role, "member");
  assert.equal(createdUser?.isActive, true);
});

test("known public user does not trigger registration notification again", async () => {
  let nextCallCount = 0;
  const registeredUserIds: string[] = [];
  const config = createTempDatabaseConfig();
  const database = new VacancyDatabase(config);
  database.initialize();

  const middleware = createPublicAccessMiddleware(database, {
    onPublicUserRegistered: async (_ctx, user) => {
      registeredUserIds.push(user.userId);
    }
  });
  const ctx = {
    from: { id: 123456 },
    message: { text: "/start" },
    callbackQuery: undefined,
    reply: async () => {}
  } as never;

  await middleware(ctx, async () => {
    nextCallCount += 1;
  });
  await middleware(ctx, async () => {
    nextCallCount += 1;
  });

  database.close();

  assert.equal(nextCallCount, 2);
  assert.deepEqual(registeredUserIds, ["123456"]);
});

test("registration notification errors do not block the user", async () => {
  let nextCalled = false;
  const config = createTempDatabaseConfig();
  const database = new VacancyDatabase(config);
  database.initialize();

  const middleware = createPublicAccessMiddleware(database, {
    onPublicUserRegistered: async () => {
      throw new Error("telegram is sleepy");
    }
  });
  await middleware(
    {
      from: { id: 123456 },
      message: { text: "/start" },
      callbackQuery: undefined,
      reply: async () => {}
    } as never,
    async () => {
      nextCalled = true;
    }
  );

  const createdUser = database.getBotUser("123456");
  database.close();

  assert.equal(nextCalled, true);
  assert.equal(createdUser?.isActive, true);
});

test("disabled user cannot use commands and is not auto-reactivated", async () => {
  let nextCalled = false;
  let repliedText: string | null = null;
  const registeredUserIds: string[] = [];
  const config = createTempDatabaseConfig();
  const database = new VacancyDatabase(config);
  database.initialize();
  database.addOrActivateBotUser("123456", "member", config.ownerUserId);
  database.setBotUserActive("123456", false);

  const middleware = createPublicAccessMiddleware(database, {
    onPublicUserRegistered: async (_ctx, user) => {
      registeredUserIds.push(user.userId);
    }
  });
  await middleware(
    {
      from: { id: 123456 },
      message: { text: "/start" },
      callbackQuery: undefined,
      reply: async (text: string) => {
        repliedText = text;
      }
    } as never,
    async () => {
      nextCalled = true;
    }
  );

  const user = database.getBotUser("123456");
  database.close();

  assert.equal(nextCalled, false);
  assert.deepEqual(registeredUserIds, []);
  assert.equal(repliedText, DISABLED_USER_MESSAGE);
  assert.equal(user?.isActive, false);
});

test("disabled user cannot use callbacks", async () => {
  let nextCalled = false;
  let callbackAnswer: string | null = null;
  const registeredUserIds: string[] = [];
  const config = createTempDatabaseConfig();
  const database = new VacancyDatabase(config);
  database.initialize();
  database.addOrActivateBotUser("123456", "member", config.ownerUserId);
  database.setBotUserActive("123456", false);

  const middleware = createPublicAccessMiddleware(database, {
    onPublicUserRegistered: async (_ctx, user) => {
      registeredUserIds.push(user.userId);
    }
  });
  await middleware(
    {
      from: { id: 123456 },
      callbackQuery: { id: "cb-1" },
      answerCallbackQuery: async (payload?: { text?: string }) => {
        callbackAnswer = payload?.text ?? null;
      },
      reply: async () => {}
    } as never,
    async () => {
      nextCalled = true;
    }
  );
  database.close();

  assert.equal(nextCalled, false);
  assert.deepEqual(registeredUserIds, []);
  assert.equal(callbackAnswer, DISABLED_USER_MESSAGE);
});
