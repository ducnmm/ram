// Copyright (c) RAM
// SPDX-License-Identifier: Apache-2.0

/// Transfer module for RAM wallet
/// Handles transfers between wallets (by handle or direct)
module ram::transfers {
    use std::ascii;
    use std::type_name;
    use sui::balance::Balance;
    use sui::clock::Clock;
    use ram::core::{Self, RamWallet};
    use ram::events;
    use enclave::enclave::Enclave;

    // ====== Transfer with Signature (Voice/Tweet based) ======

    /// Transfer coins between wallets with enclave signature verification
    /// Only this transfer function requires a signature param
    public fun transfer_with_signature<T, E>(
        from: &mut RamWallet,
        to: &mut RamWallet,
        amount: u64,
        coin_type: vector<u8>,
        timestamp: u64,
        signature: &vector<u8>,
        enclave: &Enclave<E>,
        clock: &Clock,
    ) {
        // Check both wallets not locked
        core::assert_wallet_unlocked(from, clock);
        core::assert_wallet_unlocked(to, clock);

        // Verify coin type matches generic T
        let expected_type = type_name::get<T>().into_string().into_bytes();
        assert!(coin_type == expected_type, 100); // ECoinTypeMismatch

        // Verify signature from enclave
        let payload = core::new_transfer_payload(
            core::wallet_handle(from).into_bytes(),
            core::wallet_handle(to).into_bytes(),
            amount,
            coin_type,
        );
        let is_valid = enclave.verify_signature(
            core::transfer_intent(),
            timestamp,
            payload,
            signature,
        );
        assert!(is_valid, core::e_invalid_signature());

        // Check replay
        assert!(timestamp > core::wallet_last_timestamp(from), core::e_replay_attempt());
        core::wallet_set_last_timestamp(from, timestamp);

        // Execute transfer
        transfer_internal<T>(from, to, amount);

        // Emit event
        events::emit_transferred(
            core::wallet_handle(from),
            core::wallet_handle(to),
            type_name::get<T>().into_string().to_string(),
            amount,
        );
    }

    // ====== Transfer with Wallet Auth (Direct from dApp) ======

    /// Transfer coins between wallets using linked wallet (no signature param)
    /// Used when user signs transaction directly from their Sui wallet
    public fun transfer_with_wallet<T>(
        from: &mut RamWallet,
        to: &mut RamWallet,
        amount: u64,
        clock: &Clock,
        ctx: &TxContext,
    ) {
        // Check both wallets not locked
        core::assert_wallet_unlocked(from, clock);
        core::assert_wallet_unlocked(to, clock);

        // Check sender is linked to source wallet
        assert!(core::wallet_linked_address(from).is_some(), core::e_wallet_not_linked());
        assert!(ctx.sender() == *core::wallet_linked_address(from).borrow(), core::e_not_owner());

        // Execute transfer
        transfer_internal<T>(from, to, amount);

        // Emit event
        events::emit_transferred(
            core::wallet_handle(from),
            core::wallet_handle(to),
            type_name::get<T>().into_string().to_string(),
            amount,
        );
    }

    // ====== Internal Helper ======

    fun transfer_internal<T>(
        from: &mut RamWallet,
        to: &mut RamWallet,
        amount: u64,
    ) {
        let type_key = type_name::get<T>().into_string();

        let from_balances = core::wallet_balances_mut(from);
        
        // Check from has balance
        assert!(from_balances.contains(type_key), core::e_insufficient_balance());

        // Check sufficient balance
        let from_balance = from_balances.borrow_mut<ascii::String, Balance<T>>(type_key);
        assert!(from_balance.value() >= amount, core::e_insufficient_balance());

        // Split from source
        let transfer_balance = from_balance.split(amount);

        // Add to destination
        let to_balances = core::wallet_balances_mut(to);
        if (to_balances.contains(type_key)) {
            let to_balance = to_balances.borrow_mut<ascii::String, Balance<T>>(type_key);
            to_balance.join(transfer_balance);
        } else {
            to_balances.add(type_key, transfer_balance);
        };
    }
}
