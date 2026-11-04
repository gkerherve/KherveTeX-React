//! Per-document Git repo with auto-commit on save: a port of
//! khervedoc/git_backend.py over git2-rs (libgit2, as pygit2 is).
//!
//! Each document lives in a directory that is also its own git repo. The
//! committed artifacts are the human-readable files (`document.tex`, the
//! `.ktex`), not the internal model — so `git diff` is meaningful.
//!
//! Every function keeps the Python one's name, arguments, return shape and
//! user-facing messages; the Tauri commands at the bottom are thin wrappers
//! run off the main thread (a push to a dead remote can block for 30+ s).

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use chrono::{Local, TimeZone};
use git2::{
    build::CheckoutBuilder, BranchType, Commit, Cred, CredentialType, DiffFormat, DiffOptions,
    ErrorCode, FetchOptions, IndexAddOption, Oid, PushOptions, RemoteCallbacks,
    Repository, Signature, Sort, Time,
};
use serde::Serialize;

pub fn is_available() -> bool {
    true
}

/// Walk up the directory tree; if any ancestor has a .git, return that
/// ancestor. Used to detect when a save would create a nested repo inside
/// an existing one (which was the source of the rogue "master"-branch
/// auto-commit history).
pub fn find_enclosing_repo(repo_dir: &Path) -> Option<PathBuf> {
    let mut cur = resolve(repo_dir);
    // pathlib: `while cur != cur.parent` — the filesystem root is not checked.
    while let Some(parent) = cur.parent() {
        if cur.join(".git").exists() {
            return Some(cur);
        }
        cur = parent.to_path_buf();
    }
    None
}

/// Path.resolve(strict=False): symlinks resolved as far as the path exists.
fn resolve(p: &Path) -> PathBuf {
    if let Ok(c) = fs::canonicalize(p) {
        return c;
    }
    let abs = if p.is_absolute() {
        p.to_path_buf()
    } else {
        std::env::current_dir().map(|d| d.join(p)).unwrap_or_else(|_| p.to_path_buf())
    };
    match (abs.parent(), abs.file_name()) {
        (Some(parent), Some(name)) => resolve(parent).join(name),
        _ => abs,
    }
}

/// Initialise a git repo in `repo_dir` if one doesn't already exist.
///
/// - If `repo_dir` is already a repo, return true (no-op).
/// - If `repo_dir` is INSIDE another git repo, use that parent repo
///   instead of nesting — saves there should commit to the enclosing
///   repo's current branch, not a new "master" branch under a hidden
///   `.git` directory.
/// - Otherwise initialise a fresh repo with HEAD pointing to
///   `refs/heads/dev`, matching the project's branching convention.
pub fn init_repo(repo_dir: &Path) -> bool {
    if fs::create_dir_all(repo_dir).is_err() {
        return false;
    }
    if repo_dir.join(".git").exists() {
        return true;
    }
    if find_enclosing_repo(repo_dir).is_some() {
        // Don't create a nested repo. commit_all still works because it
        // walks up from repo_dir to find the enclosing .git.
        return true;
    }
    if Repository::init(repo_dir).is_err() {
        return false;
    }
    // libgit2 defaults the unborn HEAD to refs/heads/master; rewrite it so
    // the very first commit lands on `dev` instead.
    fs::write(repo_dir.join(".git").join("HEAD"), "ref: refs/heads/dev\n").is_ok()
}

/// The Repository governing `repo_dir`, walking up to find an enclosing
/// one if `repo_dir` itself isn't a repo root.
///
/// None on transient errors (e.g. OneDrive holding a file lock on
/// .git/index) so the caller degrades gracefully instead of crashing.
fn repo_for(repo_dir: &Path) -> Option<Repository> {
    if repo_dir.join(".git").exists() {
        return Repository::open(repo_dir).ok();
    }
    let enclosing = find_enclosing_repo(repo_dir)?;
    Repository::open(enclosing).ok()
}

fn head_is_unborn(repo: &Repository) -> bool {
    match repo.head() {
        Ok(_) => false,
        Err(e) => matches!(e.code(), ErrorCode::UnbornBranch | ErrorCode::NotFound),
    }
}

/// A commit signature, preferring the user's real git identity.
///
/// Order:
///   1. repo.signature() (libgit2's git_signature_default, pygit2's
///      repo.default_signature) — reads user.name/user.email from
///      .git/config, the user's global config, or the system config (the
///      same chain plain `git commit` uses, so auto-commits look identical
///      to CLI commits).
///   2. Hard-coded fallback only if no git identity is configured anywhere.
pub fn signature(repo: Option<&Repository>) -> Signature<'static> {
    if let Some(r) = repo {
        if let Ok(sig) = r.signature() {
            return sig;
        }
    }
    let now = chrono::Utc::now().timestamp();
    Signature::new("KherveTeX", "khervedoc@local", &Time::new(now, 0))
        .expect("a valid fallback signature")
}

/// datetime.now().isoformat(timespec='seconds')
fn now_iso() -> String {
    Local::now().format("%Y-%m-%dT%H:%M:%S").to_string()
}

/// datetime.fromtimestamp(t).isoformat(timespec='seconds'): local time.
fn iso_local(t: i64) -> String {
    match Local.timestamp_opt(t, 0).single() {
        Some(d) => d.format("%Y-%m-%dT%H:%M:%S").to_string(),
        None => String::new(),
    }
}

/// Stage files in `repo_dir` and create a commit.
///
/// When `file_stem` is given only files whose name starts with that stem
/// are staged (e.g. "My report" stages `My report.ktex`, `My report.tex`,
/// `My report.ktex.json`). Otherwise every tracked + new file is staged.
///
/// The new commit's hex OID, or None if nothing changed.
pub fn commit_all(repo_dir: &Path, message: Option<&str>, file_stem: Option<&str>) -> Option<String> {
    init_repo(repo_dir);
    let repo = repo_for(repo_dir)?;
    let mut index = repo.index().ok()?;
    match file_stem.filter(|s| !s.is_empty()) {
        Some(stem) => {
            let repo_root = resolve(repo.workdir()?);
            // The readable .tex lives in the hidden .kherve/ working folder.
            let work = repo_dir.join(".kherve");
            let mut candidates: Vec<PathBuf> = list_entries(&repo_root);
            if work.is_dir() {
                candidates.extend(list_entries(&work));
            }
            for p in candidates {
                let name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                if name.starts_with(stem) && p.is_file() {
                    // Path relative to the repo root for index.add.
                    let Ok(rel) = resolve(&p).strip_prefix(&repo_root).map(Path::to_path_buf) else {
                        continue;
                    };
                    let rel = rel.to_string_lossy().replace('\\', "/");
                    index.add_path(Path::new(&rel)).ok()?;
                }
            }
        }
        None => {
            index.add_all(Vec::<&str>::new(), IndexAddOption::DEFAULT, None).ok()?;
        }
    }
    index.write().ok()?;

    // Detect "no changes" by comparing the new tree against HEAD's tree.
    let new_tree_oid = index.write_tree().ok()?;
    let unborn = head_is_unborn(&repo);
    let mut parents: Vec<Commit> = Vec::new();
    let mut update_ref = "HEAD".to_string();
    if !unborn {
        let head = repo.head().ok()?;
        update_ref = head.name().unwrap_or("HEAD").to_string();
        let head_commit = head.peel_to_commit().ok()?;
        if head_commit.tree_id() == new_tree_oid {
            return None;
        }
        parents.push(head_commit);
    }
    let sig = signature(Some(&repo));
    let msg = match message.filter(|m| !m.is_empty()) {
        Some(m) => m.to_string(),
        None => format!("Edit at {}", now_iso()),
    };
    let tree = repo.find_tree(new_tree_oid).ok()?;
    let parent_refs: Vec<&Commit> = parents.iter().collect();
    let oid = repo.commit(Some(&update_ref), &sig, &sig, &msg, &tree, &parent_refs).ok()?;
    Some(oid.to_string())
}

