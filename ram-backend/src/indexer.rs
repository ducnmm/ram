use crate::models::RamEvent;
use crate::database::Database;
use chrono::{Utc, TimeZone};
use reqwest::Client as HttpClient;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::PgPool;
use std::time::Duration;
use tracing::{info, warn, error};
use anyhow::{Result, anyhow};

const POLL_INTERVAL: Duration = Duration::from_secs(5);
const BATCH_SIZE: u64 = 50;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventId {
    pub tx_digest: String,
    pub event_seq: String,
}

impl EventId {
    pub fn to_cursor(&self) -> String {
        format!("{}:{}", self.tx_digest, self.event_seq)
    }
    
    pub fn from_cursor(cursor: &str) -> Option<Self> {
        let parts: Vec<&str> = cursor.split(':').collect();
        if parts.len() == 2 {
            Some(EventId {
                tx_digest: parts[0].to_string(),
                event_seq: parts[1].to_string(),
            })
        } else {
            None
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventPage {
    pub data: Vec<SuiEvent>,
    pub next_cursor: Option<EventId>,
    pub has_next_page: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SuiEvent {
    pub id: EventId,
    #[serde(rename = "type")]
    pub event_type: String,
    pub parsed_json: Value,
    pub timestamp_ms: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RpcResponse<T> {
    jsonrpc: String,
    result: Option<T>,
    error: Option<RpcError>,
    id: i64,
}

#[derive(Debug, Deserialize)]
struct RpcError {
    code: i64,
    message: String,
}

pub struct Indexer {
    http_client: HttpClient,
    rpc_url: String,
    package_id: String,
    pool: PgPool,
}

impl Indexer {
    pub fn new(rpc_url: String, package_id: String, pool: PgPool) -> Self {
        Self {
            http_client: HttpClient::new(),
            rpc_url,
            package_id,
            pool,
        }
    }

    pub async fn run(&self) -> Result<()> {
        info!("Starting indexer for package {}", self.package_id);
        
        let mut cursor = self.load_cursor().await?;
        
        loop {
            match self.fetch_and_process_events(cursor.as_ref()).await {
                Ok(new_cursor) => {
                    if let Some(new_cursor) = new_cursor {
                        self.save_cursor(&new_cursor).await?;
                        cursor = Some(new_cursor);
                    }
                }
                Err(e) => {
                    error!("Error processing events: {}", e);
                }
            }
            
            tokio::time::sleep(POLL_INTERVAL).await;
        }
    }

    async fn fetch_and_process_events(
        &self,
        cursor: Option<&EventId>,
    ) -> Result<Option<EventId>> {
        let filter = json!({
            "MoveEventModule": {
                "package": self.package_id,
                "module": "events"
            }
        });
        
        let cursor_value = cursor
            .map(|c| json!(c))
            .unwrap_or(Value::Null);
        
        let payload = json!({
            "jsonrpc": "2.0",
            "method": "suix_queryEvents",
            "params": [filter, cursor_value, BATCH_SIZE, false],
            "id": 1
        });

        let resp = self.http_client
            .post(&self.rpc_url)
            .json(&payload)
            .send()
            .await?;

        let rpc_resp: RpcResponse<EventPage> = resp.json().await?;
        
        if let Some(error) = rpc_resp.error {
            return Err(anyhow!("RPC error: {} ({})", error.message, error.code));
        }
        
        let event_page = rpc_resp.result.ok_or_else(|| anyhow!("No result in RPC response"))?;
        
        if event_page.data.is_empty() {
            return Ok(None);
        }

        info!("Fetched {} events", event_page.data.len());

        for event in &event_page.data {
            if let Err(e) = self.process_event(event).await {
                warn!("Failed to process event {:?}: {}", event.id, e);
            }
        }

        Ok(event_page.next_cursor)
    }

    async fn process_event(&self, event: &SuiEvent) -> Result<()> {
        let event_type_parts: Vec<&str> = event.event_type.split("::").collect();
        let event_name = event_type_parts.last().ok_or_else(|| anyhow!("Invalid event type"))?;

        let handle = self.extract_handle(&event.parsed_json)?;
        let tx_digest = event.id.tx_digest.clone();
        
        let timestamp = if let Some(ts_str) = &event.timestamp_ms {
            let ts_millis: i64 = ts_str.parse()?;
            Utc.timestamp_millis_opt(ts_millis).single().unwrap_or_else(Utc::now)
        } else {
            Utc::now()
        };

        let ram_event = match *event_name {
            "WalletCreated" => {
                let owner = event.parsed_json["owner"].as_str().unwrap_or("").to_string();
                RamEvent {
                    handle: Some(handle.clone()),
                    event_type: "WalletCreated".to_string(),
                    amount: None,
                    from_handle: None,
                    to_handle: None,
                    owner: Some(owner),
                    tx_digest: tx_digest.clone(),
                    timestamp,
                }
            }
            "AddressLinked" => {
                let address = event.parsed_json["address"].as_str().unwrap_or("").to_string();
                RamEvent {
                    handle: Some(handle.clone()),
                    event_type: "AddressLinked".to_string(),
                    amount: None,
                    from_handle: None,
                    to_handle: Some(address),
                    owner: None,
                    tx_digest: tx_digest.clone(),
                    timestamp,
                }
            }
            "Deposited" => {
                let amount = event.parsed_json["amount"]
                    .as_str()
                    .and_then(|s| s.parse::<i64>().ok())
                    .unwrap_or(0);
                RamEvent {
                    handle: Some(handle.clone()),
                    event_type: "Deposited".to_string(),
                    amount: Some(amount),
                    from_handle: None,
                    to_handle: None,
                    owner: None,
                    tx_digest: tx_digest.clone(),
                    timestamp,
                }
            }
            "Withdrawn" => {
                let amount = event.parsed_json["amount"]
                    .as_str()
                    .and_then(|s| s.parse::<i64>().ok())
                    .unwrap_or(0);
                RamEvent {
                    handle: Some(handle.clone()),
                    event_type: "Withdrawn".to_string(),
                    amount: Some(amount),
                    from_handle: None,
                    to_handle: None,
                    owner: None,
                    tx_digest: tx_digest.clone(),
                    timestamp,
                }
            }
            "Transferred" => {
                let amount = event.parsed_json["amount"]
                    .as_str()
                    .and_then(|s| s.parse::<i64>().ok())
                    .unwrap_or(0);
                let to_handle = event.parsed_json["to_handle"].as_str().unwrap_or("").to_string();
                RamEvent {
                    handle: Some(handle.clone()),
                    event_type: "Transferred".to_string(),
                    amount: Some(amount),
                    from_handle: Some(handle.clone()),
                    to_handle: Some(to_handle),
                    owner: None,
                    tx_digest: tx_digest.clone(),
                    timestamp,
                }
            }
            "WalletLocked" => {
                RamEvent {
                    handle: Some(handle.clone()),
                    event_type: "WalletLocked".to_string(),
                    amount: None,
                    from_handle: None,
                    to_handle: None,
                    owner: None,
                    tx_digest: tx_digest.clone(),
                    timestamp,
                }
            }
            "BioAuthCompleted" => {
                let success = event.parsed_json["success"].as_bool().unwrap_or(false);
                RamEvent {
                    handle: Some(handle.clone()),
                    event_type: if success { "BioAuthSuccess" } else { "BioAuthFailed" }.to_string(),
                    amount: None,
                    from_handle: None,
                    to_handle: None,
                    owner: None,
                    tx_digest: tx_digest.clone(),
                    timestamp,
                }
            }
            _ => {
                warn!("Unknown event type: {}", event_name);
                return Ok(());
            }
        };

        Database::insert_event(&self.pool, &ram_event).await?;
        info!(
            "Processed {} event for handle {:?}", 
            ram_event.event_type, 
            ram_event.handle
        );

        Ok(())
    }

    fn extract_handle(&self, parsed_json: &Value) -> Result<String> {
        if let Some(handle) = parsed_json["handle"].as_str() {
            Ok(handle.to_string())
        } else if let Some(from_handle) = parsed_json["from_handle"].as_str() {
            Ok(from_handle.to_string())
        } else {
            Err(anyhow!("No handle found in event"))
        }
    }

    async fn load_cursor(&self) -> Result<Option<EventId>> {
        let result = sqlx::query_scalar::<_, String>(
            "SELECT cursor FROM indexer_state WHERE id = 1"
        )
        .fetch_optional(&self.pool)
        .await?;

        Ok(result.and_then(|cursor| EventId::from_cursor(&cursor)))
    }

    async fn save_cursor(&self, cursor: &EventId) -> Result<()> {
        let cursor_str = cursor.to_cursor();
        
        sqlx::query(
            "INSERT INTO indexer_state (id, cursor, updated_at) 
             VALUES (1, $1, NOW())
             ON CONFLICT (id) DO UPDATE SET cursor = $1, updated_at = NOW()"
        )
        .bind(&cursor_str)
        .execute(&self.pool)
        .await?;

        Ok(())
    }
}
