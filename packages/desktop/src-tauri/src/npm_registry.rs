// FORK: 国内 npm 镜像决策 — 让 sidecar 装 @opencode-ai/plugin / 用户插件走国内镜像,
// 避免国内用户卡在 registry.npmjs.org(实测 12s vs 国内 ~1s),国际用户保持官方。
// 注入点:cli.rs spawn_command 的 npm_config_registry env(@npmcli/config 读 process.env)。
// 完整设计见 docs/features/npm-registry-cn-mirror/。 [feat: npm-registry-cn-mirror] 2026-05-28

use std::path::PathBuf;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use chrono::Offset;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

/// 验证过(2026-05-28 实测能取到 @opencode-ai/plugin)的国内镜像,按可靠性优先级排列。
/// 清单维护见 docs/features/npm-registry-cn-mirror/3-changelog.md。
const MIRRORS: &[&str] = &[
    "https://registry.npmmirror.com",                 // 阿里,业界事实标准,主用
    "https://mirrors.huaweicloud.com/repository/npm", // 华为云
    "https://mirrors.cloud.tencent.com/npm",          // 腾讯云
    "https://repo.huaweicloud.com/repository/npm",    // 华为云备用域名
    "https://r.cnpmjs.org",                           // cnpm
];

const NPMJS: &str = "https://registry.npmjs.org";
/// 首启 timezone 命中国内时先用的主镜像(= MIRRORS[0])。
const PRIMARY_MIRROR: &str = "https://registry.npmmirror.com";

/// 缓存有效期:14 天后重新探活(镜像挂了 / 用户跨境 自愈)。
const CACHE_TTL_SECS: u64 = 14 * 24 * 60 * 60;
/// 单个探活超时。
const PROBE_TIMEOUT: Duration = Duration::from_secs(3);
/// npmjs 低于此延迟视为"网络好 / 国际用户",直接用官方。
const NPMJS_FAST_MS: u128 = 2500;

#[derive(Serialize, Deserialize, Clone)]
struct Decision {
    /// None = 用官方 npmjs(不注入 env);Some = 用该镜像。
    registry: Option<String>,
    checked_at: u64,
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn cache_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .resolve(
            "deskfox-npm-registry.json",
            tauri::path::BaseDirectory::AppLocalData,
        )
        .ok()
}

fn read_cache(path: &PathBuf) -> Option<Decision> {
    let raw = std::fs::read_to_string(path).ok()?;
    serde_json::from_str::<Decision>(&raw).ok()
}

fn write_cache(path: &PathBuf, decision: &Decision) {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(raw) = serde_json::to_string_pretty(decision) {
        let _ = std::fs::write(path, raw);
    }
}

/// 首启即时猜测(零网络):本机时区 UTC+8 视为国内,先用主镜像;否则用官方。
/// 真正的权威是后台探活,这里只为首启不空等。
fn instant_guess() -> Option<String> {
    let offset_secs = chrono::Local::now().offset().fix().local_minus_utc();
    if offset_secs == 8 * 3600 {
        Some(PRIMARY_MIRROR.to_string())
    } else {
        None
    }
}

/// 探一个 registry:GET 包元数据但**不读 body**(send() 拿到 headers 即返回,
/// response drop 关连接,不会下载 15MB),返回首字节延迟。Range 头兜底防意外缓冲。
async fn probe_one(client: &reqwest::Client, base: &str) -> Option<Duration> {
    let url = format!("{base}/@opencode-ai/plugin");
    let start = Instant::now();
    match client.get(&url).header("Range", "bytes=0-1023").send().await {
        Ok(resp) if resp.status().is_success() => Some(start.elapsed()),
        _ => None,
    }
}