fn list_entries(dir: &Path) -> Vec<PathBuf> {
    match fs::read_dir(dir) {
        Ok(rd) => rd.filter_map(|e| e.ok().map(|e| e.path())).collect(),
        Err(_) => Vec::new(),
    }
}

/// pygit2.KeypairFromAgent("git"): SSH-agent credentials. pygit2 rejects a
/// credential the transport did not ask for ("credential type not
/// allowed"), and the agent is tried once, not in a loop.
fn agent_callbacks<'a>() -> RemoteCallbacks<'a> {
    let mut cb = RemoteCallbacks::new();
    let mut tried = false;
    cb.credentials(move |_url, _user, allowed| {
        if !allowed.contains(CredentialType::SSH_KEY) {
            return Err(git2::Error::from_str("invalid credential type"));
        }
        if tried {
            return Err(git2::Error::from_str("SSH agent authentication failed"));
        }
        tried = true;
        Cred::ssh_key_from_agent("git")
    });
    cb
}

/// Python's repr() of a str, as the messages quote names with !r.
fn py_repr(s: &str) -> String {
    if s.contains('\'') && !s.contains('"') {
        format!("\"{s}\"")
    } else {
        format!("'{}'", s.replace('\\', "\\\\").replace('\'', "\\'"))
    }
}

/// [(name, url), ...] for every remote configured in the repo. Empty if
/// there is no repo — callers use that to detect "remote needs configuring".
pub fn get_remotes(repo_dir: &Path) -> Vec<(String, String)> {
    let Some(repo) = repo_for(repo_dir) else { return Vec::new() };
    remote_names(&repo)
        .into_iter()
        .filter_map(|n| {
            let r = repo.find_remote(&n).ok()?;
            let url = String::from_utf8_lossy(r.url_bytes()).into_owned();
            Some((n, url))
        })
        .collect()
}

/// git_remote_list: the configured remote names, sorted.
fn remote_names(repo: &Repository) -> Vec<String> {
    match repo.remotes() {
        Ok(a) => a.iter_bytes().map(|b| String::from_utf8_lossy(b).into_owned()).collect(),
        Err(_) => Vec::new(),
    }
}

/// Add a remote or update its URL if it already exists. The repo is
/// created on demand so a fresh document can be wired up to a GitHub URL
/// before its first save.
pub fn set_remote(repo_dir: &Path, name: &str, url: &str) -> bool {
    if name.is_empty() || url.is_empty() {
        return false;
    }
    init_repo(repo_dir);
    let Some(repo) = repo_for(repo_dir) else { return false };
    let existing = remote_names(&repo);
    if existing.iter().any(|n| n == name) {
        repo.remote_set_url(name, url).is_ok()
    } else {
        repo.remote(name, url).is_ok()
    }
}

pub fn remove_remote(repo_dir: &Path, name: &str) -> bool {
    let Some(repo) = repo_for(repo_dir) else { return false };
    repo.remote_delete(name).is_ok()
}

/// Short name of the current branch (e.g. "dev"), or None if the repo is
/// detached / unborn / missing.
pub fn current_branch(repo_dir: &Path) -> Option<String> {
    let repo = repo_for(repo_dir)?;
    if head_is_unborn(&repo) || repo.head_detached().unwrap_or(false) {
        return None;
    }
    let head = repo.head().ok()?;
    let name = head.name().ok()?; // "refs/heads/dev"
    Some(name.strip_prefix("refs/heads/").unwrap_or(name).to_string())
}

/// Fetch from `remote_name` and fast-forward the current branch to match
/// its upstream. (success, message) — a short line for the status bar /
/// dialog: "Already up to date.", "Pulled 3 commits from origin/dev.", ...
///
/// Only fast-forward merges, deliberately: if a real merge is needed the
/// user should drop to the command line. The auto-commit on save means
/// three-way merges from inside the GUI would be too easy to misuse and
/// lose work.
pub fn pull(repo_dir: &Path, remote_name: &str) -> (bool, String) {
    let Some(repo) = repo_for(repo_dir) else {
        return (false, "Not a git repository.".into());
    };
    let Ok(mut remote) = repo.find_remote(remote_name) else {
        return (false, format!("No remote named {} is configured.", py_repr(remote_name)));
    };

    // ---- fetch ----
    let mut last = String::new();
    let mut fetched = false;
    for with_agent in [true, false] {
        let mut fo = FetchOptions::new();
        if with_agent {
            fo.remote_callbacks(agent_callbacks());
        }
        match remote.fetch(&[] as &[&str], Some(&mut fo), None) {
            Ok(()) => {
                fetched = true;
                break;
            }
            Err(e) => last = e.message().to_string(),
        }
    }
    if !fetched {
        return (false, format!("Fetch failed: {last}"));
    }

    // ---- locate upstream ref ----
    let Some(branch) = current_branch(repo_dir) else {
        return (false, "Repository has no current branch.".into());
    };
    let upstream_ref = format!("refs/remotes/{remote_name}/{branch}");
    let Some(upstream_oid) = repo.find_reference(&upstream_ref).ok().and_then(|r| r.target()) else {
        return (
            false,
            format!("Remote {} has no branch {} to pull from.", py_repr(remote_name), py_repr(&branch)),
        );
    };

    // ---- fast-forward ----
    let head = match repo.head() {
        Ok(h) => h,
        Err(e) => return (false, format!("Fast-forward failed: {}", e.message())),
    };
    let head_name = head.name().unwrap_or("HEAD").to_string();
    let Some(head_oid) = head.target() else {
        return (false, "Repository has no current branch.".into());
    };
    if head_oid == upstream_oid {
        return (true, "Already up to date.".into());
    }
    let analysis = repo
        .find_annotated_commit(upstream_oid)
        .and_then(|ann| repo.merge_analysis(&[&ann]).map(|(a, _)| a));
    let analysis = match analysis {
        Ok(a) => a,
        Err(e) => return (false, format!("Fast-forward failed: {}", e.message())),
    };
    if analysis.is_up_to_date() {
        return (true, "Already up to date.".into());
    }
    if !analysis.is_fast_forward() {
        return (
            false,
            "Local branch has diverged from the remote — KherveTeX only \
             fast-forwards. Resolve the merge from a terminal."
                .into(),
        );
    }
    // Count incoming commits for a nicer status message. `hide` stops the
    // walker at head_oid AND skips its ancestors, so the count is exactly
    // "how many new commits this pull brings in".
    let incoming = match repo.revwalk() {
        Ok(mut w) => {
            let _ = w.set_sorting(Sort::NONE);
            let _ = w.push(upstream_oid);
            let _ = w.hide(head_oid);
            w.count()
        }
        Err(_) => 0,
    };
    let ff = (|| -> Result<(), git2::Error> {
        let obj = repo.find_object(upstream_oid, None)?;
        repo.checkout_tree(&obj, Some(CheckoutBuilder::new().safe()))?;
        repo.find_reference(&head_name)?.set_target(upstream_oid, "pull: fast-forward")?;
        repo.set_head(&head_name)?;
        Ok(())
    })();
    if let Err(e) = ff {
        return (false, format!("Fast-forward failed: {}", e.message()));
    }
    let plural = if incoming == 1 { "" } else { "s" };
    (true, format!("Pulled {incoming} commit{plural} from {remote_name}/{branch}."))
}

