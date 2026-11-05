//! Where the engines and their caches are: compiler._find_tectonic,
//! _find_typst, default/query_tectonic_cache_dir, style_manager's folders
//! and __main__._seed_tectonic_cache.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::fsops::{copy_file, dir_size_bytes};
use crate::process::{is_executable, run_blocking, which};

#[derive(Serialize, Clone)]
pub struct Engine {
    path: String,
    /// The binary that ships inside the app (the Tauri sidecar).
    bundled: bool,
}

fn home() -> PathBuf {
    PathBuf::from(
        std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).unwrap_or_default(),
    )
}

/// The sidecar sits next to the app's executable (Contents/MacOS on macOS).
fn bundled_tectonic() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    for name in ["tectonic.exe", "tectonic"] {
        let p = dir.join(name);
        if is_executable(&p) {
            return Some(p);
        }
    }
    None
}

/// Search order: bundled with the app, the PATH, then common install
/// locations that may not be on PATH yet (a Finder-launched app has a
/// minimal PATH without Homebrew).
pub fn find_tectonic_path() -> Option<Engine> {
    if let Some(p) = bundled_tectonic() {
        return Some(Engine { path: p.to_string_lossy().into_owned(), bundled: true });
    }
    if let Some(p) = which("tectonic") {
        return Some(Engine { path: p, bundled: false });
    }
    let h = home();
    let candidates = [
        h.join("bin").join("tectonic.exe"),
        h.join("bin").join("tectonic"),
        h.join(".cargo").join("bin").join("tectonic.exe"),
        h.join("scoop").join("shims").join("tectonic.exe"),
        PathBuf::from("/opt/homebrew/bin/tectonic"),
        PathBuf::from("/usr/local/bin/tectonic"),
    ];
    candidates
        .iter()
        .find(|c| c.exists())
        .map(|c| Engine { path: c.to_string_lossy().into_owned(), bundled: false })
}

#[tauri::command]
pub fn find_tectonic() -> Option<Engine> {
    find_tectonic_path()
}

/// Falls back to common install locations (winget, cargo, scoop, Homebrew).
#[tauri::command]
pub fn find_typst() -> Option<String> {
    if let Some(p) = which("typst") {
        return Some(p);
    }
    let h = home();
    let mut candidates = vec![
        h.join("bin").join("typst.exe"),
        h.join("bin").join("typst"),
        h.join(".cargo").join("bin").join("typst.exe"),
        h.join(".cargo").join("bin").join("typst"),
        h.join("scoop").join("shims").join("typst.exe"),
        PathBuf::from("/opt/homebrew/bin/typst"),
        PathBuf::from("/usr/local/bin/typst"),
    ];
    // winget installs into a versioned package dir
    let winget = h.join("AppData").join("Local").join("Microsoft").join("WinGet").join("Packages");
    if let Ok(rd) = std::fs::read_dir(&winget) {
        for e in rd.flatten() {
            if e.file_name().to_string_lossy().starts_with("Typst.Typst_") {
                find_named(&e.path(), "typst.exe", &mut candidates);
            }
        }
    }
    candidates.iter().find(|c| c.exists()).map(|c| c.to_string_lossy().into_owned())
}

fn find_named(dir: &Path, name: &str, out: &mut Vec<PathBuf>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            find_named(&p, name, out);
        } else if e.file_name() == name {
            out.push(p);
        }
    }
}

/// Tectonic's per-OS cache location, used when the binary can't be asked.
pub fn default_cache_dir() -> PathBuf {
    let h = home();
    if cfg!(windows) {
        h.join("AppData").join("Local").join("TectonicProject").join("Tectonic").join("bundles")
    } else if cfg!(target_os = "macos") {
        h.join("Library").join("Caches").join("TectonicProject.Tectonic").join("bundles")
    } else {
        let base = std::env::var_os("XDG_CACHE_HOME").map(PathBuf::from).unwrap_or(h.join(".cache"));
        base.join("Tectonic").join("bundles")
    }
}

#[tauri::command]
pub fn default_tectonic_cache_dir() -> String {
    default_cache_dir().to_string_lossy().into_owned()
}

/// Ask the tectonic binary where it caches bundle files.
pub fn query_cache_dir(tectonic: &str) -> Option<PathBuf> {
    let r = run_blocking(
        tectonic,
        &["-X".into(), "show".into(), "user-cache-dir".into()],
        None,
        None,
        Duration::from_secs(10),
    );
    if r.code != Some(0) {
        return None;
    }
    r.stdout.trim().lines().last().map(|l| PathBuf::from(l.trim()))
}

