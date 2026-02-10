// Copyright (c) RAM
// SPDX-License-Identifier: Apache-2.0

/// Wallet management module for RAM
/// Handles wallet creation, address linking, deposits and withdrawals
module ram::wallet {
    use std::string::{Self, String};
    use std::ascii;
    use std::type_name;
    use sui::balance::Balance;
    use sui::coin::Coin;
    use sui::clock::Clock;
    use ram::core::{Self, RamRegistry, RamWallet};
    use ram::events;
    use enclave::enclave::Enclave;

    // ====== Wallet Creation ======

    /// Create a new RAM wallet with enclave signature verification
    public fun create_wallet<T>(
        registry: &mut RamRegistry,
        handle: vector<u8>,
        timestamp: u64,
        signature: &vector<u8>,
        enclave: &Enclave<T>,
        ctx: &mut TxContext,
    ) {
        let handle_str = string::utf8(handle);
        let sender_addr = ctx.sender();

        // Check address uniqueness - each address can only create one wallet
        assert!(!core::registry_contains_address(registry, sender_addr), core::e_address_already_exists());

        // Verify signature from enclave
        let payload = core::new_create_wallet_payload(handle);
        let is_valid = enclave.verify_signature(
            core::create_wallet_intent(),
            timestamp,
            payload,
            signature,
        );
        assert!(is_valid, core::e_invalid_signature());

        // Create wallet
        let mut wallet = core::new_wallet(handle_str, ctx);
        core::wallet_set_last_timestamp(&mut wallet, timestamp);
        let wallet_id = core::wallet_id(&wallet);

        // Register in registry by sender address
        core::registry_add_address(registry, sender_addr, wallet_id);

        // Emit event
        events::emit_wallet_created(handle_str, wallet_id);

        // Share wallet so it can be accessed in transfers
        transfer::public_share_object(wallet);
    }

    /// Create wallet without signature (for backend auto-creation)
    public fun create_wallet_no_sig(
        registry: &mut RamRegistry,
        handle: vector<u8>,
        ctx: &mut TxContext,
    ) {
        let handle_str = string::utf8(handle);
        let sender_addr = ctx.sender();

        // Check address uniqueness - each address can only create one wallet
        assert!(!core::registry_contains_address(registry, sender_addr), core::e_address_already_exists());

        // Create wallet
        let mut wallet = core::new_wallet(handle_str, ctx);
        let wallet_id = core::wallet_id(&wallet);

        // Register in registry by sender address
        core::registry_add_address(registry, sender_addr, wallet_id);

        // Automatically link the creator's address to the wallet
        core::wallet_set_linked_address(&mut wallet, sender_addr);

        // Emit events
        events::emit_wallet_created(handle_str, wallet_id);
        events::emit_address_linked(handle_str, sender_addr);

        // Share wallet so it can be accessed in transfers
        transfer::public_share_object(wallet);
    }

    /// Create wallet for a specific address (auto-creation during transfers)
    /// Allows anyone to create a wallet for any address that doesn't have one yet
    /// Create wallet for a specific address (auto-creation during transfers)
    public fun create_wallet_for_address(
        registry: &mut RamRegistry,
        target_address: address,
        handle: vector<u8>,
        ctx: &mut TxContext,
    ) {
        let handle_str = string::utf8(handle);

        // Check address uniqueness - each address can only have one wallet
        assert!(!core::registry_contains_address(registry, target_address), core::e_address_already_exists());

        // Create wallet
        let mut wallet = core::new_wallet(handle_str, ctx);
        let wallet_id = core::wallet_id(&wallet);

        // Register by target address
        core::registry_add_address(registry, target_address, wallet_id);

        // Automatically link to target address
        core::wallet_set_linked_address(&mut wallet, target_address);

        // Emit events
        events::emit_wallet_created(handle_str, wallet_id);
        events::emit_address_linked(handle_str, target_address);

        // Share wallet so it can be accessed in transfers
        transfer::public_share_object(wallet);
    }

    // ====== Address Linking ======

