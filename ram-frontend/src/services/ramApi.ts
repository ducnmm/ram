// RAM Backend API Service
// Connects to the RAM Voice Wallet Server

const RAM_API_URL = import.meta.env.VITE_RAM_API_URL || 'http://localhost:3000';
const RAM_BACKEND_URL = import.meta.env.VITE_RAM_BACKEND_URL || 'http://localhost:4000';

// Sui Blockchain Constants
export const SUI_PACKAGE_ID = import.meta.env.VITE_SUI_PACKAGE_ID || '0x8d6ef0202e592745340d9c96efb32dba98191ea981eea5ad7ba8731f1545e216';
export const RAM_REGISTRY_ID = import.meta.env.VITE_RAM_REGISTRY_ID || '0xc91902a23f2b159175da4b9728cb6018c51dc42b2437b59f6cfe54f189206ae4';
export const ENCLAVE_ID = import.meta.env.VITE_ENCLAVE_ID || '0x1d154f7d2c12f7e611d39cc1a261e56eda39bcdc09c7b0f973c67ac67e8094aa';
export const USER_HANDLE = import.meta.env.VITE_USER_HANDLE || 'alice';

// ============================================================================
// Types
// ============================================================================

export interface CreateWalletRequest {
  handle: string;
}

export interface CreateWalletResponse {
  payload: {
    handle: number[];
  };
  intent: number;
  timestamp_ms: number;
  signature: string;
}

export interface LinkAddressRequest {
  handle: string;
  wallet_address: string;
}

export interface LinkAddressResponse {
  payload: {
    handle: number[];
    address: number[];
  };
  intent: number;
  timestamp_ms: number;
  signature: string;
}

export interface BioAuthRequest {
  handle: string;
  audio_base64: string;
  expected_amount: number; // In smallest unit (e.g., 1 SUI = 1_000_000_000)
  coin_type?: string;
}

export interface BioAuthResponse {
  payload: {
    handle: number[];
    amount: number;
    result: number; // 0=OK, 1=InvalidAmount, 2=Duress
    transcript: number[];
  };
  intent: number;
  timestamp_ms: number;
  signature: string;
  // NO data field! Frontend cannot see stress_level or result until blockchain confirms.
  // This prevents malicious frontend from bypassing duress detection.
}

export interface TransferResponse {
  payload: {
    from_handle: number[];
    to_handle: number[];
    amount: number;
    coin_type: number[];
  };
  intent: number;
  timestamp_ms: number;
  signature: string;
}

export interface WithdrawResponse {
  payload: {
    handle: number[];
    amount: number;
    coin_type: number[];
  };
  intent: number;
  timestamp_ms: number;
  signature: string;
}

export type BioAuthResult = 'OK' | 'InvalidAmount' | 'Duress';

export interface HealthCheckResponse {
  pk: string;
  endpoints_status: Record<string, unknown>;
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Check if RAM server is healthy
 */
export async function healthCheck(): Promise<HealthCheckResponse> {
  const response = await fetch(`${RAM_API_URL}/health_check`);
  if (!response.ok) {
    throw new Error(`Health check failed: ${response.status}`);
  }
  return response.json();
}

/**
 * Create a new RAM wallet
 */
export async function createWallet(handle: string): Promise<CreateWalletResponse> {
  const response = await fetch(`${RAM_API_URL}/create_wallet`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      payload: { handle },
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `Failed to create wallet: ${response.status}`);
  }

  return response.json();
}

/**
 * Link a Sui wallet address to RAM wallet
 */
export async function linkAddress(
  handle: string,
  walletAddress: string
): Promise<LinkAddressResponse> {
  const response = await fetch(`${RAM_API_URL}/link_address`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      payload: { handle, wallet_address: walletAddress },
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `Failed to link address: ${response.status}`);
  }

  return response.json();
}

/**
 * Perform BioAuth voice verification
 * 
 * @param handle - User's handle name
 * @param audioBase64 - Base64-encoded audio recording
 * @param amount - Amount in human-readable format (e.g., 5 for 5 SUI)
 * @param coinType - Coin type (SUI, USDC, WAL)
 */
