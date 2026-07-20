import test from "node:test";
import assert from "node:assert/strict";

import type { ApiCallFn } from "grammy";

import { disableTextLinkPreviews } from "../src/bot/linkPreview";

test("global Telegram transformer disables previews for sent and edited text messages", async () => {
  const calls: Array<{ method: string; payload: Record<string, unknown> }> = [];
  const next = (async (method: string, payload: Record<string, unknown>) => {
    calls.push({ method, payload });
    return { ok: true, result: true };
  }) as ApiCallFn;

  await disableTextLinkPreviews(next, "sendMessage", { chat_id: 1, text: "https://example.com" });
  await disableTextLinkPreviews(next, "editMessageText", {
    chat_id: 1,
    message_id: 2,
    text: "https://example.com"
  });

  assert.deepEqual(calls[0]?.payload.link_preview_options, { is_disabled: true });
  assert.deepEqual(calls[1]?.payload.link_preview_options, { is_disabled: true });
});

test("global Telegram transformer leaves non-text methods unchanged", async () => {
  const calls: Array<{ method: string; payload: Record<string, unknown> }> = [];
  const next = (async (method: string, payload: Record<string, unknown>) => {
    calls.push({ method, payload });
    return { ok: true, result: true };
  }) as ApiCallFn;
  const payload = { chat_id: 1, document: "file-id" };

  await disableTextLinkPreviews(next, "sendDocument", payload);

  assert.deepEqual(calls[0]?.payload, payload);
  assert.equal("link_preview_options" in payload, false);
});