/// True if the user has the system `git` CLI on PATH. HTTPS push is
/// delegated to it when libgit2 can't authenticate, because system git
/// talks to Windows Credential Manager / macOS Keychain / git credential
/// helpers transparently.
pub fn system_git_available() -> bool {
    crate::process::which("git").is_some()
}

/// `git push <remote> <ref>` via the CLI. stdout and stderr are captured to
/// surface a useful error — most GitHub HTTPS failures end with a single
/// "remote: ..." or "fatal: Authentication failed for ..." line that the
/// user actually needs to read.
fn git_cli_push(repo_dir: &Path, remote_name: &str, refname: &str) -> (bool, String) {
    let r = crate::process::run_blocking(
        "git",
        &["push".into(), remote_name.into(), refname.into()],
        repo_dir.to_str(),
        None,
        Duration::from_secs(60),
    );
    if r.timed_out {
        return (false, "git push timed out after 60s.".into());
    }
    if r.error.is_some() {
        return (false, "System git is not on PATH.".into());
    }
    if r.code == Some(0) {
        return (true, format!("Pushed to {remote_name}."));
    }
    // Distil the most useful line from stderr.
    let err = if !r.stderr.is_empty() { &r.stderr } else { &r.stdout };
    let err = err.trim();
    for line in err.lines().rev() {
        let line = line.trim();
        if line.starts_with("fatal:") || line.starts_with("error:") || line.starts_with("remote:") {
            return (false, line.to_string());
        }
    }
    match err.lines().last() {
        Some(l) => (false, l.to_string()),
        None => (false, format!("git push exited with code {}.", r.code.unwrap_or(-1))),
    }
}

/// Push the current branch to `remote_name`. (ok, message).
///
/// Strategy:
///   1. libgit2 with SSH-agent credentials (works for git@ URLs).
///   2. libgit2 with no callbacks (works for some HTTPS setups).
///   3. If both fail AND the system `git` CLI is available, `git push`.
///      This is what saves GitHub-over-HTTPS users on Windows — libgit2
///      doesn't talk to Windows Credential Manager, but the system git
///      does, so a Personal Access Token stored there just works.
///
/// The message is for the user — the actual error from git (e.g. "fatal:
/// Authentication failed for https://github.com/…") when one is
/// available, not a generic "upload failed".
pub fn push(repo_dir: &Path, remote_name: &str) -> (bool, String) {
    if !repo_dir.join(".git").exists() {
        return (false, "Not a git repository.".into());
    }
    let mut libgit2_err = String::new();
    let mut head_ref: Option<String> = None;
    let mut remote_url = String::new();
    match Repository::open(repo_dir) {
        Ok(repo) => {
            let Ok(mut remote) = repo.find_remote(remote_name) else {
                return (false, format!("No remote named {} is configured.", py_repr(remote_name)));
            };
            remote_url = String::from_utf8_lossy(remote.url_bytes()).into_owned();
            if head_is_unborn(&repo) {
                return (false, "Repository has no commits yet — save first.".into());
            }
            match repo.head() {
                Ok(h) => {
                    let name = h.name().unwrap_or("HEAD").to_string(); // "refs/heads/dev"
                    let refspec = format!("{name}:{name}");
                    head_ref = Some(name);
                    for with_agent in [true, false] {
                        let mut po = PushOptions::new();
                        if with_agent {
                            po.remote_callbacks(agent_callbacks());
                        }
                        match remote.push(&[refspec.as_str()], Some(&mut po)) {
                            Ok(()) => return (true, format!("Pushed to {remote_name}.")),
                            Err(e) => libgit2_err = e.message().to_string(),
                        }
                    }
                }
                Err(e) => libgit2_err = e.message().to_string(),
            }
        }
        Err(e) => libgit2_err = e.message().to_string(),
    }

    // Attempt 3: the system git CLI. Most useful for HTTPS URLs on
    // Windows, where libgit2 has no Credential Manager hookup.
    if let Some(r) = head_ref.as_deref() {
        if system_git_available() {
            // Surface the CLI's error either way: it is more actionable.
            return git_cli_push(repo_dir, remote_name, r);
        }
    }

    // No git CLI available — hand back libgit2's complaint with a hint
    // about credentials.
    let hint = if remote_url.starts_with("http") {
        " Tip: GitHub no longer accepts passwords over HTTPS — \
         install Git for Windows so the system credential \
         manager handles your Personal Access Token, or switch \
         the remote URL to SSH (git@github.com:…)."
    } else {
        ""
    };
    (false, format!("Push failed: {libgit2_err}.{hint}"))
}

/// pygit2's repo.get(key): an object by full or abbreviated hex id, None
/// when the id is not hex, ambiguous or unknown.
fn get_object<'r>(repo: &'r Repository, oid: &str) -> Option<git2::Object<'r>> {
    if oid.len() == 40 {
        let id = Oid::from_str(oid).ok()?;
        return repo.find_object(id, None).ok();
    }
    repo.find_object_by_prefix(oid, None).ok()
}

fn short8(s: &str) -> &str {
    match s.char_indices().nth(8) {
        Some((i, _)) => &s[..i],
        None => s,
    }
}

/// Reset the working tree files to their state at `oid`. Does NOT move
/// HEAD — the history stays intact; this is a "load this older version
/// into the editor" operation, not a rebase. The user can then edit and
/// save, which auto-commits the restored contents as a new commit on top.
///
/// With `paths` only those files are restored; with None every tracked
/// file at `oid` is.
pub fn restore_to_commit(repo_dir: &Path, oid: &str, paths: Option<&[String]>) -> (bool, String) {
    let Some(repo) = repo_for(repo_dir) else {
        return (false, "Not a git repository.".into());
    };
    let Some(obj) = get_object(&repo, oid) else {
        return (false, format!("Commit {} not found.", py_repr(short8(oid))));
    };
    let tree = match obj.peel_to_commit().and_then(|c| c.tree()) {
        Ok(t) => t,
        Err(e) => return (false, format!("Could not read commit: {}", e.message())),
    };
    let result = (|| -> Result<(), String> {
        match paths.filter(|p| !p.is_empty()) {
            Some(paths) => {
                // Restore only the listed paths from the commit's tree.
                for p in paths {
                    let Ok(entry) = tree.get_path(Path::new(p)) else {
                        continue; // path didn't exist at that commit
                    };
                    let Ok(blob) = repo.find_blob(entry.id()) else { continue };
                    let target = repo_dir.join(p);
                    if let Some(parent) = target.parent() {
                        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                    }
                    fs::write(&target, blob.content()).map_err(|e| e.to_string())?;
                }
            }
            None => {
                // Whole-tree checkout, but DON'T move HEAD: FORCE |
                // RECREATE_MISSING rewrites the working tree to match.
                let mut cb = CheckoutBuilder::new();
                cb.force().recreate_missing(true);
                repo.checkout_tree(tree.as_object(), Some(&mut cb)).map_err(|e| e.message().to_string())?;
            }
        }
        Ok(())
    })();
    if let Err(e) = result {
        return (false, format!("Restore failed: {e}"));
    }
    (true, format!("Restored files to {}.", short8(oid)))
}

