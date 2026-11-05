//! In-app half of KherveTeX's MCP support (khervedoc/mcp_bridge.py's
//! socket plumbing).
//!
//! The bridge listens on a loopback TCP port and answers newline-delimited
//! JSON requests. Each authenticated request is handed to the webview (the
//! `mcp-request` event); src/mcp/bridge.ts runs the tool against the live
//! document and answers with `mcp_respond`. mcp_server.rs (the stdio
//! process Claude launches) is the only intended client.
//!
//! Why a socket rather than serving MCP from inside the app: MCP hosts
//! launch their servers as stdio subprocesses they own and restart at will,
//! while document tools must run in the webview of an already-running
//! window. The socket is the seam between the two.
//!
//! Security posture: the listener binds to 127.0.0.1 only, and every
//! request must carry the random token from the endpoint file, which is
//! written user-readable only. The bridge is off unless the user turns it
//! on in AI > Connect to Claude.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, EventTarget};

use crate::mcp_json::{self, J};
use crate::mcp_server::{endpoint_path, state_dir};

/// Refuse absurd payloads rather than buffering without bound.
const MAX_LINE: usize = 8 * 1024 * 1024;

/// Longer than the stdio client's own wait, so the client gives up first.
const ANSWER_TIMEOUT: Duration = Duration::from_secs(600);

/// Runs one authenticated request: (method, params) → the reply's
/// `{"result": ...}` / `{"error": ...}` object.
pub type Dispatch = Arc<dyn Fn(String, J) -> J + Send + Sync>;

/// A listening bridge.
pub struct Listener {
    port: u16,
    token: String,
    stop: Arc<AtomicBool>,
    conns: Arc<Mutex<Vec<TcpStream>>>,
    endpoint: PathBuf,
}

/// secrets.token_urlsafe(32)
fn new_token() -> String {
    let mut bytes = [0u8; 32];
    if getrandom::fill(&mut bytes).is_err() {
        // No OS randomness: fall back to the clock and pid, still per-run.
        let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
        let seed = t.as_nanos() ^ ((std::process::id() as u128) << 64);
        for (i, b) in bytes.iter_mut().enumerate() {
            *b = (seed.rotate_left(i as u32 * 5) >> (i % 16)) as u8;
        }
    }
    const A: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let n = chunk.iter().enumerate().fold(0u32, |n, (i, b)| n | (*b as u32) << (16 - 8 * i));
        for i in 0..=chunk.len() {
            out.push(A[(n >> (18 - 6 * i) & 63) as usize] as char);
        }
    }
    out
}

/// secrets.compare_digest
fn same(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    let mut diff = a.len() ^ b.len();
    for i in 0..a.len().max(b.len()) {
        diff |= (*a.get(i).unwrap_or(&0) ^ *b.get(i).unwrap_or(&1)) as usize;
    }
    diff == 0
}

impl Listener {
    /// Begin listening. Err (with no side effects) if the port could not be
    /// bound. `endpoint` is where host/port/token are published.
    pub fn start(port: u16, version: &str, endpoint: PathBuf, dispatch: Dispatch) -> std::io::Result<Listener> {
        let server = TcpListener::bind(("127.0.0.1", port))?;
        server.set_nonblocking(true)?;
        let port = server.local_addr()?.port();
        let token = new_token();
        let stop = Arc::new(AtomicBool::new(false));
        let conns: Arc<Mutex<Vec<TcpStream>>> = Arc::default();
        let listener = Listener { port, token: token.clone(), stop: stop.clone(), conns: conns.clone(), endpoint };
        listener.write_endpoint(version);
        std::thread::spawn(move || {
            while !stop.load(Ordering::SeqCst) {
                match server.accept() {
                    Ok((sock, _)) => {
                        let _ = sock.set_nonblocking(false);
                        if let Ok(c) = sock.try_clone() {
                            conns.lock().unwrap().push(c);
                        }
                        let (token, dispatch, stop) = (token.clone(), dispatch.clone(), stop.clone());
                        std::thread::spawn(move || serve_connection(sock, &token, &dispatch, &stop));
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(40));
                    }
                    Err(_) => std::thread::sleep(Duration::from_millis(40)),
                }
            }
        });
        Ok(listener)
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    #[cfg(test)]
    pub fn token(&self) -> &str {
        &self.token
    }

