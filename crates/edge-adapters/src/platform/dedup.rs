//! In-memory LRU message dedup store.
//!
//! Tracks seen message IDs with TTL-based expiration and LRU eviction.
//! Mirrors Hermes' `_seen_message_ids` pattern for cross-platform
//! duplicate detection.
//!
//! ## Design
//!
//! - New entries are appended to the end of a `VecDeque`
//! - Oldest entries are evicted when capacity is reached (FIFO/LRU)
//! - Entries older than `ttl_seconds` are considered expired

use std::collections::VecDeque;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::RwLock;

/// Current Unix timestamp in seconds.
#[inline]
fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

/// In-memory LRU message dedup store.
///
/// Tracks seen message IDs with TTL-based expiration and LRU eviction.
/// Mirrors Hermes' `_seen_message_ids` pattern.
///
/// # Example
///
/// ```ignore
/// use edge_adapters::platform::dedup::DedupStore;
///
/// # tokio::runtime::Runtime::new().unwrap().block_on(async {
/// let store = DedupStore::new(10, 3600);
/// assert!(!store.is_duplicate("msg_1").await);
/// assert!(store.is_duplicate("msg_1").await); // duplicate within TTL
/// # });
/// ```
pub struct DedupStore {
    /// Message ID → seen_at (Unix timestamp seconds), ordered by insertion.
    seen_ids: RwLock<VecDeque<(String, i64)>>,
    /// Maximum number of entries before eviction.
    max_size: usize,
    /// Time-to-live in seconds.
    ttl_seconds: i64,
}

impl DedupStore {
    /// Create a new `DedupStore` without persistence.
    pub fn new(max_size: usize, ttl_seconds: i64) -> Self {
        Self {
            seen_ids: RwLock::new(VecDeque::with_capacity(max_size.min(64))),
            max_size,
            ttl_seconds,
        }
    }

    /// Check whether `message_id` is a duplicate (already seen within TTL).
    ///
    /// # Returns
    ///
    /// - `true` if the message ID exists and its `seen_at` is within TTL.
    /// - `false` otherwise (not seen, or seen but expired). In both
    ///   cases the entry is added (or updated) to the store.
    pub async fn is_duplicate(&self, message_id: &str) -> bool {
        let mut guard = self.seen_ids.write().await;
        let now = now_secs();

        // Check if already present.
        if let Some(pos) = guard.iter().position(|(id, _)| id == message_id) {
            let (_, seen_at) = &guard[pos];
            if now - seen_at < self.ttl_seconds {
                // Still within TTL → true duplicate.
                return true;
            }
            // Expired — remove the stale entry, then fall through to add.
            guard.remove(pos);
        }

        // Evict oldest if at capacity before adding.
        while guard.len() >= self.max_size {
            guard.pop_front();
        }

        guard.push_back((message_id.to_string(), now));

        false
    }

    /// Explicitly mark `message_id` as seen without checking for duplicates.
    ///
    /// This unconditionally adds (or refreshes) the entry. Useful for
    /// explicit tracking scenarios where the caller already handled
    /// dedup logic upstream.
    pub async fn mark_seen(&self, message_id: &str) {
        let mut guard = self.seen_ids.write().await;

        // Remove existing entry if present (so we can push a fresh one).
        if let Some(pos) = guard.iter().position(|(id, _)| id == message_id) {
            guard.remove(pos);
        }

        // Evict if at capacity.
        while guard.len() >= self.max_size {
            guard.pop_front();
        }

        guard.push_back((message_id.to_string(), now_secs()));
    }

    /// Number of entries currently in the store.
    pub async fn len(&self) -> usize {
        self.seen_ids.read().await.len()
    }

    /// Whether the store is empty.
    pub async fn is_empty(&self) -> bool {
        self.len().await == 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_duplicate_detection_within_ttl() {
        let store = DedupStore::new(10, 3600);
        assert!(
            !store.is_duplicate("msg_1").await,
            "first sighting → not dup"
        );
        assert!(store.is_duplicate("msg_1").await, "second sighting → dup");
        assert_eq!(store.len().await, 1);
    }

    #[tokio::test]
    async fn test_expired_entry_not_duplicate() {
        let store = DedupStore::new(10, 0); // ttl=0 → everything expires immediately
        assert!(!store.is_duplicate("msg_1").await, "first sighting");
        assert!(
            !store.is_duplicate("msg_1").await,
            "expired → not dup, re-added"
        );
        assert_eq!(store.len().await, 1);
    }

    #[tokio::test]
    async fn test_eviction_at_capacity() {
        let store = DedupStore::new(3, 3600);

        // Fill the store.
        assert!(!store.is_duplicate("a").await);
        assert!(!store.is_duplicate("b").await);
        assert!(!store.is_duplicate("c").await);
        assert_eq!(store.len().await, 3);

        // Insert "d" — should evict "a" (oldest).
        assert!(!store.is_duplicate("d").await);
        assert_eq!(store.len().await, 3);

        // "b" and "c" still tracked; "d" was just added.
        assert!(store.is_duplicate("b").await);
        assert!(store.is_duplicate("c").await);
        assert!(store.is_duplicate("d").await);

        // "a" was evicted — not a duplicate (but re-added by this call).
        assert!(!store.is_duplicate("a").await);
    }

    #[tokio::test]
    async fn test_is_duplicate_automatically_marks_seen() {
        let store = DedupStore::new(10, 3600);

        // Call is_duplicate on a new message → should mark it as seen.
        assert!(!store.is_duplicate("unique_msg").await, "first → not dup");
        assert_eq!(store.len().await, 1);

        // Now it's a duplicate.
        assert!(store.is_duplicate("unique_msg").await, "second → dup");
    }

    #[tokio::test]
    async fn test_empty_store_returns_len_zero() {
        let store = DedupStore::new(10, 3600);
        assert_eq!(store.len().await, 0);
        assert!(store.is_empty().await);
    }

    #[tokio::test]
    async fn test_mark_seen_adds_entry() {
        let store = DedupStore::new(10, 3600);

        store.mark_seen("explicit_msg").await;
        assert_eq!(store.len().await, 1);
        assert!(
            store.is_duplicate("explicit_msg").await,
            "should be seen now"
        );
    }

    #[tokio::test]
    async fn test_mark_seen_evicts_oldest_at_capacity() {
        let store = DedupStore::new(2, 3600);

        store.mark_seen("a").await;
        store.mark_seen("b").await;
        assert_eq!(store.len().await, 2);

        // This should evict "a".
        store.mark_seen("c").await;
        assert_eq!(store.len().await, 2);

        // "b" and "c" are tracked.
        assert!(store.is_duplicate("b").await);
        assert!(store.is_duplicate("c").await);

        // "a" was evicted — re-checking it re-adds it (evicting "b").
        assert!(!store.is_duplicate("a").await);
    }
}
