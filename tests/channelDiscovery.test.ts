import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { VacancyDatabase } from "../src/db/database";
import { ChannelDiscoveryMtprotoClient, ChannelDiscoveryService } from "../src/services/channelDiscovery";
import { createTestConfig } from "./helpers";

function createTempDatabaseConfig(overrides = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-tg-bot-discovery-"));
  return createTestConfig({
    ownerUserId: "777",
    ownerChatId: "777",
    channels: [],
    databasePath: path.join(tempDir, "bot.db"),
    databaseUrl: `file:${path.join(tempDir, "bot.db")}`,
    appDataDir: tempDir,
    runtimeDir: path.join(tempDir, "runtime"),
    channelDiscoveryRequestDelayMs: 0,
    channelDiscoveryMaxCandidates: 20,
    channelDiscoverySamplePosts: 30,
    ...overrides
  });
}

function createPreviewHtml(channel: string, posts: string[]): string {
  return posts
    .map(
      (text, index) => `
        <article class="tgme_widget_message" data-post="${channel}/${100 + index}">
          <div class="tgme_widget_message_text">${text}</div>
          <time datetime="2026-06-03T10:00:00+00:00"></time>
        </article>
      `
    )
    .join("\n");
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for discovery state.");
}

const goodPosts = [
  "We are hiring Senior React TypeScript Frontend Developer. Remote job.",
  "Frontend Engineer needed for React and Next.js. Remote-first role.",
  "React TypeScript developer vacancy. Remote team, full-time."
];

const resumePosts = [
  "Resume Senior Frontend Developer. Optimized rendering by 40%.",
  "CV React Engineer. Built dashboards and mentored developers.",
  "Open to work Frontend Developer. Increased performance by 25%."
];

const weakPosts = [
  "Frontend news digest",
  "React article",
  "TypeScript meetup"
];

const backendPosts = [
  "We are hiring Senior Backend Engineer Node.js for a fintech team.",
  "Python backend developer vacancy. FastAPI, PostgreSQL, full-time.",
  "Go backend role at platform company. Kubernetes and microservices."
];

const threeDPrintPosts = [
  "3d printing freelance project: looking for digital sculptor, ZBrush, STL print-ready miniatures.",
  "Need 3d modeler for print-ready figurines. Blender, OBJ, contract order.",
  "3д скульптор нужен на проект: модели для 3д печати, заказ на миниатюры."
];

const noExperiencePosts = [
  "Удаленная работа оператором чата. Опыт не требуется, всему научим. Отклик в личные сообщения.",
  "Ищем новичков на подработку удаленно. Можно без опыта, обучение с нуля.",
  "Entry-level remote job. No experience required, training provided. Apply today."
];

const juniorWithExperiencePosts = [
  "Junior Frontend Developer vacancy. Требуется коммерческий опыт от 1 года.",
  "Ищем Junior QA Engineer с опытом автоматизации от 2 лет.",
  "Entry-level Backend Developer job. At least 1 year of production experience required."
];

function createMockMtprotoClient(): ChannelDiscoveryMtprotoClient {
  return {
    async searchPublicChannels(query) {
      if (query !== "react remote") {
        return [];
      }

      return [
        { username: "job_react", title: "Already active" },
        { username: "good_frontend", title: "Good Frontend" },
        { username: "resume_frontend", title: "Resume Heavy" },
        { username: "rejected_frontend", title: "Rejected Before" }
      ];
    },
    async searchGlobalChannels(query) {
      if (query !== "react remote") {
        return [];
      }

      return [
        { username: "good_frontend", title: "Good Frontend duplicate" },
        { username: "weak_frontend", title: "Weak Frontend" }
      ];
    },
    async getChannelRecommendations() {
      return [{ username: "recommended_frontend", title: "Recommended Frontend" }];
    }
  };
}

function createQueryMockMtprotoClient(query: string, username: string): ChannelDiscoveryMtprotoClient {
  return {
    async searchPublicChannels(candidateQuery) {
      return candidateQuery === query ? [{ username, title: username }] : [];
    },
    async searchGlobalChannels() {
      return [];
    },
    async getChannelRecommendations() {
      return [];
    }
  };
}

