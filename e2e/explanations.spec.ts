import { test, expect } from "@playwright/test";
import type { ExplanationRequest } from "../src/lib/explanations.ts";

const answer = {
  text: "The greeting now includes the world.",
  model: "test-model",
  sampled: false,
  cached: false,
};

test("queued summaries skip an old file revision when the code changes", async ({ page }) => {
  const requests: ExplanationRequest[] = [];
  let changed = false;
  let finish!: () => void;
  const waiting = new Promise<void>((resolve) => {
    finish = resolve;
  });
  await page.route("**/api/diff/auto", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    if (changed) {
      body.diff = body.diff.replaceAll("hello world", "hello again");
      delete body.files;
    }
    await route.fulfill({ json: body });
  });
  await page.route("**/api/explain", async (route) => {
    if (route.request().method() === "GET") return route.continue();
    requests.push(route.request().postDataJSON());
    if (requests.length === 1) await waiting;
    await route.fulfill({ json: answer });
  });
  await page.goto("/");
  const explanation = page.getByRole("group", { name: "Explanation for hello.ts", exact: true });
  await expect(explanation).toContainText("Summarizing…");
  expect(requests).toHaveLength(1);
  changed = true;
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent("ws-message", { detail: { type: "diff-updated" } })),
  );
  await expect(page.getByTestId("diff-view")).toContainText("hello again");
  await expect(explanation).toContainText("Summarizing…");
  finish();
  await expect(explanation).toContainText(answer.text);
  const fileRequests = requests.filter((request) => request.file === "hello.ts");
  expect(fileRequests).toHaveLength(1);
  expect(fileRequests[0]!.patch).toContain("hello again");
});

test("code loads at full width while automatic summaries are still pending", async ({ page }) => {
  let finish!: () => void;
  const waiting = new Promise<void>((resolve) => {
    finish = resolve;
  });
  await page.route("**/api/explain", async (route) => {
    if (route.request().method() === "GET") return route.continue();
    await waiting;
    await route.fulfill({ json: answer });
  });
  await page.goto("/");
  await expect(page.getByTestId("diff-view")).toContainText("hello world");
  await expect(page.getByRole("group", { name: "Overall explanation" })).toContainText(
    "Summarizing…",
  );
  await expect(page.getByRole("complementary")).toHaveCount(0);
  await expect(page.getByRole("combobox")).toHaveCount(0);
  const width = await page
    .getByTestId("diff-view")
    .evaluate((element) => element.getBoundingClientRect().width);
  expect(width).toBeGreaterThan(page.viewportSize()!.width - 50);
  finish();
  await expect(
    page.getByRole("group", { name: "Explanation for hello.ts", exact: true }),
  ).toContainText(answer.text);
});

test("each visible file gets only its patch and plus/minus changes detail", async ({ page }) => {
  const requests: ExplanationRequest[] = [];
  await page.route("**/api/explain", async (route) => {
    if (route.request().method() === "GET") return route.continue();
    const input: ExplanationRequest = route.request().postDataJSON();
    requests.push(input);
    await route.fulfill({
      json: { ...answer, text: `Detail ${input.depth}: ${input.file ?? "whole diff"}` },
    });
  });
  await page.goto("/");
  const explanation = page.getByRole("group", { name: "Explanation for hello.ts", exact: true });
  await expect(explanation).toContainText("Detail 0: hello.ts");
  const fileRequest = requests.find((request) => request.file === "hello.ts")!;
  expect(fileRequest.patch).toContain("hello.ts");
  expect(fileRequest.patch).not.toContain("large-file.ts");
  await explanation.getByRole("button", { name: "More detail" }).click();
  await expect(explanation).toContainText("Detail 1: hello.ts");
  await explanation.getByRole("button", { name: "Less detail" }).click();
  await expect(explanation).toContainText("Detail 0: hello.ts");
  expect(requests.filter((request) => request.file === "hello.ts")).toHaveLength(2);
  await explanation.getByRole("button", { name: "Less detail" }).click();
  await expect(explanation).not.toContainText("Detail 0");
  await explanation.getByRole("button", { name: "More detail" }).click();
  await expect(explanation).toContainText("Detail 0: hello.ts");
  expect(requests.filter((request) => request.file === "hello.ts")).toHaveLength(2);
});

test("changed code stays readable while an old summary is replaced", async ({ page }) => {
  let changed = false;
  await page.route("**/api/diff/auto", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    if (changed) {
      body.diff = body.diff.replaceAll("hello world", "hello again");
      delete body.files;
    }
    await route.fulfill({ json: body });
  });
  let finish!: () => void;
  const waiting = new Promise<void>((resolve) => {
    finish = resolve;
  });
  await page.route("**/api/explain", async (route) => {
    if (route.request().method() === "GET") return route.continue();
    const input: ExplanationRequest = route.request().postDataJSON();
    if (input.patch.includes("hello again")) await waiting;
    await route.fulfill({
      json: {
        ...answer,
        text: input.patch.includes("hello again") ? "Updated greeting." : answer.text,
      },
    });
  });
  await page.goto("/");
  const explanation = page.getByRole("group", { name: "Explanation for hello.ts", exact: true });
  await expect(explanation).toContainText(answer.text);
  changed = true;
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent("ws-message", { detail: { type: "diff-updated" } })),
  );
  await expect(explanation.locator(".inline-explanation-old")).toBeVisible();
  await expect(page.getByTestId("diff-view")).toContainText("hello again");
  finish();
  await expect(explanation).toContainText("Updated greeting.");
});

test("offscreen files wait until visible and errors do not hide the diff", async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 500 });
  const requests: ExplanationRequest[] = [];
  let shouldFail = true;
  await page.route("**/api/explain", async (route) => {
    if (route.request().method() === "GET") return route.continue();
    const input: ExplanationRequest = route.request().postDataJSON();
    requests.push(input);
    await route.fulfill(
      shouldFail && input.file === "hello.ts"
        ? { status: 503, json: { error: "Sign in to Claude first." } }
        : { json: answer },
    );
  });
  await page.goto("/");
  const explanation = page.getByRole("group", { name: "Explanation for hello.ts", exact: true });
  await expect(explanation.getByRole("alert")).toContainText("Sign in to Claude first.");
  await expect(page.getByTestId("diff-view")).toContainText("hello world");
  expect(requests.some((request) => request.file === "new-file.ts")).toBe(false);
  shouldFail = false;
  await explanation.getByRole("button", { name: "Retry explanation" }).click();
  await expect(explanation).toContainText(answer.text);
  const lastFile = page.getByTestId("diff-file").filter({ hasText: "new-file.ts" });
  await lastFile.scrollIntoViewIfNeeded();
  await expect(
    lastFile.getByRole("group", { name: "Explanation for new-file.ts", exact: true }),
  ).toContainText(answer.text);
  expect(requests.some((request) => request.file === "new-file.ts")).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
