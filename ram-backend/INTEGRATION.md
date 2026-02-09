# RAM Backend - Frontend Integration Guide

## Overview

RAM Backend acts as a middleware layer between your frontend and the Nautilus enclave server. It provides:

1. **Transparent Proxying**: All existing Nautilus API calls work unchanged
2. **Event History API**: New endpoints for querying wallet transaction history
3. **Statistics API**: Wallet activity statistics

## Architecture Update

**Before:**
```
Frontend → Nautilus Server (Port 3000)
```

**After:**
```
Frontend → RAM Backend (Port 4000) → Nautilus Server (Port 3000)
                ↓
         Event Indexer → Sui Blockchain
                ↓
            SQLite DB
```

## Frontend Configuration Changes

### Update API URL

In `ram-frontend/src/services/ramApi.ts`:

```typescript
// Change this:
const RAM_API_URL = import.meta.env.VITE_RAM_API_URL || 'http://localhost:3000';

// To this:
const RAM_API_URL = import.meta.env.VITE_RAM_API_URL || 'http://localhost:4000';
```

### Update .env file

In `ram-frontend/.env`:

```bash
# Change from:
VITE_RAM_API_URL=http://localhost:3000

# To:
VITE_RAM_API_URL=http://localhost:4000
```

## New API Endpoints for Frontend

### 1. Get Wallet Transaction History

Add to `ramApi.ts`:

```typescript
/**
 * Get wallet transaction history (from backend indexer)
 */
export async function getWalletEvents(
  handle: string,
  limit: number = 50,
  offset: number = 0,
  eventType?: string
): Promise<EventsResponse> {
  const response = await fetch(`${RAM_API_URL}/api/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      handle,
      limit,
      offset,
      event_type: eventType,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch events: ${response.status}`);
  }

  return response.json();
}

export interface RamEvent {
  id: number;
  event_type: string;
  transaction_digest: string;
  timestamp_ms: number;
  handle?: string;
  from_handle?: string;
  to_handle?: string;
  coin_type?: string;
  amount?: number;
  wallet_id?: string;
  linked_address?: string;
  result?: number;
  locked_until_ms?: number;
  created_at: string;
}

export interface EventsResponse {
  events: RamEvent[];
  total: number;
  limit: number;
  offset: number;
}
```

### 2. Get Wallet Statistics

```typescript
/**
 * Get wallet statistics (from backend)
 */
export async function getWalletStats(handle: string): Promise<WalletStats> {
  const response = await fetch(`${RAM_API_URL}/api/stats`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ handle }),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch stats: ${response.status}`);
  }

  return response.json();
}

export interface WalletStats {
  handle: string;
  total_deposits: number;
  total_withdrawals: number;
  total_transfers_sent: number;
  total_transfers_received: number;
  last_activity?: string;
}
```

## Update HistoryPage to Use Backend

In `ram-frontend/src/pages/HistoryPage.tsx`, replace the current implementation:

```typescript
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCurrentAccount } from '@mysten/dapp-kit'
import { getWalletEvents, RamEvent } from '../services/ramApi'
import './HistoryPage.css'

export function HistoryPage() {
    const navigate = useNavigate()
    const account = useCurrentAccount()
    const [events, setEvents] = useState<RamEvent[]>([])
    const [loading, setLoading] = useState(true)
    const [walletHandle, setWalletHandle] = useState<string>('')

    useEffect(() => {
        // Get wallet handle from localStorage or wallet info
        const handle = localStorage.getItem('ram_wallet_handle') || ''
        setWalletHandle(handle)
        
        if (handle) {
            loadEvents(handle)
        } else {
            setLoading(false)
        }
    }, [account])

    const loadEvents = async (handle: string) => {
        try {
            setLoading(true)
            const response = await getWalletEvents(handle, 20)
            setEvents(response.events)
        } catch (error) {
            console.error('Failed to load events:', error)
        } finally {
            setLoading(false)
        }
    }

    const formatTimestamp = (timestampMs: number) => {
        return new Date(timestampMs).toLocaleString()
    }

    const formatAmount = (amount?: number, coinType?: string) => {
        if (!amount) return 'N/A'
        const sui = (amount / 1_000_000_000).toFixed(2)
        return `${sui} SUI`
    }

    return (
        <div className="history-page">
            <div className="history-container">
                <div className="history-header">
                    <button className="back-btn" onClick={() => navigate('/')}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                            <path d="M19 12H5M12 19l-7-7 7-7" />
                        </svg>
                    </button>
                    <h2 className="page-title">Transaction History</h2>
                </div>
                <div className="history-body">
                    {!walletHandle ? (
                        <div className="empty-state">
                            <p>Please create a wallet first</p>
                        </div>
                    ) : loading ? (
                        <div className="loading-state">
                            <p>Loading transactions...</p>
                        </div>
                    ) : events.length === 0 ? (
                        <div className="empty-state">
                            <p>No transactions found</p>
                        </div>
                    ) : (
                        <div className="transactions-list">
                            {events.map((event) => (
                                <div key={event.id} className="transaction-item">
                                    <div className="transaction-header">
                                        <div className="transaction-type">
                                            <div className="status-indicator success"></div>
                                            <span>{event.event_type}</span>
                                        </div>
                                        <span className="transaction-time">
                                            {formatTimestamp(event.timestamp_ms)}
                                        </span>
                                    </div>
                                    {event.amount && (
                                        <div className="transaction-amount">
                                            <span className="label">Amount:</span>
                                            <span>{formatAmount(event.amount, event.coin_type)}</span>
                                        </div>
                                    )}
                                    {event.from_handle && (
                                        <div className="transaction-detail">
                                            <span className="label">From:</span>
                                            <span>{event.from_handle}</span>
                                        </div>
                                    )}
                                    {event.to_handle && (
                                        <div className="transaction-detail">
                                            <span className="label">To:</span>
                                            <span>{event.to_handle}</span>
                                        </div>
                                    )}
                                    <div className="transaction-digest">
                                        <span className="label">TX:</span>
                                        <a 
                                            href={`https://suiscan.xyz/testnet/tx/${event.transaction_digest}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="digest-link"
                                        >
                                            {event.transaction_digest.slice(0, 8)}...{event.transaction_digest.slice(-8)}
                                        </a>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
```

## Running the Full Stack

### 0. Start PostgreSQL (New Step!)

```bash
cd ram-backend
docker-compose up -d
```

### 1. Start Nautilus Server (Terminal 1)

```bash
cd ram-nautilus
source .env
cd src/nautilus-server
cargo run --no-default-features --features ram --bin ram-server
```

### 2. Start RAM Backend (Terminal 2)

```bash
cd ram-backend
cp .env.example .env
# Edit .env with your configuration
cargo run --release
```

### 3. Start Frontend (Terminal 3)

```bash
cd ram-frontend
npm run dev
```

## Testing the Integration

1. Open browser to `http://localhost:5173`
2. Create a wallet
3. Make some transactions (deposit, withdraw, transfer)
4. Navigate to History page - you should see indexed events
5. Check backend logs for event indexing activity

## Troubleshooting

### Backend can't connect to Nautilus

Check `NAUTILUS_URL` in `.env` points to running Nautilus server

### Events not appearing

1. Check `RAM_PACKAGE_ID` matches deployed contract
2. Verify `SUI_RPC_URL` is accessible
3. Check backend logs for indexer errors
4. Transactions may take 10-20 seconds to be indexed (polling interval)

### Frontend 404 errors

Ensure `VITE_RAM_API_URL` points to backend (port 4000), not Nautilus (port 3000)
