//! `KherveTeX --smoke-test <outdir> [file.tex ...]`: the headless half of
//! scripts/smoke_test.mjs (the port of packaging/smoke_test.py).
//!
//! An installer fails quietly: a sidecar or resource left out only shows on
//! a user's first compile, and a package missing from the bundled cache only
//! on a PC that has never been online. So the built app itself, with no
//! window, finds its bundled tectonic, seeds the user's cache from its
//! bundled one exactly as at start-up (run it with TECTONIC_CACHE_DIR on an
//! empty folder: a brand-new PC), then compiles each .tex with
//! `--only-cached`, the bundled styles copied in and on TEXINPUTS as
//! compiler.compileTex does. It writes `<outdir>/smoke-report.json`; the
//! script judges it. The process never opens a window, so a CI runner needs
//! no display.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde_json::{Value, json};
use tauri::PackageInfo;

use crate::fsops::copy_file;
use crate::process::run_blocking;
use crate::tectonic::{find_tectonic_path, seed_cache_from};

pub const FLAG: &str = "--smoke-test";

/// The exit code when the command line asks for a smoke test, else None.
pub fn run_from_args(info: &PackageInfo) -> Option<i32> {
    let args: Vec<String> = std::env::args().collect();
    let at = args.iter().position(|a| a == FLAG)?;
    let Some(outdir) = args.get(at + 1).map(PathBuf::from) else {
        eprintln!("usage: {FLAG} <outdir> [file.tex ...]");
        return Some(2);
    };
    let files: Vec<PathBuf> = args[at + 2..].iter().map(PathBuf::from).collect();
    let report = run(info, &outdir, files);
    let text = serde_json::to_string_pretty(&report).unwrap_or_default();
    let _ = std::fs::create_dir_all(&outdir);
    if let Err(e) = std::fs::write(outdir.join("smoke-report.json"), &text) {
        eprintln!("cannot write the report: {e}");
        return Some(2);
    }
    println!("{text}");
    Some(0)
}

fn count_files(dir: &Path) -> usize {
    let Ok(rd) = std::fs::read_dir(dir) else { return 0 };
    rd.flatten()
        .map(|e| {
            let p = e.path();
            if p.is_dir() { count_files(&p) } else { 1 }
        })
        .sum()
}

fn tail(s: &str, n: usize) -> String {
    let chars: Vec<char> = s.chars().collect();
    chars[chars.len().saturating_sub(n)..].iter().collect()
}

fn run(info: &PackageInfo, outdir: &Path, mut files: Vec<PathBuf>) -> Value {
    let resources = tauri::utils::platform::resource_dir(info, &tauri::Env::default())
        .map(|d| d.join("resources"))
        .ok();
    // {path, bundled}: the frontend's Engine, so the report shows whether
    // the sidecar (not some tectonic on PATH) was found.
    let engine = find_tectonic_path().map(|e| serde_json::to_value(e).unwrap_or(Value::Null));
    let mut report = json!({
        "app_version": info.version.to_string(),
        "resource_dir": resources.as_ref().map(|d| d.to_string_lossy().into_owned()),
        "tectonic": engine.clone(),
    });
    let Some(tec) = engine.as_ref().and_then(|e| e["path"].as_str()).map(String::from) else {
        report["error"] = json!("no tectonic binary found");
        return report;
    };
    let v = run_blocking(&tec, &["--version".into()], None, None, Duration::from_secs(30));
    report["tectonic_version"] = json!(v.stdout.trim());

    let bundled = resources.as_ref().map(|r| r.join("tectonic_cache")).filter(|d| d.is_dir());
    report["bundled_cache_files"] = json!(bundled.as_deref().map(count_files).unwrap_or(0));
    let Some(bundled) = bundled else {
        report["error"] = json!("the app has no bundled tectonic_cache");
        return report;
    };
    let t0 = Instant::now();
    let cache = seed_cache_from(&bundled);
    report["cache_dir"] = json!(cache.to_string_lossy());
    report["seeded_files"] = json!(count_files(&cache));
    report["seed_seconds"] = json!(t0.elapsed().as_secs_f64());

    let styles = resources.as_ref().map(|r| r.join("styles")).filter(|d| d.is_dir());
    report["styles_dir"] = json!(styles.as_ref().map(|d| d.to_string_lossy().into_owned()));
    let mut env = HashMap::new();
    if let Some(s) = &styles {
        let sep = if cfg!(windows) { ";" } else { ":" };
        env.insert("TEXINPUTS".to_string(), format!("{}{sep}", s.to_string_lossy()));
    }

    if files.is_empty() {
        if let Ok(rd) = std::fs::read_dir(outdir) {
            files = rd.flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "tex")).collect();
            files.sort();
        }
    }
    let mut docs = Vec::new();
    for f in &files {
        docs.push(compile(&tec, f, outdir, styles.as_deref(), &env));
    }
    report["documents"] = Value::Array(docs);
    report
}

fn compile(tec: &str, tex: &Path, outdir: &Path, styles: Option<&Path>, env: &HashMap<String, String>) -> Value {
    let name = tex.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let work = outdir.join(format!("{name}.work"));
    let _ = std::fs::remove_dir_all(&work);
    let _ = std::fs::create_dir_all(&work);
    let source = match std::fs::read_to_string(tex) {
        Ok(s) => s,
        Err(e) => return json!({ "name": name, "ok": false, "log": format!("cannot read {}: {e}", tex.display()) }),
    };
    // tectonic ignores TEXINPUTS for a document class: compileTex copies the
    // bundled styles next to the document, and so does this.
    if let Some(dir) = styles {
        if let Ok(rd) = std::fs::read_dir(dir) {
            for e in rd.flatten() {
                let p = e.path();
                if p.extension().is_some_and(|x| x == "cls" || x == "sty" || x == "bst") {
                    let _ = copy_file(&p, &work.join(e.file_name()));
                }
            }
        }
    }
    let tex_path = work.join("document.tex");
    let _ = std::fs::write(&tex_path, source);
    let args: Vec<String> = vec![
        "--only-cached".into(),
        "-Z".into(),
        "continue-on-errors".into(),
        "--keep-logs".into(),
        "--synctex".into(),
        "--outdir".into(),
        work.to_string_lossy().into_owned(),
        tex_path.to_string_lossy().into_owned(),
    ];
    let t0 = Instant::now();
    let r = run_blocking(tec, &args, Some(&work.to_string_lossy()), Some(env), Duration::from_secs(180));
    let pdf = work.join("document.pdf");
    let log = format!("{}{}{}", r.stdout, r.stderr, r.error.unwrap_or_default());
    let mut tex_log = std::fs::read_to_string(work.join("document.log")).unwrap_or_default();
    tex_log = tail(&tex_log, 4000);
    json!({
        "name": name,
        "code": r.code,
        "timed_out": r.timed_out,
        "seconds": t0.elapsed().as_secs_f64(),
        "pdf": pdf.is_file(),
        "pdf_bytes": std::fs::metadata(&pdf).map(|m| m.len()).unwrap_or(0),
        "log": tail(&log, 6000),
        "tex_log_tail": tex_log,
    })
}
