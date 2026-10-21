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
  cached: boolean;
};

export function indexFilePatches(patch: string): Map<string, string> {
  const patches = new Map<string, string>();
  for (const section of splitFilePatches(patch)) {
    const file = parseDiff(section)[0];
    if (file) patches.set(file.newPath, (patches.get(file.newPath) ?? "") + section);
  }
  return patches;
}

export function splitFilePatches(patch: string): string[] {
  return patch.split(/(?=^diff --git )/m).filter((section) => section.trim());
}
