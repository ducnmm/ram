import { useState, useEffect } from 'react'
import { useCurrentAccount, useSuiClient, useSignAndExecuteTransaction } from '@mysten/dapp-kit'
import { Transaction } from '@mysten/sui/transactions'
import { SUI_PACKAGE_ID, RAM_REGISTRY_ID, ENCLAVE_ID, requestWithdrawSignature } from '../services/ramApi'
import type { BioAuthResponse } from '../services/ramApi'
import { useRamWallet } from '../hooks/useRamWallet'
import './WithdrawPanel.css'
import { VoiceAuth } from './VoiceAuth'

type Toast = {
    message: string;
    visible: boolean;
};

type WithdrawState = 'form' | 'voice-auth' | 'success' | 'locked';

export function WithdrawPanel() {
    const account = useCurrentAccount()
    const suiClient = useSuiClient()
    const { mutate: signAndExecute } = useSignAndExecuteTransaction()
    const [amount, setAmount] = useState('')
    const [withdrawState, setWithdrawState] = useState<WithdrawState>('form')
    const [toast, setToast] = useState<Toast>({ message: '', visible: false })
    const [walletId, setWalletId] = useState<string | null>(null)
    const [lastResponse, setLastResponse] = useState<BioAuthResponse | null>(null)

    const { walletInfo } = useRamWallet()
    const currentUserHandle = walletInfo?.handle || ''

    // Query wallet when account changes
    useEffect(() => {
        if (!account?.address) {
            setWalletId(null)
            return
        }
        queryWallet(account.address)
    }, [account?.address, suiClient])

    const queryWallet = async (address: string) => {
        try {
            // Get registry and extract table ID
            const registryObj = await suiClient.getObject({
                id: RAM_REGISTRY_ID,
                options: { showContent: true }
            })
            const registryContent = registryObj.data?.content as any
            const tableId = registryContent?.fields?.address_to_wallet?.fields?.id?.id

            if (!tableId) {
                setWalletId(null)
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
                            setWalletId(fieldContent.fields.value)
                            return
                        }
                    }
                }
            }
            setWalletId(null)
        } catch (error) {
            console.error('Failed to query wallet:', error)
            setWalletId(null)
        }
    }

    const showToast = (message: string) => {
        setToast({ message, visible: true })
        setTimeout(() => {
            setToast({ message: '', visible: false })
        }, 3000)
    }

    const handleSend = () => {
        // Validate amount
        if (!amount || parseFloat(amount) <= 0) {
            showToast('Please enter a valid amount')
            return
        }

        // Validate wallet
        if (!account?.address) {
            showToast('Please connect your wallet')
            return
        }

        if (!walletId) {
            showToast('RAM wallet not found. Please create a wallet first.')
            return
        }

        // Show voice auth modal
        setWithdrawState('voice-auth')
    }

    const handleVoiceAuthSuccess = async (response: BioAuthResponse) => {
        setLastResponse(response)

        // Check if wallet exists
        if (!walletId) {
            showToast('Your wallet not found')
            setWithdrawState('form')
            return
        }

        // Validate wallet ID
        if (!walletId || typeof walletId !== 'string' || !walletId.startsWith('0x')) {
            console.error('Invalid walletId:', walletId)
            showToast('Your wallet ID is invalid. Please refresh and try again.')
            setWithdrawState('form')
            return
        }

        console.log('Withdraw from:', walletId)

        try {
            const amountInMist = Math.floor(parseFloat(amount) * 1_000_000_000)
            const coinTypeStr = '0000000000000000000000000000000000000000000000000000000000000002::sui::SUI'

            // Step 1: Get enclave signature for the withdrawal
            console.log('Requesting withdraw signature from enclave...')
            const withdrawSig = await requestWithdrawSignature(
                currentUserHandle,
                amountInMist,
                coinTypeStr,
            )
            console.log('Withdraw signature received:', withdrawSig)

            // Step 2: Create transaction with signed withdraw
            const tx = new Transaction()

            // Convert signature hex string to number array
            const sigHex = withdrawSig.signature
            const sigBytes: number[] = []
            for (let i = 0; i < sigHex.length; i += 2) {
                sigBytes.push(parseInt(sigHex.substring(i, i + 2), 16))
            }

            const coinTypeBytes = Array.from(new TextEncoder().encode(coinTypeStr))

            // Call withdraw function with enclave signature
            const [coin] = tx.moveCall({
                target: `${SUI_PACKAGE_ID}::wallet::withdraw`,
                arguments: [
                    tx.object(walletId),
                    tx.pure.u64(amountInMist),
                    tx.pure('vector<u8>', coinTypeBytes),
                    tx.pure.u64(withdrawSig.timestamp_ms),
                    tx.pure('vector<u8>', sigBytes),
                    tx.object(ENCLAVE_ID),
                    tx.object('0x6'), // Clock object
                ],
                typeArguments: [
                    '0x2::sui::SUI',
                    `${SUI_PACKAGE_ID}::core::RAM`,
                ]
            })

            // Transfer the withdrawn coin to sender
            tx.transferObjects([coin], account!.address)

            // Execute transaction
            signAndExecute(
                { transaction: tx },
                {
                    onSuccess: (result) => {
                        console.log('Withdraw successful!', result)
                        setWithdrawState('success')

                        // Dispatch event to refresh balance in HomePage
                        window.dispatchEvent(new Event('ram-balance-updated'))
                    },
                    onError: (error) => {
                        console.error('Withdraw failed:', error)
                        setWithdrawState('form')

                        const errorMsg = error.message || String(error)
                        if (errorMsg.includes('InsufficientBalance') || errorMsg.includes('insufficient')) {
                            showToast('Insufficient balance in RAM wallet')
                        } else if (errorMsg.includes('WalletLocked')) {
                            showToast('Wallet is locked')
                        } else if (errorMsg.includes('InvalidSignature')) {
                            showToast('Invalid enclave signature. Please try again.')
                        } else {
                            showToast('Withdraw failed. Please try again.')
                        }
                    }
                }
            )
        } catch (error) {
            setWithdrawState('form')
            showToast(error instanceof Error ? error.message : 'Withdraw failed. Please try again.')
        }
    }

    const handleVoiceAuthCancel = () => {
        setWithdrawState('form')
    }

    const handleDuress = (response: BioAuthResponse) => {
        setLastResponse(response)
        setWithdrawState('locked')
    }

    const handleNewWithdraw = () => {
        setAmount('')
        setWithdrawState('form')
        setLastResponse(null)
    }

    // Voice auth modal
    if (withdrawState === 'voice-auth') {
        return (
            <VoiceAuth
                amount={parseFloat(amount)}
                handle={currentUserHandle}
                coinType="Sui"
                action="withdraw"
                onSuccess={handleVoiceAuthSuccess}
                onCancel={handleVoiceAuthCancel}
                onDuress={handleDuress}
            />
        )
    }

    // Locked state (duress detected)
    if (withdrawState === 'locked') {
        return (
            <div className="withdraw-panel result-panel">
                <div className="locked-result">
                    <div className="result-icon locked-icon-large">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="5" y="11" width="14" height="10" rx="2" />
                            <path d="M7 11V7a5 5 0 0110 0v4" />
                        </svg>
                    </div>
                    <h3 className="result-title">Wallet Locked</h3>
                    <p className="result-message">Duress detected in voice authentication</p>
                    <p className="lock-duration">🔒 Locked for 24 hours</p>
                    <button className="new-withdraw-btn" onClick={handleNewWithdraw}>
                        Try Again
                    </button>
                </div>
            </div>
        )
    }

    // Success state
    if (withdrawState === 'success') {
        return (
            <div className="withdraw-panel result-panel">
                <div className="success-result">
                    <div className="result-icon success-icon-large">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                            <path d="M20 6L9 17l-5-5" />
                        </svg>
                    </div>
                    <h3 className="result-title">Withdraw Complete!</h3>
                    <p className="result-amount">{amount} Sui</p>
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
            <div className="withdraw-panel">
                <h3 className="withdraw-heading">Withdraw</h3>

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

                <button
                    className="withdraw-submit-btn"
                    onClick={handleSend}
                >
                    Withdraw
                </button>
            </div>
        </>
    )
}
