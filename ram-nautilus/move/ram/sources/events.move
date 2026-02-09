// Copyright (c) RAM
// SPDX-License-Identifier: Apache-2.0

/// Events module for RAM wallet
/// Emits events for indexing and tracking wallet activity
module ram::events {
    use std::string::String;
    use sui::event;

    // ====== Event Structs ======

    /// Emitted when a new wallet is created
    public struct WalletCreated has copy, drop {
        handle: String,
        wallet_id: ID,
    }

    /// Emitted when an address is linked to a wallet
    public struct AddressLinked has copy, drop {
        handle: String,
        linked_address: address,
    }

    /// Emitted when coins are deposited
    public struct Deposited has copy, drop {
        handle: String,
        coin_type: String,
        amount: u64,
    }

    /// Emitted when coins are withdrawn
    public struct Withdrawn has copy, drop {
        handle: String,
        coin_type: String,
        amount: u64,
    }

    /// Emitted when coins are transferred between wallets
    public struct Transferred has copy, drop {
        from_handle: String,
        to_handle: String,
        coin_type: String,
        amount: u64,
    }

    /// Emitted when a wallet is locked (duress detected or manual)
    public struct WalletLocked has copy, drop {
        handle: String,
        locked_until_ms: u64,
    }

    /// Emitted when BioAuth verification is completed
    public struct BioAuthCompleted has copy, drop {
        handle: String,
        amount: u64,
        result: u8, // 0=OK, 1=InvalidAmount, 2=Duress
    }

    // ====== Emit Functions ======

    public(package) fun emit_wallet_created(handle: String, wallet_id: ID) {
        event::emit(WalletCreated { handle, wallet_id });
    }

    public(package) fun emit_address_linked(handle: String, linked_address: address) {
        event::emit(AddressLinked { handle, linked_address });
    }

    public(package) fun emit_deposited(handle: String, coin_type: String, amount: u64) {
        event::emit(Deposited { handle, coin_type, amount });
    }

    public(package) fun emit_withdrawn(handle: String, coin_type: String, amount: u64) {
        event::emit(Withdrawn { handle, coin_type, amount });
    }

    public(package) fun emit_transferred(
        from_handle: String,
        to_handle: String,
        coin_type: String,
        amount: u64,
    ) {
        event::emit(Transferred { from_handle, to_handle, coin_type, amount });
    }

    public(package) fun emit_wallet_locked(handle: String, locked_until_ms: u64) {
        event::emit(WalletLocked { handle, locked_until_ms });
    }

    public(package) fun emit_bioauth_completed(handle: String, amount: u64, result: u8) {
        event::emit(BioAuthCompleted { handle, amount, result });
    }
}
