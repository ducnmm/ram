// Copyright (c) RAM
// SPDX-License-Identifier: Apache-2.0

//! Type definitions for RAM wallet enclave
//!
//! Contains all payload structs, request/response types, and data structures.
//! These must match the Move contract definitions in move/ram/

use serde::{Deserialize, Serialize};
use serde_repr::{Deserialize_repr, Serialize_repr};

// ============================================================================
// INTENT CONSTANTS - Must match Move contract (core.move)
// ============================================================================

/// Intent codes - must match CREATE_WALLET_INTENT, LINK_ADDRESS_INTENT, etc. in core.move
pub const CREATE_WALLET_INTENT: u8 = 0;
pub const LINK_ADDRESS_INTENT: u8 = 1;
pub const TRANSFER_INTENT: u8 = 2;
pub const BIOAUTH_INTENT: u8 = 3;
pub const WITHDRAW_INTENT: u8 = 4;

// ============================================================================
// PAYLOAD TYPES - Must match Move contract definitions
// ============================================================================

/// Create wallet payload
/// Must match CreateWalletPayload in core.move
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CreateWalletPayload {
    pub handle: Vec<u8>,  // User handle as bytes
}

/// Link address payload
/// Must match LinkAddressPayload in core.move
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LinkAddressPayload {
    pub handle: Vec<u8>,         // User handle as bytes
    pub address: [u8; 32],       // Sui wallet address (32 bytes)
}

/// Transfer payload
/// Must match TransferPayload in core.move
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TransferPayload {
    pub from_handle: Vec<u8>,    // Source handle as bytes
    pub to_handle: Vec<u8>,      // Destination handle as bytes
    pub amount: u64,             // Amount in smallest unit
    pub coin_type: Vec<u8>,      // Coin type as bytes
}

/// BioAuth payload
/// Must match BioAuthPayload in core.move
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BioAuthPayload {
    pub handle: Vec<u8>,         // User handle as bytes
    pub amount: u64,             // Expected transfer amount
    pub result: u8,              // 0=OK, 1=InvalidAmount, 2=Duress
    pub transcript: Vec<u8>,     // What user said (for debugging)
}

/// Withdraw payload
/// Must match WithdrawPayload in core.move
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WithdrawPayload {
    pub handle: Vec<u8>,         // User handle as bytes
    pub amount: u64,             // Amount in smallest unit
    pub coin_type: Vec<u8>,      // Coin type as bytes
}

// ============================================================================
// REQUEST TYPES
// ============================================================================

/// Request to create a new RAM wallet
#[derive(Debug, Serialize, Deserialize)]
pub struct CreateWalletRequest {
    pub handle: String,  // User's unique handle (e.g., username, phone number hash)
}

/// Request to link a Sui address to RAM wallet
#[derive(Debug, Serialize, Deserialize)]
pub struct LinkAddressRequest {
    pub handle: String,              // User's handle
    pub wallet_address: String,      // Sui wallet address (0x...)
    pub wallet_signature: String,    // Signature of message proving ownership
    pub message: String,             // The message that was signed
}

/// BioAuth request containing voice audio
#[derive(Debug, Serialize, Deserialize)]
pub struct BioAuthRequest {
    pub handle: String,              // User's handle
    pub audio_base64: String,        // Base64 encoded audio file (WAV/MP3)
    pub expected_amount: u64,        // Amount in smallest unit (MIST for SUI)
    pub coin_type: Option<String>,   // Optional coin type (default: SUI)
}

/// Request to sign a transfer
#[derive(Debug, Serialize, Deserialize)]
pub struct TransferRequest {
    pub from_handle: String,         // Sender's handle
    pub to_handle: String,           // Recipient's handle
    pub amount: u64,                 // Amount in smallest unit
    pub coin_type: String,           // Coin type string (e.g., "0x2::sui::SUI")
}

/// Request to sign a withdrawal
#[derive(Debug, Serialize, Deserialize)]
pub struct WithdrawRequest {
    pub handle: String,              // User's handle
    pub amount: u64,                 // Amount in smallest unit
    pub coin_type: String,           // Coin type string
}

// ============================================================================
// RESPONSE TYPES
// ============================================================================

/// Response for create wallet
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateWalletResponse {
    pub payload: CreateWalletPayload,
    pub intent: u8,
    pub timestamp_ms: u64,
    pub signature: String,
}

/// Response for link address
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinkAddressResponse {
    pub payload: LinkAddressPayload,
    pub intent: u8,
    pub timestamp_ms: u64,
    pub signature: String,
}

/// BioAuth verification result codes
/// Must match BIOAUTH_OK, BIOAUTH_INVALID_AMOUNT, BIOAUTH_DURESS in core.move
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize_repr, Deserialize_repr)]
#[repr(u8)]
pub enum BioAuthResult {
    Ok = 0,            // Voice verified, amount matches, no stress
    InvalidAmount = 1, // Spoken amount doesn't match expected
    Duress = 2,        // Stress/panic detected -> LOCK WALLET
}

impl BioAuthResult {
    pub fn as_str(&self) -> &'static str {
        match self {
            BioAuthResult::Ok => "ok",
            BioAuthResult::InvalidAmount => "invalid_amount",
            BioAuthResult::Duress => "duress",
        }
    }
}

/// Human-readable BioAuth data for UI
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BioAuthData {
    pub handle: String,
    pub amount: u64,
    pub result: String,       // "ok", "invalid_amount", "duress"
    pub transcript: String,   // What the AI heard
    pub stress_level: u8,     // 0-100 stress indicator
    pub locked: bool,         // Will wallet be locked?
}

/// Complete BioAuth response (BLIND - no human-readable data)
/// Frontend cannot see stress_level or result to prevent bypassing duress detection
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BioAuthResponse {
    /// Signed payload for on-chain apply_bioauth call (BCS encoded)
    pub payload: BioAuthPayload,
    /// Intent code (should be BIOAUTH_INTENT = 3)
    pub intent: u8,
    /// Timestamp used in signature
    pub timestamp_ms: u64,
    /// Hex-encoded signature
    pub signature: String,
    // NO data field! Frontend learns result from blockchain events only.
}

/// Response for transfer signature
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferResponse {
    pub payload: TransferPayload,
    pub intent: u8,
    pub timestamp_ms: u64,
    pub signature: String,
}

/// Response for withdraw signature
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WithdrawResponse {
    pub payload: WithdrawPayload,
    pub intent: u8,
    pub timestamp_ms: u64,
    pub signature: String,
}
