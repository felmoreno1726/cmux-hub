import { test, expect } from "@playwright/test";
import type { ExplanationRequest } from "../src/lib/explanations.ts";

const answer = {
  text: "The greeting now includes the world. Check callers that compare the old text.",
  model: "test-model",
  sampled: false,
  cached: false,
};

test("explains on request, selects files, and reuses answers when detail changes back", async ({
  page,
}) => {
  const requests: ExplanationRequest[] = [];
  await page.route("**/api/explain", async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ json: answer });
  });
  await page.goto("/");
  const panel = page.getByRole("complementary", { name: "AI explanations" });
  await expect(panel.getByRole("button", { name: "Explain changes" })).toBeEnabled();
  expect(requests).toHaveLength(0);
  await panel.getByRole("button", { name: "Explain changes" }).click();
  await expect(panel).toContainText(answer.text);
  expect(requests).toHaveLength(1);
  expect(requests[0]?.patch).toContain("hello.ts");
  await panel.getByRole("button", { name: "More detail" }).click();
  await expect(panel).not.toContainText(answer.text);
  expect(requests).toHaveLength(1);
  await panel.getByRole("button", { name: "Less detail" }).click();
  await expect(panel).toContainText(answer.text);
  await panel.getByRole("combobox", { name: "File to explain" }).selectOption("hello.ts");
  await panel.getByRole("button", { name: "Explain changes" }).click();
  await expect(panel).toContainText(answer.text);
  expect(requests).toHaveLength(2);
  expect(requests[1]?.file).toBe("hello.ts");
  expect(requests[1]?.patch).not.toContain("large-file.ts");
});

test("changed code marks answers stale and keeps an explicit review checkpoint", async ({
  page,
}) => {
  const requests: ExplanationRequest[] = [];
  let changed = false;
  await page.route("**/api/diff/auto", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    if (changed) body.diff += "\n+another change\n";
    await route.fulfill({ json: body });
  });
  await page.route("**/api/explain", async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ json: answer });
  });
  await page.goto("/");
  const panel = page.getByRole("complementary", { name: "AI explanations" });
  await panel.getByRole("button", { name: "Explain changes" }).click();
  await expect(panel).toContainText(answer.text);
  await panel.getByRole("button", { name: "Mark this diff reviewed" }).click();
  await page.getByRole("button", { name: "Commits", exact: true }).click();
  await expect(panel).not.toBeVisible();
  await page.getByRole("button", { name: "feature/test", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Review point saved" })).toBeVisible();
  changed = true;
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent("ws-message", { detail: { type: "diff-updated" } })),
  );
  await expect(panel).toContainText("Code changed.");
  expect(requests).toHaveLength(1);
  await panel.getByRole("button", { name: "Since reviewed", exact: true }).click();
  await panel.getByRole("button", { name: "Explain changes" }).click();
  await expect(panel).toContainText(answer.text);
  expect(requests[1]?.previousPatch).toBe(requests[0]?.patch);
  expect(requests[1]?.patch).toContain("another change");
});

test("failures are visible and retry works on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 800 });
  let calls = 0;
  await page.route("**/api/explain", async (route) => {
    calls++;
    await route.fulfill(
      calls === 1 ? { status: 503, json: { error: "Sign in to Claude first." } } : { json: answer },
    );
  });
  await page.goto("/");
  const panel = page.getByRole("complementary", { name: "AI explanations" });
  await panel.getByRole("button", { name: "Explain changes" }).click();
  await expect(panel.getByRole("alert")).toHaveText("Sign in to Claude first.");
  await panel.getByRole("button", { name: "Explain changes" }).click();
  await expect(panel).toContainText(answer.text);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
