// FORK: SETTINGS_STORE 读写共享 helper [feat: prevent-sleep] 2026-06-06
//
// 统一 tauri-plugin-store 的 open / get / set / save 样板,避免各 feature 手抄。
// 走 app.store(SETTINGS_STORE)(而非硬编码 bundle-id 路径),兼容 DeskFox 三档 override。
//
// TODO(follow-up):linux_display.rs 的 read_wayland/write_wayland 也是同款样板,
// 且 read 路径硬编码了 "ai.opencode.desktop" bundle-id(与本 helper 的 app.store 不一致);
// 后续可迁移到此 helper 统一(本次不动 Linux-only 代码,避免无环境验证的改动面)。

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

use crate::constants::SETTINGS_STORE;

/// 读 SETTINGS_STORE 某 key 的原始 JSON value;store 打不开 / key 不存在返 None。
/// 反序列化交给调用方(便于纯函数单测解析逻辑)。
pub fn read_value(app: &AppHandle, key: &str) -> Option<serde_json::Value> {
    app.store(SETTINGS_STORE).ok()?.get(key)
}

/// 把 value 序列化写入 SETTINGS_STORE 某 key 并落盘。
pub fn write<T: Serialize>(app: &AppHandle, key: &str, value: &T) -> Result<(), String> {
    let store = app
        .store(SETTINGS_STORE)
        .map_err(|e| format!("Failed to open settings store: {e}"))?;
    let v = serde_json::to_value(value).map_err(|e| format!("Failed to serialize {key}: {e}"))?;
    store.set(key, v);
    store
        .save()
        .map_err(|e| format!("Failed to save settings store: {e}"))
}
