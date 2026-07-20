import assert from "node:assert/strict";
import test from "node:test";

import { splitTelegramMultiVacancyPost } from "../src/services/telegramMultiVacancySplitter";
import type { RawVacancyItem } from "../src/types";

function aggregatePost(): RawVacancyItem {
  return {
    source: "telegram_web_preview",
    channel: "findmyremote_frontend",
    messageId: "887",
    url: "https://t.me/findmyremote_frontend/887",
    date: "2026-06-12T08:00:00.000Z",
    text: [
      "Senior Front-End Developer (React, JS) @ Miratech",
      "Posted: 11 Jun 2026",
      "Employment: Full-time",
      "Locations: Brazil",
      "",
      "Senior Software Engineer (Frontend) @ SiteMinder",
      "Posted: 11 Jun 2026",
      "Employment: Full-time",
      "Locations: Estonia"
    ].join("\n"),
    linkEntities: [
      {
        text: "Senior Front-End Developer (React, JS)",
        url: "https://findmyremote.ai/companies/miratech/jobs/senior-frontend-1",
        position: 0
      },
      {
        text: "Senior Software Engineer (Frontend)",
        url: "https://findmyremote.ai/companies/siteminder/jobs/frontend-2",
        position: 1
      }
    ]
  };
}

test("splitTelegramMultiVacancyPost creates stable child vacancies with their own fields", () => {
  const first = splitTelegramMultiVacancyPost(aggregatePost());
  const second = splitTelegramMultiVacancyPost(aggregatePost());

  assert.equal(first.split, true);
  assert.equal(first.items.length, 2);
  assert.equal(first.items[0]?.cursorMessageId, "887");
  assert.equal(first.items[1]?.cursorMessageId, "887");
  assert.match(first.items[0]?.messageId ?? "", /^887:child:[a-f0-9]{16}$/u);
  assert.equal(first.items[0]?.messageId, second.items[0]?.messageId);
  assert.equal(first.items[0]?.canonicalUrl, "https://findmyremote.ai/companies/miratech/jobs/senior-frontend-1");
  assert.match(first.items[0]?.text ?? "", /Locations: Brazil/u);
  assert.doesNotMatch(first.items[0]?.text ?? "", /Estonia/u);
  assert.match(first.items[1]?.text ?? "", /Locations: Estonia/u);
});

test("splitTelegramMultiVacancyPost keeps uncertain posts intact", () => {
  const item = aggregatePost();
  item.text = "Several frontend roles are available. Open the links for details.";

  const result = splitTelegramMultiVacancyPost(item);

  assert.equal(result.split, false);
  assert.deepEqual(result.items, [item]);
});