test("ChannelDiscoveryService finds, filters, deduplicates and ranks frontend channel candidates", async () => {
  const config = createTempDatabaseConfig();
  const database = new VacancyDatabase(config);
  database.initialize();
  database.addChannel(config.ownerUserId, "telegram_web_preview", "job_react");

  const oldRun = database.createChannelDiscoveryRun({
    startedByUserId: config.ownerUserId,
    profileId: "frontend",
    profileLabel: "Frontend",
    seedQueries: ["old"]
  });
  database.upsertChannelDiscoveryCandidate({
    runId: oldRun.id,
    username: "rejected_frontend",
    status: "blocked",
    score: 90,
    sources: ["mtproto_search"],
    stats: {
      samplePosts: 3,
      primarySignalPosts: 3,
      formatSignalPosts: 3,
      hiringPosts: 3,
      vacancyLikePosts: 3,
      resumePosts: 0,
      resumeRate: 0
    },
    reasons: ["previously rejected"]
  });

  database.recordMessage(
    {
      source: "telegram_web_preview",
      channel: "job_react",
      messageId: "1",
      date: new Date().toISOString(),
      text: "Useful links: https://t.me/good_frontend and https://t.me/raw_link_frontend",
      url: "https://t.me/job_react/1"
    },
    {
      matches: false,
      score: 0,
      matchedKeywords: [],
      blockedBy: [],
      summary: "raw link fixture"
    },
    []
  );

  const htmlByChannel = new Map<string, string>([
    ["good_frontend", createPreviewHtml("good_frontend", goodPosts)],
    ["recommended_frontend", createPreviewHtml("recommended_frontend", goodPosts)],
    ["raw_link_frontend", createPreviewHtml("raw_link_frontend", goodPosts)],
    ["resume_frontend", createPreviewHtml("resume_frontend", resumePosts)],
    ["weak_frontend", createPreviewHtml("weak_frontend", weakPosts)]
  ]);

  const service = new ChannelDiscoveryService(config, database, {
    mtprotoClient: createMockMtprotoClient(),
    fetchImpl: async (url) => {
      const channel = new URL(String(url)).pathname.split("/").filter(Boolean).pop() ?? "";
      const html = htmlByChannel.get(channel);
      return html ? new Response(html, { status: 200 }) : new Response("not found", { status: 404 });
    }
  });

  const run = await service.runFrontendDiscovery(config.ownerUserId);
  const page = database.listChannelDiscoveryCandidatesPage(run.id, 0, 10);
  const usernames = page.items.map((candidate) => candidate.username);
  const goodCandidate = page.items.find((candidate) => candidate.username === "good_frontend");

  assert.equal(run.status, "completed");
  assert.equal(page.total, 3);
  assert.deepEqual(usernames, ["recommended_frontend", "good_frontend", "raw_link_frontend"]);
  assert.equal(usernames.includes("job_react"), false);
  assert.equal(usernames.includes("resume_frontend"), false);
  assert.equal(usernames.includes("rejected_frontend"), false);
  assert.deepEqual(goodCandidate?.sources.sort(), ["mention_graph_link", "mtproto_search"]);
  assert.equal(run.profileId, "frontend");
  assert.equal(goodCandidate?.stats.vacancyLikePosts, 3);

  const addResult = database.addChannel(config.ownerUserId, "telegram_web_preview", goodCandidate!.username);
  const approved = database.setChannelDiscoveryCandidateStatus(goodCandidate!.id, "approved");
  const addedChannel = database.getChannelByUsername("telegram_web_preview", goodCandidate!.username);
  database.close();

  assert.equal(addResult.added, true);
  assert.equal(approved?.status, "approved");
  assert.equal(addedChannel?.isActive, true);
});