    pub fn stop(&self) {
        self.stop.store(true, Ordering::SeqCst);
        for c in self.conns.lock().unwrap().drain(..) {
            let _ = c.shutdown(Shutdown::Both);
        }
        let _ = std::fs::remove_file(&self.endpoint);
    }

    /// Publish host/port/token so the stdio server can find us.
    fn write_endpoint(&self, version: &str) {
        let payload = J::obj(vec![
            ("host", J::s("127.0.0.1")),
            ("port", J::int(self.port as i64)),
            ("token", J::s(self.token.clone())),
            ("pid", J::int(std::process::id() as i64)),
            ("version", J::s(version)),
        ]);
        if let Some(dir) = self.endpoint.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if std::fs::write(&self.endpoint, mcp_json::dumps(&payload, Some(2))).is_ok() {
            private(&self.endpoint);
        }
    }
}

/// Best effort; a no-op on Windows.
fn private(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }
    #[cfg(not(unix))]
    let _ = path;
}

fn serve_connection(sock: TcpStream, token: &str, dispatch: &Dispatch, stop: &AtomicBool) {
    let Ok(mut out) = sock.try_clone() else { return };
    let mut reader = BufReader::new(sock);
    let mut buf = Vec::new();
    while !stop.load(Ordering::SeqCst) {
        buf.clear();
        // read_until stops at the newline; a line longer than MAX_LINE is
        // cut off by `take` and the connection dropped.
        match (&mut reader).take(MAX_LINE as u64 + 1).read_until(b'\n', &mut buf) {
            Ok(0) | Err(_) => return,
            Ok(_) => {}
        }
        if buf.len() > MAX_LINE {
            let _ = out.shutdown(Shutdown::Both);
            return;
        }
        let line = String::from_utf8_lossy(&buf);
        if line.trim().is_empty() {
            continue;
        }
        let reply = handle_line(line.trim_end_matches(['\r', '\n']), token, dispatch);
        if out.write_all((mcp_json::dumps(&reply, None) + "\n").as_bytes()).is_err() {
            return;
        }
        let _ = out.flush();
    }
}

/// McpBridge._handle_line: one request line → its reply object.
pub fn handle_line(line: &str, token: &str, dispatch: &Dispatch) -> J {
    let reply = |id: J, body: J| {
        let mut r = J::obj(vec![("id", id)]);
        if let J::Obj(pairs) = body {
            for (k, v) in pairs {
                r.set(&k, v);
            }
        }
        r
    };
    let err = |id: J, msg: &str| reply(id, J::obj(vec![("error", J::s(msg))]));
    let req = match mcp_json::parse(line) {
        Ok(r) if r.is_obj() => r,
        _ => return err(J::Null, "Malformed JSON request."),
    };
    let id = req.get("id").cloned().unwrap_or(J::Null);
    let given = req.get("token").map(J::py_str).unwrap_or_default();
    if !same(&given, token) {
        return err(id, "Invalid bridge token.");
    }
    let method = req.get("method").map(J::py_str).unwrap_or_else(|| "None".into());
    let params = req.get("params").filter(|p| p.truthy()).cloned().unwrap_or(J::Obj(vec![]));
    let body = dispatch(method, params);
    if body.get("error").is_none() && body.get("result").is_none() {
        return err(id, "Malformed reply from the editor.");
    }
    reply(id, body)
}

// ── The app's bridge: requests go to the webview ───────────────────

struct AppBridge {
    listener: Option<Listener>,
    pending: HashMap<u64, Sender<String>>,
}

static BRIDGE: LazyLock<Mutex<AppBridge>> =
    LazyLock::new(|| Mutex::new(AppBridge { listener: None, pending: HashMap::new() }));
static NEXT_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Serialize)]
struct Request {
    id: u64,
    method: String,
    /// The params as JSON text (keys in the client's order).
    params: String,
}

#[derive(Serialize)]
pub struct Started {
    port: u16,
    pid: u32,
    endpoint: String,
}

