import { test, expect } from "@playwright/test";
import assert from "node:assert";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

test("toolbar explains destinations and keeps the message when an action fails", async ({
  page,
}) => {
  await page.route("**/api/action", async (route) => {
    await route.fulfill({
      json: { ok: false, command: "git commit", stderr: "No changes selected for this commit." },
    });
  });
  await page.goto("/");
  const toolbar = page.getByTestId("toolbar");
  await expect(toolbar.getByRole("button", { name: "Claude review" })).toHaveAttribute(
    "title",
    /shell prompt/,
  );
  await toolbar.getByRole("button", { name: "Commit staged", exact: true }).click();
  await expect(toolbar).toContainText("Does not push to GitHub.");
  await toolbar.getByPlaceholder("Commit message...").fill("Keep this message");
  await toolbar.getByRole("button", { name: "Commit staged", exact: true }).last().click();
  await expect(toolbar.getByRole("alert")).toHaveText("No changes selected for this commit.");
  await expect(toolbar.getByPlaceholder("Commit message...")).toHaveValue("Keep this message");
});

// Resolve repo dir from the test server's /api/status endpoint
async function getRepoDir(request: import("@playwright/test").APIRequestContext) {
  const res = await request.get("/api/status", {
    headers: { host: "127.0.0.1:14568" },
  });
  const data = await res.json();
  return data.cwd as string;
}

test("opening the page shows the branch name in the toolbar", async ({ page }) => {
  await page.goto("/");
  const toolbar = page.getByTestId("toolbar");
  await expect(toolbar).toBeVisible();
  // Branch name is displayed
  await expect(toolbar).toContainText("feature/test");
});

test("opening the page fetches /api/diff/auto and shows changed files", async ({ page }) => {
  // Intercept /api/diff/auto to verify it's called
  let diffRequested = false;
  await page.route("**/api/diff/auto", async (route) => {
    diffRequested = true;
    await route.continue();
  });
  await page.goto("/");
  const diffView = page.getByTestId("diff-view");
  await expect(diffView).toBeVisible();
  // Three changed files are displayed (hello.ts, large-file.ts, new-file.ts)
  const diffFiles = diffView.getByTestId("diff-file");
  await expect(diffFiles).toHaveCount(3);
  // File paths are shown
  await expect(diffFiles.nth(0)).toContainText("hello.ts");
  await expect(diffFiles.nth(1)).toContainText("large-file.ts");
  await expect(diffFiles.nth(2)).toContainText("new-file.ts");
  // New file has the New badge
  await expect(diffFiles.nth(2)).toContainText("New");
  // Added line content is visible
  await expect(diffFiles.nth(0)).toContainText("hello world");
  // Verify the diff API was called
  expect(diffRequested).toBe(true);
});

test("modifying a file updates the diff view automatically", async ({ page, request }) => {
  const repoDir = await getRepoDir(request);
  await page.goto("/");
  const diffView = page.getByTestId("diff-view");
  await expect(diffView).toBeVisible();
  // Verify initial file count
  await expect(diffView.getByTestId("diff-file")).toHaveCount(3);
  // Add a new file to the repo
  writeFileSync(join(repoDir, "added.ts"), "export const added = true;\n");
  execSync("git add added.ts", { cwd: repoDir, stdio: "pipe" });
  // Wait for the diff view to update (watcher debounce + fetch)
  await expect(diffView.getByTestId("diff-file")).toHaveCount(4);
  // The added file is shown
  await expect(diffView).toContainText("added.ts");
});

test("ファイル変更時にスクロール位置がリセットされない", async ({ page, request }) => {
  const repoDir = await getRepoDir(request);
  await page.goto("/");
  const diffView = page.getByTestId("diff-view");
  await expect(diffView).toBeVisible();
  // large-file.ts が表示されていることを確認
  await expect(
    diffView.getByTestId("diff-file").filter({ hasText: "large-file.ts" }),
  ).toBeVisible();
  // large-file.ts のファイルまでスクロール
  const largeFile = diffView.getByTestId("diff-file").filter({ hasText: "large-file.ts" });
  await largeFile.scrollIntoViewIfNeeded();
  // スクロール位置を記録（contentVisibility: auto の影響でページ全体のscrollYではなくdiffView内のスクロールを確認）
  const scrollBefore = await largeFile.evaluate((el) => el.getBoundingClientRect().top);
  // large-file.ts がビューポートに見えている（スクロールが発生した）
  // ファイルを変更してwatcherを発火させる
  writeFileSync(
    join(repoDir, "large-file.ts"),
    Array.from({ length: 100 }, (_, i) => `export const line${i} = ${i + 1};`).join("\n") + "\n",
  );
  execSync("git add large-file.ts", { cwd: repoDir, stdio: "pipe" });
  // diff更新を待つ（変更後のコンテンツが表示されるまで）
  await expect(diffView).toContainText("line99 = 100");
  // スクロール位置が維持されていることを確認（large-file.ts がまだ表示範囲内にある）
  const scrollAfter = await largeFile.evaluate((el) => el.getBoundingClientRect().top);
  // ファイルの位置が大幅にずれていない（TOPにリセットされていない）
  expect(Math.abs(scrollAfter - scrollBefore)).toBeLessThan(200);
});

test("clicking a diff line opens the comment form, and submitting sends the comment", async ({
  page,
}) => {
  // Intercept /api/comment to verify the request payload
  let commentPayload: Record<string, unknown> | null = null;
  await page.route("**/api/comment", async (route) => {
    const request = route.request();
    commentPayload = request.postDataJSON();
    await route.continue();
  });
  await page.goto("/");
  const diffView = page.getByTestId("diff-view");
  await expect(diffView).toBeVisible();
  // Find the hello.ts file by its header text
  const helloFile = diffView.getByTestId("diff-file").filter({ hasText: "hello.ts" });
  await expect(helloFile).toBeVisible();
  // Click on the gutter of the "hello world" line
  const addedLine = helloFile.getByRole("row").filter({ hasText: "hello world" });
  await addedLine.getByRole("cell").first().click();
  // Comment form appears
  const commentForm = helloFile.getByRole("textbox");
  await expect(commentForm).toBeVisible();
  // Type a comment and submit
  await commentForm.fill("This looks good");
  await expect(helloFile).toContainText("Goes to the linked terminal, not GitHub.");
  await helloFile.getByRole("button", { name: "Send to terminal" }).click();
  // Comment form disappears after successful submission
  await expect(commentForm).not.toBeVisible();
  // Verify the request was sent with correct payload
  assert(commentPayload !== null, "comment API request was not sent");
  expect((commentPayload as Record<string, unknown>).comment).toBe("This looks good");
  expect((commentPayload as Record<string, unknown>).file).toContain("hello.ts");
});

test("GET /api/status returns the current branch name", async ({ request }) => {
  const res = await request.get("/api/status", {
    headers: { host: "127.0.0.1:14568" },
  });
  expect(res.ok()).toBe(true);
  const data = await res.json();
  expect(data.branch).toBe("feature/test");
});
