export default {
  commands: [
    {
      name: "hello",
      title: "Say Hello",
      async run(context) {
        const name = await context.prompt("What's your name?", "World");
        if (name !== null) {
          context.showToast("Hello, " + name + "! Welcome to Qx.");
        }
      }
    },
    {
      name: "goodbye",
      title: "Say Goodbye",
      async run(context) {
        context.showToast("Goodbye! See you next time.");
      }
    }
  ],

  panel: {
    render(container, context) {
      container.innerHTML = `
        <div style="padding: 20px; font-family: system-ui; color: var(--text-primary, #333);">
          <h2 style="margin: 0 0 12px; font-size: 18px;">Hello World Plugin</h2>
          <p style="color: var(--text-secondary, #666); margin: 0 0 16px;">
            This is a demo plugin panel rendered inside an iframe sandbox.
          </p>
          <button id="hello-btn" style="
            padding: 8px 16px;
            border: 1px solid #ccc;
            border-radius: 6px;
            background: #f5f5f5;
            cursor: pointer;
            font-size: 14px;
          ">Say Hello</button>
          <div id="output" style="margin-top: 16px; font-size: 14px; color: #666;"></div>
        </div>
      `;

      const btn = container.querySelector('#hello-btn');
      const output = container.querySelector('#output');
      if (btn) {
        btn.addEventListener('click', async () => {
          const name = await context.prompt("Enter your name:", "World");
          if (name !== null && output) {
            output.textContent = "Hello, " + name + "!";
            context.showToast("Hello, " + name + "!");
          }
        });
      }
    },
    destroy(container) {
      container.innerHTML = "";
    }
  }
};
