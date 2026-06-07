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
/// 上报超时,fire-and-forget,不重试(最小实现)。
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);

/// 按 channel 选 Plausible site —— 防 dev/beta 的开发/QA 流量污染 prod 统计。
/// channel 由 bundle identifier 推断(prod=`ai.deskfox.app` / beta=`...beta` / dev=`...dev`)。
/// 未知 identifier 一律归 dev,绝不进 prod(fail-safe)。beta/dev 对应 site 若未建,
/// 后端 202 接收并丢弃(不污染 prod;要看预览渠道统计时在 Plausible 建对应 site 即可)。
fn domain_for_identifier(identifier: &str) -> &'static str {
    match identifier {
        "ai.deskfox.app" => "opencode.desktop",
        "ai.deskfox.app.beta" => "opencode.desktop-beta",
        _ => "opencode.desktop-dev",
    }
}

// ---------------------------------------------------------------------------
// 路径解析(支持 OPENCODE_TEST_HOME 注入以便单测)
// ---------------------------------------------------------------------------

fn test_home() -> Option<PathBuf> {
    std::env::var("OPENCODE_TEST_HOME").ok().map(PathBuf::from)
}

/// home 根(测试可经 OPENCODE_TEST_HOME 注入)—— cache_dir / config_dir 共用,避免重复解析。
fn home_base() -> Option<PathBuf> {
    test_home().or_else(dirs::home_dir)
}

/// install_id 缓存目录:`~/.cache/opencode/`(复用已删 SDK 的既定路径)。
fn cache_dir() -> Option<PathBuf> {
    Some(home_base()?.join(".cache").join("opencode"))
}

/// opencode 配置目录:`~/.config/opencode/`。
fn config_dir() -> Option<PathBuf> {
    Some(home_base()?.join(".config").join("opencode"))
}

/// UI 开关写入的 config 文件(`config.json`,opencode 合并加载的文件之一,隐私协议指明的 opt-out 文件)。
fn config_path() -> Option<PathBuf> {
    Some(config_dir()?.join("config.json"))
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
        // 校验是合法 UUID;脏值(云同步/外部进程写入、含控制字符)一律丢弃重生成 —— 否则
        // 脏值会流进 payload 和 User-Agent header(控制字符会让 reqwest 构造 header 失败,
        // 等于该机 telemetry 永久静默失效),或污染后端按设备去重的 DAU。
        if uuid::Uuid::parse_str(trimmed).is_ok() {
            return trimmed.to_string();
        }
    }
    let id = uuid::Uuid::new_v4().to_string();
    // 写入尽力而为:失败也返回本次生成的 id(不 panic,不阻塞)。
    let _ = fs::create_dir_all(&dir);
    let _ = fs::write(&path, &id);
    // 收紧权限到 0600:匿名设备 ID 跨会话稳定,多用户机器上不应被其他本地用户读到。
    restrict_to_owner(&path);
    id
}

/// 把文件权限收紧到仅属主可读写(0600)。非 Unix 平台 no-op(Windows 用户目录默认即私有)。
fn restrict_to_owner(path: &PathBuf) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }
    #[cfg(not(unix))]
    let _ = path;
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

