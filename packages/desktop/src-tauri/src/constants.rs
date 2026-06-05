use tauri_plugin_window_state::StateFlags;

pub const SETTINGS_STORE: &str = "opencode.settings.dat";
pub const DEFAULT_SERVER_URL_KEY: &str = "defaultServerUrl";
pub const WSL_ENABLED_KEY: &str = "wslEnabled";
// FORK: updater backend 总开关 — 从 false 翻 true,启用 DeskFox 自家 updater。
// 前序 feat 禁自动升级 硬关了所有上游通道(防 DeskFox 被整壳替换);现在密钥/endpoint/
// latest.json 全部切换到 DeskFox 自有体系,安全底线守住。[启用自动升级] 2026-06-05
pub const UPDATER_ENABLED: bool = true;

pub fn window_state_flags() -> StateFlags {
    // FORK: 不记忆 MAXIMIZED / FULLSCREEN — 否则上次最大化或全屏状态被恢复,窗口开局铺满整屏、
    // 系统层面无法鼠标拖边 resize(实测残留 state 里 fullscreen:true 导致窗口盖住任务栏拖不动)。
    // 尺寸/位置仍跨会话记忆;最大化/全屏按钮当次仍可用,只是不持久化。[fix: window-resizable] 2026-05-27
    StateFlags::all() - StateFlags::DECORATIONS - StateFlags::VISIBLE - StateFlags::MAXIMIZED - StateFlags::FULLSCREEN
}
