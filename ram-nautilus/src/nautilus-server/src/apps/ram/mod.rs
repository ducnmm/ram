// Copyright (c) RAM
// SPDX-License-Identifier: Apache-2.0

//! RAM - Voice-Protected Wallet Enclave Server Module
//!
//! Provides voice authentication with stress/duress detection for secure transfers.
//!
//! ## Module Structure
//!
//! - `types`: Request/response structs and payload definitions
//! - `audio`: Audio processing and stress detection
//! - `handlers`: HTTP endpoint handlers

// Submodules
mod audio;
mod handlers;
mod types;

// Re-export types
pub use types::{
    // Payloads (for Move contract integration)
    CreateWalletPayload,
    LinkAddressPayload,
    TransferPayload,
    WithdrawPayload,
    BioAuthPayload,
    // Request types
    CreateWalletRequest,
    LinkAddressRequest,
    BioAuthRequest,
    TransferRequest,
    WithdrawRequest,
    // Response types
    CreateWalletResponse,
    LinkAddressResponse,
    BioAuthResponse,
    TransferResponse,
    WithdrawResponse,
    BioAuthData,
    BioAuthResult,
};

// Re-export handlers (public endpoints)
pub use handlers::{
    process_create_wallet,
    process_link_address,
    process_bio_auth,
    process_transfer,
    process_withdraw,
};

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_bioauth_result_codes() {
        assert_eq!(BioAuthResult::Ok as u8, 0);
        assert_eq!(BioAuthResult::InvalidAmount as u8, 1);
        assert_eq!(BioAuthResult::Duress as u8, 2);
    }
}
