// Expected findings: 0 (this file should pass preflight cleanly)
//
// This file demonstrates well-written Rust with proper Result handling, the ?
// operator for error propagation, documented unsafe blocks with // SAFETY:
// comments, consumed iterators, and idiomatic patterns. Preflight should NOT
// flag anything here.

use std::collections::HashMap;
use std::fmt;
use std::io::{self, Read, Write};
use std::sync::{Arc, RwLock};

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/// Errors that can occur during token store operations.
#[derive(Debug)]
pub enum StoreError {
    /// A token with this name was not found.
    NotFound(String),
    /// The lock was poisoned by a panicking thread.
    LockPoisoned,
    /// An I/O error occurred during serialization or deserialization.
    Io(io::Error),
    /// The stored data could not be parsed.
    ParseError(String),
}

impl fmt::Display for StoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            StoreError::NotFound(name) => write!(f, "token not found: {name}"),
            StoreError::LockPoisoned => write!(f, "internal lock poisoned"),
            StoreError::Io(err) => write!(f, "I/O error: {err}"),
            StoreError::ParseError(msg) => write!(f, "parse error: {msg}"),
        }
    }
}

impl std::error::Error for StoreError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            StoreError::Io(err) => Some(err),
            _ => None,
        }
    }
}

impl From<io::Error> for StoreError {
    fn from(err: io::Error) -> Self {
        StoreError::Io(err)
    }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// A single API token with metadata.
#[derive(Debug, Clone)]
pub struct Token {
    pub name: String,
    pub value: String,
    pub scopes: Vec<String>,
    pub created_epoch: u64,
    pub expires_epoch: Option<u64>,
}

impl Token {
    /// Returns true if the token has an expiration time that has passed.
    pub fn is_expired(&self, now_epoch: u64) -> bool {
        self.expires_epoch
            .map(|exp| now_epoch >= exp)
            .unwrap_or(false)
    }

    /// Checks whether the token grants a specific scope.
    pub fn has_scope(&self, scope: &str) -> bool {
        self.scopes.iter().any(|s| s == scope)
    }
}

impl fmt::Display for Token {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let masked = if self.value.len() > 8 {
            format!("{}...{}", &self.value[..4], &self.value[self.value.len() - 4..])
        } else {
            "****".to_string()
        };
        write!(f, "{} ({})", self.name, masked)
    }
}

// ---------------------------------------------------------------------------
// Token store
// ---------------------------------------------------------------------------

/// Thread-safe in-memory token store.
///
/// Uses `RwLock` to allow concurrent reads while serializing writes.
pub struct TokenStore {
    tokens: Arc<RwLock<HashMap<String, Token>>>,
}

