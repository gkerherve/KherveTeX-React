//! What updater.py's Updater.schedule() asks of the environment: nothing runs
//! when KHERVETEX_NO_UPDATE is set (CI runners, the smoke test, a developer
//! who wants a fixed build). The checking itself is tauri-plugin-updater,
//! driven from src/app/actions/updater.ts.

#[tauri::command]
pub fn updates_disabled() -> bool {
    std::env::var_os("KHERVETEX_NO_UPDATE").is_some_and(|v| !v.is_empty())
}