test("ChannelDiscoveryService reports missing MTProto access from config", () => {
  const config = createTempDatabaseConfig();
  const database = new VacancyDatabase(config);
  database.initialize();
  const service = new ChannelDiscoveryService(config, database);

  assert.equal(service.hasMtprotoDiscoveryAccess(), false);
  assert.deepEqual(service.getProviderAvailability(), [
    { name: "manual_seed", available: true },
    { name: "mention_graph", available: true },
    { name: "mtproto", available: false },
    { name: "duckduckgo", available: false }
  ]);
  database.close();
});

test("ChannelDiscoveryService uses backend profile signals without requiring remote signals", async () => {
  const config = createTempDatabaseConfig();
  const database = new VacancyDatabase(config);
  database.initialize();

  const service = new ChannelDiscoveryService(config, database, {
    mtprotoClient: createQueryMockMtprotoClient("backend remote", "good_backend"),
    fetchImpl: async (url) => {
      const channel = new URL(String(url)).pathname.split("/").filter(Boolean).pop() ?? "";
      return channel === "good_backend"
        ? new Response(createPreviewHtml("good_backend", backendPosts), { status: 200 })
        : new Response("not found", { status: 404 });
    }
  });

  const run = await service.runDiscovery(config.ownerUserId, { profileId: "backend" });
  const page = database.listChannelDiscoveryCandidatesPage(run.id, 0, 10);
  const candidate = page.items[0];
  database.close();

  assert.equal(run.profileId, "backend");
  assert.equal(page.total, 1);
  assert.equal(candidate?.username, "good_backend");
  assert.equal(candidate?.stats.primarySignalPosts, 3);
  assert.equal(candidate?.stats.formatSignalPosts, 0);
  assert.equal(candidate?.stats.vacancyLikePosts, 3);
});

test("ChannelDiscoveryService supports custom query discovery", async () => {
  const config = createTempDatabaseConfig();
  const database = new VacancyDatabase(config);
  database.initialize();

  const service = new ChannelDiscoveryService(config, database, {
    mtprotoClient: createQueryMockMtprotoClient("3d printing", "print_jobs"),
    fetchImpl: async (url) => {
      const channel = new URL(String(url)).pathname.split("/").filter(Boolean).pop() ?? "";
      return channel === "print_jobs"
        ? new Response(createPreviewHtml("print_jobs", threeDPrintPosts), { status: 200 })
        : new Response("not found", { status: 404 });
    }
  });

  const run = await service.runDiscovery(config.ownerUserId, { profileId: "custom", customQuery: "3d printing" });
  const page = database.listChannelDiscoveryCandidatesPage(run.id, 0, 10);
  database.close();

  assert.equal(run.profileId, "custom");
  assert.equal(run.customQuery, "3d printing");
  assert.equal(page.total, 1);
  assert.equal(page.items[0]?.username, "print_jobs");
});

test("ChannelDiscoveryService recommends 3D print and sculpt channels", async () => {
  const config = createTempDatabaseConfig();
  const database = new VacancyDatabase(config);
  database.initialize();

  const service = new ChannelDiscoveryService(config, database, {
    mtprotoClient: createQueryMockMtprotoClient("3d sculptor jobs", "sculpt_print"),
    fetchImpl: async (url) => {
      const channel = new URL(String(url)).pathname.split("/").filter(Boolean).pop() ?? "";
      return channel === "sculpt_print"
        ? new Response(createPreviewHtml("sculpt_print", threeDPrintPosts), { status: 200 })
        : new Response("not found", { status: 404 });
    }
  });

  const run = await service.runDiscovery(config.ownerUserId, { profileId: "three_d_printing" });
  const page = database.listChannelDiscoveryCandidatesPage(run.id, 0, 10);
  const candidate = page.items[0];
  database.close();

  assert.equal(run.profileId, "three_d_printing");
  assert.equal(page.total, 1);
  assert.equal(candidate?.stats.primarySignalPosts, 3);
  assert.equal(candidate?.stats.formatSignalPosts, 3);
  assert.equal(candidate?.stats.vacancyLikePosts, 3);
});

