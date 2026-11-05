//! JSON for the MCP stack, as Python's `json` module reads and writes it:
//! objects keep their key order (serde_json's map sorts them), numbers keep
//! the text they arrived as, and `dumps` escapes non-ASCII the way
//! `json.dumps(ensure_ascii=True)` does, with its ", " / ": " separators.
//! Tool results travel webview → bridge → stdio server → host, and the
//! host shows the model that text.

#[derive(Clone, Debug, PartialEq)]
pub enum J {
    Null,
    Bool(bool),
    /// The number's source text (JSON never needs re-formatting it).
    Num(String),
    Str(String),
    Arr(Vec<J>),
    Obj(Vec<(String, J)>),
}

impl J {
    pub fn s(v: impl Into<String>) -> J {
        J::Str(v.into())
    }

    pub fn int(v: i64) -> J {
        J::Num(v.to_string())
    }

    pub fn obj(pairs: Vec<(&str, J)>) -> J {
        J::Obj(pairs.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
    }

    /// dict.get(key) for an object; None for anything else.
    pub fn get(&self, key: &str) -> Option<&J> {
        match self {
            J::Obj(pairs) => pairs.iter().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            J::Str(s) => Some(s),
            _ => None,
        }
    }

    pub fn is_obj(&self) -> bool {
        matches!(self, J::Obj(_))
    }

    /// Python's bool(value).
    pub fn truthy(&self) -> bool {
        match self {
            J::Null => false,
            J::Bool(b) => *b,
            J::Num(n) => n.parse::<f64>().map(|v| v != 0.0).unwrap_or(true),
            J::Str(s) => !s.is_empty(),
            J::Arr(a) => !a.is_empty(),
            J::Obj(o) => !o.is_empty(),
        }
    }

    /// dict.pop(key)
    pub fn pop(&mut self, key: &str) -> Option<J> {
        match self {
            J::Obj(pairs) => {
                let i = pairs.iter().position(|(k, _)| k == key)?;
                Some(pairs.remove(i).1)
            }
            _ => None,
        }
    }

    /// d[key] = value, keeping the key's place when it exists.
    pub fn set(&mut self, key: &str, value: J) {
        if let J::Obj(pairs) = self {
            if let Some(slot) = pairs.iter_mut().find(|(k, _)| k == key) {
                slot.1 = value;
            } else {
                pairs.push((key.to_string(), value));
            }
        }
    }

    /// str(value): a string as itself, anything else as its JSON.
    pub fn py_str(&self) -> String {
        match self {
            J::Str(s) => s.clone(),
            J::Null => "None".into(),
            J::Bool(true) => "True".into(),
            J::Bool(false) => "False".into(),
            other => dumps(other, None),
        }
    }
}

// ---------------------------------------------------------------- parsing

pub fn parse(text: &str) -> Result<J, String> {
    let mut p = Parser { s: text.as_bytes(), i: 0 };
    p.ws();
    let v = p.value(0)?;
    p.ws();
    if p.i != p.s.len() {
        return Err(format!("Extra data: line 1 column {} (char {})", p.i + 1, p.i));
    }
    Ok(v)
}

struct Parser<'a> {
    s: &'a [u8],
    i: usize,
}

