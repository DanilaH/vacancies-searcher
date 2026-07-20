import test from "node:test";
import assert from "node:assert/strict";

import {
  parseChannelBatchInput,
  parseChannelDiscoverySeedBatch,
  parseLimitedChannelBatchInput,
  validateChannelInput
} from "../src/services/channelValidation";

test("parseChannelBatchInput supports commas, spaces and mixed separators", () => {
  assert.deepEqual(parseChannelBatchInput("Remoteit,jobs_in_it_remoute,workayte"), [
    "Remoteit",
    "jobs_in_it_remoute",
    "workayte"
  ]);
  assert.deepEqual(parseChannelBatchInput("Remoteit jobs_in_it_remoute workayte"), [
    "Remoteit",
    "jobs_in_it_remoute",
    "workayte"
  ]);
  assert.deepEqual(parseChannelBatchInput("@Remoteit,@jobs_in_it_remoute,@workayte"), [
    "@Remoteit",
    "@jobs_in_it_remoute",
    "@workayte"
  ]);
  assert.deepEqual(parseChannelBatchInput("@Remoteit @jobs_in_it_remoute @workayte"), [
    "@Remoteit",
    "@jobs_in_it_remoute",
    "@workayte"
  ]);
  assert.deepEqual(parseChannelBatchInput("@Remoteit,\n@jobs_in_it_remoute\tworkayte"), [
    "@Remoteit",
    "@jobs_in_it_remoute",
    "workayte"
  ]);
});

test("validateChannelInput accepts usernames and public t.me links", () => {
  assert.deepEqual(validateChannelInput("@job_react"), { ok: true, value: "job_react" });
  assert.deepEqual(validateChannelInput("https://t.me/job_react"), { ok: true, value: "job_react" });
  assert.deepEqual(validateChannelInput("https://t.me/s/job_react"), { ok: true, value: "job_react" });
  assert.deepEqual(validateChannelInput("t.me/job_react/123"), { ok: true, value: "job_react" });
});

test("validateChannelInput rejects private or malformed links", () => {
  assert.equal(validateChannelInput("https://t.me/+abcdef").ok, false);
  assert.equal(validateChannelInput("https://t.me/joinchat/abcdef").ok, false);
  assert.equal(validateChannelInput("https://t.me/c/123/456").ok, false);
  assert.equal(validateChannelInput("@bad").ok, false);
  assert.equal(validateChannelInput("   ").ok, false);
});

test("parseChannelDiscoverySeedBatch normalizes mixed input and reports duplicates, invalid entries and truncation", () => {
  const result = parseChannelDiscoverySeedBatch(
    "@Remoteit, https://t.me/s/jobs_in_it_remoute remoteit bad https://t.me/workayte extra_channel",
    3
  );

  assert.deepEqual(result.usernames, ["remoteit", "jobs_in_it_remoute", "workayte"]);
  assert.deepEqual(result.duplicates, ["remoteit"]);
  assert.deepEqual(result.invalid, ["bad"]);
  assert.equal(result.totalEntries, 6);
  assert.equal(result.truncated, 1);
});

test("parseLimitedChannelBatchInput caps unique valid channels without counting invalid entries or duplicates", () => {
  const result = parseLimitedChannelBatchInput(
    "@channel_1 bad @channel_1 @channel_2 @channel_3 @channel_4",
    3
  );

  assert.deepEqual(result.usernames, ["channel_1", "channel_2", "channel_3"]);
  assert.deepEqual(result.duplicates, ["channel_1"]);
  assert.deepEqual(result.invalid, ["bad"]);
  assert.equal(result.totalEntries, 6);
  assert.equal(result.truncated, 1);
});