test("ChannelDiscoveryService recommends channels with explicit no-experience vacancies", async () => {
  const config = createTempDatabaseConfig();
  const database = new VacancyDatabase(config);
  database.initialize();

  const service = new ChannelDiscoveryService(config, database, {
    mtprotoClient: createQueryMockMtprotoClient("работа без опыта", "starter_jobs"),
    fetchImpl: async (url) => {
      const channel = new URL(String(url)).pathname.split("/").filter(Boolean).pop() ?? "";
      return channel === "starter_jobs"
        ? new Response(createPreviewHtml("starter_jobs", noExperiencePosts), { status: 200 })
        : new Response("not found", { status: 404 });
    }
  });

  const run = await service.runDiscovery(config.ownerUserId, { profileId: "no_experience" });
  const page = database.listChannelDiscoveryCandidatesPage(run.id, 0, 10);
  const candidate = page.items[0];
  database.close();

  assert.equal(run.profileId, "no_experience");
  assert.equal(page.total, 1);
  assert.equal(candidate?.username, "starter_jobs");
  assert.equal(candidate?.stats.primarySignalPosts, 3);
  assert.equal(candidate?.stats.vacancyLikePosts, 3);
});

test("ChannelDiscoveryService does not treat generic junior channels as no-experience channels", async () => {
  const config = createTempDatabaseConfig();
  const database = new VacancyDatabase(config);
  database.initialize();

  const service = new ChannelDiscoveryService(config, database, {
    fetchImpl: async (url) => {
      const channel = new URL(String(url)).pathname.split("/").filter(Boolean).pop() ?? "";
      return channel === "junior_with_experience"
        ? new Response(createPreviewHtml("junior_with_experience", juniorWithExperiencePosts), { status: 200 })
        : new Response("not found", { status: 404 });
    }
  });

  const run = await service.runDiscovery(config.ownerUserId, {
    profileId: "no_experience",
    manualSeeds: ["junior_with_experience"]
  });
  const page = database.listChannelDiscoveryCandidatesPage(run.id, 0, 10);
  database.close();

  assert.equal(run.profileId, "no_experience");
  assert.equal(page.total, 0);
  assert.equal(run.candidatesFiltered, 1);
});

test("ChannelDiscoveryService finds mention graph candidates without MTProto credentials", async () => {
  const config = createTempDatabaseConfig();
  const database = new VacancyDatabase(config);
  database.initialize();
  database.addChannel(config.ownerUserId, "telegram_web_preview", "source_jobs_one");
  database.addChannel(config.ownerUserId, "telegram_web_preview", "source_jobs_two");
  for (const [channel, messageId, text] of [
    ["source_jobs_one", "1", "See https://t.me/linked_frontend and @mentioned_frontend"],
    ["source_jobs_one", "2", "Again @mentioned_frontend"],
    ["source_jobs_two", "3", "Also @mentioned_frontend"]
  ]) {
    database.recordMessage(
      { source: "telegram_web_preview", channel, messageId, date: new Date().toISOString(), text, url: `https://t.me/${channel}/${messageId}` },
      { matches: false, score: 0, matchedKeywords: [], blockedBy: [], summary: "mention graph fixture" },
      []
    );
  }
  const service = new ChannelDiscoveryService(config, database, {
    fetchImpl: async (url) => {
      const channel = new URL(String(url)).pathname.split("/").filter(Boolean).pop() ?? "";
      return ["linked_frontend", "mentioned_frontend"].includes(channel)
        ? new Response(createPreviewHtml(channel, goodPosts), { status: 200 })
        : new Response("not found", { status: 404 });
    }
  });

  const run = await service.runFrontendDiscovery(config.ownerUserId);
  const page = database.listChannelDiscoveryCandidatesPage(run.id, 0, 10);
  database.close();

  assert.equal(run.status, "completed");
  assert.equal(run.providers.includes("mention_graph"), true);
  assert.deepEqual(page.items.map((candidate) => candidate.username).sort(), ["linked_frontend", "mentioned_frontend"]);
  assert.equal(page.items.some((candidate) => candidate.sources.includes("mention_graph_link")), true);
  assert.equal(page.items.some((candidate) => candidate.sources.includes("mention_graph_username")), true);
});

