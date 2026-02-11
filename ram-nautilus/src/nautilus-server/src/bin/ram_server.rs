// Copyright (c) RAM
// SPDX-License-Identifier: Apache-2.0

//! RAM Server Binary
//!
//! Voice-protected wallet server with stress/duress detection.
//!
//! Build and run:
//! ```bash
//! cargo run --no-default-features --features ram --bin ram-server
//! ```
//!
//! Environment variables:
//! - OPENROUTER_API_KEY: For GPT-4o Audio API (optional, falls back to mock)
//! - HUME_API_KEY: For Hume AI emotion detection (optional, enhances stress detection)

use anyhow::Result;
use axum::{routing::get, routing::post, Router};
use fastcrypto::{ed25519::Ed25519KeyPair, traits::KeyPair};
// Import RAM app handlers
use nautilus_server::ram_app::{
    process_create_wallet, process_link_address, process_bio_auth,
    process_transfer, process_withdraw,
};
use nautilus_server::common::{get_attestation, health_check};
use nautilus_server::AppState;
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};
use tracing::info;

#[tokio::main]
async fn main() -> Result<()> {
    // Load .env file
    dotenvy::dotenv().ok();

    // Initialize tracing/logging
    tracing_subscriber::fmt()
        .with_target(false)
        .with_level(true)
        .init();

    info!("Starting RAM Voice Wallet Server");

    let eph_kp = Ed25519KeyPair::generate(&mut rand::thread_rng());

    // RAM configuration (loaded from environment variables)
    let openrouter_api_key = std::env::var("OPENROUTER_API_KEY").unwrap_or_default();
    let hume_api_key = std::env::var("HUME_API_KEY").unwrap_or_default();

    info!("RAM Config:");
    info!("  OpenRouter API: {}", if openrouter_api_key.is_empty() { "(not set - using mock)" } else { "(configured)" });
    info!("  Hume AI API: {}", if hume_api_key.is_empty() { "(not set - GPT-4o stress only)" } else { "(configured - enhanced stress detection)" });

    let state = Arc::new(AppState {
        eph_kp,
        sui_rpc_url: std::env::var("SUI_RPC_URL").unwrap_or_else(|_| "https://fullnode.testnet.sui.io:443".to_string()),
        openrouter_api_key,
        hume_api_key,
    });

    // Define your own restricted CORS policy here if needed.
    let cors = CorsLayer::new().allow_methods(Any).allow_headers(Any).allow_origin(Any);

    let app = Router::new()
        .route("/", get(ping))
        .route("/get_attestation", get(get_attestation))
        // RAM endpoints
        .route("/create_wallet", post(process_create_wallet))
        .route("/link_address", post(process_link_address))
        .route("/bio_auth", post(process_bio_auth))
        .route("/transfer", post(process_transfer))
        .route("/withdraw", post(process_withdraw))
        // Health check
        .route("/health_check", get(health_check))
        .with_state(state)
        .layer(cors);

    let port = std::env::var("PORT").unwrap_or_else(|_| "3000".to_string());
    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", port)).await?;
    info!("RAM Server listening on {}", listener.local_addr().unwrap());
    info!("Endpoints:");
    info!("  POST /create_wallet - Create a new RAM wallet");
    info!("  POST /link_address  - Link Sui address to wallet");
    info!("  POST /bio_auth      - Voice authentication with duress detection");
    info!("  POST /transfer      - Sign a transfer between wallets");
    info!("  POST /withdraw      - Sign a withdrawal from wallet");
    
    axum::serve(listener, app.into_make_service())
        .await
        .map_err(|e| anyhow::anyhow!("Server error: {}", e))
}

async fn ping() -> &'static str {
    "RAM Voice Wallet Server - Pong!"
}
