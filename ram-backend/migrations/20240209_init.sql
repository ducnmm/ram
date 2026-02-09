-- Create table for RAM events
CREATE TABLE IF NOT EXISTS ram_events (
    id BIGSERIAL PRIMARY KEY,
    event_type TEXT NOT NULL,
    transaction_digest TEXT NOT NULL,
    timestamp_ms BIGINT NOT NULL,
    
    -- Common fields
    handle TEXT,
    
    -- Transfer specific fields
    from_handle TEXT,
    to_handle TEXT,
    
    -- Financial fields
    coin_type TEXT,
    amount BIGINT,
    
    -- WalletCreated specific
    wallet_id TEXT,
    
    -- AddressLinked specific
    linked_address TEXT,
    
    -- BioAuthCompleted specific
    result INTEGER,
    
    -- WalletLocked specific
    locked_until_ms BIGINT,
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Unique constraint
    CONSTRAINT unique_tx_event UNIQUE (transaction_digest, event_type, handle)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_handle ON ram_events(handle);
CREATE INDEX IF NOT EXISTS idx_from_handle ON ram_events(from_handle);
CREATE INDEX IF NOT EXISTS idx_to_handle ON ram_events(to_handle);
CREATE INDEX IF NOT EXISTS idx_event_type ON ram_events(event_type);
CREATE INDEX IF NOT EXISTS idx_timestamp ON ram_events(timestamp_ms DESC);
CREATE INDEX IF NOT EXISTS idx_transaction_digest ON ram_events(transaction_digest);

-- Table for indexer cursor state
CREATE TABLE IF NOT EXISTS indexer_state (
    id INTEGER PRIMARY KEY DEFAULT 1,
    cursor TEXT NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT single_row CHECK (id = 1)
);
