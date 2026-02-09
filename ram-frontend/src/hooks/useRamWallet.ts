import { useState, useEffect, useCallback } from 'react'
import { useCurrentAccount, useSuiClient, useResolveSuiNSName } from '@mysten/dapp-kit'
import { RAM_REGISTRY_ID } from '../services/ramApi'

export interface WalletInfo {
    id: string
    handle: string
    balance: bigint
}

export function useRamWallet() {
    const account = useCurrentAccount()
    const suiClient = useSuiClient()
    const [walletInfo, setWalletInfo] = useState<WalletInfo | null>(null)
    const [loading, setLoading] = useState(false)

    // Resolve SuiNS name from connected wallet address
    const { data: suinsName } = useResolveSuiNSName(account?.address)

    const queryWallet = useCallback(async (address: string) => {
        try {
            setLoading(true)

            // Query Registry to find wallet ID
            const registryObj = await suiClient.getObject({
                id: RAM_REGISTRY_ID,
                options: { showContent: true }
            })
            const registryContent = registryObj.data?.content as any
            const tableId = registryContent?.fields?.address_to_wallet?.fields?.id?.id

            if (!tableId) {
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
                setWalletInfo(null)
                setLoading(false)
                return
            }

            // Get wallet object details
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
                        const bagFields = await suiClient.getDynamicFields({
                            parentId: bagId
                        })

                        for (const field of bagFields.data) {
                            if (field.name && typeof field.name === 'object' && 'value' in field.name) {
                                const coinType = field.name.value as string
                                if (coinType.includes('sui::SUI')) {
                                    const balanceObj = await suiClient.getObject({
                                        id: field.objectId,
                                        options: { showContent: true }
                                    })
                                    const balanceContent = balanceObj.data?.content as any
                                    if (balanceContent?.fields?.value) {
                                        balance = BigInt(balanceContent.fields.value)
                                        break
                                    }
                                }
                            }
                        }
                    }
                } catch (error) {
                    console.error('Failed to query balance:', error)
                }

                setWalletInfo({
                    id: walletId,
                    handle: walletContent.fields.handle || '',
                    balance: balance
                })
            } else {
                setWalletInfo(null)
            }
        } catch (error) {
            console.error('Failed to query wallet:', error)
            setWalletInfo(null)
        } finally {
            setLoading(false)
        }
    }, [suiClient])

    // Query wallet when account changes
    useEffect(() => {
        if (!account?.address) {
            setWalletInfo(null)
            return
        }

        queryWallet(account.address)
    }, [account?.address, queryWallet])

    // Listen for balance updates
    useEffect(() => {
        const handleBalanceUpdate = () => {
            if (account?.address) {
                queryWallet(account.address)
            }
        }

        window.addEventListener('ram-balance-updated', handleBalanceUpdate)
        return () => {
            window.removeEventListener('ram-balance-updated', handleBalanceUpdate)
        }
    }, [account?.address, queryWallet])

    const refetch = useCallback(() => {
        if (account?.address) {
            queryWallet(account.address)
        }
    }, [account?.address, queryWallet])

    const displayName = suinsName
        ? `@${suinsName}`
        : account
            ? `@${account.address.slice(0, 6)}...${account.address.slice(-4)}`
            : ''

    return {
        walletInfo,
        loading,
        suinsName,
        displayName,
        refetch,
    }
}
