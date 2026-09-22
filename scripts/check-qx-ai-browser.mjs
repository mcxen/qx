import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 680, height: 720 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const base = process.env.QX_AI_FIXTURE_URL
  ?? "http://127.0.0.1:1420/scripts/fixtures/qx-ai-disclosures.html";

try {
  for (const locale of ["en", "zh"]) {
    for (const theme of ["light", "dark"]) {
      await page.goto(`${base}?locale=${locale}&theme=${theme}`);
      const single = page.locator('[data-fixture="single"]');
      const reasoning = single.locator('[data-qx-ai="reasoning"] > button');
      await expect(reasoning).toHaveAttribute("aria-expanded", "false");
      const affordance = await reasoning.evaluate((element) => {
        const style = getComputedStyle(element);
        const chevron = element.querySelector(".qx-jan-chevron");
        return {
          background: style.backgroundColor,
          radius: Number.parseFloat(style.borderRadius),
          chevronOpacity: Number.parseFloat(getComputedStyle(chevron).opacity),
        };
      });
      assert.notEqual(affordance.background, "rgba(0, 0, 0, 0)");
      assert.ok(affordance.radius >= 8);
      assert.ok(affordance.chevronOpacity >= 0.6);

      await reasoning.click();
      await expect(reasoning).toHaveAttribute("aria-expanded", "true");
      const tool = single.locator('[data-qx-ai="tool"] > button');
      await tool.click();
      await expect(tool).toHaveAttribute("aria-expanded", "true");
      await expect(single.locator("pre.is-output")).toContainText('"items": 2');

      // Outer collapse releases heavy content only after the close animation.
      await reasoning.click();
      await expect(single.locator("pre.is-output")).toHaveCount(1);
      await page.waitForTimeout(340);
      await expect(single.locator("pre.is-output")).toHaveCount(0);
      await reasoning.click();
      await expect(single.locator("pre.is-output")).toContainText('"items": 2');
      await expect(tool).toHaveAttribute("aria-expanded", "true");

      const empty = page.locator('[data-fixture="empty"]');
      await empty.locator('[data-qx-ai="reasoning"] > button').click();
      await empty.locator('[data-qx-ai="tool"] > button').click();
      await expect(empty.locator("pre.is-output")).toContainText(locale === "zh" ? "无输出" : "No output");

      const group = page.locator('[data-fixture="group"]');
      await group.locator('[data-qx-ai="reasoning"] > button').click();
      await group.locator(".qx-ai-tool-group-header").click();
      await expect(group.locator('[data-qx-ai="tool"]')).toHaveCount(2);
      await group.locator('[data-qx-ai="tool"] > button').nth(1).click();
      await expect(group.locator("pre.is-output")).toContainText("Reasoning and Tool contracts loaded");

      const live = page.locator('[data-fixture="live"]');
      const liveClock = live.locator(".qx-ai-flip-clock");
      const readClock = () => liveClock.evaluate((element) =>
        [...element.children].map((child) =>
          child.classList.contains("qx-ai-flip-separator")
            ? ":"
            : child.querySelector(".qx-ai-flip-digit-current")?.textContent ?? "",
        ).join(""),
      );
      const clockBefore = await readClock();
      await page.waitForTimeout(1_100);
      const clockAfter = await readClock();
      assert.notEqual(clockAfter, clockBefore, "live reasoning clock must advance from real elapsed time");
      assert.match(clockAfter ?? "", /^\d{2}:\d{2}$/);
      await live.locator('[data-qx-ai="reasoning"] > button').click();
      await page.evaluate(() => window.qxAiDisclosureFixture.completeLive());
      const liveTool = live.locator('[data-qx-ai="tool"] > button');
      await expect(liveTool).toContainText(locale === "zh" ? "已使用" : "Used");
      await liveTool.click();
      await expect(live.locator("pre.is-output")).toContainText("Live result returned");
    }
  }
  assert.deepEqual(errors, []);
  await page.screenshot({ path: "/tmp/qx-ai-disclosures-dark-zh.png", fullPage: true });
  console.log("QxAI browser: real-time split-flap clock, disclosure lifecycle, grouped tools, empty and live results passed");
} finally {
  await browser.close();
}
