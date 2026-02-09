// Copyright (c) RAM
// SPDX-License-Identifier: Apache-2.0

/// Tests for RAM wallet module
#[test_only]
module ram::tests {
    use sui::test_scenario::{Self as ts, Scenario};
    use sui::clock::{Self, Clock};
    use sui::coin;
    use sui::sui::SUI;
    use ram::core::{Self, RamWallet, RamRegistry};
    use ram::wallet;

    // ====== Test Addresses ======

    const ALICE: address = @0x1;
    const BOB: address = @0x2;

    // ====== Helper Functions ======

    fun setup_test(scenario: &mut Scenario) {
        ts::next_tx(scenario, ALICE);
        {
            core::init_for_testing(ts::ctx(scenario));
        };
    }

    fun create_clock(scenario: &mut Scenario, time_ms: u64): Clock {
        let mut clock = clock::create_for_testing(ts::ctx(scenario));
        clock::set_for_testing(&mut clock, time_ms);
        clock
    }

    /// Helper: create a wallet and return scenario ready to take_shared wallet
    fun create_test_wallet(scenario: &mut Scenario, sender: address, handle: vector<u8>) {
        ts::next_tx(scenario, sender);
        {
            let mut registry = ts::take_shared<RamRegistry>(scenario);
            wallet::create_wallet_no_sig(
                &mut registry,
                handle,
                ts::ctx(scenario),
            );
            ts::return_shared(registry);
        };
    }

    // ====== Wallet Creation Tests ======

    #[test]
    fun test_create_wallet_no_sig() {
        let mut scenario = ts::begin(ALICE);
        setup_test(&mut scenario);

        create_test_wallet(&mut scenario, ALICE, b"alice_handle");

        // Take the shared wallet and verify properties
        ts::next_tx(&mut scenario, ALICE);
        {
            let wallet = ts::take_shared<RamWallet>(&scenario);

            assert!(core::wallet_handle(&wallet) == b"alice_handle".to_string());
            assert!(core::wallet_locked_until(&wallet) == 0);
            assert!(core::wallet_linked_address(&wallet).is_some());

            ts::return_shared(wallet);
        };

        ts::end(scenario);
    }

    // ====== Lock/Unlock Tests ======

    #[test]
    fun test_wallet_not_locked_initially() {
        let mut scenario = ts::begin(ALICE);
        setup_test(&mut scenario);

        create_test_wallet(&mut scenario, ALICE, b"alice");

        ts::next_tx(&mut scenario, ALICE);
        {
            let wallet = ts::take_shared<RamWallet>(&scenario);
            let clock = create_clock(&mut scenario, 2000);

            assert!(!core::is_wallet_locked(&wallet, &clock));

            clock::destroy_for_testing(clock);
            ts::return_shared(wallet);
        };

        ts::end(scenario);
    }

    #[test]
    fun test_wallet_lock_duration() {
        let mut scenario = ts::begin(ALICE);
        setup_test(&mut scenario);

        create_test_wallet(&mut scenario, ALICE, b"alice");

        ts::next_tx(&mut scenario, ALICE);
        {
            let mut wallet = ts::take_shared<RamWallet>(&scenario);
            let clock = create_clock(&mut scenario, 5000);

            // Lock wallet
            core::lock_wallet(&mut wallet, &clock);
            
            // Verify locked until = now + 24h
            let lock_end = core::wallet_locked_until(&wallet);
            assert!(lock_end == 5000 + 86_400_000); // 24 hours

            // Verify is_locked returns true
            assert!(core::is_wallet_locked(&wallet, &clock));

            clock::destroy_for_testing(clock);
            ts::return_shared(wallet);
        };

        ts::end(scenario);
    }

    #[test]
    fun test_wallet_unlocks_after_24h() {
        let mut scenario = ts::begin(ALICE);
        setup_test(&mut scenario);

        create_test_wallet(&mut scenario, ALICE, b"alice");

        ts::next_tx(&mut scenario, ALICE);
        {
            let mut wallet = ts::take_shared<RamWallet>(&scenario);

            // Lock at time 5000
            let clock = create_clock(&mut scenario, 5000);
            core::lock_wallet(&mut wallet, &clock);
            assert!(core::is_wallet_locked(&wallet, &clock));
            clock::destroy_for_testing(clock);

            // Still locked after 12 hours
            let clock2 = create_clock(&mut scenario, 5000 + 43_200_000);
            assert!(core::is_wallet_locked(&wallet, &clock2));
            clock::destroy_for_testing(clock2);

            // Unlocked after 24 hours + 1ms
            let clock3 = create_clock(&mut scenario, 5000 + 86_400_000 + 1);
            assert!(!core::is_wallet_locked(&wallet, &clock3));
            clock::destroy_for_testing(clock3);

            ts::return_shared(wallet);
        };

        ts::end(scenario);
    }

    // ====== Deposit Tests ======

    #[test]
    fun test_deposit() {
        let mut scenario = ts::begin(ALICE);
        setup_test(&mut scenario);

        create_test_wallet(&mut scenario, ALICE, b"alice");

        ts::next_tx(&mut scenario, ALICE);
        {
            let mut wallet = ts::take_shared<RamWallet>(&scenario);

            let coin = coin::mint_for_testing<SUI>(1000000, ts::ctx(&mut scenario));
            let clock = create_clock(&mut scenario, 2000);

            wallet::deposit<SUI>(&mut wallet, coin, &clock);

            clock::destroy_for_testing(clock);
            ts::return_shared(wallet);
        };

        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = core::EWalletLocked)]
    fun test_deposit_blocked_when_locked() {
        let mut scenario = ts::begin(ALICE);
        setup_test(&mut scenario);

        create_test_wallet(&mut scenario, ALICE, b"alice");

        ts::next_tx(&mut scenario, ALICE);
        {
            let mut wallet = ts::take_shared<RamWallet>(&scenario);

            // Lock wallet
            let clock = create_clock(&mut scenario, 3000);
            core::lock_wallet(&mut wallet, &clock);

            // Try to deposit while locked - should fail
            let coin = coin::mint_for_testing<SUI>(1000000, ts::ctx(&mut scenario));
            wallet::deposit<SUI>(&mut wallet, coin, &clock);

            clock::destroy_for_testing(clock);
            ts::return_shared(wallet);
        };

        ts::end(scenario);
    }

    // ====== Address Registration Tests ======

    #[test]
    #[expected_failure(abort_code = core::EAddressAlreadyExists, location = wallet)]
    fun test_address_already_exists() {
        let mut scenario = ts::begin(ALICE);
        setup_test(&mut scenario);

        // ALICE creates first wallet
        create_test_wallet(&mut scenario, ALICE, b"alice_first");

        // Try to create second wallet from ALICE - should fail
        ts::next_tx(&mut scenario, ALICE);
        {
            let mut registry = ts::take_shared<RamRegistry>(&scenario);

            wallet::create_wallet_no_sig(
                &mut registry,
                b"alice_second",
                ts::ctx(&mut scenario),
            );

            ts::return_shared(registry);
        };

        ts::end(scenario);
    }

    #[test]
    fun test_different_addresses_ok() {
        let mut scenario = ts::begin(ALICE);
        setup_test(&mut scenario);

        // ALICE creates wallet
        create_test_wallet(&mut scenario, ALICE, b"alice");

        // BOB creates wallet - should succeed
        create_test_wallet(&mut scenario, BOB, b"bob");

        ts::end(scenario);
    }
}
