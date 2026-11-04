//! Show in Finder / Explorer, open a URL or a folder, and the app's
//! settings file (the QSettings("kherveDOC", "kherveDOC") equivalent).

use std::path::Path;

use tauri::{AppHandle, Manager};

use crate::process::command;

fn spawn(program: &str, args: &[&str]) -> Result<(), String> {
    command(program).args(args).spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// MainWindow._show_in_explorer: select the file in its folder.
#[tauri::command]
pub fn reveal(path: String) -> Result<(), String> {
    if cfg!(windows) {
        spawn("explorer", &["/select,", &path])
    } else if cfg!(target_os = "macos") {
        spawn("open", &["-R", &path])
    } else {
        let folder = Path::new(&path).parent().map(|p| p.to_string_lossy().into_owned()).unwrap_or(path);
        spawn("xdg-open", &[&folder])
    }
}

/// QDesktopServices.openUrl(QUrl.fromLocalFile(path))
#[tauri::command]
pub fn open_path(path: String) -> Result<(), String> {
    if cfg!(windows) {
        spawn("explorer", &[&path])
    } else if cfg!(target_os = "macos") {
        spawn("open", &[&path])
    } else {
        spawn("xdg-open", &[&path])
    }
}

#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    let ok = ["http://", "https://", "mailto:"].iter().any(|s| url.starts_with(s));
    if !ok {
        return Err("unsupported link".into());
    }
    if cfg!(windows) {
        spawn("rundll32", &["url.dll,FileProtocolHandler", &url])
    } else if cfg!(target_os = "macos") {
        spawn("open", &[&url])
    } else {
        spawn("xdg-open", &[&url])
    }
}

fn settings_file(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("settings.json"))
}

#[tauri::command]
pub fn settings_read(app: AppHandle) -> String {
    settings_file(&app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .unwrap_or_else(|| "{}".into())
}

#[tauri::command]
pub fn settings_write(app: AppHandle, text: String) -> Result<(), String> {
    let p = settings_file(&app)?;
    // Write then rename, so a crash mid-write never loses every setting.
    let tmp = p.with_extension("json.tmp");
    std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &p).map_err(|e| e.to_string())
}

/// Files passed on the command line (a double-clicked .ktex).
#[tauri::command]
pub fn launch_args() -> Vec<String> {
    std::env::args().skip(1).filter(|a| !a.starts_with('-')).collect()
}