test("manual seeds are checked without being activated and store up to three evidence posts", async () => {
  const config = createTempDatabaseConfig();
  const database = new VacancyDatabase(config);
  database.initialize();
  let requestCount = 0;
  const service = new ChannelDiscoveryService(config, database, {
    fetchImpl: async (url) => {
      requestCount += 1;
      const channel = new URL(String(url)).pathname.split("/").filter(Boolean).pop() ?? "";
      return channel === "manual_frontend"
        ? new Response(createPreviewHtml(channel, [...goodPosts, ...goodPosts]), { status: 200 })
        : new Response("not found", { status: 404 });
    }
  });

  const run = await service.runDiscovery(config.ownerUserId, { profileId: "frontend", manualSeeds: ["@manual_frontend"] });
  const candidate = database.listChannelDiscoveryCandidatesPage(run.id, 0, 10).items[0];
  const active = database.getChannelByUsername("telegram_web_preview", "manual_frontend");
  database.close();

  assert.equal(candidate?.sources.includes("manual_seed"), true);
  assert.equal(candidate?.evidence.length, 3);
  assert.equal(active, null);
  assert.deepEqual(run.providers, ["manual_seed"]);
  assert.equal(requestCount, 1);
});

test("one failed candidate check becomes a warning without failing the discovery run", async () => {
  const config = createTempDatabaseConfig();
  const database = new VacancyDatabase(config);
  database.initialize();
  const service = new ChannelDiscoveryService(config, database, {
    fetchImpl: async (url) => {
      const channel = new URL(String(url)).pathname.split("/").filter(Boolean).pop() ?? "";
      if (channel === "broken_frontend") {
        throw new Error("preview unavailable");
      }
      return ["broken_frontend", "manual_frontend"].includes(channel)
        ? new Response(createPreviewHtml(channel, goodPosts), { status: 200 })
        : new Response("not found", { status: 404 });
    }
  });

  const run = await service.runDiscovery(config.ownerUserId, {
    profileId: "frontend",
    manualSeeds: ["broken_frontend", "manual_frontend"]
  });
  const page = database.listChannelDiscoveryCandidatesPage(run.id, 0, 10);
  database.close();

  assert.equal(run.status, "completed");
  assert.equal(run.providerWarnings.some((warning) => warning.includes("Candidate checks failed: 1")), true);
  assert.deepEqual(page.items.map((candidate) => candidate.username), ["manual_frontend"]);
});

test("redirected Telegram profiles are filtered without warnings", async () => {
  const config = createTempDatabaseConfig();
  const database = new VacancyDatabase(config);
  database.initialize();
  const service = new ChannelDiscoveryService(config, database, {
    fetchImpl: async () => {
      throw new TypeError("fetch failed", { cause: new Error("unexpected redirect") });
    }
  });

  const run = await service.runDiscovery(config.ownerUserId, {
    profileId: "frontend",
    manualSeeds: ["personal_profile"]
  });
  database.close();

  assert.equal(run.status, "completed");
  assert.equal(run.candidatesChecked, 1);
  assert.equal(run.candidatesFiltered, 1);
  assert.deepEqual(run.providerWarnings, []);
});

test("background discovery persists progress and prevents parallel runs", async () => {
  const config = createTempDatabaseConfig();
  const database = new VacancyDatabase(config);
  database.initialize();
  let releaseSecond!: () => void;
  const secondGate = new Promise<void>((resolve) => {
    releaseSecond = resolve;
  });
  const service = new ChannelDiscoveryService(config, database, {
    fetchImpl: async (url) => {
      const channel = new URL(String(url)).pathname.split("/").filter(Boolean).pop() ?? "";
      if (channel === "progress_second") {
        await secondGate;
      }
      return new Response(createPreviewHtml(channel, goodPosts), { status: 200 });
    }
  });

  const run = service.startDiscovery(config.ownerUserId, {
    profileId: "frontend",
    manualSeeds: ["progress_first", "progress_second"]
  });
  await waitFor(() => (database.getChannelDiscoveryRun(run.id)?.candidatesChecked ?? 0) === 1);
  const progress = database.getChannelDiscoveryRun(run.id)!;
  const duplicateStart = service.startDiscovery(config.ownerUserId, {
    profileId: "frontend",
    manualSeeds: ["another_channel"]
  });

  assert.equal(run.status, "running");
  assert.equal(progress.candidatesToCheck, 2);
  assert.equal(progress.candidatesChecked, 1);
  assert.equal(duplicateStart.id, run.id);

  releaseSecond();
  await waitFor(() => database.getChannelDiscoveryRun(run.id)?.status === "completed");
  const completed = database.getChannelDiscoveryRun(run.id)!;
  database.close();

  assert.equal(completed.candidatesChecked, 2);
  assert.equal(completed.candidatesRecommended, 2);
});

