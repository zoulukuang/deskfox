use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};
use tauri_plugin_store::StoreExt;
use tokio::task::JoinHandle;
use tokio::time::timeout;

use crate::{
    cli,
    cli::CommandChild,
    constants::{DEFAULT_SERVER_URL_KEY, SETTINGS_STORE, WSL_ENABLED_KEY},
};

#[derive(Clone, serde::Serialize, serde::Deserialize, specta::Type, Debug, Default)]
pub struct WslConfig {
    pub enabled: bool,
}

#[tauri::command]
#[specta::specta]
pub fn get_default_server_url(app: AppHandle) -> Result<Option<String>, String> {
    let store = app
        .store(SETTINGS_STORE)
        .map_err(|e| format!("Failed to open settings store: {}", e))?;

    let value = store.get(DEFAULT_SERVER_URL_KEY);
    match value {
        Some(v) => Ok(v.as_str().map(String::from)),
        None => Ok(None),
    }
}

#[tauri::command]
#[specta::specta]
pub async fn set_default_server_url(app: AppHandle, url: Option<String>) -> Result<(), String> {
    let store = app
        .store(SETTINGS_STORE)
        .map_err(|e| format!("Failed to open settings store: {}", e))?;

    match url {
        Some(u) => {
            store.set(DEFAULT_SERVER_URL_KEY, serde_json::Value::String(u));
        }
        None => {
            store.delete(DEFAULT_SERVER_URL_KEY);
        }
    }

    store
        .save()
        .map_err(|e| format!("Failed to save settings: {}", e))?;

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn get_wsl_config(_app: AppHandle) -> Result<WslConfig, String> {
    // let store = app
    //     .store(SETTINGS_STORE)
    //     .map_err(|e| format!("Failed to open settings store: {}", e))?;

    // let enabled = store
    //     .get(WSL_ENABLED_KEY)
    //     .as_ref()
    //     .and_then(|v| v.as_bool())
    //     .unwrap_or(false);

    Ok(WslConfig { enabled: false })
}

#[tauri::command]
#[specta::specta]
pub fn set_wsl_config(app: AppHandle, config: WslConfig) -> Result<(), String> {
    let store = app
        .store(SETTINGS_STORE)
        .map_err(|e| format!("Failed to open settings store: {}", e))?;

    store.set(WSL_ENABLED_KEY, serde_json::Value::Bool(config.enabled));

    store
        .save()
        .map_err(|e| format!("Failed to save settings: {}", e))?;

    Ok(())
}

pub fn spawn_local_server(
    app: AppHandle,
    hostname: String,
    port: u32,
    password: String,
) -> (CommandChild, HealthCheck) {
    let (child, exit) = cli::serve(&app, &hostname, port, &password);

    let health_check = HealthCheck(tokio::spawn(async move {
        let url = format!("http://{hostname}:{port}");
        let timestamp = Instant::now();

        let ready = async {
            loop {
                tokio::time::sleep(Duration::from_millis(100)).await;

                if check_health(&url, Some(&password)).await {
                    tracing::info!(elapsed = ?timestamp.elapsed(), "Server ready");
                    return Ok(());
                }
            }
        };

        let terminated = async {
            match exit.await {
                Ok(payload) => Err(format!(
                    "Sidecar terminated before becoming healthy (code={:?} signal={:?})",
                    payload.code, payload.signal
                )),
                Err(_) => Err("Sidecar terminated before becoming healthy".to_string()),
            }
        };

        tokio::select! {
            res = ready => res,
            res = terminated => res,
        }
    }));

    (child, health_check)
}

pub struct HealthCheck(pub JoinHandle<Result<(), String>>);

async fn check_health(url: &str, password: Option<&str>) -> bool {
    let Ok(url) = reqwest::Url::parse(url) else {
        return false;
    };

    let mut builder = reqwest::Client::builder().timeout(Duration::from_secs(7));

    if url
        .host_str()
        .is_some_and(|host| {
            host.eq_ignore_ascii_case("localhost")
                || host
                    .parse::<std::net::IpAddr>()
                    .is_ok_and(|ip| ip.is_loopback())
        })
    {
        // Some environments set proxy variables (HTTP_PROXY/HTTPS_PROXY/ALL_PROXY) without
        // excluding loopback. reqwest respects these by default, which can prevent the desktop
        // app from reaching its own local sidecar server.
        builder = builder.no_proxy();
    }

    let Ok(client) = builder.build() else {
        return false;
    };
    let Ok(health_url) = url.join("/global/health") else {
        return false;
    };

    let mut req = client.get(health_url);

    if let Some(password) = password {
        req = req.basic_auth("opencode", Some(password));
    }

    req.send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

// FORK-BEGIN: sidecar watchdog 自动重启 (REQ-049 Layer③) 2026-06-04
// 起因 2026-06-03: sidecar(opencode-cli)因内存撑爆等原因崩溃后,主进程只打日志不重启
// → 32225 端口无人监听 → 前台所有文件/AI 请求失败、卡死、停止键空转。
// 轮询式看门狗:每 5s ping /global/health,连续 3 次失败(~15s)判定 sidecar 死亡或假死,
// 同 port + 同 password 重启 —— 前台凭据不变,新实例 healthy 后请求自动恢复。
// 同时覆盖"崩死"和"进程在但 hang"两种故障。
// 熔断:120s 内重启超过 5 次则放弃(确定性崩溃时避免 restart storm 空转耗资源)。
// shutting_down 由 kill_sidecar 在主动退出前置位,防止 quit / 主动 kill 时误重启。
// 详见 OPENCODE-PLAN/需求池/sidecar-OOM崩溃-四层防御加固.md (REQ-049 Layer③)。
pub fn spawn_watchdog(
    app: AppHandle,
    hostname: String,
    port: u32,
    password: String,
    child: Arc<Mutex<Option<CommandChild>>>,
    shutting_down: Arc<AtomicBool>,
) {
    const POLL_INTERVAL: Duration = Duration::from_secs(5);
    const FAIL_THRESHOLD: u32 = 3; // 连续 3 次失败(~15s)判定死亡
    const RESTART_WINDOW: Duration = Duration::from_secs(120);
    const MAX_RESTARTS: usize = 5; // 窗口内超过则熔断
    const STARTUP_GRACE: Duration = Duration::from_secs(15);

    tokio::spawn(async move {
        let url = format!("http://{hostname}:{port}");
        // 给首次启动留足时间,避免与启动竞速误判
        tokio::time::sleep(STARTUP_GRACE).await;

        let mut consecutive_failures: u32 = 0;
        let mut restarts: Vec<Instant> = Vec::new();

        loop {
            tokio::time::sleep(POLL_INTERVAL).await;
            if shutting_down.load(Ordering::SeqCst) {
                return;
            }

            if check_health(&url, Some(&password)).await {
                consecutive_failures = 0;
                continue;
            }

            consecutive_failures += 1;
            tracing::warn!(consecutive_failures, "Sidecar watchdog: health check failed");
            if consecutive_failures < FAIL_THRESHOLD {
                continue;
            }
            if shutting_down.load(Ordering::SeqCst) {
                return;
            }

            // 熔断:窗口内重启次数过多则放弃,避免确定性崩溃下的 restart storm
            let now = Instant::now();
            restarts.retain(|t| now.duration_since(*t) < RESTART_WINDOW);
            if over_restart_budget(&restarts, now, RESTART_WINDOW, MAX_RESTARTS) {
                tracing::error!(
                    restarts = restarts.len(),
                    "Sidecar watchdog: too many restarts in window, giving up to avoid restart storm"
                );
                let _ = app.emit("sidecar-watchdog", "gave-up");
                return;
            }

            tracing::warn!(port, "Sidecar watchdog: sidecar unresponsive, respawning");
            let _ = app.emit("sidecar-watchdog", "restarting");

            // 杀掉旧 child(可能是 hung 的僵尸),腾出端口
            if let Some(old) = child.lock().expect("watchdog: lock child").take() {
                let _ = old.kill();
            }
            tokio::time::sleep(Duration::from_millis(500)).await; // 等端口释放

            let (new_child, health) =
                spawn_local_server(app.clone(), hostname.clone(), port, password.clone());
            *child.lock().expect("watchdog: lock child") = Some(new_child);
            restarts.push(now);
            consecutive_failures = 0;

            // 等新实例 healthy(最多 30s);失败不放弃,下一轮 poll 会再判定(受熔断保护)
            match timeout(Duration::from_secs(30), health.0).await {
                Ok(Ok(Ok(()))) => {
                    tracing::info!("Sidecar watchdog: respawn healthy");
                    let _ = app.emit("sidecar-watchdog", "ready");
                }
                _ => {
                    tracing::error!("Sidecar watchdog: respawn did not become healthy in 30s");
                }
            }
        }
    });
}

// 纯函数:窗口内重启次数是否已达熔断上限(可单测,REQ-049 Layer③ R5)
fn over_restart_budget(restarts: &[Instant], now: Instant, window: Duration, max: usize) -> bool {
    restarts
        .iter()
        .filter(|t| now.duration_since(**t) < window)
        .count()
        >= max
}

#[cfg(test)]
mod watchdog_tests {
    use super::{over_restart_budget, Duration, Instant};

    #[test]
    fn circuit_breaks_when_window_full() {
        let now = Instant::now();
        let window = Duration::from_secs(120);
        // 5 次都在窗口内 → 达到上限 5 → 熔断
        let recent: Vec<Instant> = (0..5).map(|i| now - Duration::from_secs(i * 10)).collect();
        assert!(over_restart_budget(&recent, now, window, 5));
    }

    #[test]
    fn ignores_restarts_outside_window() {
        let now = Instant::now();
        let window = Duration::from_secs(120);
        // 4 次在窗口内 + 2 次在窗口外(>120s)→ 窗口内 4 < 5 → 不熔断
        let mut times: Vec<Instant> = (0..4).map(|i| now - Duration::from_secs(i * 10)).collect();
        times.push(now - Duration::from_secs(200));
        times.push(now - Duration::from_secs(300));
        assert!(!over_restart_budget(&times, now, window, 5));
    }

    #[test]
    fn under_budget_does_not_break() {
        let now = Instant::now();
        let window = Duration::from_secs(120);
        let few: Vec<Instant> = (0..3).map(|i| now - Duration::from_secs(i * 10)).collect();
        assert!(!over_restart_budget(&few, now, window, 5));
    }
}
// FORK-END
