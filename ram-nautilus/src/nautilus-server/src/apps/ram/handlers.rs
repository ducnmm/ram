// Copyright (c) RAM
// SPDX-License-Identifier: Apache-2.0

//! Request handlers for RAM wallet enclave endpoints
//!
//! Contains all the process_* functions for handling wallet operations.

use crate::common::{to_signed_response, IntentScope, ProcessDataRequest};
use crate::AppState;
use crate::EnclaveError;
use axum::extract::State;
use axum::Json;
use std::sync::Arc;
use tracing::info;

use super::audio;
use super::types::*;

/// Create a new RAM wallet (signed by enclave)
/// 
/// This is called when a new user wants to create their voice-protected wallet.
pub async fn process_create_wallet(
    State(state): State<Arc<AppState>>,
    Json(request): Json<ProcessDataRequest<CreateWalletRequest>>,
) -> Result<Json<CreateWalletResponse>, EnclaveError> {
    let req = &request.payload;
    
    info!("RAM: Creating wallet for handle='{}'", req.handle);

    let current_timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| EnclaveError::GenericError(format!("Failed to get timestamp: {}", e)))?
        .as_millis() as u64;

    // Build payload
    let payload = CreateWalletPayload {
        handle: req.handle.clone().into_bytes(),
    };

    // Sign payload
    let signed = to_signed_response(
        &state.eph_kp,
        payload.clone(),
        current_timestamp,
        IntentScope::ProcessData, // Use CREATE_WALLET_INTENT = 0
    );

    let response = CreateWalletResponse {
        payload,
        intent: CREATE_WALLET_INTENT,
        timestamp_ms: current_timestamp,
        signature: signed.signature,
    };

    info!("RAM: Wallet creation signed for handle='{}'", req.handle);

    Ok(Json(response))
}

/// Link a Sui wallet address to RAM wallet
/// 
/// The user proves they own the Sui wallet by signing a message.
/// TODO: Add wallet signature verification
pub async fn process_link_address(
    State(state): State<Arc<AppState>>,
    Json(request): Json<ProcessDataRequest<LinkAddressRequest>>,
) -> Result<Json<LinkAddressResponse>, EnclaveError> {
    let req = &request.payload;
    
    info!(
        "RAM: Linking address for handle='{}' -> {}",
        req.handle, req.wallet_address
    );

    let current_timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| EnclaveError::GenericError(format!("Failed to get timestamp: {}", e)))?
        .as_millis() as u64;

    // Parse wallet address (remove 0x prefix if present)
    let addr_hex = req.wallet_address.strip_prefix("0x").unwrap_or(&req.wallet_address);
    let addr_bytes: [u8; 32] = hex::decode(addr_hex)
        .map_err(|e| EnclaveError::GenericError(format!("Invalid address: {}", e)))?
        .try_into()
        .map_err(|_| EnclaveError::GenericError("Address must be 32 bytes".to_string()))?;

    // TODO: Verify wallet signature to prove ownership
    // For now, we'll trust the request

    // Build payload
    let payload = LinkAddressPayload {
        handle: req.handle.clone().into_bytes(),
        address: addr_bytes,
    };

    // Sign payload
    let signed = to_signed_response(
        &state.eph_kp,
        payload.clone(),
        current_timestamp,
        IntentScope::LinkWallet, // LINK_ADDRESS_INTENT = 1
    );

    let response = LinkAddressResponse {
        payload,
        intent: LINK_ADDRESS_INTENT,
        timestamp_ms: current_timestamp,
        signature: signed.signature,
    };

    info!("RAM: Address linked for handle='{}'", req.handle);

    Ok(Json(response))
}

