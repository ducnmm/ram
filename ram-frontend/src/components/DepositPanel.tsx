import { useState, useEffect } from 'react'
import { useCurrentAccount, useSuiClient, useSignAndExecuteTransaction } from '@mysten/dapp-kit'
import { Transaction } from '@mysten/sui/transactions'
import { SUI_PACKAGE_ID, RAM_REGISTRY_ID } from '../services/ramApi'
import './DepositPanel.css'

type Toast = {
    message: string;
    visible: boolean;
};

type DepositState = 'form' | 'processing' | 'success';

export function DepositPanel() {
    const account = useCurrentAccount()
    const suiClient = useSuiClient()
    const { mutate: signAndExecute } = useSignAndExecuteTransaction()
    const [amount, setAmount] = useState('')
    const [depositState, setDepositState] = useState<DepositState>('form')
    const [toast, setToast] = useState<Toast>({ message: '', visible: false })
    const [walletId, setWalletId] = useState<string | null>(null)

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

    const handleDeposit = async () => {
        // Validate wallet
        if (!account?.address) {
            showToast('Please connect your wallet')
            return
        }

        if (!walletId) {
            showToast('RAM wallet not found. Please create a wallet first.')
            return
        }

        // Validate amount
        if (!amount || parseFloat(amount) <= 0) {
            showToast('Please enter a valid amount')
            return
        }

        setDepositState('processing')
        
        try {
            const amountInMist = Math.floor(parseFloat(amount) * 1_000_000_000) // Convert SUI to MIST
            
            // Create transaction
            const tx = new Transaction()
            
            // Split coin from gas for deposit
            const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(amountInMist)])
            
            // Call deposit function
            tx.moveCall({
                target: `${SUI_PACKAGE_ID}::wallet::deposit`,
                arguments: [
                    tx.object(walletId),
                    coin,
                    tx.object('0x6'), // Clock object
                ],
                typeArguments: ['0x2::sui::SUI']
            })
            
            // Execute transaction
            signAndExecute(
                { transaction: tx },
                {
                    onSuccess: (result) => {
                        console.log('Deposit successful!', result)
                        setDepositState('success')
                        
                        // Dispatch event to refresh balance in HomePage
                        window.dispatchEvent(new Event('ram-balance-updated'))
                        
                        // Reset after success
                        setTimeout(() => {
                            setAmount('')
                            setDepositState('form')
                        }, 3000)
                    },
                    onError: (error) => {
                        console.error('Deposit failed:', error)
                        setDepositState('form')
                        
                        const errorMsg = error.message || String(error)
                        if (errorMsg.includes('InsufficientBalance') || errorMsg.includes('insufficient')) {
                            showToast('Insufficient balance')
                        } else if (errorMsg.includes('WalletLocked')) {
                            showToast('Wallet is locked')
                        } else {
                            showToast('Deposit failed. Please try again.')
                        }
                    }
                }
            )
        } catch (error) {
            setDepositState('form')
            showToast(error instanceof Error ? error.message : 'Deposit failed. Please try again.')
        }
    }

    // Success state
    if (depositState === 'success') {
        return (
            <div className="deposit-panel result-panel">
                <div className="success-result">
                    <div className="result-icon success-icon-large">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                            <path d="M20 6L9 17l-5-5" />
                        </svg>
                    </div>
                    <h3 className="result-title">Deposit Complete!</h3>
                    <p className="result-amount">{amount} SUI</p>
                    <p className="result-recipient">deposited successfully</p>
                </div>
            </div>
        )
    }

    return (
        <>
            {toast.visible && (
                <div className="toast-notification">
                    <svg className="toast-icon" viewBox="0 0 16 16" fill="none">
                        <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="2"/>
                        <path d="M8 4v4M8 11h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                    <span>{toast.message}</span>
                </div>
            )}
            <div className="deposit-panel">
                <h3 className="deposit-heading">Deposit</h3>
                
                <div className="amount-input-wrapper">
                    <img src="/sui-sui-logo.svg" alt="SUI" className="sui-logo" />
                    <input
                        type="number"
                        placeholder="0"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        className="amount-input"
                        disabled={depositState === 'processing'}
                    />
                </div>

                <button 
                    className="deposit-btn" 
                    onClick={handleDeposit}
                    disabled={depositState === 'processing'}
                >
                    {depositState === 'processing' ? 'Processing...' : 'Deposit'}
                </button>
            </div>
        </>
    )
}
