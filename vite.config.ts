import { defineConfig } from "vite";
import type { Plugin } from "vite";
import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

function previewRuntimeAssets(): Plugin {
  const files = new Map([
    ["worker-bundle.js", readFileSync(new URL("./node_modules/libarchive.js/dist/worker-bundle.js", import.meta.url))],
    ["libarchive.wasm", readFileSync(new URL("./node_modules/libarchive.js/dist/libarchive.wasm", import.meta.url))],
  ]);
  return {
    name: "qx-preview-runtime-assets",
    configureServer(server) {
      server.middlewares.use("/vendor/libarchive", (request, response, next) => {
        const name = request.url?.split("?")[0].replace(/^\//, "") ?? "";
        const source = files.get(name);
        if (!source) return next();
        response.setHeader("Content-Type", name.endsWith(".wasm") ? "application/wasm" : "text/javascript");
        response.end(source);
      });
    },
    generateBundle() {
      for (const [name, source] of files) {
        this.emitFile({ type: "asset", fileName: `vendor/libarchive/${name}`, source });
      }
    },
  };
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss(), previewRuntimeAssets()],
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
    },
  },

  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (
            id.includes("/react/") ||
            id.includes("/react-dom/") ||
            id.includes("/scheduler/") ||
            id.includes("/zustand/")
          ) {
            return "vendor-react";
          }
          if (id.includes("/@radix-ui/")) return "vendor-radix";
          if (id.includes("/lucide-react/")) return "vendor-icons";
          if (id.includes("/@tauri-apps/")) return "vendor-tauri";
        },
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
