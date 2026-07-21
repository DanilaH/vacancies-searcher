import test from "node:test";
import assert from "node:assert/strict";

import { sleep } from "../src/utils/sleep";

test("sleep resolves after a positive delay", async () => {
  const start = Date.now();
  await sleep(50);
  const elapsed = Date.now() - start;
  assert.ok(elapsed >= 45, `expected >= 45ms, got ${elapsed}ms`);
});

test("sleep resolves immediately for zero delay", async () => {
  const start = Date.now();
  await sleep(0);
  assert.ok(Date.now() - start < 50);
});

test("sleep resolves immediately for negative delay", async () => {
  const start = Date.now();
  await sleep(-10);
  assert.ok(Date.now() - start < 50);
});