#[derive(Serialize)]
pub struct Status {
    running: bool,
    port: u16,
    pid: u32,
    endpoint: String,
}

fn ask_webview(app: &AppHandle, label: &str, method: String, params: J) -> J {
    let id = NEXT_ID.fetch_add(1, Ordering::SeqCst);
    let (tx, rx) = mpsc::channel();
    BRIDGE.lock().unwrap().pending.insert(id, tx);
    let req = Request { id, method, params: mcp_json::dumps(&params, None) };
    let target = EventTarget::webview_window(label);
    let answer = match app.emit_to(target, "mcp-request", req) {
        Ok(()) => rx.recv_timeout(ANSWER_TIMEOUT).ok(),
        Err(_) => None,
    };
    BRIDGE.lock().unwrap().pending.remove(&id);
    match answer.map(|text| mcp_json::parse(&text)) {
        Some(Ok(body)) if body.is_obj() => body,
        Some(_) => J::obj(vec![("error", J::s("Malformed reply from the editor."))]),
        None => J::obj(vec![("error", J::s("KherveTeX did not answer in time."))]),
    }
}

/// McpBridge.start: begin listening (or report the running bridge). The
/// window that starts it is the one that runs the tools.
#[tauri::command]
pub fn mcp_start(app: AppHandle, window: tauri::WebviewWindow, port: u16, version: String) -> Result<Started, String> {
    let mut b = BRIDGE.lock().unwrap();
    let endpoint = endpoint_path();
    if let Some(l) = &b.listener {
        return Ok(Started { port: l.port(), pid: std::process::id(), endpoint: endpoint.display().to_string() });
    }
    let label = window.label().to_string();
    let dispatch: Dispatch = Arc::new(move |method, params| ask_webview(&app, &label, method, params));
    let l = Listener::start(port, &version, endpoint.clone(), dispatch).map_err(|e| e.to_string())?;
    let started = Started { port: l.port(), pid: std::process::id(), endpoint: endpoint.display().to_string() };
    b.listener = Some(l);
    Ok(started)
}

/// McpBridge.stop: close the port and remove the endpoint file.
pub fn stop() {
    let mut b = BRIDGE.lock().unwrap();
    if let Some(l) = b.listener.take() {
        l.stop();
    }
    // Anything still waiting gets "did not answer" rather than hanging.
    b.pending.clear();
}

#[tauri::command]
pub fn mcp_stop() {
    stop();
}

#[tauri::command]
pub fn mcp_status() -> Status {
    let b = BRIDGE.lock().unwrap();
    Status {
        running: b.listener.is_some(),
        port: b.listener.as_ref().map(Listener::port).unwrap_or(0),
        pid: std::process::id(),
        endpoint: endpoint_path().display().to_string(),
    }
}

/// The webview's answer to one `mcp-request`: `{"result": ...}` or
/// `{"error": "..."}` as JSON text.
#[tauri::command]
pub fn mcp_respond(id: u64, reply: String) {
    if let Some(tx) = BRIDGE.lock().unwrap().pending.remove(&id) {
        let _ = tx.send(reply);
    }
}

// ── What mcp_hosts needs from the machine ──────────────────────────

/// mcp_hosts.launch_command: the argv an MCP host should run to reach this
/// installation — this executable with `--mcp-server`.
#[tauri::command]
pub fn mcp_launch_command() -> Vec<String> {
    let exe = std::env::current_exe().map(|p| p.display().to_string()).unwrap_or_else(|_| "khervetex".into());
    vec![exe, "--mcp-server".into()]
}

#[derive(Serialize)]
pub struct HostContext {
    /// sys.platform's prefix: "darwin", "win" or "linux".
    platform: &'static str,
    home: String,
    env: HashMap<String, String>,
    state_dir: String,
}

/// The pieces os.path.expanduser / expandvars use.
#[tauri::command]
pub fn mcp_host_context() -> HostContext {
    let platform = if cfg!(windows) { "win" } else if cfg!(target_os = "macos") { "darwin" } else { "linux" };
    let home = std::env::var(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).unwrap_or_default();
    let env = std::env::vars().collect();
    HostContext { platform, home, env, state_dir: state_dir().display().to_string() }
}

