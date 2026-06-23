export default {
  commands: [
    {
      name: "count-clipboard",
      title: "Count Clipboard Text",
      async run(context) {
        try {
          const text = await context.invoke("get_clipboard_text");
          if (!text || typeof text !== 'string') {
            context.showToast("Clipboard is empty or not text.");
            return;
          }
          const chars = text.length;
          const words = text.trim().split(/\s+/).filter(w => w.length > 0).length;
          const lines = text.split(/\r?\n/).length;
          context.showToast(
            "Chars: " + chars + " | Words: " + words + " | Lines: " + lines
          );
        } catch (e) {
          context.showToast("Error: " + e.message);
        }
      }
    }
  ]
};
