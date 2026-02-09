import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCurrentAccount, useDisconnectWallet, ConnectModal } from '@mysten/dapp-kit'
import { useRamWallet } from '../hooks/useRamWallet'
import './WalletMenu.css'

export function WalletMenu() {
    const account = useCurrentAccount()
    const { mutate: disconnect } = useDisconnectWallet()
    const { displayName } = useRamWallet()
    const navigate = useNavigate()
    const [open, setOpen] = useState(false)
    const [connectOpen, setConnectOpen] = useState(false)
    const menuRef = useRef<HTMLDivElement>(null)

    // Close dropdown on outside click
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setOpen(false)
            }
        }
        if (open) {
            document.addEventListener('mousedown', handleClickOutside)
        }
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [open])

    const handleMenuAction = (action: () => void) => {
        setOpen(false)
        action()
    }

    // Not connected → open ConnectModal
    if (!account) {
        return (
            <ConnectModal
                trigger={
                    <button className="wallet-circle-btn">
                        <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4" />
                            <path d="M4 6v12a2 2 0 0 0 2 2h14v-4" />
                            <path d="M18 12a2 2 0 0 0 0 4h4v-4h-4z" />
                        </svg>
                    </button>
                }
                open={connectOpen}
                onOpenChange={setConnectOpen}
            />
        )
    }

    // Connected → custom dropdown
    return (
        <div className="wallet-menu" ref={menuRef}>
            <button className="wallet-circle-btn" onClick={() => setOpen(!open)}>
                <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4" />
                    <path d="M4 6v12a2 2 0 0 0 2 2h14v-4" />
                    <path d="M18 12a2 2 0 0 0 0 4h4v-4h-4z" />
                </svg>
            </button>

            {open && (
                <div className="wallet-dropdown">
                    <div className="dropdown-account">
                        <span className="account-name">{displayName}</span>
                        <svg className="check-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                        </svg>
                    </div>

                    <div className="dropdown-divider" />

                    <button className="dropdown-item" onClick={() => handleMenuAction(() => navigate('/history'))}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10" />
                            <polyline points="12 6 12 12 16 14" />
                        </svg>
                        <span>History</span>
                    </button>

                    <div className="dropdown-divider" />

                    <button className="dropdown-item dropdown-item-danger" onClick={() => handleMenuAction(() => disconnect())}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                            <polyline points="16 17 21 12 16 7" />
                            <line x1="21" y1="12" x2="9" y2="12" />
                        </svg>
                        <span>Disconnect</span>
                    </button>
                </div>
            )}
        </div>
    )
}