/// Python's str.isspace for one character.
fn py_isspace(c: char) -> bool {
    c.is_whitespace() || ('\x1c'..='\x1f').contains(&c)
}

/// Python's str.splitlines().
fn py_splitlines(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\r' => {
                if chars.peek() == Some(&'\n') {
                    chars.next();
                }
                out.push(std::mem::take(&mut cur));
            }
            '\n' | '\x0b' | '\x0c' | '\x1c' | '\x1d' | '\x1e' | '\u{85}' | '\u{2028}' | '\u{2029}' => {
                out.push(std::mem::take(&mut cur));
            }
            _ => cur.push(c),
        }
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

fn message_of(commit: &Commit) -> String {
    String::from_utf8_lossy(commit.message_bytes()).into_owned()
}

/// (subject, body) as history_detailed splits a message.
fn subject_body(commit: &Commit) -> (String, String) {
    let msg = message_of(commit);
    let msg = msg.trim_end_matches(py_isspace);
    let lines = py_splitlines(msg);
    let subject = lines.first().cloned().unwrap_or_default();
    let body = if lines.len() > 1 { lines[1..].join("\n").trim_matches('\n').to_string() } else { String::new() };
    (subject, body)
}

fn author_of(commit: &Commit) -> String {
    let a = commit.author();
    format!(
        "{} <{}>",
        String::from_utf8_lossy(a.name_bytes()),
        String::from_utf8_lossy(a.email_bytes())
    )
}

/// [(short_oid, iso_time, message_first_line), ...] newest first.
pub fn history(repo_dir: &Path, limit: usize) -> Vec<(String, String, String)> {
    if !repo_dir.join(".git").exists() {
        return Vec::new();
    }
    let Some(repo) = repo_for(repo_dir) else { return Vec::new() };
    let mut out = Vec::new();
    for commit in walk_head(&repo) {
        let msg = message_of(&commit);
        let first = py_splitlines(&msg).into_iter().next().unwrap_or_default();
        out.push((short8(&commit.id().to_string()).to_string(), iso_local(commit.time().seconds()), first));
        if out.len() >= limit {
            break;
        }
    }
    out
}

/// repo.walk(repo.head.target, GIT_SORT_TIME); nothing while HEAD is unborn.
fn walk_head(repo: &Repository) -> Vec<Commit<'_>> {
    if head_is_unborn(repo) {
        return Vec::new();
    }
    let Some(target) = repo.head().ok().and_then(|h| h.target()) else { return Vec::new() };
    let Ok(mut w) = repo.revwalk() else { return Vec::new() };
    if w.set_sorting(Sort::TIME).is_err() || w.push(target).is_err() {
        return Vec::new();
    }
    w.filter_map(|id| id.ok().and_then(|id| repo.find_commit(id).ok())).collect()
}

#[derive(Serialize, Clone, Debug)]
pub struct CommitInfo {
    pub oid: String,
    pub short_oid: String,
    pub timestamp: String,
    pub epoch: i64,
    pub author: String,
    pub subject: String,
    pub body: String,
}

fn commit_info(commit: &Commit) -> CommitInfo {
    let oid = commit.id().to_string();
    let (subject, body) = subject_body(commit);
    CommitInfo {
        short_oid: oid[..8].to_string(),
        oid,
        timestamp: iso_local(commit.time().seconds()),
        epoch: commit.time().seconds(),
        author: author_of(commit),
        subject,
        body,
    }
}

/// The richer `history` for the GUI commit-browser, newest first. With
/// `file_stem` (e.g. "My report") only commits that touch a file whose
/// name starts with that stem. Empty if the repo has no commits.
pub fn history_detailed(repo_dir: &Path, limit: usize, file_stem: Option<&str>) -> Vec<CommitInfo> {
    if !repo_dir.join(".git").exists() {
        return Vec::new();
    }
    let Some(repo) = repo_for(repo_dir) else { return Vec::new() };
    let stem = file_stem.filter(|s| !s.is_empty());
    let mut out = Vec::new();
    for commit in walk_head(&repo) {
        if let Some(s) = stem {
            if !commit_touches_stem(&repo, &commit, s) {
                continue;
            }
        }
        out.push(commit_info(&commit));
        if out.len() >= limit {
            break;
        }
    }
    out
}

