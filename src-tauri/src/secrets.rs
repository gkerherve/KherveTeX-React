//! Secrets the app remembers between sessions (the Overleaf Git token):
//! the system's credential store on macOS (Keychain) and Windows
//! (Credential Manager), encrypted on disk and unlocked with the user's
//! login; elsewhere a file only the user can read in the config folder.

const SERVICE: &str = "KherveTeX";

#[cfg(target_os = "windows")]
mod store {
    use super::SERVICE;

    fn entry(key: &str) -> Result<keyring::Entry, String> {
        keyring::Entry::new(SERVICE, key).map_err(|e| e.to_string())
    }

    pub fn get(key: &str) -> Result<Option<String>, String> {
        match entry(key)?.get_password() {
            Ok(v) => Ok(Some(v)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    pub fn set(key: &str, value: &str) -> Result<(), String> {
        entry(key)?.set_password(value).map_err(|e| e.to_string())
    }

    pub fn delete(key: &str) -> Result<(), String> {
        match entry(key)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}

// macOS and Linux: a file only the user can read. On macOS the Keychain
// ties an item to the app's code signature, so every rebuilt (ad-hoc
// signed) app lost the token or asked for the login password again; a
// token saved there earlier is moved here once.
#[cfg(not(target_os = "windows"))]
mod store {
    use std::path::PathBuf;

    fn path(key: &str) -> Result<PathBuf, String> {
        #[cfg(target_os = "macos")]
        let base = std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library").join("Application Support"))
            .ok_or("no home folder")?;
        #[cfg(not(target_os = "macos"))]
        let base = std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
            .ok_or("no home folder")?;
        let safe: String = key.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' }).collect();
        Ok(base.join("kherveDOC").join("secrets").join(safe))
    }

    pub fn get(key: &str) -> Result<Option<String>, String> {
        match std::fs::read_to_string(path(key)?) {
            Ok(v) => Ok(Some(v)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => from_keychain(key),
            Err(e) => Err(e.to_string()),
        }
    }

    // A token an earlier version kept in the Keychain: read once, kept here.
    #[cfg(target_os = "macos")]
    fn from_keychain(key: &str) -> Result<Option<String>, String> {
        let Ok(entry) = keyring::Entry::new(super::SERVICE, key) else { return Ok(None) };
        match entry.get_password() {
            Ok(v) if !v.is_empty() => {
                set(key, &v)?;
                let _ = entry.delete_credential();
                Ok(Some(v))
            }
            _ => Ok(None),
        }
    }

    #[cfg(not(target_os = "macos"))]
    fn from_keychain(_key: &str) -> Result<Option<String>, String> {
        Ok(None)
    }

    pub fn set(key: &str, value: &str) -> Result<(), String> {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let p = path(key)?;
        if let Some(d) = p.parent() { std::fs::create_dir_all(d).map_err(|e| e.to_string())?; }
        let mut f = std::fs::OpenOptions::new().write(true).create(true).truncate(true).mode(0o600)
            .open(&p).map_err(|e| e.to_string())?;
        f.write_all(value.as_bytes()).map_err(|e| e.to_string())
    }

    pub fn delete(key: &str) -> Result<(), String> {
        match std::fs::remove_file(path(key)?) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}

#[tauri::command]
pub async fn secret_get(key: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || store::get(&key)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn secret_set(key: String, value: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        if value.is_empty() { store::delete(&key) } else { store::set(&key, &value) }
    }).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::store;

    #[test]
    fn a_secret_is_saved_read_back_and_forgotten() {
        let key = "khervetex-test-secret";
        store::set(key, "olp_test_value").unwrap();
        assert_eq!(store::get(key).unwrap().as_deref(), Some("olp_test_value"));
        store::delete(key).unwrap();
        assert_eq!(store::get(key).unwrap(), None);
    }
}
