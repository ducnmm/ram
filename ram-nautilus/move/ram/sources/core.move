// Copyright (c) RAM
// SPDX-License-Identifier: Apache-2.0

/// Core module for RAM wallet - Voice-protected cryptocurrency wallet
/// 
/// RAM is a wallet that uses voice authentication with stress detection
/// to protect users from coerced transfers. When duress is detected,
/// the wallet automatically locks for 24 hours.
module ram::core {
    use std::string::String;
    use sui::table::{Self, Table};
    use sui::bag::{Self, Bag};
    use sui::clock::{Self, Clock};
    use enclave::enclave;

    // ====== Error Codes ======

    const EAddressAlreadyExists: u64 = 0;
    const ENotOwner: u64 = 1;
    const EInvalidSignature: u64 = 2;
    const EReplayAttempt: u64 = 3;
    const EInsufficientBalance: u64 = 4;
    const EWalletLocked: u64 = 5;
    const EWalletNotLinked: u64 = 6;
    const EAddressNotFound: u64 = 7;

    // ====== Intent Constants (must match Rust server) ======

    const CREATE_WALLET_INTENT: u8 = 0;
    const LINK_ADDRESS_INTENT: u8 = 1;
    const TRANSFER_INTENT: u8 = 2;
    const BIOAUTH_INTENT: u8 = 3;
    const WITHDRAW_INTENT: u8 = 4;

    // ====== BioAuth Result Codes ======

    const BIOAUTH_OK: u8 = 0;
    const BIOAUTH_INVALID_AMOUNT: u8 = 1;
    const BIOAUTH_DURESS: u8 = 2;

    // ====== Lock Duration ======

    const LOCK_DURATION_MS: u64 = 86_400_000; // 24 hours

    // ====== Core Structs ======

    /// One-Time Witness
    public struct CORE has drop {}

    /// Application identity for enclave
    public struct RAM has drop {}

    /// Registry mapping addresses to wallet IDs (Shared Object)
    /// Each address can only create one wallet
    public struct RamRegistry has key {
        id: UID,
        address_to_wallet: Table<address, ID>,
    }

    /// RAM Wallet NFT - The main wallet object owned by user
    /// This NFT represents a voice-protected wallet
    public struct RamWallet has key, store {
        id: UID,
        /// User's handle (e.g., Twitter handle, username)
        handle: String,
        /// Coin balances stored in bag (type -> Balance<T>)
        balances: Bag,
        /// Linked Sui wallet address (can withdraw directly)
        linked_address: Option<address>,
        /// Timestamp when wallet will unlock (0 = not locked)
        locked_until_ms: u64,
        /// Last operation timestamp for replay protection
        last_timestamp: u64,
    }

    // ====== Payload Structs (must match Rust server) ======

    #[allow(unused_field)]
    public struct CreateWalletPayload has copy, drop {
        handle: vector<u8>,
    }

    #[allow(unused_field)]
    public struct LinkAddressPayload has copy, drop {
        handle: vector<u8>,
        address: address,
    }

    #[allow(unused_field)]
    public struct TransferPayload has copy, drop {
        from_handle: vector<u8>,
        to_handle: vector<u8>,
        amount: u64,
        coin_type: vector<u8>,
    }

    #[allow(unused_field)]
    public struct BioAuthPayload has copy, drop {
        handle: vector<u8>,
        amount: u64,
        result: u8,
        transcript: vector<u8>,
    }

    #[allow(unused_field)]
    public struct WithdrawPayload has copy, drop {
        handle: vector<u8>,
        amount: u64,
        coin_type: vector<u8>,
    }

    // ====== Init Function ======

    fun init(_otw: CORE, ctx: &mut TxContext) {
        // Create enclave capability
        let cap = enclave::new_cap(RAM {}, ctx);

        cap.create_enclave_config(
            b"ram voice wallet".to_string(),
            x"000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000", // pcr0 (debug)
            x"000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000", // pcr1 (debug)
            x"000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000", // pcr2 (debug)
            ctx,
        );

        // Create and share registry
        let registry = RamRegistry {
            id: object::new(ctx),
            address_to_wallet: table::new(ctx),
        };
        transfer::share_object(registry);

        // Transfer cap to sender
        transfer::public_transfer(cap, ctx.sender());
    }

    // ====== Public Getter Functions for Error Codes ======

    public fun e_address_already_exists(): u64 { EAddressAlreadyExists }
    public fun e_not_owner(): u64 { ENotOwner }
    public fun e_invalid_signature(): u64 { EInvalidSignature }
    public fun e_replay_attempt(): u64 { EReplayAttempt }
    public fun e_insufficient_balance(): u64 { EInsufficientBalance }
    public fun e_wallet_locked(): u64 { EWalletLocked }
    public fun e_wallet_not_linked(): u64 { EWalletNotLinked }
    public fun e_address_not_found(): u64 { EAddressNotFound }

    // ====== Public Getter Functions for Intent Constants ======

