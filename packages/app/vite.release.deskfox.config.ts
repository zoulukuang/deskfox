import config from "./vite.config"

// FORK: acceptance must not navigate away when other release files change. 2026-10-19
export default {
  ...config,
  // FORK: isolate acceptance from ordinary dev caches and scan lazy routes before browsers load them.
  cacheDir: "node_modules/.vite-release",
  optimizeDeps: {
    entries: ["index.html", "src/**/*.{ts,tsx}", "!src/**/*.{test,spec,stories}.{ts,tsx}", "!src/**/*.d.ts"],
  },
  server: { ...config.server, hmr: false, watch: null },
}
