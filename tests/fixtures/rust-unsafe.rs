// Expected findings: 3
//
// This file contains three intentional issues:
//   1. UNWRAP_IN_LIB: unwrap() used in library code (not main/tests) on a
//      Result from serde deserialization -- should use ? or proper error handling
//   2. UNSAFE_WITHOUT_SAFETY_COMMENT: unsafe block without a // SAFETY: comment
//      explaining why the invariants hold
//   3. LAZY_ITERATOR_MAP: .map() on an iterator without consuming the result --
//      the side effect inside the map closure never executes because iterators
//      are lazy in Rust
//
// NOTE: These bugs are INTENTIONAL test fixtures for the preflight plugin.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// Configuration loaded from a TOML or JSON source.
#[derive(Debug, Clone)]
pub struct PluginConfig {
    pub name: String,
    pub version: String,
    pub enabled: bool,
    pub settings: HashMap<String, String>,
}

/// Tracks runtime metrics for a plugin.
#[derive(Debug, Default)]
pub struct PluginMetrics {
    pub invocations: u64,
    pub errors: u64,
    pub total_duration_ms: u64,
}

/// A registry that holds loaded plugins and their configurations.
pub struct PluginRegistry {
    plugins: HashMap<String, PluginConfig>,
    metrics: Arc<Mutex<HashMap<String, PluginMetrics>>>,
    raw_lookup: *const HashMap<String, PluginConfig>,
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

impl PluginRegistry {
    /// Creates a new empty registry.
    pub fn new() -> Self {
        let plugins = HashMap::new();
        let ptr = &plugins as *const HashMap<String, PluginConfig>;
        PluginRegistry {
            plugins,
            metrics: Arc::new(Mutex::new(HashMap::new())),
            raw_lookup: ptr,
        }
    }

    /// Loads a plugin configuration from a JSON string.
    ///
    /// This is library code consumed by downstream crates, so unwrap() is
    /// inappropriate here -- callers cannot recover from a panic.
    pub fn load_from_json(&mut self, name: &str, json_data: &str) {
        // BUG: unwrap() in library code. Should return Result<(), Error> and
        // use serde_json::from_str(json_data)? instead.
        let settings: HashMap<String, String> =
            serde_json::from_str(json_data).unwrap();

        let config = PluginConfig {
            name: name.to_string(),
            version: settings
                .get("version")
                .cloned()
                .unwrap_or_else(|| "0.0.0".to_string()),
            enabled: settings
                .get("enabled")
                .map(|v| v == "true")
                .unwrap_or(true),
            settings,
        };

        self.plugins.insert(name.to_string(), config);
        self.metrics
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(name.to_string(), PluginMetrics::default());
    }

    /// Looks up a plugin config using the raw pointer for "performance."
    ///
    /// The unsafe block below is missing the required // SAFETY: comment
    /// explaining why dereferencing the raw pointer is sound.
    pub fn fast_lookup(&self, name: &str) -> Option<&PluginConfig> {
        // BUG: unsafe block without a // SAFETY: comment. Every unsafe block
        // must document the invariant that makes the operation sound.
        unsafe {
            (*self.raw_lookup).get(name)
        }
    }

    /// Returns the names of all enabled plugins.
    pub fn enabled_plugins(&self) -> Vec<&str> {
        self.plugins
            .values()
            .filter(|p| p.enabled)
            .map(|p| p.name.as_str())
            .collect()
    }

    /// Records a successful invocation for the named plugin.
    pub fn record_invocation(&self, name: &str, duration_ms: u64) -> Result<(), String> {
        let mut metrics = self
            .metrics
            .lock()
            .map_err(|e| format!("lock poisoned: {e}"))?;

        let entry = metrics
            .get_mut(name)
            .ok_or_else(|| format!("plugin not found: {name}"))?;

        entry.invocations += 1;
        entry.total_duration_ms += duration_ms;
        Ok(())
    }

    /// Attempts to notify all enabled plugins that a reload has occurred.
    ///
    /// The .map() call below is lazy and never executes because the iterator
    /// is not consumed.
    pub fn notify_reload(&self, payload: &str) {
        let enabled: Vec<&PluginConfig> = self
            .plugins
            .values()
            .filter(|p| p.enabled)
            .collect();

        // BUG: .map() on an iterator is lazy -- this closure never runs.
        // Should use .for_each() or .collect::<Vec<_>>() to consume the
        // iterator and actually execute the side effects.
        enabled.iter().map(|plugin| {
            log::info!(
                "notifying plugin {} (v{}) with payload: {}",
                plugin.name,
                plugin.version,
                payload,
            );
            self.metrics
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .entry(plugin.name.clone())
                .or_default()
                .invocations += 1;
        });
    }

    /// Returns aggregate metrics for all loaded plugins.
    pub fn aggregate_metrics(&self) -> Result<PluginMetrics, String> {
        let metrics = self
            .metrics
            .lock()
            .map_err(|e| format!("lock poisoned: {e}"))?;

        let mut total = PluginMetrics::default();
        for m in metrics.values() {
            total.invocations += m.invocations;
            total.errors += m.errors;
            total.total_duration_ms += m.total_duration_ms;
        }

        Ok(total)
    }

    /// Returns the number of registered plugins.
    pub fn len(&self) -> usize {
        self.plugins.len()
    }

    /// Reports whether the registry is empty.
    pub fn is_empty(&self) -> bool {
        self.plugins.is_empty()
    }
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

impl std::fmt::Display for PluginConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{} v{} ({})",
            self.name,
            self.version,
            if self.enabled { "enabled" } else { "disabled" },
        )
    }
}

impl std::fmt::Display for PluginMetrics {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let avg = if self.invocations > 0 {
            self.total_duration_ms as f64 / self.invocations as f64
        } else {
            0.0
        };
        write!(
            f,
            "invocations={}, errors={}, avg_ms={:.1}",
            self.invocations, self.errors, avg,
        )
    }
}
