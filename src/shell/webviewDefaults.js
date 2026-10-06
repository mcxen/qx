// Injected by the native host before any Qx document or plugin frame loads.
// Bubble listeners cancel browser defaults only after the client has responded.
(function installQxWebviewDefaults(allowDevTools) {
  const installed = Symbol.for("qx.webview-defaults");
  if (window[installed]) return;
  window[installed] = true;

  const editable = (target) => {
    if (!(target instanceof Element)) return false;
    const control = target.closest("input, textarea, select, [contenteditable]");
    if (!control) return false;
    if (control instanceof HTMLInputElement) {
      return !["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"].includes(control.type);
    }
    return control.getAttribute("contenteditable") !== "false";
  };
  const browserKeys = new Set([
    "BrowserBack", "BrowserForward", "BrowserRefresh", "BrowserStop",
    "BrowserSearch", "BrowserFavorites", "BrowserHome",
  ]);
  window.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
    const primary = (event.ctrlKey || event.metaKey) && !event.altKey;
    const key = primary && /^Key[A-Z]$/.test(event.code)
      ? event.code.slice(3).toLowerCase() : event.key.toLowerCase();
    const browserChord = primary && (
      ["f", "g", "p", "r", "s", "u", "+", "=", "-", "_", "0", "[", "]"].includes(key)
      || ["NumpadAdd", "NumpadSubtract", "Numpad0"].includes(event.code)
    );
    const devTools = key === "f12" || (primary && event.shiftKey && ["i", "j", "c"].includes(key));
    const history = event.altKey && !event.ctrlKey && !event.metaKey
      && ["arrowleft", "arrowright", "home"].includes(key);
    if (
      browserChord || history || browserKeys.has(event.key)
      || ["f3", "f5", "f7"].includes(key)
      || (!allowDevTools && devTools)
      || (key === "backspace" && !editable(event.target) && !primary && !event.altKey)
    ) event.preventDefault();
  });

  // Ctrl+wheel/trackpad pinch must not rescale the whole desktop client.
  // Feature previews get first refusal and keep their own image zoom.
  window.addEventListener("wheel", (event) => {
    if (!event.defaultPrevented && (event.ctrlKey || event.metaKey)) event.preventDefault();
  }, { passive: false });

  // Preserve real Qx/Radix menus and native text-editing menus. Empty chrome,
  // images and links must never offer Edge's refresh/print/save/inspect menu.
  window.addEventListener("contextmenu", (event) => {
    if (!event.defaultPrevented && !editable(event.target)) event.preventDefault();
  });
})(/* QX_DEVTOOLS */ false);