/// True if `commit` changed any file whose name starts with `stem`.
fn commit_touches_stem(repo: &Repository, commit: &Commit, stem: &str) -> bool {
    let Ok(tree) = commit.tree() else { return false };
    let Ok(parent) = commit.parent(0) else {
        // Root commit — check the tree for matching filenames.
        return tree.iter().any(|e| e.name().is_ok_and(|n| n.starts_with(stem)));
    };
    let Ok(ptree) = parent.tree() else { return false };
    let Ok(diff) = repo.diff_tree_to_tree(Some(&ptree), Some(&tree), None) else { return false };
    let base = |p: Option<&Path>| -> String {
        let s = p.map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
        s.rsplit('/').next().unwrap_or("").to_string()
    };
    diff.deltas()
        .any(|d| base(d.old_file().path()).starts_with(stem) || base(d.new_file().path()).starts_with(stem))
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct BranchInfo {
    pub name: String,
    #[serde(rename = "ref")]
    pub refname: String,
    pub oid: String,
    pub current: bool,
    pub remote: Option<String>,
}

/// Every reference name, in libgit2's order (pygit2's `repo.references`).
fn reference_names(repo: &Repository) -> Vec<String> {
    match repo.references() {
        Ok(refs) => refs.flatten().filter_map(|r| r.name().ok().map(String::from)).collect(),
        Err(_) => Vec::new(),
    }
}

fn peel_ref(repo: &Repository, name: &str) -> Option<Oid> {
    repo.find_reference(name).ok()?.peel_to_commit().ok().map(|c| c.id())
}

/// Every local and remote-tracking branch: name ("dev"), ref
/// ("refs/heads/dev"), oid, current (HEAD), remote (None for local ones).
pub fn list_branches(repo_dir: &Path) -> Vec<BranchInfo> {
    let Some(repo) = repo_for(repo_dir) else { return Vec::new() };
    let cur = current_branch(repo_dir);
    let mut out = Vec::new();
    for ref_name in reference_names(&repo) {
        if let Some(short) = ref_name.strip_prefix("refs/heads/") {
            let Some(oid) = peel_ref(&repo, &ref_name) else { continue };
            out.push(BranchInfo {
                name: short.to_string(),
                current: cur.as_deref() == Some(short),
                refname: ref_name.clone(),
                oid: oid.to_string(),
                remote: None,
            });
        } else if let Some(rest) = ref_name.strip_prefix("refs/remotes/") {
            if let Some((remote, branch)) = rest.split_once('/') {
                if branch != "HEAD" {
                    let Some(oid) = peel_ref(&repo, &ref_name) else { continue };
                    out.push(BranchInfo {
                        name: branch.to_string(),
                        refname: ref_name.clone(),
                        oid: oid.to_string(),
                        current: false,
                        remote: Some(remote.to_string()),
                    });
                }
            }
        }
    }
    out
}

/// A new local branch at `start_oid` (default HEAD). Does NOT switch to it.
pub fn create_branch(repo_dir: &Path, name: &str, start_oid: Option<&str>) -> (bool, String) {
    let Some(repo) = repo_for(repo_dir) else {
        return (false, "Not a git repository.".into());
    };
    if head_is_unborn(&repo) {
        return (false, "Repository has no commits yet — save first.".into());
    }
    let target = match start_oid.filter(|s| !s.is_empty()) {
        Some(s) => match get_object(&repo, s) {
            Some(o) => o.peel_to_commit(),
            // repo.get() returned None and .peel() raised on it.
            None => return (false, "'NoneType' object has no attribute 'peel'".into()),
        },
        None => repo.head().and_then(|h| h.peel_to_commit()),
    };
    match target.and_then(|t| repo.branch(name, &t, false)) {
        Ok(_) => (true, format!("Branch '{name}' created.")),
        Err(e) => (false, e.message().to_string()),
    }
}

/// HEAD to an existing local branch; working-tree files follow.
pub fn switch_branch(repo_dir: &Path, name: &str) -> (bool, String) {
    let Some(repo) = repo_for(repo_dir) else {
        return (false, "Not a git repository.".into());
    };
    let refname = format!("refs/heads/{name}");
    let Ok(branch_ref) = repo.find_reference(&refname) else {
        return (false, format!("Branch '{name}' does not exist."));
    };
    let r = (|| -> Result<(), git2::Error> {
        let commit = branch_ref.peel_to_commit()?;
        repo.checkout_tree(commit.as_object(), Some(CheckoutBuilder::new().safe()))?;
        repo.set_head(&refname)?;
        Ok(())
    })();
    match r {
        Ok(()) => (true, format!("Switched to branch '{name}'.")),
        Err(e) => (false, e.message().to_string()),
    }
}

/// Delete a local branch; never the current one.
pub fn delete_branch(repo_dir: &Path, name: &str) -> (bool, String) {
    let Some(repo) = repo_for(repo_dir) else {
        return (false, "Not a git repository.".into());
    };
    if current_branch(repo_dir).as_deref() == Some(name) {
        return (false, "Cannot delete the branch you are currently on.".into());
    }
    let mut branch = match repo.find_branch(name, BranchType::Local) {
        Ok(b) => b,
        Err(e) if e.code() == ErrorCode::NotFound => return (false, format!("Branch '{name}' does not exist.")),
        Err(e) => return (false, e.message().to_string()),
    };
    match branch.delete() {
        Ok(()) => (true, format!("Branch '{name}' deleted.")),
        Err(e) => (false, e.message().to_string()),
    }
}

#[derive(Serialize, Clone, Debug)]
pub struct GraphRow {
    #[serde(flatten)]
    pub info: CommitInfo,
    /// Full OIDs of the parent commits.
    pub parents: Vec<String>,
    /// Which column (0-based) this commit draws in.
    pub rail: usize,
    /// (from_rail, to_rail) active BEFORE / AFTER this row.
    pub rails_before: Vec<(usize, usize)>,
    pub rails_after: Vec<(usize, usize)>,
    /// Branch names that point at this commit.
    pub branches: Vec<String>,
    pub is_merge: bool,
}

/// The commit list with graph-rail info for the DAG view, newest first.
pub fn history_graph(repo_dir: &Path, limit: usize) -> Vec<GraphRow> {
    let Some(repo) = repo_for(repo_dir) else { return Vec::new() };
    if head_is_unborn(&repo) {
        return Vec::new();
    }
    let names = reference_names(&repo);

    // Branch tips, to label commits.
    let mut branch_map: HashMap<Oid, Vec<String>> = HashMap::new();
    for ref_name in &names {
        if let Some(short) = ref_name.strip_prefix("refs/heads/") {
            let Some(oid) = peel_ref(&repo, ref_name) else { continue };
            branch_map.entry(oid).or_default().push(short.to_string());
        } else if let Some(rest) = ref_name.strip_prefix("refs/remotes/") {
            if let Some((remote, branch)) = rest.split_once('/') {
                if branch != "HEAD" {
                    let Some(oid) = peel_ref(&repo, ref_name) else { continue };
                    branch_map.entry(oid).or_default().push(format!("{remote}/{branch}"));
                }
            }
        }
    }

    // Walk ALL refs so every branch shows, not just HEAD.
    let mut seen = std::collections::HashSet::new();
    let mut raw: Vec<Commit> = Vec::new();
    'refs: for ref_name in &names {
        let Some(tip) = peel_ref(&repo, ref_name) else { continue };
        let Ok(mut w) = repo.revwalk() else { continue };
        if w.set_sorting(Sort::TOPOLOGICAL | Sort::TIME).is_err() || w.push(tip).is_err() {
            continue;
        }
        for id in w.flatten() {
            if !seen.insert(id) {
                continue;
            }
            let Ok(c) = repo.find_commit(id) else { continue };
            raw.push(c);
            if raw.len() >= limit {
                break 'refs;
            }
        }
    }

    // Re-sort by time (walks from several refs may interleave); stable.
    raw.sort_by_key(|c| -c.time().seconds());

    // Rails: each "active line" occupies a column. A commit's OID is on one
    // of the active rails; its parents continue (or fork) the rails.
    let mut active: Vec<Option<Oid>> = Vec::new();
    let mut rows = Vec::new();
    for commit in &raw {
        let oid = commit.id();
        let parent_oids: Vec<Oid> = commit.parent_ids().collect();

        let rail = match active.iter().position(|a| *a == Some(oid)) {
            Some(r) => r,
            // New branch head — a fresh rail.
            None => match active.iter().position(Option::is_none) {
                Some(r) => {
                    active[r] = Some(oid);
                    r
                }
                None => {
                    active.push(Some(oid));
                    active.len() - 1
                }
            },
        };

        let snapshot = |active: &[Option<Oid>]| -> Vec<(usize, usize)> {
            active.iter().enumerate().filter(|(_, a)| a.is_some()).map(|(i, _)| (i, i)).collect()
        };
        let rails_before = snapshot(&active);

        if parent_oids.is_empty() {
            active[rail] = None;
        } else {
            // The first parent stays on this rail; a merge's other parents
            // get rails of their own.
            active[rail] = Some(parent_oids[0]);
            for extra in &parent_oids[1..] {
                if !active.contains(&Some(*extra)) {
                    match active.iter().position(Option::is_none) {
                        Some(slot) => active[slot] = Some(*extra),
                        None => active.push(Some(*extra)),
                    }
                }
            }
        }
        // Collapse trailing Nones to keep the graph compact.
        while active.last() == Some(&None) {
            active.pop();
        }
        let rails_after = snapshot(&active);

        rows.push(GraphRow {
            info: commit_info(commit),
            parents: parent_oids.iter().map(Oid::to_string).collect(),
            rail,
            rails_before,
            rails_after,
            branches: branch_map.get(&oid).cloned().unwrap_or_default(),
            is_merge: parent_oids.len() > 1,
        });
    }
    rows
}

