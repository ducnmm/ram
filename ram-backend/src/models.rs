// Database models for RAM backend

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// RAM event stored in database
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RamEvent {
    pub handle: Option<String>,
    pub event_type: String,
    pub amount: Option<i64>,
    pub from_handle: Option<String>,
    pub to_handle: Option<String>,
    pub owner: Option<String>,
    pub tx_digest: String,
    pub timestamp: DateTime<Utc>,
}

/// Request to get events for a wallet
#[derive(Debug, Deserialize)]
pub struct GetEventsRequest {
    pub handle: String,
    #[serde(default = "default_limit")]
    pub limit: i64,
    #[serde(default)]
    pub offset: i64,
}

fn default_limit() -> i64 {
    50
}

/// Response with paginated events
#[derive(Debug, Serialize)]
pub struct EventsResponse {
    pub events: Vec<RamEvent>,
    pub total: i64,
    pub limit: i64,
    pub offset: i64,
}

/// Wallet summary statistics
#[derive(Debug, Serialize)]
pub struct WalletStats {
    pub handle: String,
    pub total_deposits: i64,
    pub total_withdrawals: i64,
    pub total_transfers_sent: i64,
    pub total_transfers_received: i64,
}

