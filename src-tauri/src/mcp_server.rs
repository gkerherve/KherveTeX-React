//! MCP (Model Context Protocol) stdio server for KherveTeX
//! (khervedoc/mcp_server.py).
//!
//! The client-facing half of KherveTeX's MCP support. It speaks JSON-RPC
//! 2.0 over stdin/stdout — the transport Claude Desktop and Claude Code
//! launch — and forwards each `tools/call` to a running KherveTeX window
//! over a loopback socket (see mcp.rs).
//!
//! Document tools run inside the application's webview; the host instead
//! wants a short-lived subprocess it owns. This is that subprocess: the app
//! binary started with `--mcp-server` (main.rs), which runs this loop and
//! exits without opening a window.

use std::io::{BufRead, BufReader, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::PathBuf;
use std::time::Duration;

use crate::mcp_json::{self, J};

// ── Protocol constants ─────────────────────────────────────────────

/// Spec revisions we know how to speak. We echo the client's choice when
/// it is one of these, otherwise we answer with our newest.
pub const SUPPORTED_PROTOCOLS: [&str; 3] = ["2025-06-18", "2025-03-26", "2024-11-05"];
pub const LATEST_PROTOCOL: &str = SUPPORTED_PROTOCOLS[0];

pub const SERVER_NAME: &str = "khervetex";

/// Endpoint file written by the in-app bridge; names host, port, token.
pub const ENDPOINT_FILENAME: &str = "mcp-bridge.json";

const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
/// A first compile can download packages.
const CALL_TIMEOUT: Duration = Duration::from_secs(330);

// ── Endpoint discovery ─────────────────────────────────────────────

/// Directory holding KherveTeX's per-user runtime state — the Python app's
/// own, so either app's bridge is found by either's stdio server.
/// KHERVETEX_STATE_DIR overrides it (tests, a second installation).
pub fn state_dir() -> PathBuf {
    if let Some(d) = std::env::var_os("KHERVETEX_STATE_DIR").filter(|d| !d.is_empty()) {
        return PathBuf::from(d);
    }
    let home = || std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
        .map(PathBuf::from)
        .unwrap_or_default();
    let env = |k: &str| std::env::var_os(k).filter(|v| !v.is_empty()).map(PathBuf::from);
    if cfg!(windows) {
        return env("LOCALAPPDATA")
            .unwrap_or_else(|| home().join("AppData").join("Local"))
            .join("KherveTeX");
    }
    if cfg!(target_os = "macos") {
        return home().join("Library").join("Application Support").join("KherveTeX");
    }
    env("XDG_CONFIG_HOME").unwrap_or_else(|| home().join(".config")).join("KherveTeX")
}

/// Full path of the bridge endpoint description file.
pub fn endpoint_path() -> PathBuf {
    state_dir().join(ENDPOINT_FILENAME)
}

/// Load the endpoint file, or None when the app is not serving.
pub fn read_endpoint(path: Option<&PathBuf>) -> Option<J> {
    let p = path.cloned().unwrap_or_else(endpoint_path);
    let text = std::fs::read_to_string(p).ok()?;
    let info = mcp_json::parse(&text).ok()?;
    if !info.is_obj() || info.get("port").is_none() {
        return None;
    }
    Some(info)
}

pub const NOT_RUNNING: &str = "KherveTeX is not reachable.\n\n\
The MCP server drives a live KherveTeX window, so the \
application must be running with its bridge enabled:\n  \
1. Start KherveTeX.\n  \
2. Enable AI ▸ Connect to Claude.\n\
Then retry — no need to restart this MCP connection.";

/// Raised when the running application cannot be reached.
#[derive(Debug, Clone, PartialEq)]
pub struct BridgeError(pub String);

/// Sent to the client on initialize. The host writes its own system prompt,
/// so anything a model must know before touching someone's open document
/// has to travel with the connection.
pub const INSTRUCTIONS: &str = "\
These tools drive a LIVE KherveTeX window — a WYSIWYG editor whose \
document is compiled to PDF with LaTeX. Everything you do lands in the \
document the user has open in front of them, immediately.

Working rules:
- Call get_document_info, then get_outline, before changing anything. \
The document is a list of top-level blocks (headings, paragraphs, \
equations, figures, tables, raw LaTeX); tools address them by index, \
and indices shift after an insert or delete, so re-read the outline \
rather than reusing stale numbers.
- read_blocks before replace_blocks, and change only what was asked. \
Keep the author's wording, labels and citations unless told otherwise.
- Write content as LaTeX BODY source (no \\documentclass or preamble): \
\\section{...}, paragraphs, equation/align, itemize/enumerate, \
table+tabular (booktabs rules are fine), figure+\\includegraphics, \
\\cite{key}, \\ref{label}. It is parsed into real editable blocks. \
Packages and the title/author go through set_metadata, not the body.
- Cite only keys that list_references returns, and reference only \
labels it lists; do not invent bibliography entries.
- After a substantive edit, compile_document and check the result; \
render_page shows a page image so you can verify equations, tables \
and layout the way the reader will see them.
- Equations: insert_equation takes the math alone (no $ or \\[ \\]); \
its result says whether the editor typesets it natively. Chemistry: \
insert_chemistry takes mhchem syntax (2H2 + O2 -> 2H2O) and adds the \
mhchem package itself — do not hand-write \\ce in insert_latex.
- Drawings: for diagrams, flowcharts and apparatus sketches use \
insert_drawing with JSON shapes in millimetres (boxes with labels, \
arrows, text, and library symbols from list_drawing_symbols) — not \
TikZ. The result is an editable figure. Check it with get_drawing or a \
render_page after compiling; fix it with update_drawing. \
open_in_khervepaint hands a drawing to the full KhervePaint app when \
the user wants to edit it by hand.
- Every tool call is one step on the editor's undo stack, so the user \
can Ctrl+Z it — but their unsaved work is real. open_document and \
new_document refuse to discard it unless you pass \
discard_unsaved_changes; save instead of discarding.
- The user controls what you may do (AI > Connect to Claude). A \
refusal naming an access level is their setting, not a bug — tell \
them what you needed rather than working around it.
";

// ── Bridge client ──────────────────────────────────────────────────

/// What the server needs from the running app (a trait so the protocol
/// tests can stand in for it).
pub trait Bridge {
    fn request(&mut self, method: &str, params: Option<J>) -> Result<J, BridgeError>;
    fn close(&mut self) {}
}

/// Line-delimited JSON client for the in-app bridge.
///
/// Connects lazily and reconnects on demand so that the MCP host may start
/// this process before (or after) KherveTeX itself, and so a restart of the
/// application does not require a restart of the host.
pub struct BridgeClient {
    endpoint_file: Option<PathBuf>,
    sock: Option<BufReader<TcpStream>>,
    token: String,
    next_id: u64,
}

enum Io {
    Bridge(BridgeError),
    Os(std::io::Error),
}

impl BridgeClient {
    pub fn new(endpoint_file: Option<PathBuf>) -> Self {
        BridgeClient { endpoint_file, sock: None, token: String::new(), next_id: 0 }
    }

    fn connect(&mut self) -> Result<(), BridgeError> {
        let info = read_endpoint(self.endpoint_file.as_ref()).ok_or_else(|| BridgeError(NOT_RUNNING.into()))?;
        self.token = info.get("token").map(J::py_str).unwrap_or_default();
        let host = info.get("host").map(J::py_str).unwrap_or_else(|| "127.0.0.1".into());
        let port: u16 = info.get("port").map(J::py_str).unwrap_or_default().parse().unwrap_or(0);
        // A stale endpoint file (app killed without cleanup) looks exactly
        // like "not running" from here — say so plainly rather than leaking
        // a connection-refused error.
        let fail = |e: String| BridgeError(format!("{NOT_RUNNING}\n\n(socket error: {e})"));
        let addr = (host.as_str(), port).to_socket_addrs().map_err(|e| fail(e.to_string()))?
            .next().ok_or_else(|| fail("no address".into()))?;
        let sock = TcpStream::connect_timeout(&addr, CONNECT_TIMEOUT).map_err(|e| fail(e.to_string()))?;
        let _ = sock.set_read_timeout(Some(CALL_TIMEOUT));
        let _ = sock.set_write_timeout(Some(CALL_TIMEOUT));
        self.sock = Some(BufReader::new(sock));
        Ok(())
    }

    fn exchange(&mut self, payload: &str) -> Result<Vec<u8>, Io> {
        let r = self.sock.as_mut().expect("connected");
        r.get_mut().write_all(payload.as_bytes()).map_err(Io::Os)?;
        r.get_mut().flush().map_err(Io::Os)?;
        let mut line = Vec::new();
        let n = r.read_until(b'\n', &mut line).map_err(Io::Os)?;
        if n == 0 || line.last() != Some(&b'\n') {
            return Err(Io::Bridge(BridgeError(
                "KherveTeX closed the connection mid-request. The application may have quit.".into())));
        }
        line.pop();
        Ok(line)
    }
}

impl Bridge for BridgeClient {
    fn close(&mut self) {
        if let Some(r) = self.sock.take() {
            let _ = r.get_ref().shutdown(std::net::Shutdown::Both);
        }
    }

    /// Send one request, returning its `result` payload.
    fn request(&mut self, method: &str, params: Option<J>) -> Result<J, BridgeError> {
        for attempt in 0..2 {
            if self.sock.is_none() {
                self.connect()?;
            }
            self.next_id += 1;
            let payload = J::obj(vec![
                ("id", J::Num(self.next_id.to_string())),
                ("token", J::s(self.token.clone())),
                ("method", J::s(method)),
                ("params", params.clone().unwrap_or(J::Obj(vec![]))),
            ]);
            let line = match self.exchange(&(mcp_json::dumps(&payload, None) + "\n")) {
                Ok(l) => l,
                Err(Io::Bridge(e)) => {
                    self.close();
                    if attempt == 0 {
                        continue; // app restarted: reconnect once
                    }
                    return Err(e);
                }
                Err(Io::Os(e)) => {
                    self.close();
                    if attempt == 0 {
                        continue;
                    }
                    return Err(BridgeError(format!("Bridge I/O error: {e}")));
                }
            };
            let Ok(reply) = mcp_json::parse(&String::from_utf8_lossy(&line)) else {
                self.close();
                return Err(BridgeError("Malformed reply from KherveTeX.".into()));
            };
            if let Some(err) = reply.get("error").filter(|e| e.truthy()) {
                return Err(BridgeError(err.py_str()));
            }
            return Ok(reply.get("result").cloned().unwrap_or(J::Null));
        }
        Err(BridgeError(NOT_RUNNING.into()))
    }
}

// ── MCP server ─────────────────────────────────────────────────────

/// Diagnostics go to stderr — stdout carries the protocol.
fn log(msg: &str) {
    let mut e = std::io::stderr();
    let _ = writeln!(e, "[khervetex-mcp] {msg}");
    let _ = e.flush();
}

/// Minimal, dependency-free MCP server over stdio.
pub struct McpServer<B: Bridge> {
    pub bridge: B,
    tools_cache: Option<Vec<J>>,
}

fn error(id: &J, code: i64, message: &str) -> J {
    J::obj(vec![
        ("jsonrpc", J::s("2.0")),
        ("id", id.clone()),
        ("error", J::obj(vec![("code", J::int(code)), ("message", J::s(message))])),
    ])
}

impl<B: Bridge> McpServer<B> {
    pub fn new(bridge: B) -> Self {
        McpServer { bridge, tools_cache: None }
    }

    /// Handle one JSON-RPC message; None means 'no reply'.
    pub fn handle(&mut self, msg: &J) -> Option<J> {
        let method = msg.get("method").filter(|m| **m != J::Null)?; // a response — ignore
        let method = method.py_str();
        let id = msg.get("id").cloned().unwrap_or(J::Null);
        let has_id = id != J::Null;
        let params = msg.get("params").filter(|p| p.truthy()).cloned().unwrap_or(J::Obj(vec![]));
        let result = match method.as_str() {
            "initialize" => Ok(self.initialize(&params)),
            "notifications/initialized" | "notifications/cancelled" | "initialized" => {
                return None; // notifications: no reply
            }
            "ping" => Ok(J::Obj(vec![])),
            "tools/list" => self.list_tools().map(|t| J::obj(vec![("tools", J::Arr(t))])),
            "tools/call" => self.call_tool(&params),
            // Declared empty rather than unsupported so hosts that probe
            // every capability do not surface an error.
            "resources/list" => Ok(J::obj(vec![("resources", J::Arr(vec![]))])),
            "resources/templates/list" => Ok(J::obj(vec![("resourceTemplates", J::Arr(vec![]))])),
            "prompts/list" => Ok(J::obj(vec![("prompts", J::Arr(vec![]))])),
            _ => {
                if !has_id {
                    return None;
                }
                return Some(error(&id, -32601, &format!("Unknown method: {method}")));
            }
        };
        if !has_id {
            return None;
        }
        Some(match result {
            Ok(r) => J::obj(vec![("jsonrpc", J::s("2.0")), ("id", id), ("result", r)]),
            Err(BridgeError(e)) => error(&id, -32000, &e),
        })
    }

    // ── Methods ─────────────────────────────────────────────────

    fn initialize(&mut self, params: &J) -> J {
        let asked = params.get("protocolVersion").and_then(J::as_str).unwrap_or("");
        let version = if SUPPORTED_PROTOCOLS.contains(&asked) { asked } else { LATEST_PROTOCOL };
        // Best-effort: the app may not be up yet, and initialize must never
        // fail for that reason.
        let app_version = self.bridge.request("get_status", None).ok()
            .and_then(|s| s.get("version").map(J::py_str))
            .unwrap_or_else(|| "unknown".into());
        J::obj(vec![
            ("protocolVersion", J::s(version)),
            ("capabilities", J::obj(vec![
                ("tools", J::obj(vec![("listChanged", J::Bool(false))])),
                ("resources", J::Obj(vec![])),
                ("prompts", J::Obj(vec![])),
            ])),
            ("serverInfo", J::obj(vec![
                ("name", J::s(SERVER_NAME)),
                ("title", J::s("KherveTeX")),
                ("version", J::s(app_version)),
            ])),
            ("instructions", J::s(INSTRUCTIONS)),
        ])
    }

    fn list_tools(&mut self) -> Result<Vec<J>, BridgeError> {
        if self.tools_cache.is_none() {
            let tools = self.bridge.request("list_tools", None)?;
            let list = match tools {
                J::Arr(a) => a,
                _ => vec![],
            };
            self.tools_cache = Some(list.iter().map(|t| J::obj(vec![
                ("name", t.get("name").cloned().unwrap_or(J::Null)),
                ("description", t.get("description").cloned().unwrap_or(J::s(""))),
                ("inputSchema", t.get("input_schema").cloned().unwrap_or_else(|| J::obj(vec![
                    ("type", J::s("object")), ("properties", J::Obj(vec![])),
                ]))),
            ])).collect());
        }
        Ok(self.tools_cache.clone().unwrap_or_default())
    }

    fn call_tool(&mut self, params: &J) -> Result<J, BridgeError> {
        let name = params.get("name").filter(|n| n.truthy())
            .ok_or_else(|| BridgeError("tools/call requires a tool name.".into()))?;
        let args = params.get("arguments").filter(|a| a.truthy()).cloned().unwrap_or(J::Obj(vec![]));
        let mut result = self.bridge.request("call_tool", Some(J::obj(vec![
            ("name", name.clone()), ("input", args),
        ])))?;
        // Tools such as compile_document always report an `error` field,
        // null on success, so only a real message marks the call as failed.
        let is_error = result.get("error").is_some_and(J::truthy);
        let mut content = Vec::new();
        if result.get("image_png_base64").is_some_and(J::truthy) {
            // A rendered page travels as a real image block, not as a wall
            // of base64 text the model cannot see.
            let data = result.pop("image_png_base64").unwrap_or(J::Null);
            content.push(J::obj(vec![("type", J::s("image")), ("mimeType", J::s("image/png")), ("data", data)]));
        }
        content.insert(0, J::obj(vec![("type", J::s("text")), ("text", J::s(mcp_json::dumps(&result, Some(2))))]));
        Ok(J::obj(vec![("content", J::Arr(content)), ("isError", J::Bool(is_error))]))
    }
}

// ── Entry point ────────────────────────────────────────────────────

/// Run the stdio loop until stdin closes.
pub fn serve(endpoint_file: Option<PathBuf>) -> i32 {
    let shown = endpoint_file.clone().unwrap_or_else(endpoint_path);
    let mut server = McpServer::new(BridgeClient::new(endpoint_file));
    let stdin = std::io::stdin();
    let mut stdin = stdin.lock();
    let stdout = std::io::stdout();
    log(&format!("listening on stdio; endpoint={}", shown.display()));
    let mut raw = Vec::new();
    loop {
        raw.clear();
        match stdin.read_until(b'\n', &mut raw) {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
        let text = String::from_utf8_lossy(&raw);
        let line = text.trim();
        if line.is_empty() {
            continue;
        }
        let msg = match mcp_json::parse(line) {
            Ok(m) => m,
            Err(e) => {
                log(&format!("bad JSON on stdin: {e}"));
                continue;
            }
        };
        // A host may batch messages into a JSON array.
        let batch = match msg {
            J::Arr(a) => a,
            m => vec![m],
        };
        let replies: Vec<J> = batch.iter().filter_map(|m| server.handle(m)).collect();
        let mut out = stdout.lock();
        for reply in &replies {
            let _ = out.write_all((mcp_json::dumps(reply, None) + "\n").as_bytes());
        }
        if !replies.is_empty() {
            let _ = out.flush();
        }
    }
    server.bridge.close();
    0
}

/// `KherveTeX --mcp-server [--endpoint FILE]`
pub fn main() -> i32 {
    let args: Vec<String> = std::env::args().skip(1).filter(|a| a != "--mcp-server").collect();
    let mut endpoint = None;
    if let Some(i) = args.iter().position(|a| a == "--endpoint") {
        if let Some(p) = args.get(i + 1) {
            endpoint = Some(PathBuf::from(p));
        }
    }
    serve(endpoint)
}

#[cfg(test)]
mod tests {
    use super::*;

    // tests/test_mcp.py — the protocol, against a stand-in for the app.
    struct FakeBridge {
        result: J,
        calls: Vec<(String, Option<J>)>,
    }

    impl Bridge for FakeBridge {
        fn request(&mut self, method: &str, params: Option<J>) -> Result<J, BridgeError> {
            self.calls.push((method.to_string(), params));
            Ok(match method {
                "get_status" => J::obj(vec![("version", J::s("9.9"))]),
                "list_tools" => mcp_json::parse(r#"[
                    {"name": "get_document_info", "description": "d", "input_schema": {"type": "object"}},
                    {"name": "get_outline", "description": "o", "input_schema": {"type": "object"}}]"#).unwrap(),
                _ => self.result.clone(),
            })
        }
    }

    fn server(result: &str) -> McpServer<FakeBridge> {
        McpServer::new(FakeBridge { result: mcp_json::parse(result).unwrap(), calls: vec![] })
    }

    fn msg(s: &str) -> J {
        mcp_json::parse(s).unwrap()
    }

    #[test]
    fn test_initialize_reports_version_and_instructions() {
        let mut srv = server("null");
        let reply = srv.handle(&msg(r#"{"jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": {"protocolVersion": "2025-03-26"}}"#)).unwrap();
        let res = reply.get("result").unwrap();
        assert_eq!(res.get("protocolVersion"), Some(&J::s("2025-03-26")));
        assert_eq!(res.get("serverInfo").unwrap().get("name"), Some(&J::s("khervetex")));
        assert_eq!(res.get("serverInfo").unwrap().get("version"), Some(&J::s("9.9")));
        assert!(res.get("instructions").unwrap().as_str().unwrap().contains("KherveTeX"));
    }

    #[test]
    fn test_tools_use_mcp_schema_keys() {
        let mut srv = server("null");
        let reply = srv.handle(&msg(r#"{"id": 2, "method": "tools/list"}"#)).unwrap();
        let J::Arr(tools) = reply.get("result").unwrap().get("tools").unwrap().clone() else { panic!() };
        assert_eq!(tools.len(), 2);
        assert!(tools.iter().all(|t| t.get("inputSchema").is_some()));
    }

    #[test]
    fn test_rendered_page_is_returned_as_an_image_block() {
        let mut srv = server(r#"{"page": 1, "image_png_base64": "AAAA"}"#);
        let reply = srv.handle(&msg(r#"{"id": 3, "method": "tools/call",
            "params": {"name": "render_page", "arguments": {"page": 1}}}"#)).unwrap();
        let J::Arr(content) = reply.get("result").unwrap().get("content").unwrap().clone() else { panic!() };
        let kinds: Vec<_> = content.iter().map(|c| c.get("type").unwrap().py_str()).collect();
        assert_eq!(kinds, ["text", "image"]);
        assert!(!content[0].get("text").unwrap().py_str().contains("AAAA"));
    }

    #[test]
    fn test_tool_error_is_flagged() {
        let mut srv = server(r#"{"error": "nope"}"#);
        let reply = srv.handle(&msg(r#"{"id": 4, "method": "tools/call", "params": {"name": "x"}}"#)).unwrap();
        assert_eq!(reply.get("result").unwrap().get("isError"), Some(&J::Bool(true)));
    }

    #[test]
    fn test_successful_compile_is_not_flagged() {
        let mut srv = server(r#"{"ok": true, "error": null, "pages": 4, "log_tail": ""}"#);
        let reply = srv.handle(&msg(r#"{"id": 5, "method": "tools/call",
            "params": {"name": "compile_document"}}"#)).unwrap();
        let res = reply.get("result").unwrap();
        assert_eq!(res.get("isError"), Some(&J::Bool(false)));
        let J::Arr(content) = res.get("content").unwrap().clone() else { panic!() };
        // json.dumps(result, indent=2), keys in the order the tool wrote them.
        assert_eq!(content[0].get("text").unwrap().py_str(),
            "{\n  \"ok\": true,\n  \"error\": null,\n  \"pages\": 4,\n  \"log_tail\": \"\"\n}");
    }

    #[test]
    fn test_missing_app_explains_how_to_fix() {
        let dir = std::env::temp_dir().join(format!("kt-mcp-none-{}", std::process::id()));
        let mut srv = McpServer::new(BridgeClient::new(Some(dir.join("none.json"))));
        let reply = srv.handle(&msg(r#"{"id": 5, "method": "tools/list"}"#)).unwrap();
        let err = reply.get("error").unwrap();
        assert_eq!(err.get("code"), Some(&J::int(-32000)));
        assert!(err.get("message").unwrap().py_str().contains("Connect to Claude"));
    }

    #[test]
    fn notifications_and_responses_get_no_reply() {
        let mut srv = server("null");
        assert!(srv.handle(&msg(r#"{"method": "notifications/initialized"}"#)).is_none());
        assert!(srv.handle(&msg(r#"{"id": 9, "result": {}}"#)).is_none());
        let r = srv.handle(&msg(r#"{"id": 7, "method": "nope"}"#)).unwrap();
        assert_eq!(r.get("error").unwrap().get("code"), Some(&J::int(-32601)));
        let r = srv.handle(&msg(r#"{"id": 8, "method": "tools/call", "params": {}}"#)).unwrap();
        assert_eq!(r.get("error").unwrap().get("message"), Some(&J::s("tools/call requires a tool name.")));
    }
}
