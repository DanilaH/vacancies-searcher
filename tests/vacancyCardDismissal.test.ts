import assert from "node:assert/strict";
import test from "node:test";

import { dismissHiddenVacancyCardMessage } from "../src/bot/createBot";
import { createHiddenVacancyReceiptKeyboard } from "../src/bot/keyboards";

test("dismissHiddenVacancyCardMessage deletes the current vacancy card", async () => {
  let deleted = 0;
  let edited = 0;

  await dismissHiddenVacancyCardMessage({
    deleteMessage: async () => {
      deleted += 1;
      return true;
    },
    editMessageText: async () => {
      edited += 1;
      return undefined as never;
    }
  });

  assert.equal(deleted, 1);
  assert.equal(edited, 0);
});

test("dismissHiddenVacancyCardMessage falls back to a compact hidden state", async () => {
  let fallbackText = "";
  let fallbackOptions: unknown;
  const fallbackKeyboard = createHiddenVacancyReceiptKeyboard(42);

  await dismissHiddenVacancyCardMessage({
    deleteMessage: async () => {
      throw new Error("delete denied");
    },
    editMessageText: async (text: string, options: unknown) => {
      fallbackText = text;
      fallbackOptions = options;
      return undefined as never;
    }
  }, fallbackKeyboard);

  assert.equal(fallbackText, "👎 Больше не показываю эту вакансию.");
  assert.deepEqual(fallbackOptions, { reply_markup: fallbackKeyboard });
});
