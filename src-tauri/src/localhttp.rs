//! A GET to a server on this computer (Zotero's, on port 23119), from Rust
//! so the webview's cross-origin rules do not stand in the way. Only
//! 127.0.0.1 / localhost: it is not a general HTTP client.

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

#[derive(serde::Serialize)]
pub struct LocalResponse {
    pub status: u16,
    pub body: String,
}

/// "http://127.0.0.1:23119/path?q" -> (port, "/path?q"); None for any other host.
fn split_url(url: &str) -> Option<(u16, String)> {
    let rest = url.strip_prefix("http://")?;
    let (host_port, path) = match rest.find('/') {
        Some(i) => (&rest[..i], rest[i..].to_string()),
        None => (rest, "/".to_string()),
    };
    let (host, port) = match host_port.rsplit_once(':') {
        Some((h, p)) => (h, p.parse().ok()?),
        None => (host_port, 80),
    };
    if host != "127.0.0.1" && host != "localhost" {
        return None;
    }
    Some((port, path))
}

fn dechunk(body: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < body.len() {
        let Some(nl) = body[i..].windows(2).position(|w| w == b"\r\n") else { break };
        let line = String::from_utf8_lossy(&body[i..i + nl]);
        let size = usize::from_str_radix(line.split(';').next().unwrap_or("").trim(), 16).unwrap_or(0);
        i += nl + 2;
        if size == 0 || i + size > body.len() {
            break;
        }
        out.extend_from_slice(&body[i..i + size]);
        i += size + 2;
    }
    out
}

fn get_blocking(url: &str, timeout: Duration) -> Result<LocalResponse, String> {
    let (port, path) = split_url(url).ok_or("only http://127.0.0.1 or http://localhost addresses")?;
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let mut s = TcpStream::connect_timeout(&addr, Duration::from_secs(3)).map_err(|e| e.to_string())?;
    s.set_read_timeout(Some(timeout)).ok();
    let req = format!(
        "GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nUser-Agent: KherveTeX\r\nAccept: */*\r\nConnection: close\r\n\r\n"
    );
    s.write_all(req.as_bytes()).map_err(|e| e.to_string())?;
    let mut raw = Vec::new();
    s.read_to_end(&mut raw).map_err(|e| e.to_string())?;
    let end = raw.windows(4).position(|w| w == b"\r\n\r\n").ok_or("no HTTP reply")?;
    let head = String::from_utf8_lossy(&raw[..end]).to_string();
    let mut body = raw[end + 4..].to_vec();
    let status = head.split_whitespace().nth(1).and_then(|c| c.parse().ok()).unwrap_or(0);
    let lower = head.to_ascii_lowercase();
    if lower.contains("transfer-encoding: chunked") {
        body = dechunk(&body);
    }
    Ok(LocalResponse { status, body: String::from_utf8_lossy(&body).into_owned() })
}

#[tauri::command]
pub async fn localhost_get(url: String, timeout_secs: f64) -> Result<LocalResponse, String> {
    let timeout = Duration::from_secs_f64(timeout_secs.max(0.5));
    tauri::async_runtime::spawn_blocking(move || get_blocking(&url, timeout))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_this_computer() {
        assert_eq!(split_url("http://127.0.0.1:23119/a?b=1"), Some((23119, "/a?b=1".into())));
        assert_eq!(split_url("http://localhost:23119"), Some((23119, "/".into())));
        assert_eq!(split_url("http://example.com:23119/"), None);
        assert_eq!(split_url("https://127.0.0.1/"), None);
    }

    #[test]
    fn chunked_bodies() {
        assert_eq!(dechunk(b"3\r\nabc\r\n2\r\nde\r\n0\r\n\r\n"), b"abcde");
    }
}
