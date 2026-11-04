//! compiler._run_tracked / cancel_running: run a program with a time limit,
//! keeping every live process so a closing window can kill them (compiles
//! can run for minutes).

use std::collections::HashMap;
use std::io::Read;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::Serialize;

#[derive(Serialize)]
pub struct RunResult {
    /// None when the process was killed or could not start.
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub timed_out: bool,
    /// Why it did not start (missing program...).
    pub error: Option<String>,
}

type Running = Mutex<HashMap<u64, Arc<Mutex<Child>>>>;

fn running() -> &'static Running {
    static R: OnceLock<Running> = OnceLock::new();
    R.get_or_init(Default::default)
}

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

pub fn command(program: &str) -> Command {
    #[allow(unused_mut)]
    let mut c = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        c.creation_flags(CREATE_NO_WINDOW);
    }
    c
}

pub fn run_blocking(
    program: &str,
    args: &[String],
    cwd: Option<&str>,
    env: Option<&HashMap<String, String>>,
    timeout: Duration,
) -> RunResult {
    let mut cmd = command(program);
    cmd.args(args)
        // stdin closed: a TeX error that asks for input must fail, not wait
        // for an answer that never comes.
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(d) = cwd {
        cmd.current_dir(d);
    }
    if let Some(e) = env {
        cmd.envs(e);
    }
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            return RunResult {
                code: None,
                stdout: String::new(),
                stderr: String::new(),
                timed_out: false,
                error: Some(format!("{program}: {e}")),
            };
        }
    };
    let mut out_pipe = child.stdout.take();
    let mut err_pipe = child.stderr.take();
    // Drain both pipes on threads so a chatty compile never blocks on a
    // full pipe while we wait for it.
    let out_t = std::thread::spawn(move || {
        let mut b = Vec::new();
        if let Some(p) = out_pipe.as_mut() {
            let _ = p.read_to_end(&mut b);
        }
        b
    });
    let err_t = std::thread::spawn(move || {
        let mut b = Vec::new();
        if let Some(p) = err_pipe.as_mut() {
            let _ = p.read_to_end(&mut b);
        }
        b
    });
    let id = NEXT_ID.fetch_add(1, Ordering::SeqCst);
    let child = Arc::new(Mutex::new(child));
    running().lock().unwrap().insert(id, child.clone());
    let start = Instant::now();
    let mut timed_out = false;
    let status = loop {
        if let Ok(Some(s)) = child.lock().unwrap().try_wait() {
            break Some(s);
        }
        if start.elapsed() > timeout {
            timed_out = true;
            let mut c = child.lock().unwrap();
            let _ = c.kill();
            break c.wait().ok();
        }
        std::thread::sleep(Duration::from_millis(40));
    };
    running().lock().unwrap().remove(&id);
    let stdout = String::from_utf8_lossy(&out_t.join().unwrap_or_default()).into_owned();
    let stderr = String::from_utf8_lossy(&err_t.join().unwrap_or_default()).into_owned();
    RunResult {
        code: if timed_out { None } else { status.and_then(|s| s.code()) },
        stdout,
        stderr,
        timed_out,
        error: None,
    }
}

#[tauri::command]
pub async fn run_process(
    program: String,
    args: Vec<String>,
    cwd: Option<String>,
    env: Option<HashMap<String, String>>,
    timeout_secs: f64,
) -> RunResult {
    tauri::async_runtime::spawn_blocking(move || {
        run_blocking(&program, &args, cwd.as_deref(), env.as_ref(), Duration::from_secs_f64(timeout_secs.max(0.1)))
    })
    .await
    .unwrap_or(RunResult {
        code: None,
        stdout: String::new(),
        stderr: String::new(),
        timed_out: false,
        error: Some("the process thread failed".into()),
    })
}

/// Kill every process started by run_process.
#[tauri::command]
pub fn cancel_running() {
    for c in running().lock().unwrap().values() {
        let _ = c.lock().unwrap().kill();
    }
}

/// shutil.which
pub fn which(name: &str) -> Option<String> {
    let path = std::env::var_os("PATH")?;
    let exts: Vec<&str> = if cfg!(windows) { vec![".exe", ".cmd", ".bat", ""] } else { vec![""] };
    for dir in std::env::split_paths(&path) {
        for ext in &exts {
            let p = dir.join(format!("{name}{ext}"));
            if is_executable(&p) {
                return Some(p.to_string_lossy().into_owned());
            }
        }
    }
    None
}

pub fn is_executable(p: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        p.is_file() && p.metadata().map(|m| m.permissions().mode() & 0o111 != 0).unwrap_or(false)
    }
    #[cfg(not(unix))]
    {
        p.is_file()
    }
}

#[tauri::command]
pub fn which_program(name: String) -> Option<String> {
    which(&name)
}

#[cfg(test)]
mod tests {
    use super::*;

    // tests/test_compiler.py::test_cancel_running_kills_a_live_compile
    #[cfg(unix)]
    #[test]
    fn test_cancel_running_kills_a_live_compile() {
        let t = std::thread::spawn(|| {
            run_blocking("sleep", &["60".into()], None, None, Duration::from_secs(90))
        });
        for _ in 0..100 {
            if !running().lock().unwrap().is_empty() {
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        cancel_running();
        let start = Instant::now();
        let r = t.join().unwrap();
        assert!(start.elapsed() < Duration::from_secs(10));
        assert_ne!(r.code, Some(0));
    }
}