export async function bioAuth(
  handle: string,
  audioBase64: string,
  amount: number,
  coinType: string = 'SUI'
): Promise<BioAuthResponse> {
  // Convert to smallest unit
  const decimals = getDecimals(coinType);
  const amountRaw = Math.round(amount * Math.pow(10, decimals));

  const response = await fetch(`${RAM_API_URL}/bio_auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      payload: {
        handle,
        audio_base64: audioBase64,
        expected_amount: amountRaw,
        coin_type: coinType,
      },
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `BioAuth failed: ${response.status}`);
  }

  return response.json();
}

/**
 * Request enclave signature for a transfer between wallets
 */
export async function requestTransferSignature(
  fromHandle: string,
  toHandle: string,
  amount: number,
  coinType: string
): Promise<TransferResponse> {
  const response = await fetch(`${RAM_API_URL}/transfer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      payload: {
        from_handle: fromHandle,
        to_handle: toHandle,
        amount,
        coin_type: coinType,
      },
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `Transfer signature failed: ${response.status}`);
  }

  return response.json();
}

/**
 * Request enclave signature for a withdrawal
 */
export async function requestWithdrawSignature(
  handle: string,
  amount: number,
  coinType: string
): Promise<WithdrawResponse> {
  const response = await fetch(`${RAM_API_URL}/withdraw`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      payload: {
        handle,
        amount,
        coin_type: coinType,
      },
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `Withdraw signature failed: ${response.status}`);
  }

  return response.json();
}

// ============================================================================
// Helpers
// ============================================================================

function getDecimals(coinType: string): number {
  switch (coinType.toUpperCase()) {
    case 'SUI':
      return 9;
    case 'USDC':
    case 'USDT':
      return 6;
    case 'WAL':
      return 9;
    default:
      return 9;
  }
}

/**
 * Convert BioAuth result code to string
 */
export function getBioAuthResultString(result: number): BioAuthResult {
  switch (result) {
    case 0:
      return 'OK';
    case 1:
      return 'InvalidAmount';
    case 2:
      return 'Duress';
    default:
      return 'InvalidAmount';
  }
}

/**
 * Check if BioAuth was successful
 */
export function isBioAuthSuccess(response: BioAuthResponse): boolean {
  return response.payload.result === 0;
}

/**
 * Check if duress was detected (must decode payload manually)
 * Note: In production, don't check this! Let blockchain handle it.
 * This is only for displaying result AFTER blockchain confirmation.
 */
export function isDuressDetected(response: BioAuthResponse): boolean {
  return response.payload.result === 2;
}

/**
 * Get transcript from payload (decode from bytes)
 */
export function getTranscript(response: BioAuthResponse): string {
  try {
    return new TextDecoder().decode(new Uint8Array(response.payload.transcript));
  } catch {
    return '';
  }
}

/**
 * Get result string from payload
 */
export function getResultString(response: BioAuthResponse): string {
  switch (response.payload.result) {
    case 0: return 'ok';
    case 1: return 'invalid_amount';
    case 2: return 'duress';
    default: return 'unknown';
  }
}

// ============================================================================
// Wallet Events API (Backend Indexer)
// ============================================================================

export interface WalletEvent {
  handle: string | null;
  event_type: string;
  amount: number | null;
  from_handle: string | null;
  to_handle: string | null;
  owner: string | null;
  tx_digest: string;
  timestamp: string;
}

export interface GetEventsRequest {
  handle: string;
  limit?: number;
  offset?: number;
}

/**
 * Get wallet events from backend indexer
 */
export async function getWalletEvents(request: GetEventsRequest): Promise<WalletEvent[]> {
  const response = await fetch(`${RAM_BACKEND_URL}/api/events`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      handle: request.handle,
      limit: request.limit || 50,
      offset: request.offset || 0,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch events: ${response.statusText}`);
  }

  return response.json();
}
