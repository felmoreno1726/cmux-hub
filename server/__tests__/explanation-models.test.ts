import { expect, test } from "bun:test";
import { createExplanationModelResolver, selectLatestLunaModel } from "../explanation-models.ts";

test("automatic selection stays on Luna and compares version numbers", () => {
  const names = ["gpt-5.6-luna", "gpt-5.7-luna", "gpt-5.10-luna", "gpt-7-sol", "gpt-7-astra"];
  const models = names.map((model) => ({ model }));
  expect(selectLatestLunaModel(models)).toBe("gpt-5.10-luna");
  expect(selectLatestLunaModel([...models, { model: "gpt-6-luna" }])).toBe("gpt-6-luna");
  expect(
    selectLatestLunaModel([
      ...models,
      { model: "gpt-6-luna" },
      { model: "gpt-6.1-luna" },
      { model: "gpt-7-luna", hidden: true },
      { model: "gpt-8-luna-preview" },
    ]),
  ).toBe("gpt-6.1-luna");
  expect(() => selectLatestLunaModel([{ model: "gpt-7-astra" }])).toThrow("did not list a Luna");
});

test("discovery shares requests and checks again after ten minutes", async () => {
  let now = 0;
  let calls = 0;
  const resolveModel = createExplanationModelResolver({
    environment: {},
    now: () => now,
    listModels: async () => [{ model: ++calls === 1 ? "gpt-5.6-luna" : "gpt-5.7-luna" }],
  });
  expect(await Promise.all([resolveModel("codex"), resolveModel("codex")])).toEqual([
    "gpt-5.6-luna",
    "gpt-5.6-luna",
  ]);
  expect(await resolveModel("codex")).toBe("gpt-5.6-luna");
  expect(calls).toBe(1);
  now = 10 * 60_000;
  expect(await resolveModel("codex")).toBe("gpt-5.7-luna");
});

test("discovery failures can be retried and explicit model choices skip discovery", async () => {
  let calls = 0;
  const environment: NodeJS.ProcessEnv = {};
  const resolveModel = createExplanationModelResolver({
    environment,
    listModels: async () => {
      if (++calls === 1) throw new Error("Offline");
      return [{ model: "gpt-6-luna" }];
    },
  });
  await expect(resolveModel("codex")).rejects.toThrow("Offline");
  expect(await resolveModel("codex")).toBe("gpt-6-luna");
  environment.DIFFY_CODEX_MODEL = "pinned-model";
  expect(await resolveModel("codex")).toBe("pinned-model");
  expect(await resolveModel("claude")).toBe("haiku");
  environment.DIFFY_CLAUDE_MODEL = "pinned-claude";
  expect(await resolveModel("claude")).toBe("pinned-claude");
  expect(calls).toBe(2);
});
