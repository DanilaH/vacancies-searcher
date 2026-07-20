import test from "node:test";
import assert from "node:assert/strict";

import { extractContacts } from "../src/services/contactExtractor";

test("extractContacts finds telegram usernames, emails and urls", () => {
  const contacts = extractContacts(`
    Write to @frontend_jobs or https://t.me/frontend_jobs
    Email hr@example.com
    Portfolio https://example.com/jobs
  `);

  assert.deepEqual(contacts, [
    { type: "telegram", value: "@frontend_jobs" },
    { type: "email", value: "hr@example.com" },
    { type: "url", value: "https://example.com/jobs" }
  ]);
});

test("extractContacts caps the number of extracted contacts from untrusted text", () => {
  const text = Array.from({ length: 40 }, (_, index) => `@user_${index + 1000}`).join(" ");
  const contacts = extractContacts(text);

  assert.ok(contacts.length <= 25);
});
