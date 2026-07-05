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

/// Read the ridi-at cookie from the login (or main) webview. Returns null if
/// not logged in yet.
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            open_ridi_login,
            get_ridi_cookie,
            close_ridi_login
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
