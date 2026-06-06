// FORK: 防止系统休眠,保障飞书远程随时可用 [feat: prevent-sleep] 2026-06-06
//
// 需求:DeskFox 是常驻服务,飞书消息走官方 SDK 的 WSS 长连接 push。电脑一旦系统
// 休眠,长连接断开 → 远端发消息收不到。给用户一个开关:开启后阻止系统休眠,但
// **允许屏幕正常关闭**(省电护屏);状态持久化,每次启动自动恢复。
//
// ── 为什么必须用专用 worker 线程 ──
// keepawake 在 Windows 底层是 SetThreadExecutionState,而该执行状态是 *per-thread*
// 的,且**设置它的线程一旦结束,ES_CONTINUOUS 状态立即失效**。Tauri command 跑在
// tokio 线程池上(线程会被回收/复用),直接在 command 线程持有 guard 不可靠。
// 故起一个常驻、不退出的 worker 线程持有 keepawake guard,enable/disable 通过 channel
// 投递 —— guard 的创建与 drop 都固定在这个活线程上,状态持续有效,且 Win/Mac/Linux
// 行为一致。guard 只存在于 worker 线程的局部变量、从不跨线程移动,顺带绕开 keepawake
// 句柄非 Send 的限制。
//
// 已知 native 边界(仅文档记录,不做 UI 提示 — user 2026-06-06 拍板):
//   1. Windows 现代待机(Modern Standby)+ 电池供电:系统会忽略防休眠请求(OS 级限制)。
//   2. 笔记本合盖默认睡:OS/BIOS 电源策略,本功能压不住。
//   3. 关机 / 断电 / 拔网线 / 断网:超出软件能力范围。

use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{Sender, channel};

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter};
use tauri_plugin_store::StoreExt;

use crate::constants::SETTINGS_STORE;

/// store 持久化 key(与 linux_display 等共用 SETTINGS_STORE 文件,各占一个顶层 key)。
pub const PREVENT_SLEEP_CONFIG_KEY: &str = "preventSleepConfig";

/// 托盘 / 前端任一入口切换后广播,另一入口监听同步(双入口状态一致)。
pub const PREVENT_SLEEP_CHANGED_EVENT: &str = "deskfox-prevent-sleep-changed";

#[derive(Default, Serialize, Deserialize)]
#[serde(default)]
struct PreventSleepConfig {
    enabled: bool,
}

/// 当前内存态(get 命令 / 托盘取反读它,避免读盘)。
static ENABLED: AtomicBool = AtomicBool::new(false);

/// worker 线程命令通道(true=启用 / false=关闭)。首次用到时惰性起线程。
static TX: OnceLock<Sender<bool>> = OnceLock::new();

/// 惰性启动常驻 worker 线程并返回其 sender。线程 recv 阻塞、永不退出,持有 keepawake guard。
fn worker_tx() -> &'static Sender<bool> {
    TX.get_or_init(|| {
        let (tx, rx) = channel::<bool>();
        std::thread::Builder::new()
            .name("deskfox-prevent-sleep".into())
            .spawn(move || {
                // guard 全程只活在本线程局部,创建/drop 都在此 → 规避 per-thread 失效 + 非 Send 限制。
                let mut guard: Option<keepawake::KeepAwake> = None;
                while let Ok(enable) = rx.recv() {
                    if enable {
                        if guard.is_none() {
                            match build_awake() {
                                Ok(g) => {
                                    guard = Some(g);
                                    tracing::info!("[prevent-sleep] 已启用(系统不休眠,屏幕仍可关)");
                                }
                                Err(e) => tracing::warn!("[prevent-sleep] 启用失败: {e}"),
                            }
                        }
                    } else if guard.take().is_some() {
                        // drop 即调 SetThreadExecutionState 复原(在本线程,有效)。
                        tracing::info!("[prevent-sleep] 已关闭,恢复正常休眠");
                    }
                }
            })
            .expect("failed to spawn prevent-sleep worker");
        tx
    })
}

