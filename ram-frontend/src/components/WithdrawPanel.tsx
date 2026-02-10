import { useState, useEffect } from 'react'
import { useCurrentAccount, useSuiClient, useSignAndExecuteTransaction } from '@mysten/dapp-kit'
import { Transaction } from '@mysten/sui/transactions'
import { SUI_PACKAGE_ID, RAM_REGISTRY_ID, ENCLAVE_ID, ENCLAVE_PACKAGE_ID, requestWithdrawSignature } from '../services/ramApi'
import type { BioAuthResponse } from '../services/ramApi'
import { useRamWallet } from '../hooks/useRamWallet'
import './WithdrawPanel.css'
import { VoiceAuth } from './VoiceAuth'

type Toast = {
    message: string;
    visible: boolean;
};

type WithdrawState = 'form' | 'voice-auth' | 'success';

export function WithdrawPanel() {
    const account = useCurrentAccount()
    const suiClient = useSuiClient()
    const { mutate: signAndExecute } = useSignAndExecuteTransaction()
    const [amount, setAmount] = useState('')
    const [withdrawState, setWithdrawState] = useState<WithdrawState>('form')
    const [toast, setToast] = useState<Toast>({ message: '', visible: false })
    const [walletId, setWalletId] = useState<string | null>(null)
    const [_lastResponse, setLastResponse] = useState<BioAuthResponse | null>(null)

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
            showToast('Your wallet ID is invalid. Please refresh and try again.')
            setWithdrawState('form')
            return
        }


        try {
            const amountInMist = Math.floor(parseFloat(amount) * 1_000_000_000)
            const coinTypeStr = '0000000000000000000000000000000000000000000000000000000000000002::sui::SUI'

            // Step 1: Get enclave signature for the withdrawal
            const withdrawSig = await requestWithdrawSignature(
                currentUserHandle,
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
                    bioauthTx.object(walletId),
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

            // === TX2: withdraw ===
            const withdrawTx = new Transaction()

            const withdrawSigHex = withdrawSig.signature
            const withdrawSigBytes: number[] = []
            for (let i = 0; i < withdrawSigHex.length; i += 2) {
                withdrawSigBytes.push(parseInt(withdrawSigHex.substring(i, i + 2), 16))
            }

            const coinTypeBytes = Array.from(new TextEncoder().encode(coinTypeStr))

            const [coin] = withdrawTx.moveCall({
                target: `${SUI_PACKAGE_ID}::wallet::withdraw`,
                arguments: [
                    withdrawTx.object(walletId),
                    withdrawTx.pure.u64(amountInMist),
                    withdrawTx.pure('vector<u8>', coinTypeBytes),
                    withdrawTx.pure.u64(withdrawSig.timestamp_ms),
                    withdrawTx.pure('vector<u8>', withdrawSigBytes),
                    withdrawTx.object(ENCLAVE_ID),
                    withdrawTx.object('0x6'),
                ],
                typeArguments: [
                    '0x2::sui::SUI',
                    `${ENCLAVE_PACKAGE_ID}::core::XWALLET`,
                ]
            })

            // Transfer the withdrawn coin to sender
            withdrawTx.transferObjects([coin], account!.address)

            // Execute TX2 — may fail if wallet was just locked
            try {
                await new Promise<void>((resolve, reject) => {
                    signAndExecute(
                        { transaction: withdrawTx },
                        {
                            onSuccess: (_result) => {
                                setWithdrawState('success')
                                window.dispatchEvent(new Event('ram-balance-updated'))
                                resolve()
                            },
                            onError: (error) => reject(error),
                        }
                    )
                })
            } catch (txError) {
                setWithdrawState('form')
                const errorMsg = txError instanceof Error ? txError.message : String(txError)
                if (errorMsg.includes('InsufficientBalance') || errorMsg.includes('insufficient')) {
                    showToast('Insufficient balance in RAM wallet')
                } else if (errorMsg.includes('WalletLocked') || errorMsg.includes('assert_wallet_unlocked')) {
                    showToast('Wallet is locked. Please try again later.')
                } else if (errorMsg.includes('InvalidSignature')) {
                    showToast('Invalid enclave signature. Please try again.')
                } else {
                    showToast('Withdraw failed. Please try again.')
                }
            }
        } catch (error) {
            setWithdrawState('form')
            const errorMsg = error instanceof Error ? error.message : String(error)
            if (errorMsg.includes('WalletLocked') || errorMsg.includes('assert_wallet_unlocked')) {
                showToast('Wallet is locked. Please try again later.')
            } else {
                showToast(error instanceof Error ? error.message : 'Withdraw failed. Please try again.')
            }
        }
    }

    const handleVoiceAuthCancel = () => {
        setWithdrawState('form')
    }

    // handleDuress removed - frontend is intentionally blind to duress
    // Smart contract handles wallet locking on-chain


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
            />
        )
    }

    // NOTE: No locked/duress UI - frontend is intentionally blind to duress detection
    // The signed payload is submitted to blockchain where smart contract handles locking

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
