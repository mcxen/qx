import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const script = read("src/shell/webviewDefaults.js");
assert.match(read("src-tauri/src/lib.rs"), /\.plugin\(webview_policy::init\(\)\)/);
assert.match(read("src-tauri/src/webview_policy.rs"), /js_init_script_on_all_frames\(script\)/);

const browser = await chromium.launch({ channel: "chrome", headless: true });
let checked = 0;
try {
  for (const debug of [false, true]) {
    const context = await browser.newContext();
    await context.addInitScript(script.replace("/* QX_DEVTOOLS */ false", String(debug)));
    const page = await context.newPage();
    // Use real document-start injection, including sandboxed opaque frames.
    await page.route("https://qx.test/**", (route) => route.fulfill({
      contentType: "text/html",
      body: '<div id="chrome" tabindex="0">Qx</div><input id="editor"><input type="checkbox"><textarea></textarea><div contenteditable="plaintext-only"><span contenteditable="false">read only</span></div><iframe sandbox="allow-scripts" srcdoc="<input id=editor><div id=chrome>Plugin</div>"></iframe>',
    }));
    await page.goto("https://qx.test/");
    await page.frameLocator("iframe").locator("#editor").waitFor();
    for (const frame of page.frames()) {
      checked += await frame.evaluate((debug) => {
        let count = 0;
        const verify = (condition, message) => { if (!condition) throw new Error(message); count++; };
        const chrome = document.getElementById("chrome");
        const editor = document.getElementById("editor");
        const dispatch = (target, options) => {
          const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...options });
          target.dispatchEvent(event);
          return event.defaultPrevented;
        };
        for (const target of [chrome, editor]) {
          for (const modifier of ["ctrlKey", "metaKey"]) {
            for (const key of ["f", "g", "p", "r", "s", "u", "+", "-", "0", "[", "]"]) {
              verify(dispatch(target, { key, [modifier]: true }), `${modifier}+${key} default leaked`);
            }
            for (const key of ["a", "c", "x", "v", "z", "y", "ArrowLeft", "Home", "End"]) {
              verify(!dispatch(target, { key, [modifier]: true }), `${modifier}+${key} editing stolen`);
            }
          }
          for (const key of ["F3", "F5", "F7", "BrowserBack", "BrowserForward"]) {
            verify(dispatch(target, { key }), `${key} default leaked`);
          }
          verify(dispatch(target, { key: "F12" }) === !debug, "devtools build policy mismatch");
          verify(dispatch(target, { key: "I", ctrlKey: true, shiftKey: true }) === !debug, "inspect build policy mismatch");
          verify(dispatch(target, { key: "ArrowLeft", altKey: true }), "Alt+Left navigation leaked");
          verify(!dispatch(target, { key: "f", ctrlKey: true, altKey: true }), "AltGr stolen");
          verify(!dispatch(target, { key: "f", ctrlKey: true, isComposing: true }), "IME stolen");
          verify(!dispatch(target, { key: "Enter", keyCode: 229 }), "legacy IME stolen");
          verify(dispatch(target, { key: "а", code: "KeyF", ctrlKey: true }), "non-Latin browser chord leaked");
        }
        verify(dispatch(chrome, { key: "Backspace" }), "chrome backspace history leaked");
        verify(!dispatch(editor, { key: "Backspace" }), "editor backspace stolen");
        let actions = 0;
        chrome.addEventListener("keydown", (event) => {
          if (event.ctrlKey && event.key === "p") {
            verify(!event.defaultPrevented, "browser guard ran before client action");
            event.preventDefault(); actions++;
          }
        });
        dispatch(chrome, { key: "p", ctrlKey: true });
        verify(actions === 1, "client action lost");
        for (const [target, expected] of [[chrome, true], [editor, false], ...Array.from(document.querySelectorAll("textarea, [contenteditable], input[type=checkbox]")).map((element) => [element, element.getAttribute("contenteditable") === "false" || element.type === "checkbox"])]) {
          const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
          target.dispatchEvent(event);
          verify(event.defaultPrevented === expected, "right-click editing policy mismatch");
        }
        chrome.addEventListener("contextmenu", (event) => { actions++; event.preventDefault(); });
        chrome.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
        verify(actions === 2, "client context menu lost");
        for (const modified of [false, true]) {
          const event = new WheelEvent("wheel", { ctrlKey: modified, bubbles: true, cancelable: true });
          chrome.dispatchEvent(event);
          verify(event.defaultPrevented === modified, "client zoom/normal scroll mismatch");
        }
        editor.addEventListener("wheel", (event) => { actions++; event.preventDefault(); });
        editor.dispatchEvent(new WheelEvent("wheel", { ctrlKey: true, bubbles: true, cancelable: true }));
        verify(actions === 3, "feature image zoom lost");
        return count;
      }, debug);
    }
    // Native editing still changes the actual input under the installed guard.
    await page.locator("#editor").fill("original");
    await page.locator("#editor").focus();
    await page.keyboard.press("Control+a");
    await page.keyboard.type("replacement");
    assert.equal(await page.locator("#editor").inputValue(), "replacement");
    await page.keyboard.press("Control+z");
    assert.equal(await page.locator("#editor").inputValue(), "original");
    await context.close();
  }
  console.log(`webview policy: ${checked} browser, editing, IME, menu and opaque-frame assertions passed`);
} finally {
  await browser.close();
}