/// 读 telemetry opt-out 值。按 opencode 的合并优先级逐文件读
/// (`config.json` < `opencode.json` < `opencode.jsonc`,后者覆盖前者),返回最后命中的值;
/// 缺失/解析失败的文件跳过,全无则 None(降级,不 panic)。
/// 注:opencode.jsonc 若含注释,serde_json 严格解析会失败而跳过(本仓无 json5 依赖);
/// 多数 opt-out 写在 config.json(UI 也写这里),env `OPENCODE_TELEMETRY` 是兜底逃生舱。
fn read_config_telemetry() -> Option<bool> {
    let dir = config_dir()?;
    let mut value = None;
    for file in ["config.json", "opencode.json", "opencode.jsonc"] {
        if let Ok(raw) = fs::read_to_string(dir.join(file)) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&raw) {
                if let Some(b) = json.get("telemetry").and_then(|v| v.as_bool()) {
                    value = Some(b);
                }
            }
        }
    }
    value
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
fn build_event_body(event: &str, domain: &str, version: &str, install_id: &str) -> String {
    let (name, url) = if event == "app_open" {
        ("pageview", "app://launch")
    } else {
        (event, "app://event")
    };
    let body = serde_json::json!({
        "name": name,
        "url": url,
        "domain": domain,
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

fn is_allowed_event(name: &str) -> bool {
    ALLOWED_EVENTS.contains(&name)
}

/// 决定是否上报并构造 (body, ua);白名单不通过 / opt-out 关闭都返回 None。**含文件 IO**
/// (读 config + 读/写 install_id),故应在后台异步上下文调用,不要放主线程 / 启动线程。
fn prepare_event(version: &str, identifier: &str, name: &str) -> Option<(String, String)> {
    if !is_allowed_event(name) || !is_enabled() {
        return None;
    }
    let install_id = get_or_create_install_id();
    let domain = domain_for_identifier(identifier);
    Some((
        build_event_body(name, domain, version, &install_id),
        user_agent(version, &install_id),
    ))
}

/// fire-and-forget:**全部工作**(opt-out 判定 + 文件 IO + HTTP)都丢后台,绝不阻塞调用方 /
/// 启动线程(防 setup 钩子里的 app_open 在慢盘/网络盘上拖慢启动)。
///
/// - `version`:一般取 `app.package_info().version.to_string()`。
/// - `identifier`:bundle identifier(`app.config().identifier`),用于按 channel 选 Plausible site。
pub fn track(version: &str, identifier: &str, name: &str) {
    let (version, identifier, name) = (version.to_string(), identifier.to_string(), name.to_string());
    tauri::async_runtime::spawn(async move {
        if let Some((body, ua)) = prepare_event(&version, &identifier, &name) {
            send_event(body, ua).await;
        }
    });
}

/// 阻塞版:等发送完成(受 5s 超时上限)再返回 —— 给 relaunch 前的 `update_applied` 用。
/// 否则 fire-and-forget 的后台请求会被紧接着的进程重启杀掉,事件长期统计性丢失。
pub async fn track_blocking(version: &str, identifier: &str, name: &str) {
    if let Some((body, ua)) = prepare_event(version, identifier, name) {
        send_event(body, ua).await;
    }
}

// ---------------------------------------------------------------------------
// 设置开关读写(config.json telemetry 字段,UI「设置→通用」绑定)
// ---------------------------------------------------------------------------

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
    // 原子写:先写同目录临时文件,再 rename 覆盖 —— 避免并发写(CLI/sidecar 同写)或写到一半
    // 进程被杀,把共用的 opencode config.json 截断成半截 JSON(opencode 合并加载会失败)。
    // rename 同文件系统内是原子操作;临时名带 pid 防多进程撞同一临时文件。
    let tmp = path.with_file_name(format!(
        "{}.tmp{}",
        path.file_name().and_then(|s| s.to_str()).unwrap_or("config.json"),
        std::process::id()
    ));
    fs::write(&tmp, body + "\n")?;
    fs::rename(&tmp, &path)
}

/// Tauri command:读当前统计**有效**开关(UI 初始化用)。返回 is_enabled() 的有效值
/// (env > config > 默认),而非仅 config —— 否则 env `OPENCODE_TELEMETRY` 覆盖时 UI 显示会与
/// 实际上报行为脱节(显示"开"实则被 env 关掉,反之亦然)。
#[tauri::command]
#[specta::specta]
pub fn get_telemetry_enabled() -> bool {
    is_enabled()
}

/// Tauri command:写统计开关(UI 切换时调)。失败返回 Err 让前端可提示,不再静默吞。
#[tauri::command]
#[specta::specta]
pub fn set_telemetry_enabled(enabled: bool) -> Result<(), String> {
    write_telemetry_config_in(config_path(), enabled).map_err(|e| e.to_string())
}

/// Tauri command —— 前端(updater 流程)上报事件入口(fire-and-forget)。
/// name 受 ALLOWED_EVENTS 白名单约束:非白名单名静默丢弃,前端无法借此发任意事件。
#[tauri::command]
#[specta::specta]
pub fn track_event_cmd(app: tauri::AppHandle, name: String) {
    track(
        &app.package_info().version.to_string(),
        &app.config().identifier,
        &name,
    );
}

/// Tauri command —— 同 track_event_cmd 但**等发送完成再返回**。给 relaunch 前的 `update_applied` 用,
/// 前端 `await` 它后再 relaunch,确保事件发出去(否则进程重启会把后台请求杀掉)。
#[tauri::command]
#[specta::specta]
pub async fn track_event_blocking_cmd(app: tauri::AppHandle, name: String) {
    track_blocking(
        &app.package_info().version.to_string(),
        &app.config().identifier,
        &name,
    )
    .await;
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

    // T1c — install_id 文件被写入脏值(非 UUID)时丢弃重生成
    #[test]
    fn t1c_install_id_regenerates_on_corrupt() {
        let home = temp_home("t1c");
        let dir = home.join(".cache").join("opencode");
        let _ = fs::create_dir_all(&dir);
        let path = dir.join("install_id");
        // 脏值:含换行/控制字符,非 UUID
        fs::write(&path, "garbage\n\x01injected").unwrap();
        let id = get_or_create_install_id_in(Some(dir));
        assert!(uuid::Uuid::parse_str(&id).is_ok(), "脏值应被重生成为合法 UUID");
        assert_ne!(id, "garbage");
        let _ = fs::remove_dir_all(&home);
    }

    // T8 — channel → Plausible site 映射:dev/beta 不进 prod
    #[test]
    fn t8_domain_per_channel() {
        assert_eq!(domain_for_identifier("ai.deskfox.app"), "opencode.desktop");
        assert_eq!(domain_for_identifier("ai.deskfox.app.beta"), "opencode.desktop-beta");
        assert_eq!(domain_for_identifier("ai.deskfox.app.dev"), "opencode.desktop-dev");
        // 未知 identifier 一律归 dev,绝不进 prod
        assert_eq!(domain_for_identifier("com.unknown.app"), "opencode.desktop-dev");
        assert_eq!(domain_for_identifier(""), "opencode.desktop-dev");
    }

    // T1d — install_id 文件落盘后权限收紧到 0600(仅 Unix)
    #[cfg(unix)]
    #[test]
    fn t1d_install_id_perms_0600() {
        use std::os::unix::fs::PermissionsExt;
        let home = temp_home("t1d");
        let dir = Some(home.join(".cache").join("opencode"));
        let _ = get_or_create_install_id_in(dir);
        let path = home.join(".cache").join("opencode").join("install_id");
        let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600, "install_id 应为 0600,实际 {:o}", mode);
        let _ = fs::remove_dir_all(&home);
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
        let body = build_event_body("app_open", "opencode.desktop", "2026.6.0", "abc-123");
        let v: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(v["name"], "pageview", "app_open 必须映射为 pageview 才计入 DAU");
        assert_eq!(v["url"], "app://launch");
        assert_eq!(v["domain"], "opencode.desktop");
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
        let up = build_event_body("update_downloaded", "opencode.desktop", "2026.6.0", "abc-123");
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

    // T6 — opt-out 时 prepare_event 返回 None(不构造、不发送)
    #[test]
    fn t6_prepare_none_when_disabled() {
        // SAFETY: 测试进程内临时设置 env(本测试是唯一动 OPENCODE_TELEMETRY 的)。
        unsafe {
            std::env::set_var("OPENCODE_TELEMETRY", "0");
        }
        // env=0 → is_enabled false → prepare 返回 None(白名单事件也不发)
        assert!(prepare_event("2026.6.0", "ai.deskfox.app", "app_open").is_none());
        unsafe {
            std::env::remove_var("OPENCODE_TELEMETRY");
        }
        // 非白名单事件无论开关都 None
        assert!(prepare_event("2026.6.0", "ai.deskfox.app", "ai_request").is_none());
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
