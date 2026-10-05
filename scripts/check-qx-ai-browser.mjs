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
      const layout = page.locator('[data-fixture="layout"]');
      const transcript = layout.locator('[data-qx-ai="conversation-content"]');
      await expect(transcript).toHaveAttribute("data-following", "true");
      const alignedColumns = await layout.evaluate((element) => {
        const messages = element.querySelector(".qx-ai-message-column")?.getBoundingClientRect();
        const composer = element.querySelector(".qx-jan-composer")?.getBoundingClientRect();
        if (!messages || !composer) return false;
        return Math.abs(messages.left - composer.left) <= 1
          && Math.abs(messages.right - composer.right) <= 1;
      });
      assert.equal(alignedColumns, true, "transcript and composer must share one content axis");

      const modelTrigger = layout.locator('[data-qx-ai="model-switcher"]');
      await expect(modelTrigger).toHaveAttribute("data-model-provider", "openrouter");
      await expect(modelTrigger).toHaveAttribute("data-model-id", "gpt-4.1");
      await modelTrigger.click();
      const modelPopover = page.locator(".qx-ai-model-popover");
      await expect(modelPopover).toBeVisible();
      await expect(modelPopover.locator(".qx-ai-model-group-label")).toHaveText([
        "OpenRouter",
        "DeepSeek",
      ]);
      const modelSearch = modelPopover.locator('input[role="combobox"]');
      await modelSearch.fill("reasoner");
      await expect(modelPopover.locator('[role="option"]')).toHaveCount(1);
      await modelSearch.press("ArrowDown");
      assert.equal(
        await page.evaluate(() => document.activeElement?.getAttribute("data-model-option")),
        "deepseek::deepseek-reasoner",
        "ArrowDown must move focus from search to the matching model",
      );
      await page.keyboard.press("Enter");
      await expect(modelPopover).toHaveCount(0);
      await expect(modelTrigger).toHaveAttribute("data-model-provider", "deepseek");
      await expect(modelTrigger).toHaveAttribute("data-model-id", "deepseek-reasoner");
      await expect.poll(() => page.evaluate(
        () => document.activeElement?.getAttribute("data-fixture"),
      ), { message: "selecting a model must restore composer focus" }).toBe("composer-input");
      await modelTrigger.click();
      await modelPopover.locator(".qx-ai-model-footer button").click();
      await expect.poll(() => page.evaluate(() => document.documentElement.dataset.modelManage))
        .toBe("true");

      await transcript.evaluate((element) => {
        element.scrollTop = 0;
        element.dispatchEvent(new Event("scroll", { bubbles: true }));
      });
      const jumpToLatest = layout.locator('[data-qx-ai="scroll-to-latest"]');
      await expect(jumpToLatest).toBeVisible();
      const detachedScrollTop = await transcript.evaluate((element) => element.scrollTop);
      const rowCount = await layout.locator(".qx-ai-message").count();
      await page.evaluate(() => window.qxAiDisclosureFixture.appendTranscript());
      await expect(layout.locator(".qx-ai-message")).toHaveCount(rowCount + 1);
      const detachedAfterAppend = await transcript.evaluate((element) => element.scrollTop);
      assert.equal(detachedAfterAppend, detachedScrollTop, "live output must not steal detached reading position");
      await page.evaluate(() => window.qxAiDisclosureFixture.switchTranscriptConversation("b"));
      await expect(layout).toHaveAttribute("data-conversation", "b");
      await expect(transcript).toHaveAttribute("data-following", "true");
      await page.evaluate(() => window.qxAiDisclosureFixture.switchTranscriptConversation("a"));
      await expect(layout).toHaveAttribute("data-conversation", "a");
      await expect(transcript).toHaveAttribute("data-following", "false");
      const restoredDetachedScrollTop = await transcript.evaluate((element) => element.scrollTop);
      assert.equal(
        restoredDetachedScrollTop,
        detachedScrollTop,
        "each conversation must restore its own detached reading position",
      );
      await jumpToLatest.click();
      await expect(jumpToLatest).toHaveCount(0);
      await expect.poll(() => transcript.evaluate(
        (element) => element.scrollHeight - element.clientHeight - element.scrollTop,
      )).toBeLessThanOrEqual(1);
      await page.evaluate(() => window.qxAiDisclosureFixture.appendTranscript());
      await expect(layout.locator(".qx-ai-message")).toHaveCount(rowCount + 2);
      await expect.poll(() => transcript.evaluate(
        (element) => element.scrollHeight - element.clientHeight - element.scrollTop,
      )).toBeLessThanOrEqual(1);

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

      const thoughts = page.locator('[data-fixture="thoughts"]');
      const thoughtReasoning = thoughts.locator('[data-qx-ai="reasoning"] > button');
      await thoughtReasoning.click();
      const thoughtHeaders = thoughts.locator(".qx-jan-step-header");
      const thoughtLabel = locale === "zh" ? "思考" : "Thought";
      const heading = locale === "zh" ? "查询已安装的软件" : "Inspect installed applications";
      await expect(thoughtHeaders.nth(0)).toHaveText(`${thoughtLabel} · ${heading}`);
      await expect(thoughtHeaders.nth(1)).toHaveText(locale === "zh"
        ? "思考 · 按类别整理软件清单。"
        : "Thought · Group the installed applications.");
      await expect(thoughtHeaders.nth(2)).toHaveText(locale === "zh"
        ? "思考 · 核对软件来源"
        : "Thought · Verify application sources");
      await expect(thoughtHeaders.nth(3)).toHaveText(thoughtLabel);
      assert.ok((await thoughtHeaders.nth(4).textContent()).endsWith("…"));
      for (const header of await thoughtHeaders.all()) {
        await expect(header).toHaveAttribute("aria-expanded", "false");
      }
      await thoughtHeaders.nth(0).focus();
      await page.keyboard.press("Enter");
      await expect(thoughtHeaders.nth(0)).toHaveAttribute("aria-expanded", "true");
      await expect(thoughts.locator(".qx-jan-thought-text")).toContainText("###");
      await page.evaluate(() => window.qxAiDisclosureFixture.appendThought());
      await expect(thoughtHeaders.nth(0)).toHaveText(`${thoughtLabel} · ${heading}`);
      await expect(thoughtHeaders.nth(0)).toHaveAttribute("aria-expanded", "true");
      await expect(thoughts.locator(".qx-jan-thought-text")).toContainText("Additional streamed detail.");
      await expect(thoughtHeaders.nth(1)).toHaveAttribute("aria-expanded", "false");
    }
  }
  await page.setViewportSize({ width: 360, height: 720 });
  await page.goto(`${base}?locale=zh&theme=dark`);
  const narrowLayout = page.locator('[data-fixture="layout"]');
  const narrowThoughts = page.locator('[data-fixture="thoughts"]');
  await narrowThoughts.locator('[data-qx-ai="reasoning"] > button').click();
  const thoughtGeometry = await narrowThoughts.evaluate((element) => {
    const header = element.querySelector(".qx-jan-step:last-child .qx-jan-step-header");
    const label = header.querySelector(".qx-jan-step-label");
    return {
      overflow: element.scrollWidth > element.clientWidth,
      clipped: label.scrollWidth > label.clientWidth,
      arrowVisible: header.querySelector(".qx-jan-chevron").getBoundingClientRect().right
        <= element.getBoundingClientRect().right,
      singleLine: getComputedStyle(label).whiteSpace === "nowrap",
    };
  });
  assert.equal(thoughtGeometry.overflow, false, "thought titles must fit narrow timelines");
  assert.equal(thoughtGeometry.clipped, true, "long thought titles must ellipsize");
  assert.equal(thoughtGeometry.arrowVisible, true, "title must leave room for disclosure arrow");
  assert.equal(thoughtGeometry.singleLine, true);
  const narrowOverflow = await narrowLayout.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  assert.ok(
    narrowOverflow.scrollWidth <= narrowOverflow.clientWidth,
    "narrow transcript must not overflow horizontally",
  );
  const narrowColumnsAligned = await narrowLayout.evaluate((element) => {
    const messages = element.querySelector(".qx-ai-message-column")?.getBoundingClientRect();
    const composer = element.querySelector(".qx-jan-composer")?.getBoundingClientRect();
    if (!messages || !composer) return false;
    return Math.abs(messages.left - composer.left) <= 1
      && Math.abs(messages.right - composer.right) <= 1;
  });
  assert.equal(narrowColumnsAligned, true, "narrow transcript and composer must remain aligned");
  const narrowModelTrigger = narrowLayout.locator('[data-qx-ai="model-switcher"]');
  const narrowModelAffordance = await narrowModelTrigger.evaluate((element) => {
    const style = getComputedStyle(element);
    const provider = element.querySelector(".qx-ai-model-trigger-provider");
    const chevron = element.querySelector(".qx-ai-model-trigger-chevron");
    return {
      background: style.backgroundColor,
      radius: Number.parseFloat(style.borderRadius),
      providerDisplay: provider ? getComputedStyle(provider).display : "missing",
      chevronDisplay: chevron ? getComputedStyle(chevron).display : "missing",
    };
  });
  assert.notEqual(narrowModelAffordance.background, "rgba(0, 0, 0, 0)");
  assert.ok(narrowModelAffordance.radius >= 8);
  assert.equal(narrowModelAffordance.providerDisplay, "none");
  assert.notEqual(narrowModelAffordance.chevronDisplay, "none");
  await narrowModelTrigger.click();
  const narrowModelPopover = page.locator(".qx-ai-model-popover");
  await expect(narrowModelPopover).toBeVisible();
  const narrowPopoverBounds = await narrowModelPopover.boundingBox();
  assert.ok(narrowPopoverBounds && narrowPopoverBounds.x >= 0);
  assert.ok(narrowPopoverBounds && narrowPopoverBounds.x + narrowPopoverBounds.width <= 360);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: "/tmp/qx-ai-model-switcher-dark-zh.png", fullPage: true });
  console.log("QxAI browser: model picker, transcript follow, split-flap clock, disclosure lifecycle and tool results passed");
} finally {
  await browser.close();
}
