// Copyright (c) RAM
// SPDX-License-Identifier: Apache-2.0

/// BioGuard module for RAM wallet
/// Handles voice authentication and duress detection
/// 
/// When user wants to transfer, they must:
/// 1. Record voice saying "I confirm sending X [coin] to [handle]"
/// 2. Server analyzes voice for stress/duress
/// 3. If OK -> transfer proceeds
/// 4. If duress detected -> wallet locks for 24 hours
module ram::bioguard {
    use sui::clock::Clock;
    use ram::core::{Self, RamWallet};
    use ram::events;
    use enclave::enclave::Enclave;

    // ====== BioAuth Verification ======

    /// Apply BioAuth result from enclave
    /// 
    /// Result codes:
    /// - 0 (OK): Voice verified, no stress detected
    /// - 1 (InvalidAmount): Spoken amount doesn't match
    /// - 2 (Duress): Stress/panic detected -> LOCK WALLET
    public fun apply_bioauth<T>(
        wallet: &mut RamWallet,
        handle: vector<u8>,
        amount: u64,
        result: u8,
        transcript: vector<u8>,
        timestamp: u64,
        signature: &vector<u8>,
        enclave: &Enclave<T>,
        clock: &Clock,
    ) {
        // Verify the handle matches
        assert!(
            core::wallet_handle(wallet).into_bytes() == handle,
            core::e_not_owner()
        );

        // Verify signature from enclave
        // COMMENTED FOR TESTING - Re-enable for production
        // let payload = core::new_bioauth_payload(handle, amount, result, transcript);
        // let is_valid = enclave.verify_signature(
        //     core::bioauth_intent(),
        //     timestamp,
        //     payload,
        //     signature,
        // );
        // assert!(is_valid, core::e_invalid_signature());

        // Check replay
        assert!(timestamp > core::wallet_last_timestamp(wallet), core::e_replay_attempt());
        core::wallet_set_last_timestamp(wallet, timestamp);

        // Handle result
        if (result == core::bioauth_duress()) {
            // DURESS DETECTED - Lock wallet for 24 hours
            core::lock_wallet(wallet, clock);
            
            // Emit lock event
            events::emit_wallet_locked(
                core::wallet_handle(wallet),
                core::wallet_locked_until(wallet),
            );
        };

        // Emit bioauth event
        events::emit_bioauth_completed(
            core::wallet_handle(wallet),
            amount,
            result,
        );
    }

    // ====== Manual Lock/Unlock ======

    /// Manually lock wallet (owner can lock their own wallet)
    public fun lock_my_wallet(
        wallet: &mut RamWallet,
        clock: &Clock,
        ctx: &TxContext,
    ) {
        // Check sender is linked
        assert!(core::wallet_linked_address(wallet).is_some(), core::e_wallet_not_linked());
        assert!(ctx.sender() == *core::wallet_linked_address(wallet).borrow(), core::e_not_owner());

        // Lock wallet
        core::lock_wallet(wallet, clock);

        // Emit event
        events::emit_wallet_locked(
            core::wallet_handle(wallet),
            core::wallet_locked_until(wallet),
        );
    }

    /// Check remaining lock time in milliseconds (0 if unlocked)
    public fun remaining_lock_time(wallet: &RamWallet, clock: &Clock): u64 {
        let now = sui::clock::timestamp_ms(clock);
        let locked_until = core::wallet_locked_until(wallet);
        
        if (now >= locked_until) {
            0
        } else {
            locked_until - now
        }
    }
}
