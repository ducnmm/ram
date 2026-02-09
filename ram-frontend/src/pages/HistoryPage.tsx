import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCurrentAccount } from '@mysten/dapp-kit'
import { getWalletEvents, type WalletEvent } from '../services/ramApi'
import { useRamWallet } from '../hooks/useRamWallet'
import './HistoryPage.css'

export function HistoryPage() {
    const navigate = useNavigate()
    const account = useCurrentAccount()
    const [events, setEvents] = useState<WalletEvent[]>([])
    const [loading, setLoading] = useState(true)
    const { walletInfo } = useRamWallet()
    const handle = walletInfo?.handle || null

    useEffect(() => {
        if (account?.address && handle) {
            loadEvents()
        } else {
            setLoading(false)
        }
    }, [account, handle])

    const loadEvents = async () => {
        if (!handle) return

        try {
            setLoading(true)
            const data = await getWalletEvents({ handle, limit: 50 })
            setEvents(data)
        } catch (error) {
            console.error('Failed to load events:', error)
        } finally {
            setLoading(false)
        }
    }

    const formatTimestamp = (timestamp: string) => {
        const date = new Date(timestamp)
        return date.toLocaleString()
    }

    const formatDigest = (digest: string) => {
        return `${digest.slice(0, 8)}...${digest.slice(-8)}`
    }

    const formatAmount = (amount: number | null) => {
        if (amount === null) return null
        return (amount / 1_000_000_000).toFixed(2) + ' SUI'
    }

    const getEventColor = (eventType: string) => {
        switch (eventType) {
            case 'WalletCreated': return '#10b981'
            case 'Deposited': return '#3b82f6'
            case 'Withdrawn': return '#f59e0b'
            case 'Transferred': return '#8b5cf6'
            case 'AddressLinked': return '#6b7280'
            case 'WalletLocked': return '#ef4444'
            default: return '#6b7280'
        }
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
                    <h2 className="page-title">Wallet History</h2>
                </div>
                <div className="history-body">
                    {!account ? (
                        <div className="empty-state">
                            <p>Please connect your wallet to view history</p>
                        </div>
                    ) : loading ? (
                        <div className="loading-state">
                            <p>Loading events...</p>
                        </div>
                    ) : events.length === 0 ? (
                        <div className="empty-state">
                            <p>No events found for @{handle}</p>
                        </div>
                    ) : (
                        <div className="transactions-list">
                            {events.map((event) => (
                                <div key={event.tx_digest + event.event_type} className="transaction-item">
                                    <div className="transaction-header">
                                        <div className="transaction-type">
                                            <span className="event-dot" style={{ backgroundColor: getEventColor(event.event_type) }}></span>
                                            <span className="event-name">{event.event_type}</span>
                                            {event.amount !== null && (
                                                <span className="amount">{formatAmount(event.amount)}</span>
                                            )}
                                        </div>
                                        <span className="transaction-time">
                                            {formatTimestamp(event.timestamp)}
                                        </span>
                                    </div>
                                    {(event.from_handle || event.to_handle) && (
                                        <div className="transaction-details">
                                            {event.from_handle && (
                                                <span className="detail">From: @{event.from_handle}</span>
                                            )}
                                            {event.to_handle && event.event_type === 'Transferred' && (
                                                <span className="detail">To: @{event.to_handle}</span>
                                            )}
                                            {event.to_handle && event.event_type === 'AddressLinked' && (
                                                <span className="detail">Address: {event.to_handle.slice(0, 8)}...{event.to_handle.slice(-6)}</span>
                                            )}
                                        </div>
                                    )}
                                    <div className="transaction-digest">
                                        <span className="label">Tx:</span>
                                        <a
                                            href={`https://suiscan.xyz/testnet/tx/${event.tx_digest}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="digest-link"
                                        >
                                            {formatDigest(event.tx_digest)}
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
