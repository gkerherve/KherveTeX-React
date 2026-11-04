//! File access for the frontend: what pathlib / shutil give the Python app.
//! Bytes travel as raw IPC bodies (no JSON number arrays), text as strings.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::ipc::{InvokeBody, Request, Response};

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn mtime_ms(meta: &fs::Metadata) -> f64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0)
}

#[derive(Serialize)]
pub struct Stat {
    is_dir: bool,
    is_file: bool,
    size: u64,
    mtime: f64,
}

#[derive(Serialize)]
pub struct Entry {
    name: String,
    path: String,
    is_dir: bool,
    is_file: bool,
    size: u64,
    mtime: f64,
}

#[tauri::command]
pub fn read_file(path: String) -> Result<Response, String> {
    fs::read(&path).map(Response::new).map_err(|e| format!("{path}: {e}"))
}

/// The body is the file's bytes; the target path is the percent-encoded
/// `x-path` header, as a raw body cannot carry other arguments.
#[tauri::command]
pub fn write_file(request: Request<'_>) -> Result<(), String> {
    let raw = request
        .headers()
        .get("x-path")
        .ok_or("write_file: no x-path header")?
        .to_str()
        .map_err(err)?;
    let path = percent_decode(raw);
    let InvokeBody::Raw(data) = request.body() else {
        return Err("write_file: body must be raw bytes".into());
    };
    let p = Path::new(&path);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(err)?;
    }
    fs::write(p, data).map_err(|e| format!("{path}: {e}"))
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Text-mode read with errors="replace", as the Python app reads sources.
#[tauri::command]
pub fn read_text(path: String) -> Result<String, String> {
    fs::read(&path)
        .map(|b| String::from_utf8_lossy(&b).into_owned())
        .map_err(|e| format!("{path}: {e}"))
}

#[tauri::command]
pub fn write_text(path: String, text: String) -> Result<(), String> {
    let p = Path::new(&path);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(err)?;
    }
    fs::write(p, text).map_err(|e| format!("{path}: {e}"))
}

#[tauri::command]
pub fn exists(path: String) -> bool {
    Path::new(&path).exists()
}

#[tauri::command]
pub fn stat(path: String) -> Option<Stat> {
    let m = fs::metadata(&path).ok()?;
    Some(Stat { is_dir: m.is_dir(), is_file: m.is_file(), size: m.len(), mtime: mtime_ms(&m) })
}

/// Sorted by name, as `sorted(Path.iterdir())`.
#[tauri::command]
pub fn list_dir(path: String) -> Result<Vec<Entry>, String> {
    let mut out = Vec::new();
    for e in fs::read_dir(&path).map_err(|e| format!("{path}: {e}"))? {
        let e = e.map_err(err)?;
        let p = e.path();
        let m = fs::metadata(&p).ok();
        out.push(Entry {
            name: e.file_name().to_string_lossy().into_owned(),
            path: p.to_string_lossy().into_owned(),
            is_dir: m.as_ref().map(|m| m.is_dir()).unwrap_or(false),
            is_file: m.as_ref().map(|m| m.is_file()).unwrap_or(false),
            size: m.as_ref().map(|m| m.len()).unwrap_or(0),
            mtime: m.as_ref().map(mtime_ms).unwrap_or(0.0),
        });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

#[tauri::command]
pub fn mkdir(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| format!("{path}: {e}"))
}

/// shutil.copy2: the bytes and the modification time, so the compiler's
/// "is the .bib newer" test keeps working on copies.
pub fn copy_file(src: &Path, dest: &Path) -> std::io::Result<()> {
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::copy(src, dest)?;
    if let Ok(t) = fs::metadata(src).and_then(|m| m.modified()) {
        if let Ok(f) = fs::File::options().write(true).open(dest) {
            let _ = f.set_modified(t);
        }
    }
    Ok(())
}

/// Copy `src` into `dest`; a folder is copied whole (shutil.copytree).
/// With `missing_only`, files already at the destination are kept.
pub fn copy_tree(src: &Path, dest: &Path, missing_only: bool) -> std::io::Result<()> {
    if src.is_dir() {
        fs::create_dir_all(dest)?;
        for e in fs::read_dir(src)? {
            let e = e?;
            copy_tree(&e.path(), &dest.join(e.file_name()), missing_only)?;
        }
        Ok(())
    } else if missing_only && dest.exists() {
        Ok(())
    } else {
        copy_file(src, dest)
    }
}

#[tauri::command]
pub fn copy_path(src: String, dest: String) -> Result<(), String> {
    copy_tree(Path::new(&src), Path::new(&dest), false).map_err(|e| format!("{src} -> {dest}: {e}"))
}

#[tauri::command]
pub fn remove_path(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if p.is_dir() {
        fs::remove_dir_all(p).map_err(err)
    } else if p.exists() {
        fs::remove_file(p).map_err(err)
    } else {
        Ok(())
    }
}

/// tempfile.mkdtemp(prefix=...)
#[tauri::command]
pub fn make_temp_dir(prefix: String) -> Result<String, String> {
    let base = std::env::temp_dir();
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    for n in 0..1000u32 {
        let p: PathBuf = base.join(format!("{prefix}{:x}{:x}{n}", nanos & 0xffff_ffff, std::process::id()));
        if fs::create_dir(&p).is_ok() {
            return Ok(p.to_string_lossy().into_owned());
        }
    }
    Err("could not create a temporary folder".into())
}

pub fn dir_size_bytes(p: &Path) -> u64 {
    let Ok(rd) = fs::read_dir(p) else { return 0 };
    rd.flatten()
        .map(|e| {
            let path = e.path();
            if path.is_dir() { dir_size_bytes(&path) } else { e.metadata().map(|m| m.len()).unwrap_or(0) }
        })
        .sum()
}

#[tauri::command]
pub fn dir_size(path: String) -> u64 {
    dir_size_bytes(Path::new(&path))
}

#[tauri::command]
pub fn home_dir() -> String {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_default()
}