/// BioGuard voice authentication endpoint
/// 
/// This is the core security feature of RAM:
/// 1. User records voice saying "I confirm sending X [coin]"
/// 2. Server analyzes voice for stress/duress indicators
/// 3. If duress detected (stress >= 70), returns result=2 (DURESS)
/// 4. Client submits signed payload to blockchain
/// 5. Move contract locks wallet for 24 hours if duress
/// 
/// Request: handle, audio_base64, expected_amount
/// Response: signed BioAuthPayload + human-readable data
pub async fn process_bio_auth(
    State(state): State<Arc<AppState>>,
    Json(request): Json<ProcessDataRequest<BioAuthRequest>>,
) -> Result<Json<BioAuthResponse>, EnclaveError> {
    let req = &request.payload;
    let coin_type = req.coin_type.as_deref().unwrap_or("SUI");
    
    // Convert expected amount to human-readable format for analysis
    let decimals = match coin_type.to_uppercase().as_str() {
        "SUI" => 9u32,
        "USDC" | "USDT" => 6,
        _ => 9,
    };
    let expected_human = req.expected_amount as f64 / (10_u64.pow(decimals)) as f64;
    
    info!(
        "RAM BioAuth: handle='{}', expected_amount={} {} ({} raw)",
        req.handle, expected_human, coin_type, req.expected_amount
    );

    let current_timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| EnclaveError::GenericError(format!("Failed to get timestamp: {}", e)))?
        .as_millis() as u64;

    // ========================================================================
    // COMMENTED OUT: Real audio analysis with stress detection
    // ========================================================================
    // let openrouter_key = if state.openrouter_api_key.is_empty() { 
    //     None 
    // } else { 
    //     Some(state.openrouter_api_key.as_str()) 
    // };
    // 
    // let hume_key = if state.hume_api_key.is_empty() {
    //     None
    // } else {
    //     Some(state.hume_api_key.as_str())
    // };
    // 
    // let analysis = audio::analyze_audio(
    //     &req.audio_base64,
    //     openrouter_key,
    //     hume_key,
    //     Some(expected_human),
    //     coin_type,
    // ).await?;
    // 
    // // Extract analysis results
    // let transcript = analysis.transcript;
    // let stress_level = analysis.stress_level;
    // let amount_verified = analysis.amount_verified;
    // 
    // // Determine result based on analysis
    // let result = if audio::is_under_duress(stress_level) {
    //     // DURESS DETECTED - This will lock the wallet for 24 hours!
    //     info!(
    //         "RAM BioAuth: ⚠️ DURESS DETECTED for '{}' (stress_level={})",
    //         req.handle, stress_level
    //     );
    //     BioAuthResult::Duress
    // } else if amount_verified {
    //     info!("RAM BioAuth: ✓ OK (amount verified)");
    //     BioAuthResult::Ok
    // } else {
    //     // Amount doesn't match or couldn't be parsed
    //     info!(
    //         "RAM BioAuth: ✗ INVALID AMOUNT (expected={:.4} {}, detected={:?})",
    //         expected_human, coin_type, analysis.amount
    //     );
    //     BioAuthResult::InvalidAmount
    // };

    // ========================================================================
    // MOCK: Always return success with 0.001 transfer
    // ========================================================================
    let transcript = format!("I confirm sending 0.001 {}", coin_type);
    let stress_level = 0u8;  // No stress
    let result = BioAuthResult::Ok;  // Always success
    
    info!(
        "RAM BioAuth [MOCK]: ✓ Always returning SUCCESS for handle='{}', amount=0.001 {}",
        req.handle, coin_type
    );

    // Build payload for Move contract
    let payload = BioAuthPayload {
        handle: req.handle.clone().into_bytes(),
        amount: req.expected_amount,
        result: result as u8,
        transcript: transcript.clone().into_bytes(),
    };

    // Sign with BioAuth intent scope
    let signed = to_signed_response(
        &state.eph_kp,
        payload.clone(),
        current_timestamp,
        IntentScope::TransferNft, // BIOAUTH_INTENT = 3 (RAM reuses TransferNft slot)
    );

    // Return BLIND response - frontend cannot see stress_level or result!
    // Frontend will learn the result ONLY from blockchain events after submission.
    let response = BioAuthResponse {
        payload,
        intent: BIOAUTH_INTENT,
        timestamp_ms: current_timestamp,
        signature: signed.signature,
        // NO data field - prevents frontend bypass!
    };

    info!(
        "RAM BioAuth response (BLIND): handle='{}', result={}, stress={} (frontend cannot see this)",
        req.handle, result.as_str(), stress_level
    );

    Ok(Json(response))
}

