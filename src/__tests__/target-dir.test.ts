import { expect, test } from "bun:test";
import { resolveTargetDir } from "../lib/target-dir.ts";

test("launches from the current directory for main and linked worktrees", () => {
  for (const processCwd of ["/repo", "/worktrees/feature", "/worktrees/feature/src"]) {
    expect(resolveTargetDir({ processCwd })).toBe(processCwd);
  }
});

test("an explicit worktree takes precedence over the current directory", () => {
  expect(
    resolveTargetDir({
      explicitTarget: "/worktrees/other project",
      processCwd: "/worktrees/current",
    }),
  ).toBe("/worktrees/other project");
});

test("relative worktree paths are resolved from the invoking directory", () => {
  expect(
    resolveTargetDir({
      explicitTarget: "../other project",
      processCwd: "/worktrees/current",
    }),
  ).toBe("/worktrees/other project");
});