#[tauri::command]
pub async fn query_tectonic_cache_dir(tectonic: String) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || query_cache_dir(&tectonic))
        .await
        .ok()
        .flatten()
        .map(|p| p.to_string_lossy().into_owned())
}

/// Size in bytes of every file under `path` (0 when missing).
#[tauri::command]
pub async fn tree_size(path: String) -> u64 {
    tauri::async_runtime::spawn_blocking(move || dir_size_bytes(Path::new(&path))).await.unwrap_or(0)
}

/// style_manager.all_style_dirs(): the user's folder first (their files win),
/// then the styles that ship with the app.
#[tauri::command]
pub fn style_dirs(app: AppHandle) -> Vec<String> {
    let mut out = Vec::new();
    if let Ok(cfg) = app.path().app_config_dir() {
        let d = cfg.join("styles");
        let _ = std::fs::create_dir_all(&d);
        if d.is_dir() {
            out.push(d.to_string_lossy().into_owned());
        }
    }
    if let Ok(res) = app.path().resource_dir() {
        let d = res.join("resources").join("styles");
        if d.is_dir() {
            out.push(d.to_string_lossy().into_owned());
        }
    }
    out
}

pub fn bundled_cache(app: &AppHandle) -> Option<PathBuf> {
    let d = app.path().resource_dir().ok()?.join("resources").join("tectonic_cache");
    d.is_dir().then_some(d)
}

/// Copy the bundled tectonic packages into the user's cache, missing files
/// only, so every document class compiles offline from the first launch.
/// The cache path is asked of the binary itself: it differs per OS and a
/// mismatch silently leaves the user with an empty cache.
pub fn seed_cache(app: &AppHandle) {
    let Some(bundled) = bundled_cache(app) else { return };
    seed_cache_from(&bundled);
}

/// The same from a bundled cache folder; returns the user's cache it filled.
pub fn seed_cache_from(bundled: &Path) -> PathBuf {
    let dest = cache_root(
        find_tectonic_path()
            .and_then(|t| query_cache_dir(&t.path))
            .unwrap_or_else(default_cache_dir),
    );
    let _ = std::fs::create_dir_all(&dest);
    seed_tree(bundled, &dest);
    dest
}

/// `-X show user-cache-dir` names the `bundles` folder *inside* tectonic's
/// cache, but the bundled copy is the whole cache (`bundles/` and
/// `formats/`, as warm() copies TECTONIC_CACHE_DIR), so it is seeded one
/// level up. Seeded into `bundles` itself it lands in `bundles/bundles`,
/// where tectonic never looks, and a new PC compiles nothing offline.
pub fn cache_root(user_cache_dir: PathBuf) -> PathBuf {
    match user_cache_dir.parent() {
        Some(parent) if user_cache_dir.file_name().is_some_and(|n| n == "bundles") => parent.to_path_buf(),
        _ => user_cache_dir,
    }
}

fn seed_tree(src: &Path, dest: &Path) {
    let Ok(rd) = std::fs::read_dir(src) else { return };
    for e in rd.flatten() {
        let s = e.path();
        let d = dest.join(e.file_name());
        if s.is_dir() {
            let _ = std::fs::create_dir_all(&d);
            seed_tree(&s, &d);
        } else if !d.exists() && e.file_name() != "README.txt" {
            let _ = copy_file(&s, &d);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seeds_the_cache_root_not_its_bundles_folder() {
        assert_eq!(cache_root(PathBuf::from("/c/TectonicProject.Tectonic/bundles")), PathBuf::from("/c/TectonicProject.Tectonic"));
        assert_eq!(cache_root(PathBuf::from("/tmp/cache")), PathBuf::from("/tmp/cache"));
    }

    #[test]
    fn seed_copies_missing_files_only() {
        let tmp = std::env::temp_dir().join(format!("ktex-seed-{}", std::process::id()));
        let (src, dest) = (tmp.join("src"), tmp.join("dest"));
        std::fs::create_dir_all(src.join("bundles").join("data")).unwrap();
        std::fs::write(src.join("bundles").join("data").join("a"), "new").unwrap();
        std::fs::write(src.join("README.txt"), "x").unwrap();
        std::fs::create_dir_all(dest.join("bundles").join("data")).unwrap();
        std::fs::write(dest.join("bundles").join("data").join("a"), "mine").unwrap();
        std::fs::create_dir_all(src.join("formats")).unwrap();
        std::fs::write(src.join("formats").join("f.fmt"), "fmt").unwrap();
        seed_tree(&src, &dest);
        assert_eq!(std::fs::read_to_string(dest.join("bundles").join("data").join("a")).unwrap(), "mine");
        assert!(dest.join("formats").join("f.fmt").is_file());
        assert!(!dest.join("README.txt").exists());
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
