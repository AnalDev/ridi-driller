use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

/// Open a native webview to the RIDI login page. The user logs in here; the
/// app then reads the ridi-at cookie from this webview's own cookie store —
/// no manual devtools copy, and it runs on the user's residential IP.
#[tauri::command]
async fn open_ridi_login(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("ridi-login") {
        let _ = win.set_focus();
        return Ok(());
    }
    let url = "https://ridibooks.com/account/login"
        .parse()
        .map_err(|_| "잘못된 URL".to_string())?;
    WebviewWindowBuilder::new(&app, "ridi-login", WebviewUrl::External(url))
        .title("리디북스 로그인 — 로그인 후 '쿠키 가져오기'를 누르세요")
        .inner_size(480.0, 760.0)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Read the ridi-at cookie from the login (or main) webview. Null if not yet logged in.
#[tauri::command]
async fn get_ridi_cookie(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let win = app
        .get_webview_window("ridi-login")
        .or_else(|| app.get_webview_window("main"))
        .ok_or_else(|| "웹뷰를 찾을 수 없습니다".to_string())?;
    let url = "https://ridibooks.com"
        .parse()
        .map_err(|_| "잘못된 URL".to_string())?;
    let cookies = win.cookies_for_url(url).map_err(|e| e.to_string())?;
    let at = cookies
        .into_iter()
        .find(|c| c.name() == "ridi-at")
        .map(|c| c.value().to_string());
    Ok(at)
}

/// Close the login helper window once the cookie is captured.
#[tauri::command]
async fn close_ridi_login(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("ridi-login") {
        win.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

// Holds the bundled Node server child so it lives for the app's lifetime and
// can be killed on exit.
#[cfg(not(debug_assertions))]
struct ServerChild(std::sync::Mutex<Option<tauri_plugin_shell::process::CommandChild>>);

#[cfg(not(debug_assertions))]
fn free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
        .unwrap_or(41390)
}

/// In a packaged build there is no dev server, so spawn the bundled Next.js
/// standalone server (Node sidecar) and point the main window at it once it's up.
#[cfg(not(debug_assertions))]
fn start_server(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    use tauri_plugin_shell::ShellExt;

    let port = free_port();
    let server_js = app
        .path()
        .resource_dir()?
        .join("server")
        .join("server.js");

    let (mut rx, child) = app
        .shell()
        .sidecar("node")?
        .args([server_js.to_string_lossy().to_string()])
        .env("PORT", port.to_string())
        .env("HOSTNAME", "127.0.0.1")
        .env("NODE_ENV", "production")
        .spawn()?;

    app.manage(ServerChild(std::sync::Mutex::new(Some(child))));

    // drain sidecar output (avoid the pipe filling up)
    tauri::async_runtime::spawn(async move { while rx.recv().await.is_some() {} });

    // wait for the port to accept, then navigate the main window to it
    let handle = app.clone();
    std::thread::spawn(move || {
        for _ in 0..200 {
            if std::net::TcpStream::connect(("127.0.0.1", port)).is_ok() {
                if let Some(win) = handle.get_webview_window("main") {
                    if let Ok(url) = format!("http://127.0.0.1:{port}/").parse() {
                        let _ = win.navigate(url);
                    }
                }
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(150));
        }
    });
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            open_ridi_login,
            get_ridi_cookie,
            close_ridi_login
        ]);

    #[allow(unused_variables)]
    let app = builder
        .setup(|app| {
            #[cfg(not(debug_assertions))]
            start_server(app.handle())?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        // kill the bundled server when the app exits
        #[cfg(not(debug_assertions))]
        if let tauri::RunEvent::Exit = event {
            if let Some(state) = app_handle.try_state::<ServerChild>() {
                if let Ok(mut guard) = state.0.lock() {
                    if let Some(child) = guard.take() {
                        let _ = child.kill();
                    }
                }
            }
        }
    });
}