    public fun create_wallet_intent(): u8 { CREATE_WALLET_INTENT }
    public fun link_address_intent(): u8 { LINK_ADDRESS_INTENT }
    public fun transfer_intent(): u8 { TRANSFER_INTENT }
    public fun bioauth_intent(): u8 { BIOAUTH_INTENT }
    public fun withdraw_intent(): u8 { WITHDRAW_INTENT }

    // ====== Public Getter Functions for BioAuth Results ======

    public fun bioauth_ok(): u8 { BIOAUTH_OK }
    public fun bioauth_invalid_amount(): u8 { BIOAUTH_INVALID_AMOUNT }
    public fun bioauth_duress(): u8 { BIOAUTH_DURESS }

    // ====== Registry Functions ======

    public(package) fun registry_contains_address(registry: &RamRegistry, addr: address): bool {
        registry.address_to_wallet.contains(addr)
    }

    public(package) fun registry_add_address(registry: &mut RamRegistry, addr: address, wallet_id: ID) {
        registry.address_to_wallet.add(addr, wallet_id);
    }

    public fun registry_get_wallet_id(registry: &RamRegistry, addr: address): ID {
        assert!(registry.address_to_wallet.contains(addr), EAddressNotFound);
        *registry.address_to_wallet.borrow(addr)
    }

    // ====== Wallet Field Accessors ======

    public fun wallet_handle(wallet: &RamWallet): String {
        wallet.handle
    }

    public fun wallet_linked_address(wallet: &RamWallet): &Option<address> {
        &wallet.linked_address
    }

    public fun wallet_locked_until(wallet: &RamWallet): u64 {
        wallet.locked_until_ms
    }

    public fun wallet_last_timestamp(wallet: &RamWallet): u64 {
        wallet.last_timestamp
    }

    public fun wallet_id(wallet: &RamWallet): ID {
        object::id(wallet)
    }

    public(package) fun wallet_balances(wallet: &RamWallet): &Bag {
        &wallet.balances
    }

    public(package) fun wallet_balances_mut(wallet: &mut RamWallet): &mut Bag {
        &mut wallet.balances
    }

    public(package) fun wallet_set_linked_address(wallet: &mut RamWallet, addr: address) {
        wallet.linked_address.swap_or_fill(addr);
    }

    public(package) fun wallet_set_locked_until(wallet: &mut RamWallet, until_ms: u64) {
        wallet.locked_until_ms = until_ms;
    }

    public(package) fun wallet_set_last_timestamp(wallet: &mut RamWallet, ts: u64) {
        wallet.last_timestamp = ts;
    }

    // ====== Wallet State Checks ======

    /// Check if wallet is currently locked
    public fun is_wallet_locked(wallet: &RamWallet, clock: &Clock): bool {
        let now = clock::timestamp_ms(clock);
        now < wallet.locked_until_ms
    }

    /// Assert wallet is not locked (for operations)
    public(package) fun assert_wallet_unlocked(wallet: &RamWallet, clock: &Clock) {
        assert!(!is_wallet_locked(wallet, clock), EWalletLocked);
    }

    /// Lock wallet for 24 hours from now
    public(package) fun lock_wallet(wallet: &mut RamWallet, clock: &Clock) {
        let now = clock::timestamp_ms(clock);
        let lock_until = now + LOCK_DURATION_MS;
        // Only extend lock if new time is later
        if (lock_until > wallet.locked_until_ms) {
            wallet.locked_until_ms = lock_until;
        };
    }

    // ====== Wallet Creation ======

    public(package) fun new_wallet(
        handle: String,
        ctx: &mut TxContext,
    ): RamWallet {
        RamWallet {
            id: object::new(ctx),
            handle,
            balances: bag::new(ctx),
            linked_address: option::none(),
            locked_until_ms: 0,
            last_timestamp: 0,
        }
    }

    // ====== Payload Constructors ======

    public(package) fun new_create_wallet_payload(handle: vector<u8>): CreateWalletPayload {
        CreateWalletPayload { handle }
    }

    public(package) fun new_link_address_payload(handle: vector<u8>, address: address): LinkAddressPayload {
        LinkAddressPayload { handle, address }
    }

    public(package) fun new_transfer_payload(
        from_handle: vector<u8>,
        to_handle: vector<u8>,
        amount: u64,
        coin_type: vector<u8>,
    ): TransferPayload {
        TransferPayload { from_handle, to_handle, amount, coin_type }
    }

    public(package) fun new_bioauth_payload(
        handle: vector<u8>,
        amount: u64,
        result: u8,
        transcript: vector<u8>,
    ): BioAuthPayload {
        BioAuthPayload { handle, amount, result, transcript }
    }

    public(package) fun new_withdraw_payload(
        handle: vector<u8>,
        amount: u64,
        coin_type: vector<u8>,
    ): WithdrawPayload {
        WithdrawPayload { handle, amount, coin_type }
    }

    // ====== Test-Only Functions ======

    #[test_only]
    public fun init_for_testing(ctx: &mut TxContext) {
        init(CORE {}, ctx);
    }
}
