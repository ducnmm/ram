# RAM — Voice-Secured Wallet on Sui

**RAM** (Rust Audio Money) is a voice-authenticated crypto wallet built on [Sui](https://sui.io). Transactions are signed inside an **AWS Nitro Enclave** (via [Nautilus](https://github.com/MystenLabs/nautilus)), and every transfer/withdrawal requires a **voice confirmation** analyzed for stress — if duress is detected, the wallet locks automatically for 24 hours.

## How It Works

```
User speaks "I confirm sending 10 SUI"
        ↓
┌─────────────────────────────────┐
│  Nautilus Enclave (TEE)         │
│  • Transcribes audio            │
│  • Analyzes stress via Hume AI  │
│  • Signs payload (blind)        │
└──────────────┬──────────────────┘
               ↓
     Sui Move Smart Contract
     • Verifies enclave signature
     • Executes transfer — or locks wallet if duress
```

> The frontend **never** sees the stress result — it only learns the outcome from on-chain events after submission.

## Architecture

| Module | Stack | Role |
|--------|-------|------|
| **ram-nautilus** | Rust · Axum · Move | TEE enclave server + Sui smart contracts |
| **ram-backend** | Rust · Axum · PostgreSQL | API proxy, event indexer, history/stats |
| **ram-frontend** | React 19 · Vite · MUI · Sui dApp Kit | Wallet UI with voice recording |

## Key Features

- 🎙 **Voice 2FA** — Confirm transactions by speaking the amount
- 🔒 **Duress Detection** — Stress analysis auto-locks wallet for 24h
- 🏦 **Enclave Signing** — All sensitive logic runs inside AWS Nitro TEE
- 💸 **Transfer & Withdraw** — Between RAM wallets or to external Sui addresses
- 📊 **Event Indexer** — Full transaction history indexed from Sui blockchain

## Quick Start

```bash
# 1. Backend (API proxy + indexer)
cd ram-backend
cp .env.example .env        # configure DB, Sui RPC, etc.
docker-compose up -d        # start PostgreSQL
cargo run --release

# 2. Nautilus Enclave Server
cd ram-nautilus/src/nautilus-server
cp .env.example .env        # configure API keys
cargo run --release --features ram --bin ram-server

# 3. Frontend
cd ram-frontend
cp .env.example .env
npm install && npm run dev
```

## Smart Contracts (Move)

Located in `ram-nautilus/move/ram/sources/`:

| File | Purpose |
|------|---------|
| `core.move` | Package init, enclave registration |
| `wallet.move` | Wallet CRUD, deposit, withdraw |
| `transfers.move` | Inter-wallet transfers with signature verification |
| `bioguard.move` | Voice auth verification, duress locking |
| `events.move` | On-chain event definitions |

## License

Apache-2.0
