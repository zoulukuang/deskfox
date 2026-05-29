use crate::{
    constants::{UPDATER_ENABLED, window_state_flags},
    server::get_wsl_config,
};
use std::{ops::Deref, time::Duration};
use tauri::{AppHandle, Manager, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_window_state::AppHandleExt;
use tokio::sync::mpsc;

#[cfg(target_os = "linux")]
use std::sync::OnceLock;

#[cfg(target_os = "linux")]
fn use_decorations() -> bool {
    static DECORATIONS: OnceLock<bool> = OnceLock::new();
    *DECORATIONS.get_or_init(|| {
        crate::linux_windowing::use_decorations(&crate::linux_windowing::SessionEnv::capture())
    })
}

#[cfg(not(target_os = "linux"))]
fn use_decorations() -> bool {
    true
}

pub struct MainWindow(WebviewWindow);

impl Deref for MainWindow {
    type Target = WebviewWindow;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl MainWindow {
    pub const LABEL: &str = "main";

    pub fn create(app: &AppHandle) -> Result<Self, tauri::Error> {
        if let Some(window) = app.get_webview_window(Self::LABEL) {
            let _ = window.set_focus();
            let _ = window.unminimize();
            return Ok(Self(window));
        }

        let wsl_enabled = get_wsl_config(app.clone())
            .ok()
            .map(|v| v.enabled)
            .unwrap_or(false);
        let decorations = use_decorations();
        let window_builder = base_window_config(
            WebviewWindowBuilder::new(app, Self::LABEL, WebviewUrl::App("/".into())),
            app,
            decorations,
        )
        // FORK: 窗口标题读 productName(tauri-overrides 按 env 注入 "DeskFox" / "DeskFox Dev" / "DeskFox Beta"),
        // 替换上游硬编码 "OpenCode",修复品牌泄漏。2026-05-29
        .title(app.config().product_name.clone().unwrap_or_else(|| "DeskFox".to_string()))
        .disable_drag_drop_handler()
        .zoom_hotkeys_enabled(false)
        .visible(true)
        // FORK: 开局窗口态(不强制最大化)+ 默认/最小尺寸,让无边框窗口可鼠标拖边改大小。
        // 原 .maximized(true) 开局即最大化,系统层面无法拖拽 resize;尺寸由 window-state 插件记忆,
        // 配合 constants.rs 去掉 MAXIMIZED 记忆,保证开局是可拖拽的窗口态。[fix: window-resizable] 2026-05-27
        .resizable(true)
        .min_inner_size(800.0, 600.0)
        .inner_size(1280.0, 800.0)
        .center()
        .initialization_script(format!(
            r#"
            window.__OPENCODE__ ??= {{}};
            window.__OPENCODE__.updaterEnabled = {UPDATER_ENABLED};
            window.__OPENCODE__.wsl = {wsl_enabled};
          "#
        ));

        let window = window_builder.build()?;

        // Ensure window is focused after creation (e.g., after update/relaunch)
        let _ = window.set_focus();

        setup_window_state_listener(app, &window);

        #[cfg(windows)]
        {
            use tauri_plugin_decorum::WebviewWindowExt;
            let _ = window.create_overlay_titlebar();
        }

        Ok(Self(window))
    }
}

fn setup_window_state_listener(app: &AppHandle, window: &WebviewWindow) {
    let (tx, mut rx) = mpsc::channel::<()>(1);

    window.on_window_event(move |event| {
        use tauri::WindowEvent;
        if !matches!(event, WindowEvent::Moved(_) | WindowEvent::Resized(_)) {
            return;
        }
        let _ = tx.try_send(());
    });

    tokio::spawn({
        let app = app.clone();

        async move {
            let save = || {
                let handle = app.clone();
                let app = app.clone();
                let _ = handle.run_on_main_thread(move || {
                    let _ = app.save_window_state(window_state_flags());
                });
            };

            while rx.recv().await.is_some() {
                tokio::time::sleep(Duration::from_millis(200)).await;

                save();
            }
        }
    });
}

pub struct LoadingWindow(WebviewWindow);

impl Deref for LoadingWindow {
    type Target = WebviewWindow;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl LoadingWindow {
    pub const LABEL: &str = "loading";

    pub fn create(app: &AppHandle) -> Result<Self, tauri::Error> {
        let decorations = use_decorations();

        let window_builder = base_window_config(
            WebviewWindowBuilder::new(app, Self::LABEL, tauri::WebviewUrl::App("/loading".into())),
            app,
            decorations,
        )
        .center()
        .resizable(false)
        .inner_size(640.0, 480.0)
        .visible(true);

        Ok(Self(window_builder.build()?))
    }
}

fn base_window_config<'a, R: Runtime, M: Manager<R>>(
    window_builder: WebviewWindowBuilder<'a, R, M>,
    _app: &AppHandle,
    decorations: bool,
) -> WebviewWindowBuilder<'a, R, M> {
    let window_builder = window_builder.decorations(decorations);

    #[cfg(windows)]
    let window_builder = window_builder
        // Some VPNs set a global/system proxy that WebView2 applies even for loopback
        // connections, which breaks the app's localhost sidecar server.
        // Note: when setting additional args, we must re-apply wry's default
        // `--disable-features=...` flags.
        .additional_browser_args(
            "--proxy-bypass-list=<-loopback> --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection",
        )
        .data_directory(_app.path().config_dir().expect("Failed to get config dir").join(_app.config().product_name.clone().unwrap()))
        .decorations(false);

    #[cfg(target_os = "macos")]
    let window_builder = window_builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .traffic_light_position(tauri::LogicalPosition::new(12.0, 18.0));

    window_builder
}