/// 纯决策逻辑(无网络,可单测):官方延迟低于阈值 → 用官方(None);
/// 否则取延迟最小的可用镜像;无可用镜像 → None(回落官方,优雅降级)。
fn pick_registry(npmjs_ms: Option<u128>, mut candidates: Vec<(u128, &'static str)>) -> Option<String> {
    if let Some(ms) = npmjs_ms {
        if ms <= NPMJS_FAST_MS {
            return None;
        }
    }
    candidates.sort_by_key(|(ms, _)| *ms);
    candidates.first().map(|(_, url)| url.to_string())
}

/// 缓存是否新鲜(时钟回拨用 saturating_sub 兜底,不会误判过期)。
fn is_fresh(checked_at: u64, now: u64) -> bool {
    now.saturating_sub(checked_at) < CACHE_TTL_SECS
}

/// 探活决策:官方快 → 用官方;否则并发探所有镜像取最快可用;全挂 → 回落官方。
async fn probe_decide() -> Option<String> {
    let client = reqwest::Client::builder()
        .timeout(PROBE_TIMEOUT)
        .build()
        .ok()?;

    let npmjs_ms = probe_one(&client, NPMJS).await.map(|d| d.as_millis());
    // 官方就快,省掉镜像探活
    if matches!(npmjs_ms, Some(ms) if ms <= NPMJS_FAST_MS) {
        return None;
    }

    let probes = MIRRORS.iter().map(|m| {
        let client = client.clone();
        async move { probe_one(&client, m).await.map(|d| (d.as_millis(), *m)) }
    });
    let candidates: Vec<(u128, &'static str)> = futures::future::join_all(probes)
        .await
        .into_iter()
        .flatten()
        .collect();
    pick_registry(npmjs_ms, candidates)
}

/// 后台线程跑探活并写缓存(供下次启动用,本次不阻塞)。自带 current-thread runtime,
/// 不依赖 spawn 时是否处在 tokio 上下文。
fn spawn_refresh(cache: PathBuf) {
    std::thread::spawn(move || {
        let Ok(rt) = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
        else {
            return;
        };
        let registry = rt.block_on(probe_decide());
        write_cache(
            &cache,
            &Decision {
                registry: registry.clone(),
                checked_at: now_secs(),
            },
        );
        tracing::info!(
            "[npm-registry] background probe done: {}",
            registry.as_deref().unwrap_or("npmjs(official)")
        );
    });
}

/// 在 sidecar spawn 时调用:返回要注入的 npm registry(None = 用官方,不注入 env)。
/// 命中新鲜缓存直接用;否则触发后台探活 + 返回 timezone 即时猜测(零阻塞)。
pub fn decide(app: &AppHandle) -> Option<String> {
    let Some(cache) = cache_path(app) else {
        return instant_guess();
    };

    if let Some(d) = read_cache(&cache) {
        if is_fresh(d.checked_at, now_secs()) {
            return d.registry;
        }
    }

    // 缺缓存 / 过期:后台刷新供下次用,本次先用即时猜测
    spawn_refresh(cache);
    instant_guess()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn npmjs_fast_uses_official() {
        assert_eq!(pick_registry(Some(500), vec![(100, MIRRORS[0])]), None);
    }

    #[test]
    fn npmjs_slow_picks_fastest_mirror() {
        let got = pick_registry(
            Some(9000),
            vec![(300, MIRRORS[1]), (80, MIRRORS[0]), (500, MIRRORS[2])],
        );
        assert_eq!(got.as_deref(), Some(MIRRORS[0]));
    }

    #[test]
    fn npmjs_unreachable_picks_mirror() {
        assert_eq!(
            pick_registry(None, vec![(420, MIRRORS[2])]).as_deref(),
            Some(MIRRORS[2])
        );
    }

    #[test]
    fn no_mirror_falls_back_to_official() {
        assert_eq!(pick_registry(None, vec![]), None);
        assert_eq!(pick_registry(Some(9000), vec![]), None);
    }

    #[test]
    fn freshness_boundary() {
        assert!(is_fresh(1000, 1000 + CACHE_TTL_SECS - 1));
        assert!(!is_fresh(1000, 1000 + CACHE_TTL_SECS));
        // 时钟回拨:saturating_sub → 0 < TTL,视为新鲜不误判
        assert!(is_fresh(1000, 500));
    }

    #[test]
    fn decision_serde_roundtrip() {
        let d = Decision {
            registry: Some(PRIMARY_MIRROR.to_string()),
            checked_at: 42,
        };
        let raw = serde_json::to_string(&d).unwrap();
        let back: Decision = serde_json::from_str(&raw).unwrap();
        assert_eq!(back.registry.as_deref(), Some(PRIMARY_MIRROR));
        assert_eq!(back.checked_at, 42);
        // None(国际用户)也能往返
        let off = Decision { registry: None, checked_at: 7 };
        let raw = serde_json::to_string(&off).unwrap();
        let back: Decision = serde_json::from_str(&raw).unwrap();
        assert_eq!(back.registry, None);
    }
}
