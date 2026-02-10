import { useState, useEffect } from 'react'
import { useCurrentAccount, useSuiClient, useSignAndExecuteTransaction } from '@mysten/dapp-kit'
import { Transaction } from '@mysten/sui/transactions'
import { SUI_PACKAGE_ID, RAM_REGISTRY_ID, ENCLAVE_ID, ENCLAVE_PACKAGE_ID, requestTransferSignature } from '../services/ramApi'
import type { BioAuthResponse } from '../services/ramApi'
import { useRamWallet } from '../hooks/useRamWallet'
import './TransferPanel.css'
import { VoiceAuth } from './VoiceAuth'

type TransferState = 'form' | 'voice-auth' | 'success';

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
    const [toHandle, setToHandle] = useState<string>('')

    // Resolution states
    const [resolvedAddress, setResolvedAddress] = useState<string>('')
    const [resolvedName, setResolvedName] = useState<string>('')
    const [nameError, setNameError] = useState<string>('')
    const [addressError, setAddressError] = useState<string>('')
    const [isAddressFocused, setIsAddressFocused] = useState(false)

    // Current user's handle (would come from auth context in real app)
    const { walletInfo } = useRamWallet()
    const currentUserHandle = walletInfo?.handle || ''

    // Query sender's wallet when account changes
    useEffect(() => {
        if (!account?.address) {
            setFromWalletId(null)
            return
        }
        queryWalletWithHandle(account.address, setFromWalletId, () => { })
    }, [account?.address])

    // Query recipient wallet when handle/address changes
    useEffect(() => {
        if (resolvedAddress) {
            queryWalletWithHandle(resolvedAddress, setToWalletId, setToHandle)
        } else if (walletAddress) {
            queryWalletWithHandle(walletAddress, setToWalletId, setToHandle)
        } else {
            setToWalletId(null)
            setToHandle('')
        }
    }, [resolvedAddress, walletAddress])

    const queryWalletWithHandle = async (
        address: string,
        walletSetter: (id: string | null) => void,
        handleSetter: (h: string) => void,
    ) => {
        try {
            // Get registry and extract table ID
            const registryObj = await suiClient.getObject({
                id: RAM_REGISTRY_ID,
                options: { showContent: true }
            })
            const registryContent = registryObj.data?.content as any
            const tableId = registryContent?.fields?.address_to_wallet?.fields?.id?.id

            if (!tableId) {
                walletSetter(null)
                handleSetter('')
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
                            const wId = fieldContent.fields.value
                            walletSetter(wId)

                            // Also fetch handle from the wallet object
                            const walletObj = await suiClient.getObject({
                                id: wId,
                                options: { showContent: true }
                            })
                            const walletContent = walletObj.data?.content as any
                            handleSetter(walletContent?.fields?.handle || '')
                            return
                        }
                    }
                }
            }
            walletSetter(null)
            handleSetter('')
        } catch (error) {
            walletSetter(null)
            handleSetter('')
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
                                resolve()
                            },
                            onError: (error) => {
                                const errorMsg = error.message || String(error)

                                // If wallet already exists, that's fine
                                if (errorMsg.includes('EAddressAlreadyExists')) {
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

            } catch (error) {
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
            showToast('Your wallet ID is invalid. Please refresh and try again.')
            setTransferState('form')
            return
        }

        if (!recipientWalletId || typeof recipientWalletId !== 'string' || !recipientWalletId.startsWith('0x')) {
            showToast('Recipient wallet ID is invalid')
            setTransferState('form')
            return
        }


        try {
            const amountInMist = Math.floor(parseFloat(amount) * 1_000_000_000)
            const coinTypeStr = '0000000000000000000000000000000000000000000000000000000000000002::sui::SUI'

            // Determine recipient handle for enclave signature
            const recipientHandle = toHandle || handleName || `user_${(resolvedAddress || walletAddress).slice(2, 8)}`

            // Step 1: Get enclave signature for the transfer
            const transferSig = await requestTransferSignature(
                currentUserHandle,
                recipientHandle,
                amountInMist,
                coinTypeStr,
            )

            // === TX1: apply_bioauth (always executes on-chain) ===
            const bioauthTx = new Transaction()

            // Convert BioAuth signature hex to bytes
            const bioSigHex = response.signature
            const bioSigBytes: number[] = []
            for (let i = 0; i < bioSigHex.length; i += 2) {
                bioSigBytes.push(parseInt(bioSigHex.substring(i, i + 2), 16))
            }

            bioauthTx.moveCall({
                target: `${SUI_PACKAGE_ID}::bioguard::apply_bioauth`,
                arguments: [
                    bioauthTx.object(fromWalletId!),
                    bioauthTx.pure('vector<u8>', response.payload.handle),
                    bioauthTx.pure.u64(response.payload.amount),
                    bioauthTx.pure.u8(response.payload.result),
                    bioauthTx.pure('vector<u8>', response.payload.transcript),
                    bioauthTx.pure.u64(response.timestamp_ms),
                    bioauthTx.pure('vector<u8>', bioSigBytes),
                    bioauthTx.object(ENCLAVE_ID),
                    bioauthTx.object('0x6'),
                ],
                typeArguments: [
                    `${ENCLAVE_PACKAGE_ID}::core::XWALLET`,
                ]
            })

            // Execute TX1 and wait for it to complete
            await new Promise<void>((resolve, reject) => {
                signAndExecute(
                    { transaction: bioauthTx },
                    {
                        onSuccess: () => resolve(),
                        onError: (error) => reject(error),
                    }
                )
            })

            // Small delay for blockchain to process
            await new Promise(r => setTimeout(r, 1000))

            // === TX2: transfer_with_signature ===
            const transferTx = new Transaction()

            const transferSigHex = transferSig.signature
            const transferSigBytes: number[] = []
            for (let i = 0; i < transferSigHex.length; i += 2) {
                transferSigBytes.push(parseInt(transferSigHex.substring(i, i + 2), 16))
            }

            const coinTypeBytes = Array.from(new TextEncoder().encode(coinTypeStr))

            transferTx.moveCall({
                target: `${SUI_PACKAGE_ID}::transfers::transfer_with_signature`,
                arguments: [
                    transferTx.object(fromWalletId!),
                    transferTx.object(recipientWalletId!),
                    transferTx.pure.u64(amountInMist),
                    transferTx.pure('vector<u8>', coinTypeBytes),
                    transferTx.pure.u64(transferSig.timestamp_ms),
                    transferTx.pure('vector<u8>', transferSigBytes),
                    transferTx.object(ENCLAVE_ID),
                    transferTx.object('0x6'),
                ],
                typeArguments: [
                    '0x2::sui::SUI',
                    `${ENCLAVE_PACKAGE_ID}::core::XWALLET`,
                ]
            })

            // Execute TX2 — may fail if wallet was just locked
            try {
                await new Promise<void>((resolve, reject) => {
                    signAndExecute(
                        { transaction: transferTx },
                        {
                            onSuccess: (result) => {
                                setTransferState('success')
                                window.dispatchEvent(new Event('ram-balance-updated'))
                                resolve()
                            },
                            onError: (error) => reject(error),
                        }
                    )
                })
            } catch (txError) {
                setTransferState('form')
                const errorMsg = txError instanceof Error ? txError.message : String(txError)
                if (errorMsg.includes('InsufficientBalance')) {
                    showToast('Insufficient balance')
                } else if (errorMsg.includes('WalletLocked') || errorMsg.includes('assert_wallet_unlocked')) {
                    showToast('Wallet is locked. Please try again later.')
                } else if (errorMsg.includes('InvalidSignature')) {
                    showToast('Invalid enclave signature. Please try again.')
                } else {
                    showToast('Transfer failed. Please try again.')
                }
            }
        } catch (error) {
            setTransferState('form')
            const errorMsg = error instanceof Error ? error.message : String(error)
            if (errorMsg.includes('WalletLocked') || errorMsg.includes('assert_wallet_unlocked')) {
                showToast('Wallet is locked. Please try again later.')
            } else {
                showToast(error instanceof Error ? error.message : 'Transfer failed')
            }
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
            return null
        }
    }

    const handleVoiceAuthCancel = () => {
        setTransferState('form')
    }

    // handleDuress removed - frontend is intentionally blind to duress
    // Smart contract handles wallet locking on-chain

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

    // NOTE: No locked/duress UI - frontend is intentionally blind to duress detection
    // The signed payload is submitted to blockchain where smart contract handles locking

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
                />
            )}
        </>
    )
}