    /// Link a Sui wallet address to RAM wallet (with signature)
    public fun link_address<T>(
        wallet: &mut RamWallet,
        address: address,
        timestamp: u64,
        signature: &vector<u8>,
        enclave: &Enclave<T>,
    ) {
        // Verify signature from enclave
        let payload = core::new_link_address_payload(
            core::wallet_handle(wallet).into_bytes(),
            address,
        );
        let is_valid = enclave.verify_signature(
            core::link_address_intent(),
            timestamp,
            payload,
            signature,
        );
        assert!(is_valid, core::e_invalid_signature());

        // Check replay
        assert!(timestamp > core::wallet_last_timestamp(wallet), core::e_replay_attempt());
        core::wallet_set_last_timestamp(wallet, timestamp);

        // Link address
        core::wallet_set_linked_address(wallet, address);

        // Emit event
        events::emit_address_linked(core::wallet_handle(wallet), address);
    }

    // ====== Deposit Functions ======

    /// Deposit coins into wallet (anyone can deposit, but wallet must be unlocked)
    /// Deposit coins into wallet (anyone can deposit, but wallet must be unlocked)
    public fun deposit<T>(
        wallet: &mut RamWallet,
        coin: Coin<T>,
        clock: &Clock,
    ) {
        // Check wallet not locked
        core::assert_wallet_unlocked(wallet, clock);

        let type_key = type_name::get<T>().into_string();
        let amount = coin.value();
        let balance = coin.into_balance();

        let balances = core::wallet_balances_mut(wallet);
        if (balances.contains(type_key)) {
            let existing = balances.borrow_mut<ascii::String, Balance<T>>(type_key);
            existing.join(balance);
        } else {
            balances.add(type_key, balance);
        };

        // Emit event
        events::emit_deposited(
            core::wallet_handle(wallet),
            type_key.to_string(),
            amount,
        );
    }

    /// Withdraw coins from wallet (owner only, wallet must be unlocked)
    /// Requires enclave signature verification
    public fun withdraw<T, E>(
        wallet: &mut RamWallet,
        amount: u64,
        coin_type: vector<u8>,
        timestamp: u64,
        signature: &vector<u8>,
        enclave: &Enclave<E>,
        clock: &Clock,
        ctx: &mut TxContext,
    ): Coin<T> {
        // Check wallet not locked
        core::assert_wallet_unlocked(wallet, clock);

        // Check linked address
        assert!(core::wallet_linked_address(wallet).is_some(), core::e_wallet_not_linked());
        assert!(ctx.sender() == *core::wallet_linked_address(wallet).borrow(), core::e_not_owner());

        // Verify coin type matches
        let expected_type = type_name::get<T>().into_string().into_bytes();
        assert!(coin_type == expected_type, 100); // ECoinTypeMismatch

        // Verify signature from enclave
        let payload = core::new_withdraw_payload(
            core::wallet_handle(wallet).into_bytes(),
            amount,
            coin_type,
        );
        let is_valid = enclave.verify_signature(
            core::withdraw_intent(),
            timestamp,
            payload,
            signature,
        );
        assert!(is_valid, core::e_invalid_signature());

        let type_key = type_name::get<T>().into_string();
        let balances = core::wallet_balances_mut(wallet);

        // Check balance exists and is sufficient
        assert!(balances.contains(type_key), core::e_insufficient_balance());
        let balance = balances.borrow_mut<ascii::String, Balance<T>>(type_key);
        assert!(balance.value() >= amount, core::e_insufficient_balance());

        let coin = balance.split(amount).into_coin(ctx);

        // Emit event
        events::emit_withdrawn(
            core::wallet_handle(wallet),
            type_key.to_string(),
            amount,
        );

        coin
    }

    // ====== View Functions ======

    /// Get balance for a coin type
    public fun get_balance<T>(wallet: &RamWallet): u64 {
        let type_key = type_name::get<T>().into_string();
        let balances = core::wallet_balances(wallet);
        if (balances.contains(type_key)) {
            balances.borrow<ascii::String, Balance<T>>(type_key).value()
        } else {
            0
        }
    }

    /// Check if wallet is locked
    public fun is_locked(wallet: &RamWallet, clock: &Clock): bool {
        core::is_wallet_locked(wallet, clock)
    }

    /// Get wallet ID by address
    public fun get_wallet_id_by_address(registry: &RamRegistry, addr: address): Option<ID> {
        if (core::registry_contains_address(registry, addr)) {
            option::some(core::registry_get_wallet_id(registry, addr))
        } else {
            option::none()
        }
    }
}
