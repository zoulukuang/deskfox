import config from "./vite.config"

// FORK: acceptance must not navigate away when other release files change. 2026-10-19
export default {
  ...config,
  server: { ...config.server, hmr: false, watch: null },
}
