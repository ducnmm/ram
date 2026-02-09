// Database layer for RAM backend

use crate::models::RamEvent;
use anyhow::Result;
use sqlx::{postgres::PgPoolOptions, Pool, Postgres};
use tracing::info;

pub type DbPool = Pool<Postgres>;

pub struct Database;

impl Database {
    /// Initialize database connection pool
    pub async fn init(database_url: &str) -> Result<DbPool> {
        info!("Connecting to database: {}", database_url);
        
        let pool = PgPoolOptions::new()
            .max_connections(5)
            .connect(database_url)
            .await?;

        // Run migrations
        info!("Running database migrations...");
        sqlx::migrate!("./migrations")
            .run(&pool)
            .await?;

        info!("Database initialized successfully");
        Ok(pool)
    }

    /// Insert a new event into the database
    pub async fn insert_event(pool: &DbPool, event: &RamEvent) -> Result<i64> {
        let timestamp_ms = event.timestamp.timestamp_millis();
        
        let result = sqlx::query!(
            r#"
            INSERT INTO ram_events (
                event_type, transaction_digest, timestamp_ms,
                handle, from_handle, to_handle, amount
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (transaction_digest, event_type, handle) DO NOTHING
            RETURNING id
            "#,
            event.event_type,
            event.tx_digest,
            timestamp_ms,
            event.handle,
            event.from_handle,
            event.to_handle,
            event.amount
        )
        .fetch_optional(pool)
        .await?;

        Ok(result.map(|r| r.id).unwrap_or(0))
    }

    /// Get events for a specific handle with pagination
    pub async fn get_events_by_handle(
        pool: &DbPool,
        handle: &str,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<RamEvent>> {
        let rows = sqlx::query!(
            r#"
            SELECT 
                event_type, transaction_digest as tx_digest, 
                to_timestamp(timestamp_ms / 1000.0) as "timestamp!",
                handle, from_handle, to_handle, amount
            FROM ram_events
            WHERE handle = $1 OR from_handle = $1 OR to_handle = $1
            ORDER BY timestamp_ms DESC
            LIMIT $2 OFFSET $3
            "#,
            handle,
            limit,
            offset
        )
        .fetch_all(pool)
        .await?;

        let events = rows
            .into_iter()
            .map(|row| RamEvent {
                event_type: row.event_type,
                tx_digest: row.tx_digest,
                timestamp: row.timestamp,
                handle: row.handle,
                from_handle: row.from_handle,
                to_handle: row.to_handle,
                amount: row.amount,
                owner: None,
            })
            .collect();

        Ok(events)
    }
}

