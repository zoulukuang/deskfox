// [fork-only] DeskFox 匿名使用统计客户端(Rust 原生)
//
// 替代已删除的 Node `@opencode-ai/telemetry` SDK —— 主力 Tauri 前端是 WebView,
// 加载不了 Node SDK,故统计逻辑下沉到 Rust 侧(与 updater 同层)。
//
// 数据安全前提下的最小采集:
//   - 事件:app_open / update_downloaded / update_applied
//   - 字段:version / os(大类)/ arch(大类)/ install_id(匿名 UUID)
//   - 绝不采集:文件路径 / prompt / 模型名 / 用户身份 / 原始 IP(IP 仅后端推断地理后即丢)
//
// 隐私开关(opt-out 优先级):env OPENCODE_TELEMETRY=0 > config telemetry:false > 默认开。
// 上报失败一律静默,绝不 panic / 阻塞主程序(feat: telemetry-usage-stats 2026-06-06)。

use std::fs;
use std::path::PathBuf;
use std::time::Duration;

/// 事件白名单 —— 任何不在此列的事件名一律丢弃(前端 command 也受此约束,防滥用)。
const ALLOWED_EVENTS: &[&str] = &["app_open", "update_downloaded", "update_applied"];

/// Plausible 事件上报端点(后端在东京机)。
const TELEMETRY_ENDPOINT: &str = "https://telemetry.deskfox.ai/api/event";
/// Plausible site domain —— 必须与后端 Plausible 配置的 site 一致,否则数据进不去。
/// 沿用已删 SDK 的约定 `opencode.<clientType>`;阶段 4 SSH 东京机时核对。
const DOMAIN: &str = "opencode.desktop";
/// 上报超时,fire-and-forget,不重试(最小实现)。
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);

// ---------------------------------------------------------------------------
// 路径解析(支持 OPENCODE_TEST_HOME 注入以便单测)
// ---------------------------------------------------------------------------

fn test_home() -> Option<PathBuf> {
    std::env::var("OPENCODE_TEST_HOME").ok().map(PathBuf::from)
}

/// install_id 缓存目录:`~/.cache/opencode/`(复用已删 SDK 的既定路径)。
fn cache_dir() -> Option<PathBuf> {
    let base = test_home().or_else(dirs::home_dir)?;
    Some(base.join(".cache").join("opencode"))
}

/// opencode config 文件:`~/.config/opencode/config.json`(SDK 与 CLI 共用的 opt-out 来源)。
fn config_path() -> Option<PathBuf> {
    let base = test_home().or_else(dirs::home_dir)?;
    Some(base.join(".config").join("opencode").join("config.json"))
}

// ---------------------------------------------------------------------------
// install_id —— 本地随机匿名 UUID,首次生成并落盘,后续复用
// ---------------------------------------------------------------------------

pub fn get_or_create_install_id() -> String {
    get_or_create_install_id_in(cache_dir())
}

fn get_or_create_install_id_in(dir: Option<PathBuf>) -> String {
    let Some(dir) = dir else {
        return "unknown".to_string();
    };
    let path = dir.join("install_id");
    if let Ok(existing) = fs::read_to_string(&path) {
        let trimmed = existing.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    let id = uuid::Uuid::new_v4().to_string();
    // 写入尽力而为:失败也返回本次生成的 id(不 panic,不阻塞)。
    let _ = fs::create_dir_all(&dir);
    let _ = fs::write(&path, &id);
    id
}

/// install_id 短码(8 位),用于 User-Agent;不暴露完整 id。
fn short_id(id: &str) -> String {
    id.chars().take(8).collect()
}

// ---------------------------------------------------------------------------
// opt-out 判定(env > config > 默认 true)
// ---------------------------------------------------------------------------

pub fn is_enabled() -> bool {
    let env_val = std::env::var("OPENCODE_TELEMETRY").ok();
    resolve_enabled(env_val.as_deref(), read_config_telemetry())
}

/// 纯函数:给定 env 值与 config 值,按优先级判定是否启用。可单测。
fn resolve_enabled(env_val: Option<&str>, config_val: Option<bool>) -> bool {
    if let Some(raw) = env_val {
        match raw.trim().to_ascii_lowercase().as_str() {
            "0" | "false" | "no" | "off" => return false,
            "1" | "true" | "yes" | "on" => return true,
            _ => {}
        }
    }
    if let Some(c) = config_val {
        return c;
    }
    true
}

/// 读 config.json 的顶层 `telemetry` 布尔字段;缺失/异常返回 None(降级,不 panic)。
fn read_config_telemetry() -> Option<bool> {
    let path = config_path()?;
    let raw = fs::read_to_string(&path).ok()?;
    let json: serde_json::Value = serde_json::from_str(&raw).ok()?;
    json.get("telemetry").and_then(|v| v.as_bool())
}

// ---------------------------------------------------------------------------
// 字段大类(os/arch 只取粗粒度,绝不含系统版本号 / CPU 型号)
// ---------------------------------------------------------------------------

/// 操作系统大类:macos / windows / linux …(Rust std 常量,不含版本号)。
fn os_class() -> &'static str {
    std::env::consts::OS
}

