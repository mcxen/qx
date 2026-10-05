import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
  for (const platform of ["Win32", "MacIntel"]) {
    const context = await browser.newContext({ userAgent: platform === "MacIntel" ? "Mozilla/5.0 (Macintosh)" : "Mozilla/5.0 (Windows NT 10.0)" });
    await context.addInitScript((value) => Object.defineProperty(navigator, "platform", { get: () => value }), platform);
    const surface = await context.newPage();
    surface.on("pageerror", (error) => errors.push(error.message));
    for (const locale of ["en", "zh"]) for (const theme of ["light", "dark"]) {
      for (const width of [360, 680, 980, 1280]) for (const mode of ["ai", "workbench"]) {
        await surface.setViewportSize({ width, height: 800 });
        await surface.goto(`${base}?mode=${mode}&locale=${locale}&theme=${theme}`);
        await expect(surface.locator(".qx-shell-search-slot input")).toBeVisible();
        const geometry = await surface.evaluate(() => {
          const rect = (selector) => document.querySelector(selector)?.getBoundingClientRect();
          const search = rect(".qx-shell-search-slot input");
          const title = rect(".qx-ai-conversation-list .qx-list-title-text, .qx-host-workbench-list .qx-list-title");
          const header = rect(".qx-ai-conversation-list .qx-section-header, .qx-host-workbench-list-header");
          const messages = rect(".qx-ai-message-column");
          const composer = rect(".qx-jan-composer");
          const meta = rect(".qx-ai-message.is-assistant .qx-ai-message-meta");
          const body = rect(".qx-ai-message.is-assistant .qx-ai-message-bubble");
          const send = rect(".qx-jan-composer-send");
          return {
            titleOffset: title?.width ? title.left - search.left : null,
            headerOffset: title?.width ? header.left + parseFloat(getComputedStyle(document.querySelector(".qx-ai-conversation-list .qx-section-header, .qx-host-workbench-list-header")).paddingLeft) - title.left : null,
            axisOffset: composer ? Math.max(Math.abs(messages.left - composer.left), Math.abs(messages.right - composer.right)) : 0,
            metaOffset: meta ? meta.left - body.left : 0,
            sendSize: send ? [send.width, send.height] : [28, 28],
            overflow: document.documentElement.scrollWidth > innerWidth,
          };
        });
        assert.ok(geometry.titleOffset === null || Math.abs(geometry.titleOffset) <= 4, `${platform}/${mode}/${width}: search/title alignment`);
        assert.ok(geometry.headerOffset === null || Math.abs(geometry.headerOffset) <= 1, `${mode}: section/title alignment`);
        assert.ok(geometry.axisOffset <= 1, `${mode}/${width}: transcript/composer axis`);
        assert.equal(geometry.metaOffset, 0);
        assert.deepEqual(geometry.sendSize, [28, 28]);
        assert.equal(geometry.overflow, false);
        if (mode !== "ai") {
          if (width === 1280 && locale === "zh") await surface.screenshot({ path: join(tmpdir(), `qx-workbench-layout-${platform}-${theme}.png`) });
          continue;
        }
        await surface.locator('[data-qx-ai="model-switcher"]').click();
        const popup = surface.locator(".qx-ai-model-popover");
        await expect(popup).toBeVisible();
        const menuAxis = await popup.evaluate((element) => {
          const input = element.querySelector("input").getBoundingClientRect();
          const title = element.querySelector(".qx-ai-model-option-name").getBoundingClientRect();
          return Math.abs(input.left + parseFloat(getComputedStyle(element.querySelector("input")).paddingLeft) - title.left);
        });
        assert.ok(menuAxis <= 4, "model search and option titles align");
        await surface.keyboard.press("Escape");
        const composer = surface.locator(".qx-jan-composer-input");
        await composer.fill("/");
        await expect(surface.locator(".qx-ai-skill-card")).toHaveCount(1);
        const skillBounds = await surface.locator(".qx-ai-skill-picker").boundingBox();
        assert.ok(skillBounds.x >= 0 && skillBounds.x + skillBounds.width <= width);
        await surface.keyboard.press("Escape");
        await expect(surface.locator(".qx-ai-skill-card")).toHaveCount(0);
        if (width === 1280 && locale === "zh") {
          await surface.screenshot({ path: join(tmpdir(), `qx-ai-layout-${platform}-${theme}.png`) });
        }
      }
    }
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log("QxAI/Workbench: name search and 64 platform/locale/theme/width layout cases passed, including composer, model menu and Skills");
} finally {
  await browser.close();
}