impl Parser<'_> {
    fn err<T>(&self, what: &str) -> Result<T, String> {
        Err(format!("{what}: char {}", self.i))
    }

    fn ws(&mut self) {
        while self.i < self.s.len() && matches!(self.s[self.i], b' ' | b'\t' | b'\n' | b'\r') {
            self.i += 1;
        }
    }

    fn eat(&mut self, lit: &str) -> bool {
        if self.s[self.i..].starts_with(lit.as_bytes()) {
            self.i += lit.len();
            true
        } else {
            false
        }
    }

    fn value(&mut self, depth: usize) -> Result<J, String> {
        if depth > 512 {
            return self.err("Nesting too deep");
        }
        match self.s.get(self.i) {
            None => self.err("Expecting value"),
            Some(b'{') => {
                self.i += 1;
                let mut pairs = Vec::new();
                self.ws();
                if self.s.get(self.i) == Some(&b'}') {
                    self.i += 1;
                    return Ok(J::Obj(pairs));
                }
                loop {
                    self.ws();
                    if self.s.get(self.i) != Some(&b'"') {
                        return self.err("Expecting property name enclosed in double quotes");
                    }
                    let k = self.string()?;
                    self.ws();
                    if self.s.get(self.i) != Some(&b':') {
                        return self.err("Expecting ':' delimiter");
                    }
                    self.i += 1;
                    self.ws();
                    let v = self.value(depth + 1)?;
                    // Python keeps the last of duplicate keys, in the first's place.
                    if let Some(slot) = pairs.iter_mut().find(|(pk, _): &&mut (String, J)| *pk == k) {
                        slot.1 = v;
                    } else {
                        pairs.push((k, v));
                    }
                    self.ws();
                    match self.s.get(self.i) {
                        Some(b',') => self.i += 1,
                        Some(b'}') => {
                            self.i += 1;
                            return Ok(J::Obj(pairs));
                        }
                        _ => return self.err("Expecting ',' delimiter"),
                    }
                }
            }
            Some(b'[') => {
                self.i += 1;
                let mut items = Vec::new();
                self.ws();
                if self.s.get(self.i) == Some(&b']') {
                    self.i += 1;
                    return Ok(J::Arr(items));
                }
                loop {
                    self.ws();
                    items.push(self.value(depth + 1)?);
                    self.ws();
                    match self.s.get(self.i) {
                        Some(b',') => self.i += 1,
                        Some(b']') => {
                            self.i += 1;
                            return Ok(J::Arr(items));
                        }
                        _ => return self.err("Expecting ',' delimiter"),
                    }
                }
            }
            Some(b'"') => Ok(J::Str(self.string()?)),
            Some(b't') if self.eat("true") => Ok(J::Bool(true)),
            Some(b'f') if self.eat("false") => Ok(J::Bool(false)),
            Some(b'n') if self.eat("null") => Ok(J::Null),
            Some(b'N') if self.eat("NaN") => Ok(J::Num("NaN".into())),
            Some(b'I') if self.eat("Infinity") => Ok(J::Num("Infinity".into())),
            Some(c) if *c == b'-' || c.is_ascii_digit() => self.number(),
            _ => self.err("Expecting value"),
        }
    }

    fn number(&mut self) -> Result<J, String> {
        let start = self.i;
        if self.eat("-Infinity") {
            return Ok(J::Num("-Infinity".into()));
        }
        if self.s[self.i] == b'-' {
            self.i += 1;
        }
        let digits = |p: &mut Self| {
            let a = p.i;
            while p.i < p.s.len() && p.s[p.i].is_ascii_digit() {
                p.i += 1;
            }
            p.i > a
        };
        if !digits(self) {
            return self.err("Expecting value");
        }
        if self.s.get(self.i) == Some(&b'.') {
            self.i += 1;
            if !digits(self) {
                return self.err("Expecting value");
            }
        }
        if matches!(self.s.get(self.i), Some(b'e' | b'E')) {
            self.i += 1;
            if matches!(self.s.get(self.i), Some(b'+' | b'-')) {
                self.i += 1;
            }
            if !digits(self) {
                return self.err("Expecting value");
            }
        }
        Ok(J::Num(String::from_utf8_lossy(&self.s[start..self.i]).into_owned()))
    }

    fn hex4(&mut self) -> Result<u32, String> {
        let h = self.s.get(self.i..self.i + 4).ok_or("Invalid \\uXXXX escape")?;
        let v = u32::from_str_radix(std::str::from_utf8(h).map_err(|e| e.to_string())?, 16)
            .map_err(|_| format!("Invalid \\uXXXX escape: char {}", self.i))?;
        self.i += 4;
        Ok(v)
    }

    fn string(&mut self) -> Result<String, String> {
        self.i += 1; // opening quote
        let mut out: Vec<u8> = Vec::new();
        loop {
            let Some(&c) = self.s.get(self.i) else {
                return self.err("Unterminated string starting at");
            };
            self.i += 1;
            match c {
                b'"' => break,
                b'\\' => {
                    let Some(&e) = self.s.get(self.i) else {
                        return self.err("Unterminated string starting at");
                    };
                    self.i += 1;
                    let ch = match e {
                        b'"' => '"',
                        b'\\' => '\\',
                        b'/' => '/',
                        b'b' => '\u{8}',
                        b'f' => '\u{c}',
                        b'n' => '\n',
                        b'r' => '\r',
                        b't' => '\t',
                        b'u' => {
                            let hi = self.hex4()?;
                            let code = if (0xD800..0xDC00).contains(&hi) && self.s[self.i..].starts_with(b"\\u") {
                                let save = self.i;
                                self.i += 2;
                                let lo = self.hex4()?;
                                if (0xDC00..0xE000).contains(&lo) {
                                    0x10000 + ((hi - 0xD800) << 10) + (lo - 0xDC00)
                                } else {
                                    self.i = save;
                                    hi
                                }
                            } else {
                                hi
                            };
                            // A lone surrogate has no Rust char; it becomes U+FFFD.
                            char::from_u32(code).unwrap_or('\u{FFFD}')
                        }
                        _ => return self.err("Invalid \\escape"),
                    };
                    let mut buf = [0u8; 4];
                    out.extend_from_slice(ch.encode_utf8(&mut buf).as_bytes());
                }
                c if c < 0x20 => return self.err("Invalid control character at"),
                c => out.push(c),
            }
        }
        Ok(String::from_utf8_lossy(&out).into_owned())
    }
}

