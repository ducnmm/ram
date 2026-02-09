import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useCurrentAccount, ConnectButton, useSuiClient, useSignAndExecuteTransaction } from '@mysten/dapp-kit'
import { Transaction } from '@mysten/sui/transactions'
import { motion, AnimatePresence } from 'framer-motion'
import { TransferPanel } from '../components/TransferPanel'
import { DepositPanel } from '../components/DepositPanel'
import { WithdrawPanel } from '../components/WithdrawPanel'
import { SUI_PACKAGE_ID, RAM_REGISTRY_ID } from '../services/ramApi'
import './HomePage.css'

type ExpandedCard = 'transfers' | 'deposit' | 'withdraw' | null

type Toast = {
    message: string;
    visible: boolean;
};

interface WalletInfo {
    id: string;
    handle: string;
    balance: bigint;
}

export function HomePage() {
    const account = useCurrentAccount()
    const suiClient = useSuiClient()
    const { mutate: signAndExecute } = useSignAndExecuteTransaction()
    const navigate = useNavigate()
    const location = useLocation()
    const [expanded, setExpanded] = useState<ExpandedCard>(null)
    const [walletInfo, setWalletInfo] = useState<WalletInfo | null>(null)
    const [suinsName, setSuinsName] = useState<string>('')
    const [loading, setLoading] = useState(false)
    const [creating, setCreating] = useState(false)
    const [toast, setToast] = useState<Toast>({ message: '', visible: false })

    // Mock SuiNS mapping - replace with actual SuiNS API in production
    const addressToSuins: Record<string, string> = {
        '0x3103b5ddad293bb00cf9b54061684293a829f2a65a7c560925e954f6e14a781f': 'ducnmm',
    }

    const displayName = suinsName
        ? `@${suinsName}`
        : account
            ? `@${account.address.slice(0, 6)}...${account.address.slice(-4)}`
            : '@ducnmm'

    // Sync state from URL
    useEffect(() => {
        if (location.pathname === '/transfer') {
            setExpanded('transfers')
        } else if (location.pathname === '/deposit') {
            setExpanded('deposit')
        } else if (location.pathname === '/withdraw') {
            setExpanded('withdraw')
        } else {
            setExpanded(null)
        }
    }, [location.pathname])

    // Query wallet info when account changes
    useEffect(() => {
        if (!account?.address) {
            setWalletInfo(null)
            setSuinsName('')
            return
        }

        // Check for SuiNS name
        const name = addressToSuins[account.address.toLowerCase()]
        if (name) {
            setSuinsName(name)
        }

        // Query wallet from blockchain
        queryWallet(account.address)
    }, [account?.address])

    // Listen for balance updates from Deposit/Withdraw/Transfer panels
    useEffect(() => {
        const handleBalanceUpdate = () => {
            if (account?.address) {
                console.log('Balance update event received, refreshing...')
                queryWallet(account.address)
            }
        }

        window.addEventListener('ram-balance-updated', handleBalanceUpdate)
        return () => {
            window.removeEventListener('ram-balance-updated', handleBalanceUpdate)
        }
    }, [account?.address])

    const queryWallet = async (address: string) => {
        try {
            setLoading(true)

            console.log('Querying wallet for address:', address)
            console.log('Registry ID:', RAM_REGISTRY_ID)

            // Query Registry to find wallet ID (wallets are now SHARED, not owned!)
            const registryObj = await suiClient.getObject({
                id: RAM_REGISTRY_ID,
                options: { showContent: true }
            })
            const registryContent = registryObj.data?.content as any
            const tableId = registryContent?.fields?.address_to_wallet?.fields?.id?.id

            if (!tableId) {
                console.log('Registry table not found')
                setWalletInfo(null)
                setLoading(false)
                return
            }

            // Query registry to find wallet ID for this address
            const registryFields = await suiClient.getDynamicFields({
                parentId: tableId
            })

            let walletId: string | null = null
            for (const field of registryFields.data) {
                if (field.name && typeof field.name === 'object' && 'value' in field.name) {
                    const fieldAddress = field.name.value as string
                    if (fieldAddress.toLowerCase() === address.toLowerCase()) {
                        const fieldObj = await suiClient.getObject({
                            id: field.objectId,
                            options: { showContent: true }
                        })
                        const fieldContent = fieldObj.data?.content as any
                        if (fieldContent?.fields?.value) {
                            walletId = fieldContent.fields.value
                            break
                        }
                    }
                }
            }

            if (!walletId) {
                console.log('No wallet found for this address in registry')
                setWalletInfo(null)
                setLoading(false)
                return
            }

            console.log('Found wallet ID:', walletId)

            // Now get the wallet object details
            const walletObj = await suiClient.getObject({
                id: walletId,
                options: { showContent: true }
            })

            const walletContent = walletObj.data?.content as any
            if (walletContent?.fields) {
                // Query balance from Bag
                let balance = BigInt(0)
                try {
                    const bagId = walletContent.fields.balances?.fields?.id?.id
                    if (bagId) {
                        // Query dynamic fields in the Bag (each coin type has a field)
                        const bagFields = await suiClient.getDynamicFields({
                            parentId: bagId
                        })

                        // Look for SUI balance (type = "0x2::sui::SUI")
                        for (const field of bagFields.data) {
                            if (field.name && typeof field.name === 'object' && 'value' in field.name) {
                                const coinType = field.name.value as string
                                if (coinType.includes('sui::SUI')) {
                                    // Get the actual balance value
                                    const balanceObj = await suiClient.getObject({
                                        id: field.objectId,
                                        options: { showContent: true }
                                    })
                                    const balanceContent = balanceObj.data?.content as any
                                    if (balanceContent?.fields?.value) {
                                        balance = BigInt(balanceContent.fields.value)
                                        console.log('SUI Balance found:', balance.toString())
                                        break
                                    }
                                }
                            }
                        }
                    }
                } catch (error) {
                    console.error('Failed to query balance:', error)
                }

                const walletData = {
                    id: walletId,
                    handle: walletContent.fields.handle || '',
                    balance: balance
                }
                console.log('Setting wallet info:', walletData)
                setWalletInfo(walletData)
            } else {
                console.log('No fields found in wallet content')
                setWalletInfo(null)
            }
        } catch (error) {
            console.error('Failed to query wallet:', error)
            setWalletInfo(null)
        } finally {
            setLoading(false)
        }
    }

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
                    onSuccess: (result) => {
                        console.log('Wallet created successfully!', result)
                        setCreating(false)
                        // Wait a bit for blockchain to process, then refresh
                        setTimeout(() => {
                            queryWallet(account.address)
                        }, 3000)
                    },
                    onError: (error) => {
                        console.error('Failed to create wallet:', error)
                        setCreating(false)
                        const errorMsg = error.message || String(error)

                        // Check if wallet already exists
                        if (errorMsg.includes('MoveAbort') || errorMsg.includes('EAddressAlreadyExists')) {
                            showToast('You already have a wallet. Refreshing...')
                            // Wallet already exists, just refresh to show it
                            setTimeout(() => {
                                queryWallet(account.address)
                            }, 1000)
                        } else {
                            showToast('Failed to create wallet. Please try again.')
                        }
                    }
                }
            )
        } catch (error) {
            console.error('Failed to create wallet:', error)
            showToast('Failed to create wallet. Please try again.')
            setCreating(false)
        }
    }

    const handleExpandCard = (card: ExpandedCard) => {
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
                            transition={{ duration: 0.15 }}
                        >
                            <div className="greeting-content">
                                <div className="wallet-btn-wrapper">
                                    <ConnectButton connectText="" />
                                </div>
                                <div className="history-btn-wrapper">
                                    <button
                                        className="history-btn"
                                        onClick={() => navigate('/history')}
                                        aria-label="View transaction history"
                                    >
                                        <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <circle cx="12" cy="12" r="10" />
                                            <polyline points="12 6 12 12 16 14" />
                                        </svg>
                                    </button>
                                </div>
                                <div className="greeting-text">
                                    <h1 className="greeting-title">Hi {displayName}</h1>
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
                            transition={{ duration: 0.15, delay: 0.05 }}
                        >
                            <motion.div
                                className="action-card action-card-transfers"
                                onClick={() => handleExpandCard('transfers')}
                                whileTap={{ scale: 0.98 }}
                                initial={{ opacity: 0, scale: 0.8 }}
                                animate={{ opacity: 1, scale: 1 }}
                                transition={{ duration: 0.15, delay: 0.1 }}
                            >
                                <span className="action-card-label">Transfers</span>
                            </motion.div>
                            <div className="action-cards-right">
                                <motion.div
                                    className="action-card action-card-small"
                                    onClick={() => handleExpandCard('deposit')}
                                    whileTap={{ scale: 0.98 }}
                                    initial={{ opacity: 0, scale: 0.8 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    transition={{ duration: 0.15, delay: 0.12 }}
                                >
                                    <span className="action-card-label">Deposit</span>
                                </motion.div>
                                <motion.div
                                    className="action-card action-card-small"
                                    onClick={() => handleExpandCard('withdraw')}
                                    whileTap={{ scale: 0.98 }}
                                    initial={{ opacity: 0, scale: 0.8 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    transition={{ duration: 0.15, delay: 0.15 }}
                                >
                                    <span className="action-card-label">Withdraw</span>
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