/// CPU 架构大类:aarch64 / x86_64 …(指令集,不含型号 / 核数 / 序列号)。
fn arch_class() -> &'static str {
    std::env::consts::ARCH
}

// ---------------------------------------------------------------------------
// 事件 body 构造(Plausible /api/event 格式)
// ---------------------------------------------------------------------------

/// 纯函数:构造上报 JSON body。props 字段白名单严格固定。可单测。
///
/// 事件→Plausible 映射:
///   - `app_open` → `pageview`(url `app://launch`):Plausible 主面板的 DAU / 唯一访客 /
///     访问次数都以 pageview 为中心统计,故启动事件必须以 pageview 形态注册访客。
///   - `update_*` → 自定义事件(原名,url `app://event`):进 Goals / 自定义事件统计。
fn build_event_body(event: &str, version: &str, install_id: &str) -> String {
    let (name, url) = if event == "app_open" {
        ("pageview", "app://launch")
    } else {
        (event, "app://event")
    };
    let body = serde_json::json!({
        "name": name,
        "url": url,
        "domain": DOMAIN,
        "props": {
            "version": version,
            "install_id": install_id,
            "os": os_class(),
            "arch": arch_class(),
        }
    });
    body.to_string()
}

fn user_agent(version: &str, install_id: &str) -> String {
    format!(
        "opencode-desktop/{} ({}; {}; install={})",
        version,
        os_class(),
        arch_class(),
        short_id(install_id)
    )
}

// ---------------------------------------------------------------------------
// 上报(fire-and-forget,静默失败)
// ---------------------------------------------------------------------------

/// 上报一个事件。opt-out 时为 no-op;否则后台异步 POST,不等结果、不阻塞调用方。
///
/// `version` 一般取 `app.package_info().version.to_string()`。
fn is_allowed_event(name: &str) -> bool {
    ALLOWED_EVENTS.contains(&name)
}

pub fn track(version: &str, name: &str) {
    if !is_allowed_event(name) {
        return;
    }
    if !is_enabled() {
        return;
    }
    let install_id = get_or_create_install_id();
    let body = build_event_body(name, version, &install_id);
    let ua = user_agent(version, &install_id);
    // 后台发送:任何网络/构造失败都吞掉,绝不影响主程序(A9)。
    tauri::async_runtime::spawn(async move {
        send_event(body, ua).await;
    });
}

// ---------------------------------------------------------------------------
// 设置开关读写(config.json telemetry 字段,UI「设置→通用」绑定)
// ---------------------------------------------------------------------------

/// config 中 telemetry 字段的当前值;缺失视为默认开(true)。
/// 注意:这反映用户在 UI 可控的 config 值;env `OPENCODE_TELEMETRY` 是更高优先级的逃生舱,
/// 不经 UI(见 is_enabled 优先级)。
fn read_telemetry_config_value() -> bool {
    read_config_telemetry().unwrap_or(true)
}

/// 写 config.json 的 telemetry 字段,保留其余字段。失败返回 Err(调用方静默)。
fn write_telemetry_config_in(path: Option<PathBuf>, enabled: bool) -> std::io::Result<()> {
    let Some(path) = path else {
        return Ok(());
    };
    let mut json: serde_json::Value = fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    if !json.is_object() {
        json = serde_json::json!({});
    }
    json["telemetry"] = serde_json::Value::Bool(enabled);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let body = serde_json::to_string_pretty(&json).unwrap_or_else(|_| "{}".to_string());
    fs::write(&path, body + "\n")
}

