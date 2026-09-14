import { fileURLToPath } from "node:url";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

const entry = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/**
 * electron-vite bundles the three processes separately. `externalizeDepsPlugin` leaves everything in
 * `dependencies` — onnxruntime-node above all, which carries native binaries — out of the bundle.
 */
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: entry("src/main/index.ts") } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: entry("src/preload/index.ts") } },
  },
  renderer: {
    root: "src/renderer",
    // Images stay files: the window's Content-Security-Policy allows nothing but 'self', so an image inlined as a
    // data: URI would not show.
    build: { assetsInlineLimit: 0, rollupOptions: { input: entry("src/renderer/index.html") } },
  },
});
