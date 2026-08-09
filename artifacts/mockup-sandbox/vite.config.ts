import { defineConfig, transformWithEsbuild } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { mockupPreviewPlugin } from "./mockupPreviewPlugin";

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    "BASE_PATH environment variable is required but was not provided.",
  );
}

export default defineConfig({
  base: basePath,
  plugins: [
    // expo-linear-gradient ships JSX inside .js build files; give them a jsx loader.
    {
      name: "expo-linear-gradient-jsx",
      async transform(code, id) {
        if (id.includes("expo-linear-gradient/build")) {
          return transformWithEsbuild(code, id, { loader: "jsx", jsx: "automatic" });
        }
      },
    },
    mockupPreviewPlugin(),
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: [
      { find: "@", replacement: path.resolve(import.meta.dirname, "src") },
      // ── FillEdgeRepro harness: mount the REAL mobile FocalImage on web ──
      // expo-linear-gradient's package entry imports './NativeLinearGradient'
      // (native shim); force the .web.js implementation like Metro would.
      {
        find: /^\.\/NativeLinearGradient$/,
        replacement: path.resolve(
          import.meta.dirname,
          "../mobile/node_modules/expo-linear-gradient/build/NativeLinearGradient.web.js",
        ),
      },
      {
        find: "expo-linear-gradient",
        replacement: path.resolve(
          import.meta.dirname,
          "../mobile/node_modules/expo-linear-gradient/build/LinearGradient.js",
        ),
      },
      // PawPlaceholder (error path only) pulls react-native-svg; stub it.
      {
        find: "react-native-svg",
        replacement: path.resolve(
          import.meta.dirname,
          "src/components/mockups/rnSvgStub.tsx",
        ),
      },
      { find: "react-native", replacement: "react-native-web" },
    ],
  },
  optimizeDeps: {
    exclude: ["expo-linear-gradient"],
    esbuildOptions: { loader: { ".js": "jsx" } },
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist"),
    emptyOutDir: true,
  },
  server: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