/// The unified diff the given commit produced. A root commit is diffed
/// against an empty tree, so the initial state shows up as additions.
/// Empty if the oid can't be resolved.
pub fn diff_for_commit(repo_dir: &Path, oid: &str) -> String {
    if !repo_dir.join(".git").exists() {
        return String::new();
    }
    let Some(repo) = repo_for(repo_dir) else { return String::new() };
    let Some(commit) = get_object(&repo, oid).and_then(|o| o.peel_to_commit().ok()) else {
        return String::new();
    };
    let Ok(tree) = commit.tree() else { return String::new() };
    let mut opts = DiffOptions::new();
    opts.context_lines(3);
    let diff = match commit.parent(0) {
        // Against the first parent — what `git show` does; for a merge
        // that is the conventional "what landed" view.
        Ok(parent) => match parent.tree() {
            Ok(pt) => repo.diff_tree_to_tree(Some(&pt), Some(&tree), Some(&mut opts)),
            Err(e) => Err(e),
        },
        Err(_) => repo.diff_tree_to_tree(None, Some(&tree), Some(&mut opts)),
    };
    let Ok(diff) = diff else { return String::new() };
    // git_diff_to_buf(GIT_DIFF_FORMAT_PATCH), as pygit2's Diff.patch.
    let mut buf: Vec<u8> = Vec::new();
    let printed = diff.print(DiffFormat::Patch, |_d, _h, line| {
        if matches!(line.origin(), '+' | '-' | ' ') {
            buf.push(line.origin() as u8);
        }
        buf.extend_from_slice(line.content());
        true
    });
    if printed.is_err() {
        return String::new();
    }
    String::from_utf8_lossy(&buf).into_owned()
}

/// The identity commits are made with, for the comment author
/// (MainWindow._insert_comment reads repo.default_signature.name).
#[derive(Serialize)]
pub struct Identity {
    pub name: String,
    pub email: String,
}

pub fn default_signature(repo_dir: &Path) -> Option<Identity> {
    let dir = find_enclosing_repo(repo_dir).unwrap_or_else(|| repo_dir.to_path_buf());
    let repo = Repository::open(dir).ok()?;
    let sig = repo.signature().ok()?;
    Some(Identity {
        name: String::from_utf8_lossy(sig.name_bytes()).into_owned(),
        email: String::from_utf8_lossy(sig.email_bytes()).into_owned(),
    })
}

// ---- Tauri commands ----

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn git_is_available() -> bool {
    is_available()
}

#[tauri::command]
pub async fn git_init_repo(repo_dir: String) -> Result<bool, String> {
    blocking(move || init_repo(Path::new(&repo_dir))).await
}

#[tauri::command]
pub async fn git_find_enclosing_repo(repo_dir: String) -> Result<Option<String>, String> {
    blocking(move || find_enclosing_repo(Path::new(&repo_dir)).map(|p| p.to_string_lossy().into_owned())).await
}

#[tauri::command]
pub async fn git_commit_all(
    repo_dir: String,
    message: Option<String>,
    file_stem: Option<String>,
) -> Result<Option<String>, String> {
    blocking(move || commit_all(Path::new(&repo_dir), message.as_deref(), file_stem.as_deref())).await
}

#[tauri::command]
pub async fn git_get_remotes(repo_dir: String) -> Result<Vec<(String, String)>, String> {
    blocking(move || get_remotes(Path::new(&repo_dir))).await
}

#[tauri::command]
pub async fn git_set_remote(repo_dir: String, name: String, url: String) -> Result<bool, String> {
    blocking(move || set_remote(Path::new(&repo_dir), &name, &url)).await
}

#[tauri::command]
pub async fn git_remove_remote(repo_dir: String, name: String) -> Result<bool, String> {
    blocking(move || remove_remote(Path::new(&repo_dir), &name)).await
}

#[tauri::command]
pub async fn git_current_branch(repo_dir: String) -> Result<Option<String>, String> {
    blocking(move || current_branch(Path::new(&repo_dir))).await
}

#[tauri::command]
pub async fn git_pull(repo_dir: String, remote_name: String) -> Result<(bool, String), String> {
    blocking(move || pull(Path::new(&repo_dir), &remote_name)).await
}

#[tauri::command]
pub async fn git_push(repo_dir: String, remote_name: String) -> Result<(bool, String), String> {
    blocking(move || push(Path::new(&repo_dir), &remote_name)).await
}

#[tauri::command]
pub async fn git_system_git_available() -> Result<bool, String> {
    blocking(system_git_available).await
}

#[tauri::command]
pub async fn git_restore_to_commit(
    repo_dir: String,
    oid: String,
    paths: Option<Vec<String>>,
) -> Result<(bool, String), String> {
    blocking(move || restore_to_commit(Path::new(&repo_dir), &oid, paths.as_deref())).await
}

#[tauri::command]
pub async fn git_history(repo_dir: String, limit: Option<usize>) -> Result<Vec<(String, String, String)>, String> {
    blocking(move || history(Path::new(&repo_dir), limit.unwrap_or(50))).await
}

#[tauri::command]
pub async fn git_history_detailed(
    repo_dir: String,
    limit: Option<usize>,
    file_stem: Option<String>,
) -> Result<Vec<CommitInfo>, String> {
    blocking(move || history_detailed(Path::new(&repo_dir), limit.unwrap_or(200), file_stem.as_deref())).await
}

#[tauri::command]
pub async fn git_list_branches(repo_dir: String) -> Result<Vec<BranchInfo>, String> {
    blocking(move || list_branches(Path::new(&repo_dir))).await
}

#[tauri::command]
pub async fn git_create_branch(
    repo_dir: String,
    name: String,
    start_oid: Option<String>,
) -> Result<(bool, String), String> {
    blocking(move || create_branch(Path::new(&repo_dir), &name, start_oid.as_deref())).await
}

#[tauri::command]
pub async fn git_switch_branch(repo_dir: String, name: String) -> Result<(bool, String), String> {
    blocking(move || switch_branch(Path::new(&repo_dir), &name)).await
}

#[tauri::command]
pub async fn git_delete_branch(repo_dir: String, name: String) -> Result<(bool, String), String> {
    blocking(move || delete_branch(Path::new(&repo_dir), &name)).await
}

#[tauri::command]
pub async fn git_history_graph(repo_dir: String, limit: Option<usize>) -> Result<Vec<GraphRow>, String> {
    blocking(move || history_graph(Path::new(&repo_dir), limit.unwrap_or(300))).await
}

#[tauri::command]
pub async fn git_diff_for_commit(repo_dir: String, oid: String) -> Result<String, String> {
    blocking(move || diff_for_commit(Path::new(&repo_dir), &oid)).await
}

#[tauri::command]
pub async fn git_default_signature(repo_dir: String) -> Result<Option<Identity>, String> {
    blocking(move || default_signature(Path::new(&repo_dir))).await
}

#[cfg(test)]
mod tests {
    //! tests/test_git_backend.py, test for test.
    use super::*;

    struct Tmp(PathBuf);
    impl Tmp {
        fn new() -> Tmp {
            static N: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
            let n = N.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            let p = std::env::temp_dir().join(format!("khervetex-git-{}-{n}", std::process::id()));
            let _ = fs::remove_dir_all(&p);
            fs::create_dir_all(&p).unwrap();
            Tmp(fs::canonicalize(&p).unwrap())
        }
    }
    impl Drop for Tmp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    /// A repo dir with two commits: the first creates hello.txt with one
    /// line, the second appends a second line.
    fn make_repo_with_two_commits(tmp: &Path) -> PathBuf {
        let repo_dir = tmp.join("repo");
        fs::create_dir_all(&repo_dir).unwrap();
        fs::write(repo_dir.join("hello.txt"), "hello world\n").unwrap();
        assert!(commit_all(&repo_dir, Some("initial commit"), None).is_some());
        fs::write(repo_dir.join("hello.txt"), "hello world\nsecond line\n").unwrap();
        assert!(commit_all(&repo_dir, Some("add a second line\n\nbody text"), None).is_some());
        repo_dir
    }

