import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const base = process.env.QX_AI_CONVERSATIONS_FIXTURE_URL
  ?? "http://127.0.0.1:1420/scripts/fixtures/qx-ai-conversations.html";
try {
  for (const locale of ["en", "zh"]) for (const theme of ["light", "dark"]) {
    await page.setViewportSize({ width: 360, height: 640 });
    await page.goto(`${base}?locale=${locale}&theme=${theme}`);
    const subtitle = page.locator(".qx-list-subtitle");
    await expect(subtitle).toHaveText("小红书 · 我的模型");
    await expect(subtitle).toHaveAttribute("title", "小红书 · 我的模型");
    for (const query of ["小红书", "我的模型", "dots3", "custom:mutgy"]) {
      await page.locator("input").fill(query);
      await expect(subtitle).toHaveText("小红书 · 我的模型");
    }
    await page.locator("input").fill("missing");
    await expect(subtitle).toHaveCount(0);
    await page.locator("input").fill("");
    await expect(subtitle).toHaveCount(1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
  assert.deepEqual(errors, []);
  console.log("QxAI conversation list: configured names, tooltip and name/ID search passed (4 locale/theme cases, 360px)");
} finally {
  await browser.close();
}