test("automatic discovery rotates to usernames not checked by the previous run", async () => {
  const config = createTempDatabaseConfig({ channelDiscoveryMaxCandidates: 2 });
  const database = new VacancyDatabase(config);
  database.initialize();
  const provider = {
    name: "rotation_fixture",
    isAvailable: () => true,
    async collect() {
      return {
        provider: "rotation_fixture",
        warnings: [],
        candidates: ["rotation_one", "rotation_two", "rotation_three", "rotation_four"].map((username) => ({
          username,
          source: "mention_graph_link" as const,
          weight: 10
        }))
      };
    }
  };
  const service = new ChannelDiscoveryService(config, database, {
    providers: [provider],
    fetchImpl: async (url) => {
      const channel = new URL(String(url)).pathname.split("/").filter(Boolean).pop() ?? "";
      return new Response(createPreviewHtml(channel, goodPosts), { status: 200 });
    }
  });

  const first = await service.runFrontendDiscovery(config.ownerUserId);
  const firstUsernames = database.listChannelDiscoveryCandidatesPage(first.id, 0, 10).items.map((item) => item.username);
  const second = await service.runFrontendDiscovery(config.ownerUserId);
  const secondUsernames = database.listChannelDiscoveryCandidatesPage(second.id, 0, 10).items.map((item) => item.username);
  database.close();

  assert.deepEqual(firstUsernames, ["rotation_one", "rotation_two"]);
  assert.deepEqual(secondUsernames, ["rotation_three", "rotation_four"]);
  assert.equal(first.totalCandidatesFound, 4);
  assert.equal(second.totalCandidatesFound, 4);
});

test("automatic discovery bootstraps rotation from legacy completed runs", async () => {
  const config = createTempDatabaseConfig({ channelDiscoveryMaxCandidates: 2 });
  const database = new VacancyDatabase(config);
  database.initialize();
  const legacy = database.createChannelDiscoveryRun({
    startedByUserId: config.ownerUserId,
    profileId: "frontend",
    profileLabel: "Frontend",
    seedQueries: [],
    providers: ["mention_graph"]
  });
  database.completeChannelDiscoveryRun(legacy.id, {
    totalCandidatesFound: 4,
    candidatesToCheck: 2,
    candidatesChecked: 2,
    candidatesRecommended: 0,
    candidatesFiltered: 4,
    providers: ["mention_graph"]
  });
  const provider = {
    name: "rotation_fixture",
    isAvailable: () => true,
    async collect() {
      return {
        provider: "rotation_fixture",
        warnings: [],
        candidates: ["legacy_one", "legacy_two", "legacy_three", "legacy_four"].map((username) => ({
          username,
          source: "mention_graph_link" as const,
          weight: 10
        }))
      };
    }
  };
  const service = new ChannelDiscoveryService(config, database, {
    providers: [provider],
    fetchImpl: async (url) => {
      const channel = new URL(String(url)).pathname.split("/").filter(Boolean).pop() ?? "";
      return new Response(createPreviewHtml(channel, goodPosts), { status: 200 });
    }
  });

  const run = await service.runFrontendDiscovery(config.ownerUserId);
  const usernames = database.listChannelDiscoveryCandidatesPage(run.id, 0, 10).items.map((item) => item.username);
  database.close();

  assert.deepEqual(usernames, ["legacy_three", "legacy_four"]);
});

