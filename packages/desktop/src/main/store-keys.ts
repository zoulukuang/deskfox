export const SETTINGS_STORE = "opencode.settings"
export const DEFAULT_SERVER_URL_KEY = "defaultServerUrl"
export const FIRST_LAUNCH_ONBOARDING_COMPLETE_KEY = "firstLaunchOnboardingComplete"
export const OLD_LAYOUT_ELIGIBLE_KEY = "oldLayoutEligible"
export const WSL_SERVERS_KEY = "wslServers"
export const PINCH_ZOOM_ENABLED_KEY = "pinchZoomEnabled"
// FORK: 防休眠开关持久化 key(对齐 Tauri prevent_sleep::PREVENT_SLEEP_CONFIG_KEY)[feat: electron-replatform-macos]
export const PREVENT_SLEEP_CONFIG_KEY = "preventSleepConfig"
// FORK: REQ-083 首启新手引导 — 首启完成标记(gate:已完成不再触发 + 删 New DeskFox 后不重建)
export const FIRST_LAUNCH_DONE_KEY = "firstLaunchDone"
// FORK: REQ-083 设置项 — onboarding.openOnFirstLaunch(默认 true)/ onboarding.completed
export const ONBOARDING_OPEN_ON_FIRST_LAUNCH_KEY = "onboarding.openOnFirstLaunch"
export const ONBOARDING_COMPLETED_KEY = "onboarding.completed"
export const WINDOW_IDS_KEY = "windowIds"