/// 构造 keepawake guard:阻止系统休眠(idle+sleep),但允许屏幕关闭(display=false)。
fn build_awake() -> Result<keepawake::KeepAwake, String> {
    keepawake::Builder::default()
        .display(false) // 允许屏幕关闭(省电护屏)
        .idle(true) // 阻止空闲休眠
        .sleep(true) // 阻止显式休眠
        .reason("DeskFox 飞书远程常驻")
        .app_name("DeskFox")
        .app_reverse_domain("ai.deskfox.app")
        .create()
        .map_err(|e| e.to_string())
}

/// 切换防休眠:投递 worker + 更新内存态 + 持久化 + 同步托盘勾选 + 广播 event。
pub fn set_enabled(app: &AppHandle, enabled: bool) -> Result<(), String> {
    let _ = worker_tx().send(enabled);
    ENABLED.store(enabled, Ordering::SeqCst);
    persist(app, enabled)?;
    crate::system_tray::set_prevent_sleep_check(enabled);
    let _ = app.emit(PREVENT_SLEEP_CHANGED_EVENT, enabled);
    Ok(())
}

/// 当前是否启用(get 命令 / 托盘取反 / lib.rs 启动恢复读它)。
pub fn is_enabled() -> bool {
    ENABLED.load(Ordering::SeqCst)
}

fn persist(app: &AppHandle, enabled: bool) -> Result<(), String> {
    let store = app
        .store(SETTINGS_STORE)
        .map_err(|e| format!("Failed to open settings store: {e}"))?;
    store.set(PREVENT_SLEEP_CONFIG_KEY, json!(PreventSleepConfig { enabled }));
    store
        .save()
        .map_err(|e| format!("Failed to save settings store: {e}"))?;
    Ok(())
}

/// 启动恢复:从 store 读上次的开关状态(走 app handle,自动定位正确的 store 路径,
/// 不硬编码 identifier — 兼容 DeskFox 三档 bundle id override)。
pub fn read_persisted(app: &AppHandle) -> bool {
    let Ok(store) = app.store(SETTINGS_STORE) else {
        return false;
    };
    enabled_from_store_value(store.get(PREVENT_SLEEP_CONFIG_KEY))
}

/// 纯函数:从 store 取到的 value 解析 enabled,任何缺失 / 类型错 → 默认 false(关)。单测覆盖。
fn enabled_from_store_value(v: Option<serde_json::Value>) -> bool {
    v.and_then(|v| serde_json::from_value::<PreventSleepConfig>(v).ok())
        .map(|c| c.enabled)
        .unwrap_or(false)
}

// ============================================================
// Tauri commands — 暴露给 GUI(设置页开关)
// ============================================================

/// 设置防休眠开关。GUI Switch onChange 调用。
#[tauri::command]
#[specta::specta]
pub fn set_prevent_sleep(app: AppHandle, enabled: bool) -> Result<(), String> {
    set_enabled(&app, enabled)
}

/// 读当前防休眠状态。GUI 设置页加载时读以显示开关初值。
#[tauri::command]
#[specta::specta]
pub fn get_prevent_sleep() -> bool {
    is_enabled()
}

// ============================================================
// 单测(纯逻辑 — 持久化值解析。keepawake/native 行为见真机 QA)
// ============================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enabled_true_when_stored_true() {
        assert!(enabled_from_store_value(Some(json!({ "enabled": true }))));
    }

    #[test]
    fn disabled_when_stored_false() {
        assert!(!enabled_from_store_value(Some(json!({ "enabled": false }))));
    }

    #[test]
    fn defaults_false_when_never_stored() {
        // 没存过(store 无此 key)→ 默认关,不擅自改用户电源行为。
        assert!(!enabled_from_store_value(None));
    }

    #[test]
    fn defaults_false_when_field_missing() {
        // 有 config 对象但缺 enabled 字段 → serde default 回退 false。
        assert!(!enabled_from_store_value(Some(json!({}))));
    }

    #[test]
    fn defaults_false_on_garbage_type() {
        // 类型损坏(enabled 不是 bool)→ 解析失败,防御性回退 false。
        assert!(!enabled_from_store_value(Some(json!({ "enabled": "yes" }))));
        assert!(!enabled_from_store_value(Some(json!("totally-wrong"))));
    }
}
