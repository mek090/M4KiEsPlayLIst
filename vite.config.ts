import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/icon.svg", "icons/apple-touch-icon.svg"],
      manifest: {
        name: "M4KiEs Room",
        short_name: "M4KiEs",
        description: "Listen to music together in real-time",
        theme_color: "#ff7eb6",
        background_color: "#1a0f1f",
        display: "standalone",
        orientation: "portrait",
        scope: "/",
        start_url: "/",
        icons: [
          {
            src: "icons/icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any",
          },
          {
            src: "icons/icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico}"],
        // Don't cache audio streams or YouTube
        navigateFallback: "index.html",
        navigateFallbackDenylist: [/^\/api/, /^\/ws/],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      "/ws": {
        target: "ws://localhost:3000",
        ws: true,
      },
      "/api": {
        target: "http://localhost:3000",
      },
    },
  },
  build: {
    target: "es2020",
    sourcemap: false,
    // Split React + React-DOM into their own chunk so app updates don't
    // bust the cache for the framework (~130 KB) on returning users.
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (
            id.includes("node_modules/react/") ||
            id.includes("node_modules/react-dom/") ||
            id.includes("node_modules/scheduler/")
          ) {
            return "react-vendor";
          }
          return undefined;
        },
      },
    },
  },
});