/// Tauri command:读当前统计开关(UI 初始化用)。
#[tauri::command]
#[specta::specta]
pub fn get_telemetry_enabled() -> bool {
    read_telemetry_config_value()
}

/// Tauri command:写统计开关(UI 切换时调)。失败静默。
#[tauri::command]
#[specta::specta]
pub fn set_telemetry_enabled(enabled: bool) {
    let _ = write_telemetry_config_in(config_path(), enabled);
}

/// Tauri command —— 前端(updater 流程)上报事件入口。
/// name 受 ALLOWED_EVENTS 白名单约束:非白名单名静默丢弃,前端无法借此发任意事件。
#[tauri::command]
#[specta::specta]
pub fn track_event_cmd(app: tauri::AppHandle, name: String) {
    track(&app.package_info().version.to_string(), &name);
}

async fn send_event(body: String, user_agent: String) {
    let client = match reqwest::Client::builder().timeout(REQUEST_TIMEOUT).build() {
        Ok(c) => c,
        Err(_) => return,
    };
    // 结果忽略:成功/失败/超时都静默(fire-and-forget)。
    let _ = client
        .post(TELEMETRY_ENDPOINT)
        .header("content-type", "application/json")
        .header("user-agent", user_agent)
        .body(body)
        .send()
        .await;
}

