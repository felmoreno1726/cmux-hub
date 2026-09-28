import { parseDiff } from "./diff-parser.ts";

export const DETAIL_LEVELS = ["Glance", "Concise", "Standard", "Detailed", "Deep"] as const;
export type ExplanationProvider = "claude" | "codex";
export type ExplanationRequest = {
  patch: string;
  previousPatch?: string;
  file?: string;
  depth: number;
  provider: ExplanationProvider;
  source: string;
};
export type ExplanationResult = {
  text: string;
  model: string;
  sampled: boolean;
  cached: boolean;
};

export function selectFilePatch(patch: string, file: string): string {
  return splitFilePatches(patch)
    .filter((section) => parseDiff(section).some((entry) => entry.newPath === file))
    .join("");
}

export function splitFilePatches(patch: string): string[] {
  return patch.split(/(?=^diff --git )/m).filter((section) => section.trim());
}
