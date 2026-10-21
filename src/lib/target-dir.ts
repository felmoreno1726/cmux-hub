import path from "node:path";

export type ResolveTargetDirOptions = {
  explicitTarget?: string;
  processCwd: string;
};

export function resolveTargetDir(options: ResolveTargetDirOptions): string {
  return path.resolve(options.processCwd, options.explicitTarget ?? ".");
}