// ===========================================================================
// 单元测试(T1-T6)
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    /// 用唯一子目录隔离每个测试的 OPENCODE_TEST_HOME,避免串扰。
    fn temp_home(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("deskfox-telemetry-test-{}-{}", tag, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    // T1 — install_id 生成 + 持久化幂等
    #[test]
    fn t1_install_id_generated_and_idempotent() {
        let home = temp_home("t1");
        let dir = Some(home.join(".cache").join("opencode"));
        let first = get_or_create_install_id_in(dir.clone());
        assert!(!first.is_empty());
        assert_ne!(first, "unknown");
        // 文件已落盘
        assert!(home.join(".cache").join("opencode").join("install_id").exists());
        // 二次读取返回同一值
        let second = get_or_create_install_id_in(dir);
        assert_eq!(first, second);
        let _ = fs::remove_dir_all(&home);
    }

    // T1b — 无家目录时降级为 "unknown" 不 panic
    #[test]
    fn t1b_install_id_graceful_when_no_dir() {
        assert_eq!(get_or_create_install_id_in(None), "unknown");
    }

    // T2 — env=0 强制禁用(无视 config)
    #[test]
    fn t2_env_forces_disable() {
        assert!(!resolve_enabled(Some("0"), Some(true)));
        assert!(!resolve_enabled(Some("false"), Some(true)));
        assert!(!resolve_enabled(Some("off"), None));
    }

    // T2b — env=1 强制启用
    #[test]
    fn t2b_env_forces_enable() {
        assert!(resolve_enabled(Some("1"), Some(false)));
        assert!(resolve_enabled(Some("true"), Some(false)));
    }

    // T3 — config telemetry:false 关闭(env 未设)
    #[test]
    fn t3_config_disable() {
        assert!(!resolve_enabled(None, Some(false)));
        assert!(resolve_enabled(None, Some(true)));
    }

    // T3b — 默认开启(env / config 都缺)
    #[test]
    fn t3c_default_enabled() {
        assert!(resolve_enabled(None, None));
        // 无法识别的 env 值不算决策,落到 config/默认
        assert!(resolve_enabled(Some("garbage"), None));
    }

    // T4 — payload 字段白名单:props 仅 version/install_id/os/arch
    #[test]
    fn t4_payload_field_whitelist() {
        // app_open → pageview(注册访客)
        let body = build_event_body("app_open", "2026.6.0", "abc-123");
        let v: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(v["name"], "pageview", "app_open 必须映射为 pageview 才计入 DAU");
        assert_eq!(v["url"], "app://launch");
        assert_eq!(v["domain"], DOMAIN);
        let props = v["props"].as_object().unwrap();
        let mut keys: Vec<&String> = props.keys().collect();
        keys.sort();
        assert_eq!(keys, vec!["arch", "install_id", "os", "version"]);
        assert_eq!(props["version"], "2026.6.0");
        assert_eq!(props["install_id"], "abc-123");
        // 确保不含任何敏感字段
        for forbidden in ["path", "project", "prompt", "model", "ip", "user", "email"] {
            assert!(!props.contains_key(forbidden), "props 不应含 {}", forbidden);
        }
        // update_* → 自定义事件(原名 + app://event)
        let up = build_event_body("update_downloaded", "2026.6.0", "abc-123");
        let uv: serde_json::Value = serde_json::from_str(&up).unwrap();
        assert_eq!(uv["name"], "update_downloaded");
        assert_eq!(uv["url"], "app://event");
    }

    // T5 — os/arch 是大类,不含系统版本号 / CPU 型号
    #[test]
    fn t5_os_arch_are_coarse() {
        let os = os_class();
        // Rust std OS 常量是固定大类集合,绝无版本号
        assert!(["macos", "windows", "linux", "freebsd", "openbsd", "netbsd"].contains(&os));
        let arch = arch_class();
        assert!(["aarch64", "x86_64", "x86", "arm"].contains(&arch));
        // 不含数字版本点号 / 空格(排除 "macOS 14.5" / "Apple M3" 这类)
        assert!(!os.contains('.') && !os.contains(' '));
        assert!(!arch.contains(' '));
    }

    // T6 — opt-out 时 track 为 no-op(静默守卫,不触网)
    #[test]
    fn t6_track_noop_when_disabled() {
        // 用 env 强制关闭,track 应直接返回不 spawn(不依赖 Tauri runtime)
        // SAFETY: 测试进程内临时设置 env。
        unsafe {
            std::env::set_var("OPENCODE_TELEMETRY", "0");
        }
        // 不 panic 即通过(disabled 分支在 spawn 之前返回)
        track("2026.6.0", "app_open");
        unsafe {
            std::env::remove_var("OPENCODE_TELEMETRY");
        }
    }

    // T4b — 事件白名单:仅 3 个事件放行,其余丢弃
    #[test]
    fn t4b_event_allowlist() {
        assert!(is_allowed_event("app_open"));
        assert!(is_allowed_event("update_downloaded"));
        assert!(is_allowed_event("update_applied"));
        assert!(!is_allowed_event("project_open"));
        assert!(!is_allowed_event("ai_request"));
        assert!(!is_allowed_event("pageview"));
        assert!(!is_allowed_event(""));
    }

    // T7 — config 写入/读取 roundtrip + 保留其余字段
    #[test]
    fn t7_config_write_read_roundtrip() {
        let home = temp_home("t7");
        let cfg = home.join(".config").join("opencode");
        let _ = fs::create_dir_all(&cfg);
        let path = cfg.join("config.json");
        // 预置一个含其他字段的 config
        fs::write(&path, r#"{"theme":"dark","telemetry":true}"#).unwrap();
        // 关闭
        write_telemetry_config_in(Some(path.clone()), false).unwrap();
        let raw = fs::read_to_string(&path).unwrap();
        let v: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(v["telemetry"], false);
        assert_eq!(v["theme"], "dark", "必须保留其余字段");
        // 重新开启
        write_telemetry_config_in(Some(path.clone()), true).unwrap();
        let v2: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(v2["telemetry"], true);
        let _ = fs::remove_dir_all(&home);
    }

    // T7b — config 不存在时写入新建文件
    #[test]
    fn t7b_config_write_creates_file() {
        let home = temp_home("t7b");
        let path = home.join(".config").join("opencode").join("config.json");
        assert!(!path.exists());
        write_telemetry_config_in(Some(path.clone()), false).unwrap();
        let v: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(v["telemetry"], false);
        let _ = fs::remove_dir_all(&home);
    }

    // T6b — user_agent 携带短码而非完整 install_id
    #[test]
    fn t6b_user_agent_uses_short_id() {
        let ua = user_agent("2026.6.0", "abcdefgh-1234-5678-9012-xxxxxxxxxxxx");
        assert!(ua.contains("opencode-desktop/2026.6.0"));
        assert!(ua.contains("install=abcdefgh"));
        // 不含完整 id
        assert!(!ua.contains("abcdefgh-1234"));
    }
}
