import { useState, useEffect } from 'react'
import { useCurrentAccount, useSuiClient, useSignAndExecuteTransaction } from '@mysten/dapp-kit'
import { Transaction } from '@mysten/sui/transactions'
import { SUI_PACKAGE_ID, RAM_REGISTRY_ID, USER_HANDLE } from '../services/ramApi'
import type { BioAuthResponse } from '../services/ramApi'
import './TransferPanel.css'
import { VoiceAuth } from './VoiceAuth'

type TransferState = 'form' | 'voice-auth' | 'success' | 'locked';

type Toast = {
    message: string;
    visible: boolean;
};

export function TransferPanel() {
    const account = useCurrentAccount()
    const suiClient = useSuiClient()
    const { mutate: signAndExecute } = useSignAndExecuteTransaction()
    const [handleName, setHandleName] = useState('')
    const [walletAddress, setWalletAddress] = useState('')
    const [amount, setAmount] = useState('')
    const [transferState, setTransferState] = useState<TransferState>('form')
    const [lastResponse, setLastResponse] = useState<BioAuthResponse | null>(null)
    const [toast, setToast] = useState<Toast>({ message: '', visible: false })
    const [fromWalletId, setFromWalletId] = useState<string | null>(null)
    const [toWalletId, setToWalletId] = useState<string | null>(null)

    // Resolution states
    const [resolvedAddress, setResolvedAddress] = useState<string>('')
    const [resolvedName, setResolvedName] = useState<string>('')
    const [nameError, setNameError] = useState<string>('')
    const [addressError, setAddressError] = useState<string>('')
    const [isAddressFocused, setIsAddressFocused] = useState(false)

    // Current user's handle (would come from auth context in real app)
    const currentUserHandle = USER_HANDLE

    // Query sender's wallet when account changes
    useEffect(() => {
        if (!account?.address) {
            setFromWalletId(null)
            return
        }
        queryWallet(account.address, setFromWalletId)
    }, [account?.address])

    // Query recipient wallet when handle/address changes
    useEffect(() => {
        if (resolvedAddress) {
            queryWallet(resolvedAddress, setToWalletId)
        } else if (walletAddress) {
            queryWallet(walletAddress, setToWalletId)
        } else {
            setToWalletId(null)
        }
    }, [resolvedAddress, walletAddress])

    const queryWallet = async (address: string, setter: (id: string | null) => void) => {
        try {
            // Get registry and extract table ID
            const registryObj = await suiClient.getObject({
                id: RAM_REGISTRY_ID,
                options: { showContent: true }
            })
            const registryContent = registryObj.data?.content as any
            const tableId = registryContent?.fields?.address_to_wallet?.fields?.id?.id

            if (!tableId) {
                setter(null)
                return
            }

            // Query registry to find wallet ID
            const registryFields = await suiClient.getDynamicFields({
                parentId: tableId
            })

            // Find wallet ID for this address
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
                            setter(fieldContent.fields.value)
                            return
                        }
                    }
                }
            }
            setter(null)
        } catch (error) {
            console.error('Failed to query wallet:', error)
            setter(null)
        }
    }

    // Mock SuiNS resolution (replace with actual SuiNS API)
    const suinsToAddress: Record<string, string> = {
        'ducnmm': '0x3103b5ddad293bb00cf9b54061684293a829f2a65a7c560925e954f6e14a781f',
        'alice': '0xa1c3b5ddad293bb00cf9b54061684293a829f2a65a7c560925e954f6e14a0001',
        'bob': '0xb0bb5ddad293bb00cf9b54061684293a829f2a65a7c560925e954f6e14a0002',
    }

    const addressToSuins: Record<string, string> = Object.fromEntries(
        Object.entries(suinsToAddress).map(([k, v]) => [v.toLowerCase(), k])
    )

    // Resolve SuiNS name to address
    const resolveSuiNS = (name: string) => {
        if (!name) {
            setResolvedAddress('')
            setNameError('')
            return
        }

        const addr = suinsToAddress[name.toLowerCase()]
        if (addr) {
            setResolvedAddress(addr)
            setNameError('')
        } else {
            setResolvedAddress('')
            setNameError(`SuiNS name "${name}" not found`)
        }
    }

    // Resolve address to SuiNS name (optional)
    const resolveAddress = (addr: string) => {
        if (!addr) {
            setResolvedName('')
            return
        }

        const name = addressToSuins[addr.toLowerCase()]
        if (name) {
            setResolvedName(name)
        } else {
            setResolvedName('')
        }
    }

    // Validate Sui address format
    const validateAddress = (addr: string) => {
        if (!addr) {
            setAddressError('')
            return true
        }

        // Sui address must start with 0x
        if (!addr.startsWith('0x')) {
            setAddressError('Address must start with "0x"')
            return false
        }

        // Total length must be between 3 (0x1) and 66 (0x + 64 hex chars)
        if (addr.length < 3) {
            setAddressError('Address is too short')
            return false
        }

        if (addr.length > 66) {
            setAddressError('Address is too long (max 66 characters)')
            return false
        }

        // Remove 0x prefix and check if it's valid hex
        const hexPart = addr.slice(2)
        if (!/^[0-9a-fA-F]+$/.test(hexPart)) {
            setAddressError('Address contains invalid characters')
            return false
        }

        setAddressError('')
        return true
    }

    const handleNameChange = (value: string) => {
        setHandleName(value)
        setWalletAddress('') // Clear address if entering name
        resolveSuiNS(value)
    }

    const handleAddressChange = (value: string) => {
        setWalletAddress(value)
        setHandleName('') // Clear name if entering address
        setNameError('') // Clear name errors
        setResolvedAddress('') // Clear resolved address
        validateAddress(value)
        resolveAddress(value)
    }

    // Truncate address for display
    const getTruncatedAddress = () => {
        if (!walletAddress || isAddressFocused) return walletAddress
        if (walletAddress.length > 20) {
            return walletAddress.slice(0, 10) + '...' + walletAddress.slice(-8)
        }
        return walletAddress
    }

    const showToast = (message: string) => {
        setToast({ message, visible: true })
        setTimeout(() => {
            setToast({ message: '', visible: false })
        }, 3000)
    }

    const handleSend = () => {
        // Validate form
        if (!handleName && !walletAddress) {
            showToast('Please enter a recipient handle or wallet address')
            return
        }

        // Check for SuiNS name error
        if (handleName && nameError) {
            showToast(nameError)
            return
        }

        // Check for address error
        if (walletAddress && addressError) {
            showToast(addressError)
            return
        }

        if (!amount || parseFloat(amount) <= 0) {
            showToast('Please enter a valid amount')
            return
        }

        // Debug logging
        console.log('=== TRANSFER DEBUG ===')
        console.log('From wallet ID:', fromWalletId)
        console.log('To wallet ID:', toWalletId)
        console.log('Recipient address:', resolvedAddress || walletAddress)
        console.log('Amount:', amount)

        if (!fromWalletId) {
            showToast('Your wallet not found. Please create a wallet first.')
            return
        }

        // Show voice auth modal
        setTransferState('voice-auth')
    }

    const handleVoiceAuthSuccess = async (response: BioAuthResponse) => {
        setLastResponse(response)

        // Check if FROM wallet exists
        if (!fromWalletId) {
            showToast('Your wallet not found')
            setTransferState('form')
            return
        }

        const recipientAddress = resolvedAddress || walletAddress
        if (!recipientAddress) {
            showToast('Recipient address not found')
            setTransferState('form')
            return
        }

        let recipientWalletId = toWalletId

        // If TO wallet doesn't exist, create it first
        if (!recipientWalletId) {
            try {
                console.log('Creating wallet for recipient:', recipientAddress)

                // Create wallet for recipient
                const createTx = new Transaction()

                // Generate handle from address (e.g., "user_abc123")
                const shortAddr = recipientAddress.slice(2, 8) // First 6 chars after 0x
                const handle = `user_${shortAddr}`

                createTx.moveCall({
                    target: `${SUI_PACKAGE_ID}::wallet::create_wallet_for_address`,
                    arguments: [
                        createTx.object(RAM_REGISTRY_ID),
                        createTx.pure.address(recipientAddress),
                        createTx.pure.string(handle),
                    ]
                })

                // Execute wallet creation and wait
                await new Promise<void>((resolve, reject) => {
                    signAndExecute(
                        { transaction: createTx },
                        {
                            onSuccess: async (result) => {
                                console.log('Wallet created for recipient!', result)
                                resolve()
                            },
                            onError: (error) => {
                                console.error('Failed to create recipient wallet:', error)
                                const errorMsg = error.message || String(error)

                                // If wallet already exists, that's fine
                                if (errorMsg.includes('EAddressAlreadyExists')) {
                                    console.log('Wallet already exists')
                                    resolve()
                                } else {
                                    reject(error)
                                }
                            }
                        }
                    )
                })

                // Wait for blockchain to process
                await new Promise(r => setTimeout(r, 2000))

                // Query the wallet ID directly
                recipientWalletId = await queryWalletDirect(recipientAddress)

                if (!recipientWalletId) {
                    showToast('Failed to find recipient wallet after creation')
                    setTransferState('form')
                    return
                }

                // Update state for future use
                setToWalletId(recipientWalletId)
                console.log('Recipient wallet ID:', recipientWalletId)

            } catch (error) {
                console.error('Wallet creation error:', error)
                showToast('Failed to create recipient wallet')
                setTransferState('form')
                return
            }
        }

        // Now execute the transfer (recipientWalletId should exist now)
        if (!recipientWalletId) {
            showToast('Recipient wallet not found')
            setTransferState('form')
            return
        }

        // Final validation - ensure both wallets are valid
        if (!fromWalletId || typeof fromWalletId !== 'string' || !fromWalletId.startsWith('0x')) {
            console.error('Invalid fromWalletId:', fromWalletId)
            showToast('Your wallet ID is invalid. Please refresh and try again.')
            setTransferState('form')
            return
        }

        if (!recipientWalletId || typeof recipientWalletId !== 'string' || !recipientWalletId.startsWith('0x')) {
            console.error('Invalid recipientWalletId:', recipientWalletId)
            showToast('Recipient wallet ID is invalid')
            setTransferState('form')
            return
        }

        console.log('Transfer from:', fromWalletId, 'to:', recipientWalletId)

        try {
            const amountInMist = Math.floor(parseFloat(amount) * 1_000_000_000)

            // Create transaction with transfer_with_wallet (direct wallet auth, no enclave needed)
            const tx = new Transaction()

            tx.moveCall({
                target: `${SUI_PACKAGE_ID}::transfers::transfer_with_wallet`,
                arguments: [
                    tx.object(fromWalletId),
                    tx.object(recipientWalletId),
                    tx.pure.u64(amountInMist),
                    tx.object('0x6'), // Clock object
                ],
                typeArguments: [
                    '0x2::sui::SUI',
                ]
            })

            // Execute transaction
            signAndExecute(
                { transaction: tx },
                {
                    onSuccess: (result) => {
                        console.log('Transfer successful!', result)
                        setTransferState('success')

                        // Dispatch event to refresh balance
                        window.dispatchEvent(new Event('ram-balance-updated'))
                    },
                    onError: (error) => {
                        console.error('Transfer failed:', error)
                        setTransferState('form')

                        const errorMsg = error.message || String(error)
                        if (errorMsg.includes('InsufficientBalance')) {
                            showToast('Insufficient balance')
                        } else if (errorMsg.includes('WalletLocked')) {
                            showToast('Wallet is locked')
                        } else if (errorMsg.includes('InvalidSignature')) {
                            showToast('Invalid enclave signature. Please try again.')
                        } else {
                            showToast('Transfer failed. Please try again.')
                        }
                    }
                }
            )
        } catch (error) {
            setTransferState('form')
            showToast(error instanceof Error ? error.message : 'Transfer failed')
        }
    }

    // Helper function to query wallet ID directly and return it
    const queryWalletDirect = async (address: string): Promise<string | null> => {
        try {
            const registryObj = await suiClient.getObject({
                id: RAM_REGISTRY_ID,
                options: { showContent: true }
            })
            const registryContent = registryObj.data?.content as any
            const tableId = registryContent?.fields?.address_to_wallet?.fields?.id?.id

            if (!tableId) return null

            const registryFields = await suiClient.getDynamicFields({
                parentId: tableId
            })

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
                            return fieldContent.fields.value
                        }
                    }
                }
            }
            return null
        } catch (error) {
            console.error('Failed to query wallet:', error)
            return null
        }
    }

    const handleVoiceAuthCancel = () => {
        setTransferState('form')
    }

    const handleDuress = (response: BioAuthResponse) => {
        setLastResponse(response)
        setTransferState('locked')
    }

    const handleNewTransfer = () => {
        setHandleName('')
        setWalletAddress('')
        setAmount('')
        setTransferState('form')
        setLastResponse(null)
        setResolvedAddress('')
        setResolvedName('')
        setNameError('')
        setAddressError('')
    }

    // Success modal
    if (transferState === 'success') {
        return (
            <div className="transfer-panel result-panel">
                <div className="success-result">
                    <div className="result-icon success-icon-large">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                            <path d="M20 6L9 17l-5-5" />
                        </svg>
                    </div>
                    <h3 className="result-title">Transfer Complete!</h3>
                    <p className="result-amount">{amount} Sui</p>
                    <p className="result-recipient">
                        sent to {handleName ? `@${handleName}` : walletAddress.slice(0, 8) + '...'}
                    </p>
                </div>
            </div>
        )
    }

    // Locked modal
    if (transferState === 'locked') {
        return (
            <div className="transfer-panel result-panel locked-panel">
                <div className="locked-result">
                    <div className="result-icon locked-icon-large">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="3" y="11" width="18" height="11" rx="2" />
                            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                        </svg>
                    </div>
                    <h3 className="result-title locked-title">Wallet Locked</h3>
                    <p className="locked-message">
                        Your wallet has been locked for 24 hours as a safety measure.
                    </p>
                    <p className="locked-submessage">
                        We detected signs of stress or coercion in your voice.
                        If you're in danger, please seek help.
                    </p>
                    <div className="emergency-contacts">
                        <p className="emergency-label">Emergency Resources:</p>
                        <a href="tel:911" className="emergency-link">Emergency: 911</a>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <>
            {toast.visible && (
                <div className="toast-notification">
                    <svg className="toast-icon" viewBox="0 0 16 16" fill="none">
                        <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="2" />
                        <path d="M8 4v4M8 11h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                    <span>{toast.message}</span>
                </div>
            )}
            <div className="transfer-panel">
                <h3 className="transfer-heading">Transfer</h3>

                {!walletAddress && (
                    <div className="form-group">
                        <div className={`handle-input ${nameError ? 'has-error' : ''}`}>
                            <span className="at-symbol">@</span>
                            <input
                                type="text"
                                placeholder="sui name"
                                value={handleName}
                                onChange={(e) => handleNameChange(e.target.value)}
                                className="handle-select"
                            />
                        </div>
                        {resolvedAddress && (
                            <div className="resolved-info">
                                <svg className="check-icon" viewBox="0 0 16 16" fill="none">
                                    <path d="M13 4L6 11l-3-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                                <span className="resolved-text">{resolvedAddress.slice(0, 10)}...{resolvedAddress.slice(-8)}</span>
                            </div>
                        )}
                        {nameError && (
                            <div className="error-info">
                                <svg className="error-icon" viewBox="0 0 16 16" fill="none">
                                    <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="2" />
                                    <path d="M8 4v4M8 11h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                </svg>
                                <span className="error-text">{nameError}</span>
                            </div>
                        )}
                    </div>
                )}

                {!handleName && !walletAddress && (
                    <div className="or-divider">or</div>
                )}

                {!handleName && (
                    <div className="form-group">
                        <div className={`handle-input ${addressError ? 'has-error' : ''}`}>
                            <svg className="wallet-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" strokeLinecap="round" strokeLinejoin="round" />
                                <path d="M3 7v12a2 2 0 0 0 2 2h16v-5" strokeLinecap="round" strokeLinejoin="round" />
                                <path d="M18 12a2 2 0 0 1 4 0v2a2 2 0 0 1-4 0v-2z" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                            <input
                                type="text"
                                placeholder="wallet address"
                                value={getTruncatedAddress()}
                                onChange={(e) => handleAddressChange(e.target.value)}
                                onFocus={() => setIsAddressFocused(true)}
                                onBlur={() => setIsAddressFocused(false)}
                                className="handle-select"
                            />
                        </div>
                        {addressError && (
                            <div className="error-info">
                                <svg className="error-icon" viewBox="0 0 16 16" fill="none">
                                    <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="2" />
                                    <path d="M8 4v4M8 11h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                </svg>
                                <span className="error-text">{addressError}</span>
                            </div>
                        )}
                        {resolvedName && !addressError && (
                            <div className="resolved-info">
                                <svg className="check-icon" viewBox="0 0 16 16" fill="none">
                                    <path d="M13 4L6 11l-3-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                                <span className="resolved-text">@{resolvedName}</span>
                            </div>
                        )}
                    </div>
                )}

                <div className="amount-input-wrapper">
                    <img src="/sui-sui-logo.svg" alt="SUI" className="sui-logo" />
                    <input
                        type="number"
                        placeholder="0"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        className="amount-input"
                    />
                </div>

                <button className="send-btn" onClick={handleSend}>
                    Send
                </button>
            </div>

            {transferState === 'voice-auth' && (
                <VoiceAuth
                    handle={currentUserHandle}
                    amount={parseFloat(amount)}
                    coinType="Sui"
                    recipientHandle={handleName || undefined}
                    recipientAddress={walletAddress || undefined}
                    onSuccess={handleVoiceAuthSuccess}
                    onCancel={handleVoiceAuthCancel}
                    onDuress={handleDuress}
                />
            )}
        </>
    )
}
