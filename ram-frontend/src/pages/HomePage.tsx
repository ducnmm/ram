import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useCurrentAccount, useSignAndExecuteTransaction } from '@mysten/dapp-kit'
import { WalletMenu } from '../components/WalletMenu'
import { Transaction } from '@mysten/sui/transactions'
import { motion, AnimatePresence } from 'framer-motion'
import { TransferPanel } from '../components/TransferPanel'
import { DepositPanel } from '../components/DepositPanel'
import { WithdrawPanel } from '../components/WithdrawPanel'
import { SUI_PACKAGE_ID, RAM_REGISTRY_ID } from '../services/ramApi'
import { useRamWallet } from '../hooks/useRamWallet'
import './HomePage.css'

type ExpandedCard = 'transfers' | 'deposit' | 'withdraw' | null

type Toast = {
    message: string;
    visible: boolean;
};

export function HomePage() {
    const account = useCurrentAccount()
    const { mutate: signAndExecute } = useSignAndExecuteTransaction()
    const navigate = useNavigate()
    const location = useLocation()
    const [expanded, setExpanded] = useState<ExpandedCard>(null)
    const [creating, setCreating] = useState(false)
    const [toast, setToast] = useState<Toast>({ message: '', visible: false })

    const { walletInfo, loading, suinsName, displayName, isLocked, refetch } = useRamWallet()

    // Sync state from URL
    useEffect(() => {
        if (location.pathname === '/transfer') {
            if (isLocked) {
                navigate('/')
                return
            }
            setExpanded('transfers')
        } else if (location.pathname === '/deposit') {
            setExpanded('deposit')
        } else if (location.pathname === '/withdraw') {
            if (isLocked) {
                navigate('/')
                return
            }
            setExpanded('withdraw')
        } else {
            setExpanded(null)
        }
    }, [location.pathname, isLocked])





    const showToast = (message: string) => {
        setToast({ message, visible: true })
        setTimeout(() => {
            setToast({ message: '', visible: false })
        }, 3000)
    }

    const handleCreateWallet = async () => {
        if (!account?.address) return

        try {
            setCreating(true)
            const handle = suinsName || `user_${account.address.slice(2, 8)}`

            // Create transaction to create wallet
            const tx = new Transaction()

            // Call create_wallet_no_sig - it shares the wallet internally (no return value)
            tx.moveCall({
                target: `${SUI_PACKAGE_ID}::wallet::create_wallet_no_sig`,
                arguments: [
                    tx.object(RAM_REGISTRY_ID),
                    tx.pure.string(handle)
                ]
            })

            // Execute transaction
            signAndExecute(
                { transaction: tx },
                {
                    onSuccess: (_result) => {
                        setCreating(false)
                        // Wait a bit for blockchain to process, then refresh
                        setTimeout(() => {
                            refetch()
                        }, 3000)
                    },
                    onError: (error) => {
                        setCreating(false)
                        const errorMsg = error.message || String(error)

                        // Check if wallet already exists
                        if (errorMsg.includes('MoveAbort') || errorMsg.includes('EAddressAlreadyExists')) {
                            showToast('You already have a wallet. Refreshing...')
                            // Wallet already exists, just refresh to show it
                            setTimeout(() => {
                                refetch()
                            }, 1000)
                        } else {
                            showToast('Failed to create wallet. Please try again.')
                        }
                    }
                }
            )
        } catch (error) {
            showToast('Failed to create wallet. Please try again.')
            setCreating(false)
        }
    }

    const handleExpandCard = (card: ExpandedCard) => {
        if ((card === 'transfers' || card === 'withdraw') && isLocked) {
            const remainMs = walletInfo!.lockedUntil - Date.now()
            const remainMin = Math.ceil(remainMs / 60000)
            const remainHrs = Math.floor(remainMin / 60)
            const remainMinOnly = remainMin % 60
            const timeStr = remainHrs > 0 ? `${remainHrs}h ${remainMinOnly}m` : `${remainMin}m`
            showToast(`Wallet is locked. Try again in ${timeStr}.`)
            return
        }
        if (card === 'transfers') {
            navigate('/transfer')
        } else if (card === 'deposit') {
            navigate('/deposit')
        } else if (card === 'withdraw') {
            navigate('/withdraw')
        }
    }

    const handleCloseCard = () => {
        navigate('/')
    }

    return (
        <div className="home-shell">
            {toast.visible && (
                <div className="toast-notification">
                    <svg className="toast-icon" viewBox="0 0 16 16" fill="none">
                        <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="2" />
                        <path d="M8 4v4M8 11h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                    <span>{toast.message}</span>
                </div>
            )}
            <div className="home-container">
                {expanded === null ? (
                    <>
                        <motion.div
                            className="greeting-card"
                            initial={{ opacity: 0, scale: 0.8 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ duration: 0.1 }}
                        >
                            <div className="greeting-content">
                                <div className="wallet-btn-wrapper">
                                    <WalletMenu />
                                </div>
                                <div className="greeting-text">
                                    <h1 className="greeting-title">
                                        Hi {displayName}
                                        {isLocked && (
                                            <span className="lock-badge" title={`Wallet locked until ${new Date(walletInfo!.lockedUntil).toLocaleTimeString()}`}>
                                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                                                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                                                </svg>
                                            </span>
                                        )}
                                    </h1>
                                    {loading ? (
                                        <p className="greeting-balance">Loading...</p>
                                    ) : walletInfo ? (
                                        <p className="greeting-balance">
                                            {(Number(walletInfo.balance) / 1_000_000_000).toFixed(2)} SUI
                                        </p>
                                    ) : account ? (
                                        <button className="create-wallet-btn" onClick={handleCreateWallet} disabled={creating}>
                                            {creating ? 'Creating...' : 'Create Wallet'}
                                        </button>
                                    ) : (
                                        <p className="greeting-balance">Connect wallet to start</p>
                                    )}
                                </div>
                            </div>
                        </motion.div>
                        <motion.div
                            className="cards-grid"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ duration: 0.1, delay: 0.05 }}
                        >
                            <motion.div
                                className={`action-card action-card-transfers${isLocked ? ' action-card-disabled' : ''}`}
                                onClick={() => handleExpandCard('transfers')}
                                whileTap={isLocked ? {} : { scale: 0.98 }}
                                initial={{ opacity: 0, scale: 0.8 }}
                                animate={{ opacity: 1, scale: 1 }}
                                transition={{ duration: 0.1, delay: 0.1 }}
                            >
                                <span className="action-card-label">
                                    {isLocked && (
                                        <svg className="card-lock-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                                            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                                        </svg>
                                    )}
                                    Transfers
                                </span>
                            </motion.div>
                            <div className="action-cards-right">
                                <motion.div
                                    className="action-card action-card-small"
                                    onClick={() => handleExpandCard('deposit')}
                                    whileTap={{ scale: 0.98 }}
                                    initial={{ opacity: 0, scale: 0.8 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    transition={{ duration: 0.1, delay: 0.12 }}
                                >
                                    <span className="action-card-label">Deposit</span>
                                </motion.div>
                                <motion.div
                                    className={`action-card action-card-small${isLocked ? ' action-card-disabled' : ''}`}
                                    onClick={() => handleExpandCard('withdraw')}
                                    whileTap={isLocked ? {} : { scale: 0.98 }}
                                    initial={{ opacity: 0, scale: 0.8 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    transition={{ duration: 0.1, delay: 0.1 }}
                                >
                                    <span className="action-card-label">
                                        {isLocked && (
                                            <svg className="card-lock-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                                                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                                            </svg>
                                        )}
                                        Withdraw
                                    </span>
                                </motion.div>
                            </div>
                        </motion.div>
                    </>
                ) : (
                    <motion.div
                        className="expanded-card"
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        transition={{
                            type: "spring",
                            stiffness: 300,
                            damping: 30
                        }}
                    >
                        <div className="expanded-header">
                            <motion.button
                                className="back-btn"
                                onClick={handleCloseCard}
                                whileHover={{ scale: 1.1 }}
                                whileTap={{ scale: 0.9 }}
                            >
                                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M19 12H5M12 19l-7-7 7-7" />
                                </svg>
                            </motion.button>
                        </div>
                        <motion.div
                            className="expanded-body"
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.1 }}
                        >
                            <AnimatePresence mode="wait">
                                <motion.div
                                    key={expanded}
                                    initial={{ opacity: 0, x: 20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: -20 }}
                                    transition={{ duration: 0.2 }}
                                >
                                    {expanded === 'transfers' ? <TransferPanel /> : expanded === 'deposit' ? <DepositPanel /> : <WithdrawPanel />}
                                </motion.div>
                            </AnimatePresence>
                        </motion.div>
                    </motion.div>
                )}
            </div>
        </div>
    )
}
