import assert from "node:assert/strict";
import test from "node:test";

import { ActionCooldown } from "../src/services/actionCooldown";

test("ActionCooldown blocks repeated acquisition until the cooldown expires", () => {
  let now = 1_000;
  const cooldown = new ActionCooldown(() => now);

  assert.deepEqual(cooldown.tryAcquire("user-rematch:1", 60_000), { allowed: true });
  assert.deepEqual(cooldown.tryAcquire("user-rematch:1", 60_000), {
    allowed: false,
    retryAfterSeconds: 60
  });

  now += 59_001;
  assert.deepEqual(cooldown.tryAcquire("user-rematch:1", 60_000), {
    allowed: false,
    retryAfterSeconds: 1
  });

  now += 999;
  assert.deepEqual(cooldown.tryAcquire("user-rematch:1", 60_000), { allowed: true });
});

test("ActionCooldown keeps independent action keys separate", () => {
  const cooldown = new ActionCooldown(() => 1_000);

  assert.deepEqual(cooldown.tryAcquire("user-rematch:1", 60_000), { allowed: true });
  assert.deepEqual(cooldown.tryAcquire("user-rematch:2", 60_000), { allowed: true });
  assert.deepEqual(cooldown.tryAcquire("channel-discovery", 300_000), { allowed: true });
});

test("ActionCooldown release allows an immediate retry", () => {
  const cooldown = new ActionCooldown(() => 1_000);

  assert.deepEqual(cooldown.tryAcquire("backup", 600_000), { allowed: true });
  assert.deepEqual(cooldown.tryAcquire("backup", 600_000), {
    allowed: false,
    retryAfterSeconds: 600
  });

  cooldown.release("backup");

  assert.deepEqual(cooldown.tryAcquire("backup", 600_000), { allowed: true });
});
