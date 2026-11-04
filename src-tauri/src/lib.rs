//! KherveTeX's desktop shell: file access, the tectonic / typst engines and
//! the OS integration the frontend (src/platform/tauri.ts) calls.

mod fsops;
mod git;
mod process;
mod system;
mod tectonic;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // Seeding copies up to a few thousand files on first launch;
            // off the main thread so the window opens at once.
            let handle = app.handle().clone();
            std::thread::spawn(move || tectonic::seed_cache(&handle));
            Ok(())
        })
        .on_window_event(|window, event| {
            // A compile can outlast any sane wait; when the main window goes,
            // kill it rather than leave tectonic running on its own.
            if let tauri::WindowEvent::Destroyed = event {
                if window.label() == "main" {
                    process::cancel_running();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            fsops::read_file,
            fsops::write_file,
            fsops::read_text,
            fsops::write_text,
            fsops::exists,
            fsops::stat,
            fsops::list_dir,
            fsops::mkdir,
            fsops::copy_path,
            fsops::remove_path,
            fsops::make_temp_dir,
            fsops::dir_size,
            fsops::home_dir,
            process::run_process,
            process::cancel_running,
            process::which_program,
            tectonic::find_tectonic,
            tectonic::find_typst,
            tectonic::default_tectonic_cache_dir,
            tectonic::query_tectonic_cache_dir,
            tectonic::tree_size,
            tectonic::style_dirs,
            system::reveal,
            system::open_path,
            system::open_url,
            system::settings_read,
            system::settings_write,
            system::launch_args,
            git::git_is_available,
            git::git_init_repo,
            git::git_find_enclosing_repo,
            git::git_commit_all,
            git::git_get_remotes,
            git::git_set_remote,
            git::git_remove_remote,
            git::git_current_branch,
            git::git_pull,
            git::git_push,
            git::git_system_git_available,
            git::git_restore_to_commit,
            git::git_history,
            git::git_history_detailed,
            git::git_list_branches,
            git::git_create_branch,
            git::git_switch_branch,
            git::git_delete_branch,
            git::git_history_graph,
            git::git_diff_for_commit,
            git::git_default_signature,
        ])
        .run(tauri::generate_context!())
        .expect("error while running KherveTeX");
}