    #[test]
    fn test_history_detailed_returns_newest_first() {
        let t = Tmp::new();
        let repo = make_repo_with_two_commits(&t.0);
        let commits = history_detailed(&repo, 200, None);
        assert_eq!(commits.len(), 2);
        assert_eq!(commits[0].subject, "add a second line");
        assert_eq!(commits[0].body, "body text");
        assert_eq!(commits[1].subject, "initial commit");
        for c in &commits {
            assert_eq!(c.short_oid.len(), 8);
            assert_eq!(c.oid.len(), 40);
            assert_eq!(c.timestamp.len(), 19);
            assert!(c.epoch > 0);
            assert!(c.author.contains('<'));
        }
    }

    #[test]
    fn test_diff_for_commit_shows_addition_for_second_commit() {
        let t = Tmp::new();
        let repo = make_repo_with_two_commits(&t.0);
        let second = &history_detailed(&repo, 200, None)[0];
        let diff = diff_for_commit(&repo, &second.oid);
        assert!(diff.contains("+second line"), "{diff}");
        assert!(diff.contains(" hello world"), "{diff}");
    }

    #[test]
    fn test_diff_for_root_commit_shows_initial_content() {
        let t = Tmp::new();
        let repo = make_repo_with_two_commits(&t.0);
        let root = history_detailed(&repo, 200, None).pop().unwrap();
        let diff = diff_for_commit(&repo, &root.oid);
        assert!(diff.contains("+hello world"), "{diff}");
        assert!(diff.contains("new file") || diff.contains("+++ b/hello.txt"), "{diff}");
    }

    #[test]
    fn test_diff_for_unknown_oid_returns_empty_string() {
        let t = Tmp::new();
        let repo = make_repo_with_two_commits(&t.0);
        assert_eq!(diff_for_commit(&repo, &"0".repeat(40)), "");
    }

    #[test]
    fn test_history_detailed_on_empty_repo_returns_empty_list() {
        let t = Tmp::new();
        let empty = t.0.join("empty_repo");
        fs::create_dir_all(&empty).unwrap();
        init_repo(&empty);
        assert!(history_detailed(&empty, 200, None).is_empty());
    }

    // ----- remote management -----

    #[test]
    fn test_set_remote_creates_and_lists() {
        let t = Tmp::new();
        let repo = make_repo_with_two_commits(&t.0);
        assert!(get_remotes(&repo).is_empty());
        assert!(set_remote(&repo, "origin", "https://example.org/x.git"));
        assert_eq!(get_remotes(&repo), vec![("origin".into(), "https://example.org/x.git".into())]);
    }

    #[test]
    fn test_set_remote_updates_url() {
        let t = Tmp::new();
        let repo = make_repo_with_two_commits(&t.0);
        set_remote(&repo, "origin", "https://old.example.org/x.git");
        assert!(set_remote(&repo, "origin", "https://new.example.org/y.git"));
        assert_eq!(get_remotes(&repo), vec![("origin".into(), "https://new.example.org/y.git".into())]);
    }

    #[test]
    fn test_set_remote_supports_multiple_remotes() {
        let t = Tmp::new();
        let repo = make_repo_with_two_commits(&t.0);
        set_remote(&repo, "origin", "https://example.org/a.git");
        set_remote(&repo, "backup", "https://other.org/a.git");
        let mut names: Vec<String> = get_remotes(&repo).into_iter().map(|(n, _)| n).collect();
        names.sort();
        assert_eq!(names, vec!["backup", "origin"]);
    }

    #[test]
    fn test_remove_remote() {
        let t = Tmp::new();
        let repo = make_repo_with_two_commits(&t.0);
        set_remote(&repo, "origin", "https://example.org/a.git");
        assert!(remove_remote(&repo, "origin"));
        assert!(get_remotes(&repo).is_empty());
    }

    #[test]
    fn test_remove_unknown_remote_returns_false() {
        let t = Tmp::new();
        let repo = make_repo_with_two_commits(&t.0);
        assert!(!remove_remote(&repo, "ghost"));
    }

    // ----- pull -----

    #[test]
    fn test_pull_no_remote_configured() {
        let t = Tmp::new();
        let repo = make_repo_with_two_commits(&t.0);
        let (ok, msg) = pull(&repo, "origin");
        assert!(!ok);
        assert!(msg.to_lowercase().contains("remote"), "{msg}");
        assert_eq!(msg, "No remote named 'origin' is configured.");
    }

    fn clone_of(upstream: &Path, into: &Path) {
        Repository::clone(upstream.to_str().unwrap(), into).unwrap();
    }

    #[test]
    fn test_pull_already_up_to_date_via_file_remote() {
        let t = Tmp::new();
        let upstream = make_repo_with_two_commits(&t.0);
        let clone_path = t.0.join("clone");
        clone_of(&upstream, &clone_path);
        let (ok, msg) = pull(&clone_path, "origin");
        assert!(ok, "{msg}");
        assert!(msg.to_lowercase().contains("up to date"), "{msg}");
    }

    #[test]
    fn test_pull_fast_forwards_new_commits() {
        let t = Tmp::new();
        let upstream = make_repo_with_two_commits(&t.0);
        let clone_path = t.0.join("clone");
        clone_of(&upstream, &clone_path);
        fs::write(upstream.join("hello.txt"), "hello world\nsecond line\nthird line\n").unwrap();
        commit_all(&upstream, Some("third line"), None);
        let (ok, msg) = pull(&clone_path, "origin");
        assert!(ok, "{msg}");
        assert!(msg.to_lowercase().contains("pulled 1 commit"), "{msg}");
        assert_eq!(msg, "Pulled 1 commit from origin/dev.");
        let text = fs::read_to_string(clone_path.join("hello.txt")).unwrap();
        assert!(text.contains("third line"));
    }

    #[test]
    fn test_current_branch() {
        let t = Tmp::new();
        let repo = make_repo_with_two_commits(&t.0);
        // init_repo writes refs/heads/dev — that's what we should report.
        assert_eq!(current_branch(&repo).as_deref(), Some("dev"));
    }

    // ----- push (tuple form) -----

    #[test]
    fn test_push_with_no_remote_returns_message() {
        let t = Tmp::new();
        let repo = make_repo_with_two_commits(&t.0);
        let (ok, msg) = push(&repo, "origin");
        assert!(!ok);
        assert!(msg.to_lowercase().contains("remote"), "{msg}");
    }

    #[test]
    fn test_push_with_unborn_head_returns_message() {
        let t = Tmp::new();
        let empty = t.0.join("empty");
        fs::create_dir_all(&empty).unwrap();
        init_repo(&empty);
        let (ok, msg) = push(&empty, "origin");
        assert!(!ok);
        let m = msg.to_lowercase();
        assert!(m.contains("commit") || m.contains("remote"), "{msg}");
    }

