import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1000, height: 740 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => { if (/passive event listener/i.test(message.text())) errors.push(message.text()); });
const base = process.env.QX_FIXTURE_URL ?? "http://127.0.0.1:1433/scripts/fixtures/media-viewer.html";
const scroll = page.locator(".qx-host-workbench-media-preview-scroll");
const zoom = page.locator(".qx-host-workbench-media-zoom-value");
const image = scroll.locator("img");
const position = () => scroll.evaluate((el) => ({ x: el.scrollLeft, y: el.scrollTop, width: el.clientWidth, height: el.clientHeight, end: el.scrollHeight - el.clientHeight }));
const open = async (name) => {
  await page.getByRole("button", { name: `Image Preview: ${name}`, exact: true }).click();
  await expect(scroll).toHaveAttribute("aria-busy", "false");
  await expect(zoom).toHaveText("100%");
};
try {
  await page.goto(base);
  await open("Landscape");
  await expect(scroll).toBeFocused();
  const fitted = await image.boundingBox();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(zoom).toHaveText("125%");
  assert.ok((await image.boundingBox()).width > fitted.width * 1.2, "zoom changes image geometry");
  for (let i = 0; i < 3; i++) await page.keyboard.press("+");
  await expect(zoom).toHaveText("200%");
  await scroll.hover();
  await page.mouse.wheel(100, 160);
  await expect.poll(async () => (await position()).y).toBeGreaterThan(0);
  await expect(zoom).toHaveText("200%");
  const box = await scroll.boundingBox();
  await page.mouse.move(box.x + 65, box.y + box.height / 2);
  await expect(page.locator(".qx-host-workbench-media-preview-nav-zone.is-previous")).toHaveCSS("opacity", "1");
  const pointer = { x: box.x + box.width * 0.6, y: box.y + box.height * 0.55 };
  const point = async () => { const b = await image.boundingBox(); return [(pointer.x - b.x) / b.width, (pointer.y - b.y) / b.height]; };
  const before = await point();
  await scroll.dispatchEvent("wheel", { ctrlKey: true, deltaY: -60, clientX: pointer.x, clientY: pointer.y });
  await expect(zoom).not.toHaveText("200%");
  const after = await point();
  assert.ok(after.every((value, i) => Math.abs(value - before[i]) < 0.005), "zoom preserves pointer anchor in offset dialog");
  await scroll.focus();
  const previous = await position();
  await page.keyboard.press("ArrowDown");
  await expect.poll(async () => (await position()).y).toBeGreaterThan(previous.y);
  await page.keyboard.press("ArrowRight");
  await expect(image).toHaveAttribute("alt", "Landscape");
  await page.keyboard.press("Home");
  await page.mouse.move(pointer.x, pointer.y); await page.mouse.down();
  const dragStart = await position();
  await page.mouse.move(pointer.x - 90, pointer.y - 80, { steps: 5 }); await page.mouse.up();
  assert.ok((await position()).y > dragStart.y + 60, "drag pans without native image dragging");
  await page.keyboard.press("0");
  await expect(zoom).toHaveText("100%");
  await page.keyboard.press("ArrowRight");
  await expect(image).toHaveAttribute("alt", "Portrait");
  await expect(scroll).toHaveAttribute("aria-busy", "false");
  assert.ok((await image.boundingBox()).height <= (await position()).height);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByRole("button", { name: "Image Preview: Landscape", exact: true })).toBeFocused();
  assert.deepEqual(await page.evaluate(() => window.fixture.calls), []);

  await open("Long image");
  assert.equal((await position()).y, 0);
  await scroll.hover(); await page.mouse.wheel(0, 300);
  await expect.poll(async () => (await position()).y).toBeGreaterThan(200);
  await expect(zoom).toHaveText("100%");
  await scroll.dispatchEvent("wheel", { deltaY: 3, deltaMode: 1 });
  await expect(zoom).toHaveText("100%");
  await page.keyboard.press("End");
  assert.ok(Math.abs((await position()).y - (await position()).end) < 2, "bottom remains reachable");
  await page.keyboard.press("Home"); assert.equal((await position()).y, 0);
  for (let i = 0; i < 14; i++) await page.keyboard.press("+");
  await expect(zoom).toHaveText("400%");
  await expect(page.getByRole("button", { name: "Zoom in", exact: true })).toBeDisabled();
  for (let i = 0; i < 16; i++) await page.keyboard.press("-");
  await expect(zoom).toHaveText("50%");
  await expect(page.getByRole("button", { name: "Zoom out", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await open("Long image"); assert.equal((await position()).y, 0);
  await page.keyboard.press("Escape");

  // Current image appears without waiting for the unresolved neighbor group.
  await page.evaluate(() => window.fixture.kind("slow"));
  await open("Landscape");
  await page.keyboard.press("Escape");
  await page.evaluate(() => window.fixture.release());
  await expect(page.getByRole("dialog")).toBeHidden();
  // Detail deliberately rejects failed images; exercise a load failure after open instead.
  await page.evaluate(() => window.fixture.kind("normal"));
  await open("Landscape");
  await image.dispatchEvent("error");
  await expect(page.getByRole("status")).toHaveText("Image unavailable");
  await page.getByRole("button", { name: "Next image", exact: true }).click();
  await expect(image).toHaveAttribute("alt", "Portrait");
  await page.keyboard.press("Escape");

  for (const width of [360, 680, 1200]) {
    for (const theme of ["light", "dark"]) {
      await page.setViewportSize({ width, height: 660 });
      await page.goto(`${base}?theme=${theme}`);
      await open("Landscape");
      const dialog = await page.getByRole("dialog").boundingBox();
      assert.ok(dialog.x >= 0 && dialog.y >= 0 && dialog.x + dialog.width <= width + 1 && dialog.y + dialog.height <= 661);
      const download = await page.locator(".qx-host-workbench-media-download").boundingBox();
      const controls = await page.locator(".qx-host-workbench-media-zoom").boundingBox();
      assert.ok(download.x + download.width <= controls.x, "narrow controls never overlap");
      if (width === 680 && theme === "dark") await page.screenshot({ path: "/tmp/qx-media-viewer-dark.png" });
      if (width === 360 && theme === "light") await page.screenshot({ path: "/tmp/qx-media-viewer-narrow.png" });
      await page.keyboard.press("Escape");
    }
  }
  await page.goto(`${base}?locale=zh&kind=single&theme=dark`);
  await page.getByRole("button", { name: "图片预览: Landscape", exact: true }).click();
  await expect(scroll).toHaveAttribute("aria-busy", "false");
  await expect(page.locator(".qx-host-workbench-media-preview-count")).toHaveCount(0);
  await page.getByRole("button", { name: "放大图片", exact: true }).click();
  await expect(zoom).toHaveText("125%");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "图片预览: Landscape", exact: true })).toBeFocused();
  assert.deepEqual(errors, []);
  console.log("Media viewer browser checks passed: Workbench, cached reopen, fit, zoom anchor/limits, wheel, drag, keyboard, Esc/focus, async close, failure recovery, responsive themes.");
} finally { await browser.close(); }
