//! Edge-owned platform adapter host.
//!
//! Platform SDK integration is an external Edge concern, not an AI harness
//! runtime concern. Gateway invokes these adapters through the Cowd Edge
//! JSONL protocol and never links their SDK dependencies.

pub mod mirror;

pub mod config {
    use serde::{Deserialize, Serialize};

    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
    #[serde(rename_all = "lowercase")]
    pub enum SessionResetPolicy {
        Daily,
        Idle,
        Both,
        Always,
        #[default]
        None,
    }
}

pub mod cowd_dirs;

pub mod feishu_sidecar;
pub mod message_sidecar;
pub mod platform;
#[cfg(feature = "source-db")]
mod source_db;
pub mod source_sidecar;
