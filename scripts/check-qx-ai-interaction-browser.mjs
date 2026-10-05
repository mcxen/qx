import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { join } from "node:path";
import { tmpdir } from "node:os";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const base = process.env.QX_FIXTURE_URL ?? "http://127.0.0.1:1420/scripts/fixtures/qx-ai-conversations.html";
const calls = () => page.evaluate(() => window.interactionFixture.calls);
let cases = 0;
try {
  for (const locale of ["en", "zh"]) for (const theme of ["light", "dark"]) for (const width of [360, 980]) {
    for (const mode of ["question", "multi", "suggestions"]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`${base}?mode=ai&interaction=${mode}&locale=${locale}&theme=${theme}`);
      await expect(page.locator(".qx-ai-question, .qx-ai-suggestions")).toBeVisible();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      const input = page.locator(".qx-jan-composer-input");
      await input.fill("Keep my unsent draft");
      if (mode === "suggestions") {
        await page.evaluate(() => window.interactionFixture.streaming(true));
        await expect(page.locator(".qx-ai-suggestions")).toHaveCount(0);
        await page.evaluate(() => window.interactionFixture.streaming(false));
        const option = page.locator(".qx-ai-suggestions button").filter({ hasText: "Check versions" });
        await option.focus(); await page.keyboard.press("Enter");
        assert.deepEqual(await calls(), ["Check the versions of the installed applications."]);
        await expect(page.locator(".qx-ai-suggestions")).toHaveCount(0);
      } else {
        await page.evaluate(() => window.interactionFixture.runQueue());
        assert.equal(await page.evaluate(() => window.interactionFixture.queue()), 1);
        assert.deepEqual(await calls(), []);
        const first = page.locator(".qx-ai-question fieldset").first();
        const all = first.getByRole("button").filter({ hasText: "All applications" });
        await expect(all).toHaveAttribute("aria-pressed", "false");
        if (mode === "question") {
          await all.focus(); await page.keyboard.press("Enter");
          assert.equal((await calls())[0], "Which applications should I inspect?\nAll applications");
        } else {
          const submit = page.locator(".qx-ai-question-actions button").last();
          await expect(submit).toBeDisabled();
          await all.click();
          await first.getByRole("button").filter({ hasText: "Games only" }).click();
          await expect(all).toHaveAttribute("aria-pressed", "true");
          await expect(submit).toBeDisabled();
          await page.locator(".qx-ai-question fieldset").last().getByRole("textbox").fill("自己的格式");
          await expect(submit).toBeEnabled();
          if (width === 980 && locale === "zh") await page.screenshot({ path: join(tmpdir(), `qx-ai-question-${theme}.png`) });
          await submit.click();
          assert.equal((await calls())[0], "Which applications should I inspect?\nAll applications; Games only\n\nHow should I show the result?\n自己的格式");
        }
        await expect(page.locator(".qx-ai-question button").first()).toBeDisabled();
        await page.locator(".qx-ai-question button").first().evaluate((button) => button.click());
        assert.equal((await calls()).length, 1, "historical question cannot send again");
        await page.evaluate(() => window.interactionFixture.restore());
        await expect(page.locator(".qx-ai-question button").first()).toBeEnabled();
        await page.evaluate(() => window.interactionFixture.stale());
        assert.equal((await calls()).length, 1, "store rejects a stale source after session restore");
      }
      await expect(input).toHaveValue("Keep my unsent draft");
      cases++;
    }
  }
  await page.goto(`${base}?mode=ai&interaction=question`);
  await page.locator(".qx-ai-question-custom").fill("Only my work applications");
  await page.locator(".qx-ai-question-actions button").last().click();
  assert.equal((await calls())[0], "Which applications should I inspect?\nOnly my work applications");
  await page.goto(`${base}?mode=ai&interaction=question`);
  await page.locator(".qx-ai-question-actions button").first().click();
  assert.match((await calls())[0], /without assuming any choice/);
  await page.setViewportSize({ width: 1280, height: 800 });
  for (const mode of ["question", "suggestions"]) {
    await page.goto(`${base}?mode=pzai&interaction=${mode}`);
    await expect(page.locator(".qx-ai-question, .qx-ai-suggestions")).toBeVisible();
    const draft = page.locator(".qx-pzai-assistant-composer textarea");
    await draft.fill("Reading assistant draft");
    await page.locator(mode === "question" ? ".qx-ai-question-option" : ".qx-ai-suggestions button").first().click();
    assert.equal((await calls()).length, 1);
    await expect(draft).toHaveValue("Reading assistant draft");
  }
  assert.deepEqual(errors, []);
  console.log(`QxAI interactions browser: ${cases} locale/theme/width cases, explicit choices, custom answers, skip, queue pause, draft preservation and history passed`);
} finally { await browser.close(); }
