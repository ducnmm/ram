// Proxy handlers for forwarding requests to Nautilus server

use axum::{
    body::Body,
    extract::State,
    http::{Request, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use reqwest::Client;
use serde_json::Value;
use std::sync::Arc;
use tracing::{error, info};

use crate::AppState;

/// Generic proxy handler that forwards requests to Nautilus server
pub async fn proxy_to_nautilus(
    State(state): State<Arc<AppState>>,
    req: Request<Body>,
) -> Result<Response, StatusCode> {
    let path = req.uri().path().to_string();
    let method_str = req.method().as_str().to_string();
    
    info!("Proxying {} request to Nautilus: {}", method_str, path);

    // Build Nautilus URL
    let nautilus_url = format!("{}{}", state.nautilus_url, path);

    // Extract body
    let body_bytes = axum::body::to_bytes(req.into_body(), usize::MAX)
        .await
        .map_err(|e| {
            error!("Failed to read request body: {}", e);
            StatusCode::BAD_REQUEST
        })?;

    // Forward request to Nautilus
    let client = Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let method = reqwest::Method::from_bytes(method_str.as_bytes())
        .map_err(|_| StatusCode::METHOD_NOT_ALLOWED)?;
    
    let response = client
        .request(method, &nautilus_url)
        .header("Content-Type", "application/json")
        .body(body_bytes.to_vec())
        .send()
        .await
        .map_err(|e| {
            error!("Failed to proxy request to Nautilus: {}", e);
            StatusCode::BAD_GATEWAY
        })?;

    // Get response status and body
    let status_code = response.status().as_u16();
    let response_bytes = response.bytes().await.map_err(|e| {
        error!("Failed to read Nautilus response: {}", e);
        StatusCode::BAD_GATEWAY
    })?;

    info!("Nautilus response status: {}", status_code);

    // Return proxied response
    Ok(Response::builder()
        .status(status_code)
        .header("Content-Type", "application/json")
        .body(Body::from(response_bytes))
        .unwrap())
}

/// Health check endpoint
pub async fn health_check(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    // Check Nautilus server health
    let client = Client::new();
    let nautilus_health = client
        .get(format!("{}/health_check", state.nautilus_url))
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false);

    // Check database health
    let db_health = sqlx::query("SELECT 1")
        .fetch_one(&state.db)
        .await
        .is_ok();

    let status = if nautilus_health && db_health {
        "healthy"
    } else {
        "unhealthy"
    };

    Json(serde_json::json!({
        "status": status,
        "nautilus_server": if nautilus_health { "up" } else { "down" },
        "database": if db_health { "up" } else { "down" },
        "indexer": "running"
    }))
}

/// Get events for a wallet
pub async fn get_wallet_events(
    State(state): State<Arc<AppState>>,
    Json(req): Json<crate::models::GetEventsRequest>,
) -> Result<Json<Vec<crate::models::RamEvent>>, StatusCode> {
    use crate::database::Database;

    let events = Database::get_events_by_handle(
        &state.db,
        &req.handle,
        req.limit,
        req.offset,
    )
    .await
    .map_err(|e| {
        error!("Failed to fetch events: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(Json(events))
}

/// Get wallet statistics
pub async fn get_wallet_stats(
    State(_state): State<Arc<AppState>>,
    Json(handle): Json<Value>,
) -> Result<Json<crate::models::WalletStats>, StatusCode> {
    let handle_str = handle["handle"]
        .as_str()
        .ok_or(StatusCode::BAD_REQUEST)?;

    // TODO: Implement statistics calculation
    Ok(Json(crate::models::WalletStats {
        handle: handle_str.to_string(),
        total_deposits: 0,
        total_withdrawals: 0,
        total_transfers_sent: 0,
        total_transfers_received: 0,
    }))
}

