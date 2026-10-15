#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    fs::{self, OpenOptions},
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent};

struct ChineseContextMenu(Menu<tauri::Wry>);

#[tauri::command]
async fn show_context_menu(
    window: tauri::WebviewWindow,
    menu: tauri::State<'_, ChineseContextMenu>,
) -> Result<(), String> {
    window
        .popup_menu(&menu.0)
        .map_err(|error| error.to_string())
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[derive(Default)]
struct Service {
    child: Mutex<Option<Child>>,
    closing: AtomicBool,
}

impl Service {
    fn stop(&self) {
        let Some(mut child) = self.child.lock().unwrap().take() else {
            return;
        };
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(b"shutdown\n");
            let _ = stdin.flush();
        }
        let deadline = Instant::now() + Duration::from_secs(4);
        loop {
            match child.try_wait() {
                Ok(Some(_)) => return,
                _ if Instant::now() < deadline => thread::sleep(Duration::from_millis(50)),
                _ => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return;
                }
            }
        }
    }
}

fn show_error(app: &tauri::AppHandle, message: &str) {
    if let Some(window) = app.get_webview_window("main") {
        let encoded = serde_json::to_string(message).unwrap();
        let _ = window.eval(&format!(
            "document.body.innerHTML='<main style=\"max-width:700px;margin:12vh auto;padding:32px;font-family:system-ui;color:#091540\"><h1>本地服务未能运行</h1><p id=\"desktop-error\" style=\"white-space:pre-wrap;line-height:1.8\"></p><p>请解决问题后重新打开应用。</p></main>';document.getElementById('desktop-error').textContent={encoded};"
        ));
        let _ = window.show();
    }
}

fn launch_service(app: tauri::AppHandle, service: Arc<Service>, port: u16) -> Result<(), String> {
    let data_dir = std::env::var_os("DEDSIWORK_DATA_DIR")
        .map(PathBuf::from)
        .map(Ok)
        .unwrap_or_else(|| {
            #[cfg(windows)]
            {
                std::env::var_os("LOCALAPPDATA")
                    .map(|path| PathBuf::from(path).join("DedsiWork"))
                    .ok_or_else(|| {
                        tauri::Error::Io(std::io::Error::new(
                            std::io::ErrorKind::NotFound,
                            "LOCALAPPDATA missing",
                        ))
                    })
            }
            #[cfg(not(windows))]
            {
                app.path().app_local_data_dir()
            }
        })
        .map_err(|e| e.to_string())?;
    fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    let log_path = data_dir.join("desktop-service.log");
    let log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|e| e.to_string())?;
    let executable = std::env::current_exe().map_err(|e| e.to_string())?;
    let mut sidecar = executable
        .parent()
        .ok_or("无法定位安装目录")?
        .join(if cfg!(windows) {
            "dedsiwork-service.exe"
        } else {
            "dedsiwork-service"
        });
    if cfg!(debug_assertions) && !sidecar.exists() {
        sidecar = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(concat!(
            "binaries/dedsiwork-service-",
            env!("DEDSIWORK_SIDECAR_TARGET")
        ));
    }
    let token = uuid::Uuid::new_v4().to_string();
    let origin = format!("http://127.0.0.1:{port}");
    let mut command = Command::new(sidecar);
    command
        .env("DEDSIWORK_DESKTOP_TOKEN", &token)
        .env("DEDSIWORK_DATA_DIR", &data_dir)
        .env("DEDSIWORK_HOST", "127.0.0.1")
        .env("DEDSIWORK_PORT", port.to_string())
        .current_dir(&data_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::from(log));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let mut child = command
        .spawn()
        .map_err(|e| format!("无法启动附带的 Bun 服务：{e}"))?;
    let stdout = child.stdout.take().ok_or("无法读取服务启动状态")?;
    {
        let mut slot = service.child.lock().unwrap();
        if service.closing.load(Ordering::SeqCst) {
            let _ = child.kill();
            let _ = child.wait();
            return Ok(());
        }
        *slot = Some(child);
    }
    let (tx, rx) = mpsc::channel();
    let monitor_app = app.clone();
    let monitor_service = service.clone();
    let expected_origin = origin.clone();
    thread::spawn(move || {
        let mut ready = false;
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Ok(event) = serde_json::from_str::<serde_json::Value>(&line) {
                if !ready && event["event"] == "ready" && event["origin"] == expected_origin {
                    ready = true;
                    let _ = tx.send(Ok(()));
                }
            }
        }
        if !ready {
            let _ = tx.send(Err("服务在就绪前已退出".to_string()));
        } else if !monitor_service.closing.load(Ordering::SeqCst) {
            show_error(
                &monitor_app,
                "本地服务已意外退出。请从系统托盘退出应用后重新启动；数据保存在本地数据库中。",
            );
        }
    });
    match rx.recv_timeout(Duration::from_secs(30)) {
        Ok(Ok(())) => {
            if service.closing.load(Ordering::SeqCst) {
                return Ok(());
            }
            if let Some(window) = app.get_webview_window("main") {
                window
                    .navigate(
                        format!("{origin}/desktop/start?token={token}")
                            .parse()
                            .map_err(|e| format!("无效服务地址：{e}"))?,
                    )
                    .map_err(|e| e.to_string())?;
            }
            Ok(())
        }
        result => {
            service.stop();
            Err(format!("启动失败：{result:?}\n请检查端口 {port} 是否被占用（例如原来的 bun run dev），不要同时启动两个服务。\n日志：{}", log_path.display()))
        }
    }
}

