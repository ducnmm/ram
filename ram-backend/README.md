# RAM Backend

Backend service for RAM (Rust Audio Money) wallet application.

## Features

- **API Proxy**: Routes frontend requests to Nautilus enclave server
- **Event Indexer**: Continuously indexes blockchain events from Sui
- **REST API**: Provides event history and wallet statistics
- **SQLite Database**: Stores indexed events for fast querying

## Architecture

```
Frontend → RAM Backend → Nautilus Server (Enclave)
              ↓
         Event Indexer → Sui Blockchain
              ↓
          SQLite DB
```

## API Endpoints

### Proxy Endpoints (Forward to Nautilus)

- `POST /process_create_wallet` - Create new RAM wallet
- `POST /process_link_address` - Link Sui address to wallet
- `POST /process_bio_auth` - Voice authentication
- `GET /health_check` - Nautilus server health

### Backend-Specific Endpoints

- `GET /health` - Backend health (includes DB and Nautilus status)
- `POST /api/events` - Get wallet event history
- `POST /api/stats` - Get wallet statistics

## Event Types Indexed

1. **WalletCreated** - New wallet created
2. **AddressLinked** - Sui address linked to wallet
3. **Deposited** - Coins deposited to wallet
4. **Withdrawn** - Coins withdrawn from wallet
5. **Transferred** - Coins transferred between wallets
6. **WalletLocked** - Wallet locked (duress detected)
7. **BioAuthCompleted** - Voice authentication completed

## Setup

### 1. Install Dependencies

```bash
# Rust toolchain required
rustup update stable
```

### 2. Start PostgreSQL Database

```bash
# Start PostgreSQL using Docker
docker-compose up -d

# Check if running
docker-compose ps
```

### 3. Configure Environment

```bash
cp .env.example .env
# Edit .env with your configuration
# Note: DATABASE_URL is pre-configured for Docker PostgreSQL
```

### 4. Run Migrations

Migrations run automatically on startup.

### 5. Start Server

```bash
cargo run --release
```

## Configuration

Edit `.env` file:
PostgreSQL connection string (default: `postgres://ram:ram123@localhost:5434/ram
- `DATABASE_URL` - SQLite database path (default: `sqlite:ram.db`)
- `NAUTILUS_URL` - Nautilus enclave server URL (default: `http://localhost:3000`)
- `SUI_RPC_URL` - Sui RPC endpoint
- `RAM_PACKAGE_ID` - RAM smart contract package ID on Sui
- `PORT` - Backend server port (default: `4000`)
- `INDEXER_POLL_INTERVAL_SECS` - How often to poll for new events (default: `10`)

## API Usage

### Get Wallet Events

```bash
curl -X POST http://localhost:4000/api/events \
  -H "Content-Type: application/json" \
  -d '{
    "handle": "alice",
    "limit": 50,
    "offset": 0,
    "event_type": "Deposited"
  }'
```

Response:
```json
{
  "events": [
    {
      "id": 1,
      "event_type": "Deposited",
      "transaction_digest": "0x123...",
      "timestamp_ms": 1707523200000,
      "handle": "alice",
      "coin_type": "0x2::sui::SUI",
      "amount": 1000000000,
      "created_at": "2024-02-09T12:00:00Z"
    }
  ],
  "total": 1,
  "limit": 50,
  "offset": 0
}
```

### Get Wallet Stats

```bash
curl -X POST http://localhost:4000/api/stats \
  -H "Content-Type: application/json" \
  -d '{"handle": "alice"}'
```

Response:
```json
{
  "handle": "alice",
  "total_deposits": 5,
  "total_withdrawals": 2,
  "total_transfers_sent": 3,
  "total_transfers_received": 1,
  "last_activity": "2024-02-09T12:00:00Z"
}
```

## Development

```bash
# Run with debug logging
RUST_LOG=debug cargo run

# Run tests
cargo test

# Format code
cargo fmt

# Check for issues
cargo clippy
```

## Database Schema
in PostgreSQL with the following structure:

- `id` - Auto-incrementing primary key (BIGSERIAL)
- `event_type` - Type of event (WalletCreated, Deposited, etc.)
- `transaction_digest` - Sui transaction hash
- `timestamp_ms` - Event timestamp (BIGINT)
- `handle`, `from_handle`, `to_handle` - Wallet handles
- `coin_type`, `amount` - Financial data
- `wallet_id`, `linked_address` - Identity data
- `result`, `locked_until_ms` - Status data
- `created_at` - Record creation timestamp (TIMESTAMPTZ)

## Docker Commands

See [DOCKER.md](DOCKER.md) for detailed Docker commands and database management.data
- `result`, `locked_until_ms` - Status data

## License

Apache-2.0