/// Host._write's os.replace: write beside the file, then rename over it,
/// so a host never reads a half-written config.
#[tauri::command]
pub fn mcp_write_atomic(path: String, text: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if let Some(dir) = p.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = PathBuf::from(format!("{path}.khervedoc-tmp"));
    std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &p).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        e.to_string()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp_server::{Bridge, BridgeClient, BridgeError};

    fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("kt-mcp-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn echo() -> Dispatch {
        Arc::new(|method, params| match method.as_str() {
            "get_status" => J::obj(vec![("result", J::obj(vec![("version", J::s("0.9")), ("é", J::s("ü"))]))]),
            "call_tool" => J::obj(vec![("result", params)]),
            m => J::obj(vec![("error", J::s(format!("Unknown bridge method: '{m}'")))]),
        })
    }

    // tests/test_mcp.py::test_endpoint_file_is_private_and_removed_on_stop
    #[test]
    fn test_endpoint_file_is_private_and_removed_on_stop() {
        let ep = temp("ep").join("ep.json");
        let l = Listener::start(0, "0.9", ep.clone(), echo()).unwrap();
        let info = mcp_json::parse(&std::fs::read_to_string(&ep).unwrap()).unwrap();
        assert_eq!(info.get("port"), Some(&J::int(l.port() as i64)));
        assert_eq!(info.get("token").unwrap().py_str(), l.token());
        assert_eq!(l.token().len(), 43);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(&ep).unwrap().permissions().mode() & 0o777, 0o600);
        }
        l.stop();
        assert!(!ep.exists());
    }

    // tests/test_mcp.py::test_wrong_token_is_refused
    #[test]
    fn test_wrong_token_is_refused() {
        let dir = temp("tok");
        let ep = dir.join("ep.json");
        let l = Listener::start(0, "0.9", ep.clone(), echo()).unwrap();
        let mut info = mcp_json::parse(&std::fs::read_to_string(&ep).unwrap()).unwrap();
        info.set("token", J::s("wrong"));
        let bad = dir.join("ep.json.bad");
        std::fs::write(&bad, mcp_json::dumps(&info, None)).unwrap();
        let err = BridgeClient::new(Some(bad)).request("get_status", None).unwrap_err();
        assert!(err.0.contains("token"), "{err:?}");
        l.stop();
    }

    #[test]
    fn requests_round_trip_over_the_socket() {
        let ep = temp("rt").join("ep.json");
        let l = Listener::start(0, "0.9", ep.clone(), echo()).unwrap();
        let mut c = BridgeClient::new(Some(ep.clone()));
        let st = c.request("get_status", None).unwrap();
        assert_eq!(mcp_json::dumps(&st, None), r#"{"version": "0.9", "\u00e9": "\u00fc"}"#);
        let args = mcp_json::parse(r#"{"name": "insert_latex", "input": {"z": 1, "a": "x"}}"#).unwrap();
        assert_eq!(c.request("call_tool", Some(args.clone())).unwrap(), args);
        assert_eq!(c.request("nope", None), Err(BridgeError("Unknown bridge method: 'nope'".into())));
        c.close();
        l.stop();
    }

    #[test]
    fn malformed_and_unauthenticated_lines() {
        let d = echo();
        let r = handle_line("{nope", "t", &d);
        assert_eq!(mcp_json::dumps(&r, None), r#"{"id": null, "error": "Malformed JSON request."}"#);
        let r = handle_line(r#"{"id": 3, "token": "x", "method": "get_status"}"#, "t", &d);
        assert_eq!(mcp_json::dumps(&r, None), r#"{"id": 3, "error": "Invalid bridge token."}"#);
        assert!(same("abc", "abc") && !same("abc", "abd") && !same("abc", "ab"));
    }

    #[test]
    fn atomic_write_replaces_the_file() {
        let p = temp("aw").join("sub").join("c.json");
        mcp_write_atomic(p.display().to_string(), "{}".into()).unwrap();
        mcp_write_atomic(p.display().to_string(), "{\"a\": 1}".into()).unwrap();
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "{\"a\": 1}");
        assert!(!PathBuf::from(format!("{}.khervedoc-tmp", p.display())).exists());
    }
}
