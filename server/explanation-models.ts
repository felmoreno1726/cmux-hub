import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline";
import type { ExplanationProvider } from "../src/lib/explanations.ts";

const CATALOG_CACHE_MS = 10 * 60_000;
const CATALOG_TIMEOUT_MS = 30_000;
const MAX_CATALOG_BYTES = 2_000_000;
const LUNA_MODEL_NAME = /^gpt-(\d+(?:\.\d+)*)-luna$/;

type CodexModel = { model: string; hidden?: boolean };
type CatalogResponse = {
  id?: number;
  error?: { message: string };
  result?: { data: CodexModel[]; nextCursor: string | null };
};
export type ExplanationModelResolver = (provider: ExplanationProvider) => Promise<string>;

export function createExplanationModelResolver(
  options: {
    listModels?: () => Promise<CodexModel[]>;
    now?: () => number;
    environment?: NodeJS.ProcessEnv;
  } = {},
): ExplanationModelResolver {
  const { listModels = listCodexModels, now = Date.now, environment = process.env } = options;
  let cached: { model: string; expiresAt: number } | undefined;
  let pending: Promise<string> | undefined;
  return async (provider) => {
    if (provider === "claude") return environment.DIFFY_CLAUDE_MODEL || "haiku";
    if (environment.DIFFY_CODEX_MODEL) return environment.DIFFY_CODEX_MODEL;
    if (cached && cached.expiresAt > now()) return cached.model;
    if (pending) return pending;
    pending = listModels().then((models) => {
      const model = selectLatestLunaModel(models);
      cached = { model, expiresAt: now() + CATALOG_CACHE_MS };
      return model;
    });
    try {
      return await pending;
    } finally {
      pending = undefined;
    }
  };
}

export function selectLatestLunaModel(models: CodexModel[]): string {
  const names = models
    .filter(({ model, hidden }) => !hidden && LUNA_MODEL_NAME.test(model))
    .map(({ model }) => model)
    .sort((left, right) => right.localeCompare(left, "en", { numeric: true }));
  if (!names[0]) {
    throw new Error(
      "Codex did not list a Luna model. Update Codex and sign in, or set DIFFY_CODEX_MODEL to choose a model.",
    );
  }
  return names[0];
}

export async function listCodexModels(): Promise<CodexModel[]> {
  const binary = Bun.which("codex");
  if (!binary) throw new Error("Install and sign in to Codex to generate summaries.");
  return new Promise((resolve, reject) => {
    const child = execFile(
      binary,
      ["app-server", "--listen", "stdio://", "-c", 'model_provider="openai"'],
      { cwd: tmpdir(), timeout: CATALOG_TIMEOUT_MS, maxBuffer: MAX_CATALOG_BYTES },
      (error, _stdout, stderr) => {
        reject(
          new Error(
            error?.killed
              ? "Codex model discovery timed out. Check your connection and try again."
              : stderr.trim().slice(0, 2_000) ||
                  error?.message ||
                  "Codex exited before listing models.",
          ),
        );
      },
    );
    const lines = createInterface({ input: child.stdout! });
    const models: CodexModel[] = [];
    const send = (message: object) => child.stdin!.write(JSON.stringify(message) + "\n");
    const requestPage = (cursor?: string) =>
      send({
        id: 2,
        method: "model/list",
        params: { includeHidden: false, cursor },
      });
    const stop = () => {
      lines.close();
      child.kill();
    };
    child.stdin!.on("error", (error) => {
      reject(error);
      stop();
    });
    lines.on("line", (line) => {
      try {
        const response = JSON.parse(line) as CatalogResponse;
        if (response.id !== 1 && response.id !== 2) return;
        if (response.error) throw new Error(response.error.message);
        if (response.id === 1) {
          send({ method: "initialized" });
          requestPage();
          return;
        }
        if (!response.result || !Array.isArray(response.result.data)) {
          throw new Error("Codex returned an invalid model list. Update Codex and try again.");
        }
        models.push(...response.result.data);
        if (response.result.nextCursor) {
          requestPage(response.result.nextCursor);
          return;
        }
        resolve(models);
        stop();
      } catch (error) {
        reject(error);
        stop();
      }
    });
    send({
      id: 1,
      method: "initialize",
      params: {
        clientInfo: { name: "cmux_hub", title: "cmux-hub summaries", version: "1.6.0" },
      },
    });
  });
}
