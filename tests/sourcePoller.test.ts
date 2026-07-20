import test from "node:test";
import assert from "node:assert/strict";

import { SourcePoller } from "../src/services/sourcePoller";
import { VacancySource } from "../src/types";

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

test("SourcePoller applies a smaller interval immediately after runtime update", async () => {
  let currentIntervalSeconds = 0.2;
  let fetchCount = 0;
  let intervalChangeListener: (() => void) | undefined;

  const source: VacancySource = {
    name: "telegram_web_preview",
    async fetchLatest() {
      fetchCount += 1;
      if (fetchCount === 2) {
        currentIntervalSeconds = 999;
      }
      return [];
    },
    async stop() {}
  };

  const poller = new SourcePoller(
    source,
    async () => currentIntervalSeconds,
    async () => [],
    undefined,
    (listener) => {
      intervalChangeListener = listener;
      return () => {
        intervalChangeListener = undefined;
      };
    }
  );

  await poller.start();
  await sleep(80);

  currentIntervalSeconds = 0.02;
  intervalChangeListener?.();

  await sleep(120);
  await poller.stop();

  assert.equal(fetchCount, 2);
});

test("SourcePoller runs the first search immediately on start", async () => {
  let fetchCount = 0;
  const source: VacancySource = {
    name: "telegram_web_preview",
    async fetchLatest() {
      fetchCount += 1;
      return [];
    },
    async stop() {}
  };
  const poller = new SourcePoller(source, async () => 999, async () => []);

  await poller.start();
  await poller.stop();

  assert.equal(fetchCount, 1);
});
