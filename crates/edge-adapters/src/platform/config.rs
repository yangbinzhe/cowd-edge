//! Platform configuration.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Configuration for a single platform instance.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlatformConfig {
    /// Whether this platform is enabled.
    pub enabled: bool,
    /// Platform type (feishu, wecom, email).
    pub platform_type: String,
    /// Platform-specific settings.
    #[serde(default)]
    pub settings: HashMap<String, serde_json::Value>,
}

impl PlatformConfig {
    /// Create a new platform config.
    pub fn new(platform_type: impl Into<String>) -> Self {
        Self {
            enabled: true,
            platform_type: platform_type.into(),
            settings: HashMap::new(),
        }
    }

    /// Set a setting value.
    pub fn with_setting(
        mut self,
        key: impl Into<String>,
        value: impl Into<serde_json::Value>,
    ) -> Self {
        self.settings.insert(key.into(), value.into());
        self
    }

    /// Get a setting value.
    pub fn get_setting(&self, key: &str) -> Option<&serde_json::Value> {
        self.settings.get(key)
    }

    /// Get a setting as a specific type.
    pub fn get_setting_as<T: serde::de::DeserializeOwned>(&self, key: &str) -> Option<T> {
        self.settings
            .get(key)
            .and_then(|v| serde_json::from_value(v.clone()).ok())
    }
}
