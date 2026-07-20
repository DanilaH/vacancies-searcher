import test from "node:test";
import assert from "node:assert/strict";

import {
  appendVacancyCardOrigin,
  encodeVacancyCardOrigin,
  parseVacancyCardOrigin,
  weeklyCallbackForVacancyCardOrigin
} from "../src/bot/vacancyCardOrigin";

test("vacancy card origin round-trips global and profile weekly pages", () => {
  assert.deepEqual(parseVacancyCardOrigin(encodeVacancyCardOrigin({ offset: 10 })), { offset: 10 });
  assert.deepEqual(parseVacancyCardOrigin(encodeVacancyCardOrigin({ profileId: 7, offset: 35 })), {
    profileId: 7,
    offset: 35
  });
  assert.deepEqual(parseVacancyCardOrigin(encodeVacancyCardOrigin({ offset: 10, days: 14 })), { offset: 10, days: 14 });
  assert.deepEqual(parseVacancyCardOrigin(encodeVacancyCardOrigin({ profileId: 7, offset: 35, days: 30 })), {
    profileId: 7,
    offset: 35,
    days: 30
  });
  assert.equal(weeklyCallbackForVacancyCardOrigin({ offset: 10 }), "week:10");
  assert.equal(weeklyCallbackForVacancyCardOrigin({ profileId: 7, offset: 35 }), "week:profile:7:35");
  assert.equal(weeklyCallbackForVacancyCardOrigin({ offset: 10, days: 14 }), "week:14:10");
  assert.equal(weeklyCallbackForVacancyCardOrigin({ profileId: 7, offset: 35, days: 30 }), "week:profile:7:30:35");
});

test("vacancy card origin never pushes callback data past Telegram limit", () => {
  const baseCallback = "x".repeat(64);

  assert.equal(appendVacancyCardOrigin(baseCallback, { profileId: 7, offset: 10 }), baseCallback);
  assert.equal(appendVacancyCardOrigin("vacancy:view:42:compact", { offset: 10 }), "vacancy:view:42:compact:wa");
});
