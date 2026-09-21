import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 700 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const base = process.env.QX_FIXTURE_URL ?? "http://127.0.0.1:1420/scripts/fixtures/shell-contracts.html";
const open = async (query = "mode=combined") => {
  await page.goto(`${base}?${query}`);
  await page.waitForFunction(() => Boolean(window.fixture));
};
const invoke = (name, value) => page.evaluate(([name, value]) => window.fixture[name](value), [name, value]);
const resolve = () => page.evaluate(() => window.fixture.deferred.shift()?.());
const calls = () => page.evaluate(() => window.fixture.calls);
try {
  await open();
  const root = page.locator(".qx-shell");
  const primary = page.locator(".qx-shell-actions .variant-primary");
  const contextRun = page.locator(".qx-shell-context button").filter({ hasText: "Run a very long" });
  await primary.click();
  await expect(primary).toBeDisabled();
  await expect(contextRun).toBeDisabled();
  await invoke("rerender");
  await expect(primary).toBeDisabled();
  assert.equal((await calls()).filter((x) => x === "run").length, 1);
  await resolve(); await expect(primary).toBeEnabled();
  await contextRun.click(); await resolve(); await expect(primary).toBeEnabled();
  await root.focus(); await page.keyboard.press("Enter"); await resolve();
  await page.keyboard.press("Meta+k");
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(page.getByRole("menuitem").first()).toBeFocused();
  await page.keyboard.press("Enter"); await resolve();
  assert.equal((await calls()).filter((x) => x === "run").length, 4, "all four surfaces execute one command each");

  // Context submenu -> late resolution after close must not reopen.
  await page.locator(".qx-shell-context").getByRole("button", { name: /^Submenu / }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape"); await resolve();
  await expect(page.getByRole("menu")).toBeHidden();
  await root.focus(); await page.keyboard.press("Meta+m"); await resolve();
  const filter = page.getByRole("combobox");
  await expect(filter).toBeFocused();
  await filter.fill("Child"); await page.keyboard.press("ArrowLeft");
  await expect(filter).toHaveValue("Child");
  await page.keyboard.press("Home"); await expect(filter).toBeFocused();
  await page.keyboard.press("End"); await expect(filter).toBeFocused();
  const beforeIme = (await calls()).length;
  await filter.dispatchEvent("keydown", { key: "Enter", isComposing: true });
  assert.equal((await calls()).length, beforeIme);
  await page.keyboard.press("Enter");
  assert.equal((await calls()).at(-1), "child");
  await expect(page.getByRole("menu")).toBeHidden();

  await root.focus(); await page.keyboard.press("Meta+m");
  await page.keyboard.press("Meta+j");
  await expect(page.getByRole("menuitem", { name: "Fast child" })).toBeVisible();
  await resolve();
  await expect(page.getByRole("menuitem", { name: "Fast child" })).toBeVisible();
  await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
  await root.focus(); await page.keyboard.press("Meta+e");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /View error details/ }).click();
  await expect(page.getByRole("dialog")).toContainText("Submenu failure");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect.poll(async () => (await calls()).filter((x) => x === "load-failed").length).toBe(2);
  await page.keyboard.press("Escape");
  assert.ok(!(await calls()).includes("disabled"));

  await root.focus(); await page.keyboard.press("Meta+m");
  await invoke("route", "another-route"); await resolve();
  await expect(page.getByRole("menu")).toBeHidden();
  await root.focus(); await page.keyboard.press("Meta+f");
  await expect(page.getByRole("button", { name: /View error details/ })).toBeVisible();
  await page.getByRole("button", { name: /View error details/ }).click();
  await expect(page.getByRole("dialog")).toContainText("Expected failure");
  await page.keyboard.press("Escape");
  assert.ok(!(await calls()).includes("leave"), "dialog Esc must not leave Shell");

  await invoke("guard", "cancel");
  await root.focus(); await page.keyboard.press("Meta+g");
  assert.ok(!(await calls()).includes("guarded"));
  await invoke("guard", "allow"); await page.keyboard.press("Meta+g");
  const guarded = page.locator(".qx-shell-context").getByRole("button", { name: /^Guarded command/ });
  await expect(guarded).toBeDisabled();
  await resolve(); await expect(guarded).toBeEnabled();
  await invoke("guard", "fail"); await page.keyboard.press("Meta+g");
  await page.getByRole("button", { name: /View error details: Actions/ }).click();
  await expect(page.getByRole("dialog")).toContainText("Guard failed");

  // Stable error identity: inline callbacks/new equivalent target objects cannot reset TTL.
  await open("mode=feedback");
  await invoke("error", "Feedback detail");
  await expect(page.getByRole("button", { name: /View error details/ })).toBeVisible();
  const snapshot = await page.evaluate(() => window.fixture.snapshot());
  await invoke("rerender");
  assert.deepEqual(await page.evaluate(() => window.fixture.snapshot()), snapshot);

  // Real pointer + keyboard splitter lifecycle, storage commits only at completion.
  await page.setViewportSize({ width: 1400, height: 700 });
  await open("mode=layout");
  const separator = page.getByRole("separator", { name: "Resize list", exact: true });
  await expect(separator).toBeVisible();
  await separator.focus(); await page.keyboard.press("End");
  const stored = await page.evaluate(() => localStorage.getItem("fixture.width"));
  assert.ok(Number(stored) >= 220);
  const box = await separator.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 80); await page.mouse.down();
  await page.mouse.move(box.x - 40, box.y + 80, { steps: 5 });
  assert.equal(await page.evaluate(() => localStorage.getItem("fixture.width")), stored);
  await page.mouse.up();
  assert.notEqual(await page.evaluate(() => localStorage.getItem("fixture.width")), stored);
  assert.equal(await page.evaluate(() => document.body.style.cursor), "");
  const contextSeparator = page.getByRole("separator", { name: "Resize or hide context panel" });
  await contextSeparator.focus(); await page.keyboard.press("End");
  await expect(page.locator(".qx-shell-context")).toHaveAttribute("inert", "");
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(".qx-shell-context")).not.toHaveAttribute("inert", "");
  assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue("--qx-context-current-w")), "");

  // Shrink clamps the rendered width without destroying the user's saved preference.
  const preferred = await page.evaluate(() => localStorage.getItem("fixture.width"));
  await page.setViewportSize({ width: 680, height: 600 });
  assert.equal(await page.evaluate(() => localStorage.getItem("fixture.width")), preferred);
  await page.getByRole("button", { name: "Open detail" }).click();
  await expect(page.getByTestId("detail")).toBeVisible();
  await expect(page.getByTestId("list")).toBeHidden();
  await root.focus(); await page.keyboard.press("Escape");
  await expect(page.getByTestId("list")).toBeVisible();
  assert.ok(!(await calls()).includes("leave"), "inner Esc only returns to the list");
  const search = page.getByPlaceholder("Search", { exact: true });
  await search.fill("query"); await page.keyboard.press("Escape");
  await expect(search).toHaveValue("");
  assert.ok(!(await calls()).includes("leave"), "query Esc does not leave the module");
  await page.setViewportSize({ width: 1400, height: 700 });
  await expect(separator).toBeVisible();
  await separator.focus();
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error("Storage unavailable"); }; });
  await page.keyboard.press("ArrowRight");
  const cleanupBox = await separator.boundingBox();
  await page.mouse.move(cleanupBox.x + 2, cleanupBox.y + 40); await page.mouse.down();
  await invoke("panes", false);
  await expect(page.getByTestId("plain")).toBeVisible();
  assert.equal(await page.evaluate(() => document.body.style.cursor), "");
  assert.equal(await page.evaluate(() => document.body.style.userSelect), "");
  await page.mouse.up();

  await page.setViewportSize({ width: 360, height: 600 });
  await open("mode=feedback"); await invoke("showTask");
  await expect(page.locator('.qx-island-surface[data-priority="task"]')).toBeVisible();
  await expect(page.getByTestId("preview")).toBeHidden();

  let cases = 0;
  for (const mode of ["baseline", "actions", "feedback", "layout", "combined"]) {
    for (const theme of ["light", "dark"]) for (const locale of ["en", "zh"]) {
      await open(`mode=${mode}&theme=${theme}&locale=${locale}`);
      assert.equal(await page.locator("html").getAttribute("data-theme"), theme);
      for (const width of [360, 680, 760, 860, 980, 1200]) {
        await page.setViewportSize({ width, height: 600 });
        const before = await page.locator(".qx-shell-bottombar").boundingBox();
        if (mode === "feedback" || mode === "combined") await invoke("error", "Long reason ".repeat(60));
        await expect.poll(() => page.locator(".qx-shell-bottombar").getAttribute("data-island-density")).not.toBeNull();
        const after = await page.locator(".qx-shell-bottombar").boundingBox();
        assert.equal(after.y, before.y); assert.equal(after.height, before.height);
        await expect.poll(() => page.locator(".qx-shell").evaluate((e) => e.scrollWidth - e.clientWidth), {
          message: `horizontal overflow ${mode}/${theme}/${locale}/${width}`,
        }).toBeLessThanOrEqual(1);
        if (mode === "feedback" || mode === "combined") {
          const island = page.locator('.qx-island-surface[data-priority="error"]');
          await expect(island).toBeVisible();
          await expect.poll(async () => {
            const geometry = await island.boundingBox();
            return Math.abs(geometry.x + geometry.width / 2 - width / 2);
          }).toBeLessThan(2);
          await expect.poll(async () => {
            const geometry = await island.boundingBox();
            const actions = await page.locator(".qx-shell-actions").boundingBox();
            return geometry.x + geometry.width - actions.x;
          }, { message: `overlap ${mode}/${width}/${locale}` }).toBeLessThanOrEqual(1);
          await page.getByRole("button", { name: locale === "zh" ? /^查看错误详情/ : /^View error details/ }).click();
          await expect(page.getByRole("dialog")).toContainText("Long reason");
          await page.keyboard.press("Escape");
          await invoke("error", "");
        }
        cases++;
      }
    }
  }
  await open("mode=combined&theme=dark&locale=zh");
  await page.setViewportSize({ width: 360, height: 500 });
  await invoke("error", "错误原因：保留当前内容，不增加一行。".repeat(20));
  await page.screenshot({ path: "/tmp/qx-shell-compact-dark.png" });
  assert.deepEqual(errors, []);
  console.log(`shell browser: ${cases} isolated/combined theme, locale and width cases; action, IME, async, error and splitter interactions passed`);
} finally { await browser.close(); }