test("service startup marks orphaned running discovery as interrupted", () => {
  const config = createTempDatabaseConfig();
  const database = new VacancyDatabase(config);
  database.initialize();
  const orphaned = database.createChannelDiscoveryRun({
    startedByUserId: config.ownerUserId,
    profileId: "frontend",
    profileLabel: "Frontend",
    seedQueries: []
  });

  new ChannelDiscoveryService(config, database);
  const recovered = database.getChannelDiscoveryRun(orphaned.id);
  database.close();

  assert.equal(recovered?.status, "failed");
  assert.match(recovered?.error ?? "", /process restart/i);
});

test("DuckDuckGo CAPTCHA becomes a provider warning without failing discovery", async () => {
  const config = createTempDatabaseConfig({ channelDiscoveryDuckDuckGoEnabled: true });
  const database = new VacancyDatabase(config);
  database.initialize();
  const service = new ChannelDiscoveryService(config, database, {
    fetchImpl: async (url) =>
      String(url).startsWith("https://html.duckduckgo.com/")
        ? new Response('<div class="anomaly-modal">captcha</div>', { status: 202 })
        : new Response("not found", { status: 404 })
  });

  const run = await service.runFrontendDiscovery(config.ownerUserId);
  database.close();

  assert.equal(run.status, "completed");
  assert.equal(run.providers.includes("duckduckgo"), true);
  assert.equal(run.providerWarnings.some((warning) => /captcha/i.test(warning)), true);
});

test("DuckDuckGo unexpected HTML becomes a provider warning without failing discovery", async () => {
  const config = createTempDatabaseConfig({ channelDiscoveryDuckDuckGoEnabled: true });
  const database = new VacancyDatabase(config);
  database.initialize();
  const service = new ChannelDiscoveryService(config, database, {
    fetchImpl: async (url) =>
      String(url).startsWith("https://html.duckduckgo.com/")
        ? new Response("<html><body>unexpected</body></html>", { status: 200 })
        : new Response("not found", { status: 404 })
  });

  const run = await service.runFrontendDiscovery(config.ownerUserId);
  database.close();

  assert.equal(run.status, "completed");
  assert.equal(run.providerWarnings.some((warning) => /unexpected HTML/i.test(warning)), true);
});

test("skipped discovery candidates may return while blocked candidates never return", async () => {
  const config = createTempDatabaseConfig();
  const database = new VacancyDatabase(config);
  database.initialize();
  const service = new ChannelDiscoveryService(config, database, {
    fetchImpl: async (url) => {
      const channel = new URL(String(url)).pathname.split("/").filter(Boolean).pop() ?? "";
      return channel === "repeat_frontend"
        ? new Response(createPreviewHtml(channel, goodPosts), { status: 200 })
        : new Response("not found", { status: 404 });
    }
  });

  const first = await service.runDiscovery(config.ownerUserId, { profileId: "frontend", manualSeeds: ["repeat_frontend"] });
  const firstCandidate = database.listChannelDiscoveryCandidatesPage(first.id, 0, 10).items[0]!;
  database.skipChannelDiscoveryUsername(firstCandidate.username);
  assert.equal(database.listPendingChannelDiscoveryCandidatesPage(0, 10).total, 0);
  const second = await service.runDiscovery(config.ownerUserId, { profileId: "frontend", manualSeeds: ["repeat_frontend"] });
  const secondCandidate = database.listChannelDiscoveryCandidatesPage(second.id, 0, 10).items[0]!;
  assert.equal(database.listPendingChannelDiscoveryCandidatesPage(0, 10).total, 1);
  database.blockChannelDiscoveryUsername(secondCandidate.username);
  const third = await service.runDiscovery(config.ownerUserId, { profileId: "frontend", manualSeeds: ["repeat_frontend"] });
  const thirdPage = database.listChannelDiscoveryCandidatesPage(third.id, 0, 10);
  database.close();

  assert.equal(secondCandidate.status, "pending");
  assert.equal(thirdPage.total, 0);
});