impl TokenStore {
    /// Creates an empty token store.
    pub fn new() -> Self {
        TokenStore {
            tokens: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Inserts or replaces a token. Returns the previous token if one existed
    /// under the same name.
    pub fn insert(&self, token: Token) -> Result<Option<Token>, StoreError> {
        let mut tokens = self
            .tokens
            .write()
            .map_err(|_| StoreError::LockPoisoned)?;

        Ok(tokens.insert(token.name.clone(), token))
    }

    /// Retrieves a clone of the token with the given name.
    pub fn get(&self, name: &str) -> Result<Option<Token>, StoreError> {
        let tokens = self
            .tokens
            .read()
            .map_err(|_| StoreError::LockPoisoned)?;

        Ok(tokens.get(name).cloned())
    }

    /// Removes a token by name. Returns the removed token or a NotFound error.
    pub fn remove(&self, name: &str) -> Result<Token, StoreError> {
        let mut tokens = self
            .tokens
            .write()
            .map_err(|_| StoreError::LockPoisoned)?;

        tokens
            .remove(name)
            .ok_or_else(|| StoreError::NotFound(name.to_string()))
    }

    /// Returns the names of all tokens that have not expired.
    pub fn active_names(&self, now_epoch: u64) -> Result<Vec<String>, StoreError> {
        let tokens = self
            .tokens
            .read()
            .map_err(|_| StoreError::LockPoisoned)?;

        let names: Vec<String> = tokens
            .values()
            .filter(|t| !t.is_expired(now_epoch))
            .map(|t| t.name.clone())
            .collect();

        Ok(names)
    }

    /// Removes all expired tokens and returns the count of removed entries.
    pub fn purge_expired(&self, now_epoch: u64) -> Result<usize, StoreError> {
        let mut tokens = self
            .tokens
            .write()
            .map_err(|_| StoreError::LockPoisoned)?;

        let before = tokens.len();
        tokens.retain(|_, t| !t.is_expired(now_epoch));
        Ok(before - tokens.len())
    }

    /// Returns the total number of stored tokens (including expired ones).
    pub fn len(&self) -> Result<usize, StoreError> {
        let tokens = self
            .tokens
            .read()
            .map_err(|_| StoreError::LockPoisoned)?;

        Ok(tokens.len())
    }

    /// Reports whether the store is empty.
    pub fn is_empty(&self) -> Result<bool, StoreError> {
        Ok(self.len()? == 0)
    }
}

impl Default for TokenStore {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/// Writes the store contents to a writer in a simple line-based format.
///
/// Each token is written as: name\tvalue\tscopes\tcreated\texpires
pub fn export_store(store: &TokenStore, mut writer: impl Write) -> Result<usize, StoreError> {
    let tokens = store
        .tokens
        .read()
        .map_err(|_| StoreError::LockPoisoned)?;

    let mut count = 0;
    for token in tokens.values() {
        let scopes = token.scopes.join(",");
        let expires = token
            .expires_epoch
            .map(|e| e.to_string())
            .unwrap_or_else(|| "never".to_string());

        writeln!(
            writer,
            "{}\t{}\t{}\t{}\t{}",
            token.name, token.value, scopes, token.created_epoch, expires,
        )?;

        count += 1;
    }

    Ok(count)
}

/// Reads tokens from a reader in the line-based format produced by
/// `export_store` and loads them into the given store.
pub fn import_store(store: &TokenStore, mut reader: impl Read) -> Result<usize, StoreError> {
    let mut buf = String::new();
    reader.read_to_string(&mut buf)?;

    let mut loaded = 0;
    for (line_no, line) in buf.lines().enumerate() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() < 5 {
            return Err(StoreError::ParseError(format!(
                "line {}: expected 5 tab-separated fields, got {}",
                line_no + 1,
                parts.len(),
            )));
        }

        let expires_epoch = match parts[4] {
            "never" => None,
            s => Some(s.parse::<u64>().map_err(|e| {
                StoreError::ParseError(format!("line {}: invalid expires: {e}", line_no + 1))
            })?),
        };

        let token = Token {
            name: parts[0].to_string(),
            value: parts[1].to_string(),
            scopes: parts[2]
                .split(',')
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string())
                .collect(),
            created_epoch: parts[3].parse::<u64>().map_err(|e| {
                StoreError::ParseError(format!("line {}: invalid created: {e}", line_no + 1))
            })?,
            expires_epoch,
        };

        store.insert(token)?;
        loaded += 1;
    }

    Ok(loaded)
}

// ---------------------------------------------------------------------------
// Documented unsafe example
// ---------------------------------------------------------------------------

/// Reinterprets a byte slice as a UTF-8 string without validation.
///
/// This is used on trusted internal buffers that are known to contain valid
/// UTF-8 because they were originally produced by `String::as_bytes()`.
///
/// # Safety
///
/// The caller must guarantee that `bytes` is valid UTF-8. Passing arbitrary
/// bytes will produce undefined behavior when the returned `&str` is used.
pub unsafe fn bytes_to_str_unchecked(bytes: &[u8]) -> &str {
    // SAFETY: The caller guarantees that `bytes` is valid UTF-8. This is
    // upheld by the internal callers in this module, which only pass slices
    // obtained from `String::as_bytes()`.
    std::str::from_utf8_unchecked(bytes)
}
