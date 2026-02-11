// RAM Backend Server
// Proxy layer between frontend and Nautilus server + Event indexer

mod database;
mod indexer;
mod models;
mod proxy;

use anyhow::Result;
use axum::{
    routing::{get, post},
    Router,
};
use database::DbPool;
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};
use tracing::info;

/// Application state shared across handlers
#[derive(Clone)]
pub struct AppState {
    pub db: DbPool,
    pub nautilus_url: String,
}

#[tokio::main]
async fn main() -> Result<()> {
    // Load environment variables
    dotenvy::dotenv().ok();

    // Initialize logging
    tracing_subscriber::fmt()
        .with_target(false)
        .with_level(true)
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive("ram_backend=info".parse().unwrap())
                .add_directive("sqlx=warn".parse().unwrap()),
        )
        .init();

    info!("Starting RAM Backend Server");

    // Load configuration
    let database_url =
        std::env::var("DATABASE_URL").unwrap_or_else(|_| "sqlite:ram.db".to_string());
    let nautilus_url =
        std::env::var("NAUTILUS_URL").unwrap_or_else(|_| "http://localhost:3000".to_string());
    let sui_rpc_url =
        std::env::var("SUI_RPC_URL").expect("SUI_RPC_URL must be set in environment");
    let package_id = std::env::var("RAM_PACKAGE_ID").expect("RAM_PACKAGE_ID must be set");
    let server_port = std::env::var("PORT")
        .unwrap_or_else(|_| "4000".to_string())
        .parse::<u16>()?;

    info!("Configuration:");
    info!("  Database: {}", database_url);
    info!("  Nautilus Server: {}", nautilus_url);
    info!("  Sui RPC: {}", sui_rpc_url);
    info!("  RAM Package ID: {}", package_id);
    info!("  Server Port: {}", server_port);

    // Initialize database
    let db = database::Database::init(&database_url).await?;

    // Create app state
    let state = Arc::new(AppState {
        db: db.clone(),
        nautilus_url: nautilus_url.clone(),
    });

    // Start event indexer in background
    let indexer_db = db.clone();
    let indexer_rpc = sui_rpc_url.clone();
    let indexer_package = package_id.clone();
    tokio::spawn(async move {
        info!("Starting event indexer...");
        let indexer = indexer::Indexer::new(
            indexer_rpc,
            indexer_package,
            indexer_db,
        );

        if let Err(e) = indexer.run().await {
            tracing::error!("Indexer error: {}", e);
        }
    });

    // Setup CORS
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    // Build router
    let app = Router::new()
        // Backend-specific endpoints
        .route("/health", get(proxy::health_check))
        .route("/api/events", post(proxy::get_wallet_events))
        .route("/api/stats", post(proxy::get_wallet_stats))
        // Proxy all Nautilus endpoints
        .route("/health_check", get(proxy::proxy_to_nautilus))
        .route("/process_create_wallet", post(proxy::proxy_to_nautilus))
        .route("/process_link_address", post(proxy::proxy_to_nautilus))
        .route("/process_bio_auth", post(proxy::proxy_to_nautilus))
        .route("/process_tweet", post(proxy::proxy_to_nautilus))
        .route("/process_init_account", post(proxy::proxy_to_nautilus))
        .route("/process_update_handle", post(proxy::proxy_to_nautilus))
        .route("/process_secure_link_wallet", post(proxy::proxy_to_nautilus))
        .route("/get_attestation", get(proxy::proxy_to_nautilus))
        // Frontend-facing proxy routes (simpler names)
        .route("/create_wallet", post(proxy::proxy_to_nautilus))
        .route("/link_address", post(proxy::proxy_to_nautilus))
        .route("/bio_auth", post(proxy::proxy_to_nautilus))
        .route("/transfer", post(proxy::proxy_to_nautilus))
        .route("/withdraw", post(proxy::proxy_to_nautilus))
        .with_state(state)
        .layer(cors);

    // Start server
    let addr = format!("0.0.0.0:{}", server_port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    info!("RAM Backend listening on {}", listener.local_addr()?);

    axum::serve(listener, app.into_make_service())
        .await
        .map_err(|e| anyhow::anyhow!("Server error: {}", e))
}