// ---------------------------------------------------------------- writing

/// json.dumps(value) (indent None) or json.dumps(value, indent=n).
pub fn dumps(v: &J, indent: Option<usize>) -> String {
    let mut out = String::new();
    write(&mut out, v, indent, 0);
    out
}

fn write(out: &mut String, v: &J, indent: Option<usize>, level: usize) {
    match v {
        J::Null => out.push_str("null"),
        J::Bool(true) => out.push_str("true"),
        J::Bool(false) => out.push_str("false"),
        J::Num(n) => out.push_str(n),
        J::Str(s) => write_str(out, s),
        J::Arr(items) if items.is_empty() => out.push_str("[]"),
        J::Obj(pairs) if pairs.is_empty() => out.push_str("{}"),
        J::Arr(items) => {
            out.push('[');
            for (i, it) in items.iter().enumerate() {
                sep(out, indent, level + 1, i == 0);
                write(out, it, indent, level + 1);
            }
            close(out, indent, level);
            out.push(']');
        }
        J::Obj(pairs) => {
            out.push('{');
            for (i, (k, it)) in pairs.iter().enumerate() {
                sep(out, indent, level + 1, i == 0);
                write_str(out, k);
                out.push_str(": ");
                write(out, it, indent, level + 1);
            }
            close(out, indent, level);
            out.push('}');
        }
    }
}

fn sep(out: &mut String, indent: Option<usize>, level: usize, first: bool) {
    match indent {
        Some(n) => {
            if !first {
                out.push(',');
            }
            out.push('\n');
            out.extend(std::iter::repeat_n(' ', n * level));
        }
        None => {
            if !first {
                out.push_str(", ");
            }
        }
    }
}

fn close(out: &mut String, indent: Option<usize>, level: usize) {
    if let Some(n) = indent {
        out.push('\n');
        out.extend(std::iter::repeat_n(' ', n * level));
    }
}

fn write_str(out: &mut String, s: &str) {
    out.push('"');
    for ch in s.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            // json.dumps escapes everything outside ' '..'~' (DEL included).
            c if (c as u32) < 0x20 || (c as u32) > 0x7e => {
                let mut buf = [0u16; 2];
                for unit in c.encode_utf16(&mut buf) {
                    out.push_str(&format!("\\u{:04x}", unit));
                }
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_key_order_and_number_text() {
        let v = parse(r#"{"z": 1.0, "a": [1, 2.50, -3e2], "m": {}}"#).unwrap();
        assert_eq!(dumps(&v, None), r#"{"z": 1.0, "a": [1, 2.50, -3e2], "m": {}}"#);
    }

    #[test]
    fn dumps_like_python_ensure_ascii() {
        let v = J::obj(vec![("t", J::s("café — \u{1F600}\n\"x\"\u{1}"))]);
        assert_eq!(dumps(&v, None), r#"{"t": "caf\u00e9 \u2014 \ud83d\ude00\n\"x\"\u0001"}"#);
    }

    #[test]
    fn indent_matches_python() {
        let v = parse(r#"{"a": [1, {"b": null}], "c": [], "d": "x"}"#).unwrap();
        assert_eq!(dumps(&v, Some(2)),
            "{\n  \"a\": [\n    1,\n    {\n      \"b\": null\n    }\n  ],\n  \"c\": [],\n  \"d\": \"x\"\n}");
    }

    #[test]
    fn parses_escapes_and_surrogates() {
        let v = parse(r#""\u00e9\ud83d\ude00\/""#).unwrap();
        assert_eq!(v, J::s("é\u{1F600}/"));
        assert!(parse("{\"a\" 1}").is_err());
        assert!(parse("[1,]").is_err());
    }

    #[test]
    fn truthiness() {
        assert!(!J::Null.truthy());
        assert!(!J::Num("0.0".into()).truthy());
        assert!(J::s("x").truthy());
        assert!(!J::Obj(vec![]).truthy());
    }
}