/// Hex encoding/decoding utilities
mod hex {
    pub fn decode(s: &str) -> Result<Vec<u8>, String> {
        if s.len() % 2 != 0 {
            return Err("Hex string must have even length".to_string());
        }
        (0..s.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&s[i..i + 2], 16).map_err(|e| e.to_string()))
            .collect()
    }
}

/// Sign a transfer between two RAM wallets
///
/// Called by the frontend after BioAuth succeeds, to get an enclave signature
/// for the `transfer_with_signature` Move function.
pub async fn process_transfer(
    State(state): State<Arc<AppState>>,
    Json(request): Json<ProcessDataRequest<TransferRequest>>,
) -> Result<Json<TransferResponse>, EnclaveError> {
    let req = &request.payload;

    info!(
        "RAM Transfer: from='{}' -> to='{}', amount={}, coin_type='{}'",
        req.from_handle, req.to_handle, req.amount, req.coin_type
    );

    let current_timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| EnclaveError::GenericError(format!("Failed to get timestamp: {}", e)))?
        .as_millis() as u64;

    // Build payload matching Move's TransferPayload
    let payload = TransferPayload {
        from_handle: req.from_handle.clone().into_bytes(),
        to_handle: req.to_handle.clone().into_bytes(),
        amount: req.amount,
        coin_type: req.coin_type.clone().into_bytes(),
    };

    // Sign with TRANSFER_INTENT = 2
    let signed = to_signed_response(
        &state.eph_kp,
        payload.clone(),
        current_timestamp,
        IntentScope::TransferCoin, // TRANSFER_INTENT = 2
    );

    let response = TransferResponse {
        payload,
        intent: TRANSFER_INTENT,
        timestamp_ms: current_timestamp,
        signature: signed.signature,
    };

    info!(
        "RAM Transfer signed: from='{}' -> to='{}', amount={}",
        req.from_handle, req.to_handle, req.amount
    );

    Ok(Json(response))
}

/// Sign a withdrawal from a RAM wallet
///
/// Called by the frontend after BioAuth succeeds, to get an enclave signature
/// for the `withdraw` Move function.
pub async fn process_withdraw(
    State(state): State<Arc<AppState>>,
    Json(request): Json<ProcessDataRequest<WithdrawRequest>>,
) -> Result<Json<WithdrawResponse>, EnclaveError> {
    let req = &request.payload;

    info!(
        "RAM Withdraw: handle='{}', amount={}, coin_type='{}'",
        req.handle, req.amount, req.coin_type
    );

    let current_timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| EnclaveError::GenericError(format!("Failed to get timestamp: {}", e)))?
        .as_millis() as u64;

    // Build payload matching Move's WithdrawPayload
    let payload = WithdrawPayload {
        handle: req.handle.clone().into_bytes(),
        amount: req.amount,
        coin_type: req.coin_type.clone().into_bytes(),
    };

    // Sign with WITHDRAW_INTENT = 4
    let signed = to_signed_response(
        &state.eph_kp,
        payload.clone(),
        current_timestamp,
        IntentScope::UpdateHandle, // WITHDRAW_INTENT = 4 (RAM reuses UpdateHandle slot)
    );

    let response = WithdrawResponse {
        payload,
        intent: WITHDRAW_INTENT,
        timestamp_ms: current_timestamp,
        signature: signed.signature,
    };

    info!(
        "RAM Withdraw signed: handle='{}', amount={}",
        req.handle, req.amount
    );

    Ok(Json(response))
}
