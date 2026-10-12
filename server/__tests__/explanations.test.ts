import { expect, test } from "bun:test";
import {
  buildExplanationPrompt,
  buildModelCommand,
  createExplanationService,
  readExplanationRequest,
  samplePatch,
} from "../explanations.ts";
import { indexFilePatches } from "../../src/lib/explanations.ts";
import type { ExplanationRequest } from "../../src/lib/explanations.ts";
import { createAppConfig } from "../app.ts";
import { createGitService } from "../git.ts";
import { createGitHubService } from "../github.ts";
import { createCmuxService, createDryRunConnector } from "../cmux.ts";

const PATCH =
  "diff --git a/hello.ts b/hello.ts\n--- a/hello.ts\n+++ b/hello.ts\n@@ -1 +1 @@\n-old\n+new\n";
const INPUT: ExplanationRequest = {
  patch: PATCH,
  depth: 1,
  provider: "claude",
  source: "Working tree",
};

test("answers are cached by full patch, scope, depth, provider and review point", async () => {
  let calls = 0;
  const service = createExplanationService(
    async () => `Answer ${++calls}`,
    async () => "test-model",
  );
  const first = await service.explain(INPUT);
  expect((await service.explain(INPUT)).cached).toBe(true);
  expect(first.text).toBe("Answer 1");
  for (const change of [
    { patch: PATCH + "+more\n" },
    { depth: 2 },
    { provider: "codex" as const },
    { file: "hello.ts" },
    { previousPatch: "" },
    { source: "Commit abc123" },
  ]) {
    expect((await service.explain({ ...INPUT, ...change })).cached).toBe(false);
  }
  expect(calls).toBe(7);
});

test("duplicate requests share one call and competing calls receive a busy error", async () => {
  let finish!: (text: string) => void;
  let calls = 0;
  const service = createExplanationService(() => {
    calls++;
    return new Promise<string>((resolve) => {
      finish = resolve;
    });
  });
  const first = service.explain(INPUT);
  const duplicate = service.explain(INPUT);
  await expect(service.explain({ ...INPUT, depth: 3 })).rejects.toMatchObject({ status: 429 });
  finish("Done");
  expect(await first).toEqual(await duplicate);
  expect(calls).toBe(1);
});

test("failures and empty answers can be retried", async () => {
  let calls = 0;
  const service = createExplanationService(async () => {
    calls++;
    if (calls === 1) throw new Error("Login required");
    return calls === 2 ? " " : "Works";
  });
  await expect(service.explain(INPUT)).rejects.toThrow("Login required");
  await expect(service.explain(INPUT)).rejects.toThrow("empty answer");
  expect((await service.explain(INPUT)).text).toBe("Works");
});

test("empty and unchanged diffs never call a model, but reverted changes do", async () => {
  let calls = 0;
  const service = createExplanationService(async () => {
    calls++;
    return "Reverted";
  });
  await service.explain({ ...INPUT, patch: "" });
  await service.explain({ ...INPUT, previousPatch: PATCH });
  expect(calls).toBe(0);
  expect((await service.explain({ ...INPUT, patch: "", previousPatch: PATCH })).text).toBe(
    "Reverted",
  );
  expect(calls).toBe(1);
});

test("large diffs share the context budget across files", () => {
  const patch =
    PATCH +
    "x".repeat(20_000) +
    "\n" +
    PATCH.replaceAll("hello.ts", "last.ts") +
    "y".repeat(20_000);
  const sampled = samplePatch(patch, 4_000);
  expect(sampled.sampled).toBe(true);
  expect(sampled.text.length).toBeLessThanOrEqual(4_000);
  expect(sampled.text).toContain("a/hello.ts");
  expect(sampled.text).toContain("a/last.ts");
  expect(samplePatch(PATCH, 4_000)).toEqual({ text: PATCH, sampled: false });
});

test("focused patches exclude other files and retain rename/delete metadata", () => {
  const removed =
    "diff --git a/gone.ts b/gone.ts\ndeleted file mode 100644\n--- a/gone.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-old\n";
  const renamed =
    "diff --git a/old.ts b/renamed.ts\nsimilarity index 100%\nrename from old.ts\nrename to renamed.ts\n";
  expect(indexFilePatches(PATCH + removed + renamed).get("gone.ts")).toBe(removed);
  expect(indexFilePatches(PATCH + removed + renamed).get("renamed.ts")).toBe(renamed);
});

test("review prompts distinguish two snapshots and disclose sampling", () => {
  const { prompt, sampled } = buildExplanationPrompt({
    ...INPUT,
    previousPatch: PATCH.repeat(200),
  });
  expect(sampled).toBe(true);
  expect(prompt).toContain("PREVIOUS REVIEWED PATCH:");
  expect(prompt).toContain("CURRENT PATCH:");
  expect(prompt).toContain("removed or reverted");
  expect(prompt).toContain("untrusted data");
});

test("request validation rejects malformed, oversized and invalid options", async () => {
  for (const body of [
    "{",
    "null",
    JSON.stringify({ ...INPUT, depth: 5 }),
    JSON.stringify({ ...INPUT, provider: "shell" }),
    JSON.stringify({ ...INPUT, previousPatch: null }),
    JSON.stringify({ ...INPUT, patch: "x".repeat(2_000_001) }),
  ]) {
    await expect(
      readExplanationRequest(new Request("http://localhost/api/explain", { method: "POST", body })),
    ).rejects.toThrow();
  }
  expect(
    await readExplanationRequest(
      new Request("http://localhost/api/explain", { method: "POST", body: JSON.stringify(INPUT) }),
    ),
  ).toEqual(INPUT);
});

test("provider commands disable customizations and never execute patch text as shell code", () => {
  const request = { prompt: "$(touch /tmp/unwanted)", provider: "claude" as const, model: "haiku" };
  expect(buildModelCommand(request)).toContain("--safe-mode");
  expect(buildModelCommand(request)).toContain("--no-session-persistence");
  expect(buildModelCommand(request)).not.toContain(request.prompt);
  expect(buildModelCommand({ ...request, provider: "codex" })).toContain("read-only");
  expect(buildModelCommand({ ...request, provider: "codex" })).toContain("--ignore-user-config");
});

test("explanation endpoint protects model calls and reports invalid input", async () => {
  let calls = 0;
  const run = async () => "";
  const app = createAppConfig({
    port: 14569,
    cwd: "/tmp/test",
    git: createGitService(run, "/tmp/test"),
    github: createGitHubService(run, "/tmp/test"),
    cmux: createCmuxService(createDryRunConnector()),
    explanationRunner: async () => {
      calls++;
      return "Explained";
    },
  });
  const route = app.apiRoutes["/api/explain"] as { POST: (request: Request) => Promise<Response> };
  const request = (origin: string, body = JSON.stringify(INPUT)) =>
    new Request("http://127.0.0.1:14569/api/explain", {
      method: "POST",
      headers: { host: "127.0.0.1:14569", origin, "sec-fetch-site": "same-origin" },
      body,
    });
  expect((await route.POST(request("https://untrusted.example"))).status).toBe(403);
  expect((await route.POST(request("http://127.0.0.1:4567"))).status).toBe(403);
  expect((await route.POST(request("http://127.0.0.1:14569", "{}"))).status).toBe(400);
  expect(calls).toBe(0);
  const response = await route.POST(request("http://127.0.0.1:14569"));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ text: "Explained", cached: false });
  expect(calls).toBe(1);
  app.stop();
});