fn main() {
    let port = std::env::var("DEDSIWORK_PORT")
        .unwrap_or_else(|_| "3210".into())
        .parse::<u16>()
        .ok()
        .filter(|p| *p > 0)
        .unwrap_or(3210);
    let service = Arc::new(Service::default());
    let managed = service.clone();
    let app = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![show_context_menu])
        .on_menu_event(|app, event| {
            let script = match event.id.as_ref() {
                "context-back" => "history.back()",
                "context-reload" => "location.reload()",
                _ => return,
            };
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.eval(script);
            }
        })
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // Keep the window and its session alive while the service runs in the tray.
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .setup(move |app| {
            app.add_capability(
                tauri::ipc::CapabilityBuilder::new("desktop-window-drag")
                    .window("main")
                    .remote(format!("http://127.0.0.1:{port}/*"))
                    .permission("core:window:allow-outer-position")
                    .permission("core:window:allow-scale-factor")
                    .permission("core:window:allow-set-position")
                    .permission("core:window:allow-toggle-maximize")
                    .permission("allow-context-menu"),
            )?;
            let back = MenuItem::with_id(app, "context-back", "返回", true, None::<&str>)?;
            let reload = MenuItem::with_id(app, "context-reload", "刷新", true, None::<&str>)?;
            let separator = PredefinedMenuItem::separator(app)?;
            let cut = PredefinedMenuItem::cut(app, Some("剪切"))?;
            let copy = PredefinedMenuItem::copy(app, Some("复制"))?;
            let paste = PredefinedMenuItem::paste(app, Some("粘贴"))?;
            let select_all = PredefinedMenuItem::select_all(app, Some("全选"))?;
            app.manage(ChineseContextMenu(Menu::with_items(
                app,
                &[&back, &reload, &separator, &cut, &copy, &paste, &select_all],
            )?));
            let window =
                WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                    .disable_drag_drop_handler()
                    .devtools(false)
                    .initialization_script(include_str!("context-menu.js"))
                    .title("DedsiWork");
            #[cfg(target_os = "macos")]
            let window = window
                .transparent(true)
                .effects(
                    tauri::window::EffectsBuilder::new()
                        .effect(tauri::window::Effect::UnderWindowBackground)
                        .state(tauri::window::EffectState::Active)
                        .build(),
                )
                .theme(Some(tauri::Theme::Light))
                .initialization_script(
                    "document.addEventListener('DOMContentLoaded', () => document.documentElement.classList.add('native-glass'), { once: true });",
                )
                .title_bar_style(tauri::TitleBarStyle::Overlay)
                .hidden_title(true)
                .traffic_light_position(tauri::LogicalPosition::new(16.0, 20.0));
            window
                .inner_size(1360.0, 900.0)
                .min_inner_size(1100.0, 720.0)
                .on_navigation(move |url| {
                    (url.scheme() == "http"
                        && url.host_str() == Some("127.0.0.1")
                        && url.port_or_known_default() == Some(port))
                        || url.scheme() == "tauri"
                        || url.host_str() == Some("tauri.localhost")
                })
                .build()?;
            let open = MenuItem::with_id(app, "open", "打开主窗口", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出 DedsiWork", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;
            TrayIconBuilder::with_id("main-tray")
                .icon(
                    app.default_window_icon()
                        .expect("missing application icon")
                        .clone(),
                )
                .tooltip("DedsiWork")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if matches!(
                        event,
                        TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        }
                    ) {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;
            let handle = app.handle().clone();
            let service = managed.clone();
            thread::spawn(move || {
                if let Err(error) = launch_service(handle.clone(), service.clone(), port) {
                    service.stop();
                    show_error(&handle, &error);
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("无法创建 DedsiWork 桌面应用");
    app.run(move |app, event| match event {
        RunEvent::ExitRequested { api, .. } => {
            if !service.closing.swap(true, Ordering::SeqCst) {
                api.prevent_exit();
                let service = service.clone();
                let handle = app.clone();
                thread::spawn(move || {
                    service.stop();
                    handle.exit(0);
                });
            }
        }
        RunEvent::Exit => {
            service.closing.store(true, Ordering::SeqCst);
            service.stop();
        }
        _ => {}
    });
}