    #[test]
    fn test_push_to_a_bare_remote_and_pull_it_back() {
        let t = Tmp::new();
        let repo = make_repo_with_two_commits(&t.0);
        let bare = t.0.join("bare.git");
        Repository::init_bare(&bare).unwrap();
        assert!(set_remote(&repo, "origin", bare.to_str().unwrap()));
        assert_eq!(push(&repo, "origin"), (true, "Pushed to origin.".into()));
        let head = Repository::open(&repo).unwrap().head().unwrap().target().unwrap();
        let pushed = Repository::open(&bare).unwrap().find_reference("refs/heads/dev").unwrap().target().unwrap();
        assert_eq!(head, pushed);
    }

    // ----- restore_to_commit -----

    #[test]
    fn test_restore_to_commit_brings_old_contents_back() {
        let t = Tmp::new();
        let repo = make_repo_with_two_commits(&t.0);
        let root = history_detailed(&repo, 200, None).pop().unwrap();
        assert!(fs::read_to_string(repo.join("hello.txt")).unwrap().contains("second line"));
        let (ok, msg) = restore_to_commit(&repo, &root.oid, None);
        assert!(ok, "{msg}");
        let restored = fs::read_to_string(repo.join("hello.txt")).unwrap();
        assert!(!restored.contains("second line"));
        assert!(restored.contains("hello world"));
    }

    #[test]
    fn test_restore_to_commit_keeps_head_pointing_at_latest() {
        let t = Tmp::new();
        let repo = make_repo_with_two_commits(&t.0);
        let head_before = Repository::open(&repo).unwrap().head().unwrap().target();
        let commits = history_detailed(&repo, 200, None);
        restore_to_commit(&repo, &commits.last().unwrap().oid, None);
        let head_after = Repository::open(&repo).unwrap().head().unwrap().target();
        assert_eq!(head_before, head_after);
    }

    #[test]
    fn test_restore_unknown_oid_fails_cleanly() {
        let t = Tmp::new();
        let repo = make_repo_with_two_commits(&t.0);
        let (ok, msg) = restore_to_commit(&repo, &"0".repeat(40), None);
        assert!(!ok);
        assert_eq!(msg, "Commit '00000000' not found.");
    }

    // ----- beyond the Python suite: what the app relies on -----

    #[test]
    fn test_init_repo_heads_to_dev_and_does_not_nest() {
        let t = Tmp::new();
        let outer = t.0.join("outer");
        assert!(init_repo(&outer));
        assert_eq!(fs::read_to_string(outer.join(".git/HEAD")).unwrap(), "ref: refs/heads/dev\n");
        let inner = outer.join("paper");
        assert!(init_repo(&inner));
        assert!(!inner.join(".git").exists());
        fs::write(inner.join("x.txt"), "x").unwrap();
        assert!(commit_all(&inner, Some("in the enclosing repo"), None).is_some());
        assert_eq!(current_branch(&outer).as_deref(), Some("dev"));
    }

    #[test]
    fn test_commit_all_with_file_stem_stages_only_that_document() {
        let t = Tmp::new();
        let dir = t.0.join("docs");
        fs::create_dir_all(dir.join(".kherve")).unwrap();
        fs::write(dir.join("My report.ktex"), "a").unwrap();
        fs::write(dir.join(".kherve/My report.tex"), "\\documentclass{article}").unwrap();
        fs::write(dir.join("Other.ktex"), "b").unwrap();
        let oid = commit_all(&dir, Some("Save My report.ktex"), Some("My report")).unwrap();
        let repo = Repository::open(&dir).unwrap();
        let tree = repo.find_commit(Oid::from_str(&oid).unwrap()).unwrap().tree().unwrap();
        assert!(tree.get_path(Path::new("My report.ktex")).is_ok());
        assert!(tree.get_path(Path::new(".kherve/My report.tex")).is_ok());
        assert!(tree.get_path(Path::new("Other.ktex")).is_err());
        // Nothing new: no commit.
        assert!(commit_all(&dir, Some("again"), Some("My report")).is_none());
        // The stem filter of the history.
        assert_eq!(history_detailed(&dir, 200, Some("My report")).len(), 1);
        assert!(history_detailed(&dir, 200, Some("Other")).is_empty());
    }

    #[test]
    fn test_commit_uses_the_git_identity_of_the_repo_config() {
        let t = Tmp::new();
        let dir = t.0.join("ident");
        init_repo(&dir);
        let repo = Repository::open(&dir).unwrap();
        let mut cfg = repo.config().unwrap();
        cfg.set_str("user.name", "Ada Lovelace").unwrap();
        cfg.set_str("user.email", "ada@example.org").unwrap();
        fs::write(dir.join("a.txt"), "a").unwrap();
        commit_all(&dir, None, None).unwrap();
        let c = &history_detailed(&dir, 200, None)[0];
        assert_eq!(c.author, "Ada Lovelace <ada@example.org>");
        assert!(c.subject.starts_with("Edit at "));
    }

    #[test]
    fn test_branches_create_switch_delete_and_graph() {
        let t = Tmp::new();
        let repo = make_repo_with_two_commits(&t.0);
        assert_eq!(create_branch(&repo, "draft", None), (true, "Branch 'draft' created.".into()));
        assert!(!create_branch(&repo, "draft", None).0);
        let mut names: Vec<String> = list_branches(&repo).into_iter().map(|b| b.name).collect();
        names.sort();
        assert_eq!(names, vec!["dev", "draft"]);
        assert_eq!(switch_branch(&repo, "draft"), (true, "Switched to branch 'draft'.".into()));
        assert_eq!(current_branch(&repo).as_deref(), Some("draft"));
        assert_eq!(switch_branch(&repo, "ghost"), (false, "Branch 'ghost' does not exist.".into()));
        assert_eq!(
            delete_branch(&repo, "draft"),
            (false, "Cannot delete the branch you are currently on.".into())
        );
        switch_branch(&repo, "dev");
        assert_eq!(delete_branch(&repo, "draft"), (true, "Branch 'draft' deleted.".into()));
        assert_eq!(delete_branch(&repo, "draft"), (false, "Branch 'draft' does not exist.".into()));

        let rows = history_graph(&repo, 300);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].info.subject, "add a second line");
        assert_eq!(rows[0].branches, vec!["dev"]);
        assert_eq!(rows[0].rail, 0);
        assert_eq!(rows[0].rails_after, vec![(0, 0)]);
        assert!(rows[1].rails_after.is_empty());
        assert!(!rows[0].is_merge);
    }

    #[test]
    fn test_restore_listed_paths_only() {
        let t = Tmp::new();
        let repo = make_repo_with_two_commits(&t.0);
        fs::write(repo.join("other.txt"), "keep").unwrap();
        let root = history_detailed(&repo, 200, None).pop().unwrap();
        let (ok, msg) = restore_to_commit(&repo, &root.oid, Some(&["hello.txt".to_string()]));
        assert!(ok, "{msg}");
        assert_eq!(fs::read_to_string(repo.join("hello.txt")).unwrap(), "hello world\n");
        assert_eq!(fs::read_to_string(repo.join("other.txt")).unwrap(), "keep");
        assert_eq!(msg, format!("Restored files to {}.", &root.oid[..8]));
    }

    #[test]
    fn test_py_splitlines_and_subject_body() {
        assert_eq!(py_splitlines("a\r\nb\rc\n"), vec!["a", "b", "c"]);
        assert_eq!(py_splitlines(""), Vec::<String>::new());
        assert_eq!(py_repr("origin"), "'origin'");
        assert_eq!(py_repr("it's"), "\"it's\"");
    }
}
