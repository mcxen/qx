import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const base = process.env.QX_MEMORY_FIXTURE_URL ?? "http://127.0.0.1:1420/scripts/fixtures/memory-contracts.html";
try {
  for (const locale of ["en", "zh"]) for (const theme of ["light", "dark"]) for (const width of [360, 680, 1200]) {
    await page.setViewportSize({ width, height: 720 });
    await page.goto(`${base}?locale=${locale}&theme=${theme}`);
    await expect(page.getByText("Global durable preference", { exact: true })).toBeVisible();
    await expect(page.getByText("Project-only invariant", { exact: true })).toHaveCount(0);
    const height = await page.locator(".qx-shell-bottombar").evaluate((element) => element.getBoundingClientRect().height);
    const scopeSelect = page.getByRole("combobox").first();
    await scopeSelect.click(); await page.getByRole("option", { name: "Qx", exact: true }).click();
    await expect(page.getByText("Project-only invariant", { exact: true })).toBeVisible();
    await expect(page.getByText("Global durable preference", { exact: true })).toHaveCount(0);
    await scopeSelect.click(); await page.getByRole("option", { name: locale === "en" ? "Global" : "全局", exact: true }).click();
    await page.getByRole("button", { name: locale === "en" ? "View source" : "查看来源", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("Original preserved fact");
    await expect(page.getByRole("dialog")).toContainText("Source conversation");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    const scopeInput = page.getByPlaceholder(locale === "en" ? "Project name (empty for global)" : "项目名称（留空为全局）");
    await scopeInput.fill("Another project");
    await scopeInput.dispatchEvent("keydown", { key: "Enter", isComposing: true });
    assert.equal(await page.evaluate(() => window.memoryFixture.scope()), "Qx");
    await scopeInput.press("Enter");
    assert.equal(await page.evaluate(() => window.memoryFixture.scope()), "Another project");
    const bodyHeight = await page.locator(".qx-ai-memory-manager").evaluate((element) => element.getBoundingClientRect().height);
    await page.evaluate(() => window.memoryFixture.fail());
    await page.getByRole("button", { name: locale === "en" ? "Refresh" : "刷新", exact: true }).click();
    await expect(page.getByRole("button", { name: locale === "en" ? /^View error details:/ : /^查看错误详情/ })).toBeVisible();
    assert.equal(await page.locator(".qx-ai-memory-manager").evaluate((element) => element.getBoundingClientRect().height), bodyHeight);
    assert.equal(await page.locator(".qx-shell-bottombar").evaluate((element) => element.getBoundingClientRect().height), height);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no horizontal page overflow");
  }
  assert.deepEqual(errors, []);
  await page.screenshot({ path: "/tmp/qx-memory-contracts.png" });
  console.log("memory UI: 12 locale/theme/width cases, scope, source, IME and stable error layout passed");
} finally { await browser.close(); }
