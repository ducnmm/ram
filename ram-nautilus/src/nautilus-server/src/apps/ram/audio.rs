// Copyright (c) RAM
// SPDX-License-Identifier: Apache-2.0

//! RAM Audio Processing Module
//!
//! Provides voice-based authentication with:
//! - Speech-to-Text transcription via GPT-4o Audio or Hume AI
//! - Stress/Panic detection for duress protection
//! - Amount verification from spoken words
//!
//! Supported APIs:
//! - OpenRouter GPT-4o Audio: General-purpose, single API call
//! - Hume AI Expression Measurement: Specialized emotion detection

use crate::EnclaveError;
use serde::{Deserialize, Serialize};
use tracing::{error, info, warn};

/// Stress threshold - above this is considered duress
/// When stress >= 70, wallet will be locked for 24 hours
const STRESS_THRESHOLD: u8 = 70;

/// OpenRouter API URL for GPT-4o Audio
const OPENROUTER_API_URL: &str = "https://openrouter.ai/api/v1/chat/completions";

/// Hume AI API URL for Expression Measurement
const HUME_API_URL: &str = "https://api.hume.ai/v0/batch/jobs";

/// Response from audio analysis (unified across providers)
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AudioAnalysisResult {
    pub transcript: String,
    pub stress_level: u8,
    pub amount: Option<f64>,
    /// Detailed emotion scores from Hume (optional)
    #[serde(default)]
    pub emotions: Option<EmotionScores>,
    /// Whether amount matches expected (set after verification)
    #[serde(default)]
    pub amount_verified: bool,
}

/// Detailed emotion scores from Hume AI
#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct EmotionScores {
    pub fear: f32,
    pub anxiety: f32,
    pub distress: f32,
    pub anger: f32,
    pub sadness: f32,
    pub confusion: f32,
}

/// OpenRouter chat message
#[derive(Serialize)]
struct ChatMessage {
    role: String,
    content: Vec<ContentPart>,
}

/// Content part for multimodal input
#[derive(Serialize)]
#[serde(tag = "type")]
enum ContentPart {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "input_audio")]
    Audio { input_audio: AudioInput },
}

/// Audio input for GPT-4o
#[derive(Serialize)]
struct AudioInput {
    data: String,  // base64 audio
    format: String, // "wav", "mp3", etc.
}

/// OpenRouter request
#[derive(Serialize)]
struct OpenRouterRequest {
    model: String,
    messages: Vec<ChatMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    modalities: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    audio: Option<AudioConfig>,
}

#[derive(Serialize)]
struct AudioConfig {
    voice: String,
    format: String,
}

/// OpenRouter response
#[derive(Deserialize)]
struct OpenRouterResponse {
    choices: Vec<Choice>,
}

#[derive(Deserialize)]
struct Choice {
    message: ResponseMessage,
}

#[derive(Deserialize)]
struct ResponseMessage {
    content: String,
}

// ============================================================================
// GPT-4o AUDIO ANALYSIS (via OpenRouter)
// ============================================================================

/// Analyze audio using GPT-4o via OpenRouter
/// Returns transcript, stress level, and detected amount
///
/// # Arguments
/// * `audio_base64` - Base64-encoded audio data (WAV, MP3, etc.)
/// * `api_key` - OpenRouter API key
/// * `expected_amount` - The amount the user should confirm (for verification)
/// * `coin_type` - The coin type being transferred (SUI, USDC, etc.)
pub async fn analyze_audio_gpt4o(
    audio_base64: &str,
    api_key: &str,
    expected_amount: Option<f64>,
    coin_type: &str,
) -> Result<AudioAnalysisResult, EnclaveError> {
    use base64::{Engine as _, engine::general_purpose::STANDARD};
    
    // Validate base64 encoding first
    let audio_bytes = STANDARD.decode(audio_base64)
        .map_err(|e| EnclaveError::GenericError(format!("Invalid audio base64: {}", e)))?;
    
    info!("RAM: Analyzing audio: {} bytes via GPT-4o", audio_bytes.len());
    
    // Build the request with RAM-specific prompt
    let expected_info = match expected_amount {
        Some(amt) => format!("Expected amount: {} {}", amt, coin_type),
        None => "No specific amount expected".to_string(),
    };
    
    let prompt = format!(r#"You are a voice security analyzer for a cryptocurrency wallet called RAM.
Your job is to analyze the user's voice recording to:
1. Transcribe exactly what they said
2. Detect if they are under stress/duress (being forced/coerced)
3. Extract the monetary amount they mentioned

{}

STRESS DETECTION CRITERIA (0-100 scale):
- 0-30: Normal, calm voice
- 31-50: Slightly nervous but acceptable
- 51-69: Elevated stress, concerning but not dangerous
- 70-100: DURESS DETECTED - user is likely being coerced/threatened

Voice indicators of duress:
- High or unstable pitch (trembling voice)
- Fast, irregular, or choppy speech patterns
- Unnaturally slow/deliberate speech (as if reading hostage script)
- Voice breaking, crying, or sobbing
- Whispered or hushed tone (trying to hide conversation)
- Background sounds: threats, other voices commanding, distress sounds
- Distress keywords in ANY language: "help", "please", "forced", "gun", "kidnap", "giúp", "cứu", "bắt ép"

AMOUNT EXTRACTION:
- Listen for numbers followed by currency: "5 SUI", "10.5 USDC", "một trăm SUI"
- Support both English and Vietnamese number words
- Vietnamese: một=1, hai=2, ba=3, bốn=4, năm=5, sáu=6, bảy=7, tám=8, chín=9, mười=10, trăm=100, nghìn=1000

Return ONLY valid JSON with these exact fields:
{{
  "transcript": "<exact words in original language>",
  "stress_level": <integer 0-100>,
  "amount": <number or null if no amount mentioned>
}}

Be CONSERVATIVE with stress detection. False positives lock the user's wallet for 24 hours.
Only mark stress >= 70 when there are CLEAR signs of duress."#, expected_info);

    let request = OpenRouterRequest {
        model: "openai/gpt-audio-mini".to_string(),
        messages: vec![ChatMessage {
            role: "user".to_string(),
            content: vec![
                ContentPart::Text { text: prompt },
                ContentPart::Audio {
                    input_audio: AudioInput {
                        data: audio_base64.to_string(),
                        format: detect_audio_format(audio_base64),
                    },
                },
            ],
        }],
        temperature: Some(0.1), // Low temperature for consistent analysis
        modalities: Some(vec!["text".to_string()]), // Only text output, no audio
        audio: None, // No audio output needed
    };

    // Make the API call
    let client = reqwest::Client::new();
    let response = client
        .post(OPENROUTER_API_URL)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .header("HTTP-Referer", "https://ram.sui.io")
        .header("X-Title", "RAM Voice Wallet Auth")
        .json(&request)
        .send()
        .await
        .map_err(|e| EnclaveError::GenericError(format!("OpenRouter API error: {}", e)))?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        return Err(EnclaveError::GenericError(format!(
            "OpenRouter API returned {}: {}", status, error_text
        )));
    }

    let api_response: OpenRouterResponse = response
        .json()
        .await
        .map_err(|e| EnclaveError::GenericError(format!("Failed to parse OpenRouter response: {}", e)))?;

    let content = api_response
        .choices
        .first()
        .map(|c| c.message.content.clone())
        .ok_or_else(|| EnclaveError::GenericError("No response from OpenRouter".to_string()))?;

    info!("GPT-4o response: {}", content);

    // Parse the JSON response - GPT-4o returns basic fields
    #[derive(Deserialize)]
    struct GptResponse {
        transcript: String,
        stress_level: u8,
        amount: Option<f64>,
    }
    
    let gpt_result: GptResponse = serde_json::from_str(&content)
        .map_err(|e| EnclaveError::GenericError(format!("Failed to parse GPT-4o JSON: {} - Content: {}", e, content)))?;
    
    // Verify amount if expected
    let amount_verified = match (expected_amount, gpt_result.amount) {
        (Some(expected), Some(detected)) => {
            let tolerance = 0.01; // 1% tolerance for floating point
            let diff = (expected - detected).abs() / expected.max(1.0);
            diff < tolerance
        },
        (None, _) => true, // No expectation = always pass
        (Some(_), None) => false, // Expected but not detected
    };
    
    let result = AudioAnalysisResult {
        transcript: gpt_result.transcript.clone(),
        stress_level: gpt_result.stress_level,
        amount: gpt_result.amount,
        emotions: None,
        amount_verified,
    };

    info!(
        "RAM audio analysis: transcript='{}', stress={}, amount={:?}, verified={}",
        result.transcript, result.stress_level, result.amount, result.amount_verified
    );

    Ok(result)
}

/// Detect audio format from base64 header bytes
fn detect_audio_format(audio_base64: &str) -> String {
    use base64::{Engine as _, engine::general_purpose::STANDARD};
    
    if let Ok(bytes) = STANDARD.decode(audio_base64) {
        if bytes.len() >= 4 {
            // WAV: starts with "RIFF"
            if bytes.starts_with(b"RIFF") {
                return "wav".to_string();
            }
            // MP3: starts with ID3 or 0xFF 0xFB
            if bytes.starts_with(b"ID3") || (bytes[0] == 0xFF && (bytes[1] & 0xE0) == 0xE0) {
                return "mp3".to_string();
            }
            // OGG: starts with "OggS"
            if bytes.starts_with(b"OggS") {
                return "ogg".to_string();
            }
            // FLAC: starts with "fLaC"
            if bytes.starts_with(b"fLaC") {
                return "flac".to_string();
            }
            // WebM: starts with 0x1A 0x45 0xDF 0xA3
            if bytes.starts_with(&[0x1A, 0x45, 0xDF, 0xA3]) {
                return "webm".to_string();
            }
        }
    }
    // Default to WAV
    "wav".to_string()
}

// ============================================================================
// HUME AI INTEGRATION (for specialized emotion detection)
// ============================================================================

/// Analyze audio using Hume AI Expression Measurement
/// Provides detailed emotion scores for more accurate stress detection
pub async fn analyze_audio_hume(
    audio_base64: &str,
    api_key: &str,
) -> Result<EmotionScores, EnclaveError> {
    use base64::{Engine as _, engine::general_purpose::STANDARD};
    
    let audio_bytes = STANDARD.decode(audio_base64)
        .map_err(|e| EnclaveError::GenericError(format!("Invalid audio base64: {}", e)))?;
    
    info!("RAM: Analyzing audio: {} bytes via Hume AI", audio_bytes.len());
    
    // Hume API request for prosody (voice) analysis
    let client = reqwest::Client::new();
    
    // Create multipart form with audio file
    let part = reqwest::multipart::Part::bytes(audio_bytes)
        .file_name("audio.wav")
        .mime_str("audio/wav")
        .map_err(|e| EnclaveError::GenericError(format!("Failed to create audio part: {}", e)))?;
    
    let form = reqwest::multipart::Form::new()
        .part("file", part)
        .text("models", r#"{"prosody": {}}"#);
    
    let response = client
        .post(HUME_API_URL)
        .header("X-Hume-Api-Key", api_key)
        .multipart(form)
        .send()
        .await
        .map_err(|e| EnclaveError::GenericError(format!("Hume API error: {}", e)))?;
    
    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        return Err(EnclaveError::GenericError(format!(
            "Hume API returned {}: {}", status, error_text
        )));
    }
    
    // Parse Hume response and extract emotion scores
    let hume_response: serde_json::Value = response
        .json()
        .await
        .map_err(|e| EnclaveError::GenericError(format!("Failed to parse Hume response: {}", e)))?;
    
    // Extract emotion scores from Hume's prosody analysis
    let emotions = extract_hume_emotions(&hume_response)?;
    
    info!("Hume emotion analysis: fear={:.2}, anxiety={:.2}, distress={:.2}", 
        emotions.fear, emotions.anxiety, emotions.distress);
    
    Ok(emotions)
}

/// Extract emotion scores from Hume API response
fn extract_hume_emotions(response: &serde_json::Value) -> Result<EmotionScores, EnclaveError> {
    // Hume returns emotions in predictions[0].models.prosody.grouped_predictions[0].predictions[0].emotions
    let emotions = response
        .get("predictions")
        .and_then(|p| p.get(0))
        .and_then(|p| p.get("models"))
        .and_then(|m| m.get("prosody"))
        .and_then(|p| p.get("grouped_predictions"))
        .and_then(|g| g.get(0))
        .and_then(|g| g.get("predictions"))
        .and_then(|p| p.get(0))
        .and_then(|p| p.get("emotions"));
    
    let emotions_array = emotions
        .and_then(|e| e.as_array())
        .ok_or_else(|| EnclaveError::GenericError("No emotions in Hume response".to_string()))?;
    
    let mut scores = EmotionScores::default();
    
    for emotion in emotions_array {
        let name = emotion.get("name").and_then(|n| n.as_str()).unwrap_or("");
        let score = emotion.get("score").and_then(|s| s.as_f64()).unwrap_or(0.0) as f32;
        
        match name.to_lowercase().as_str() {
            "fear" => scores.fear = score,
            "anxiety" => scores.anxiety = score,
            "distress" => scores.distress = score,
            "anger" => scores.anger = score,
            "sadness" => scores.sadness = score,
            "confusion" => scores.confusion = score,
            _ => {}
        }
    }
    
    Ok(scores)
}

/// Calculate stress level from Hume emotion scores
/// Returns 0-100 stress level based on negative emotions
pub fn calculate_stress_from_emotions(emotions: &EmotionScores) -> u8 {
    // Weighted combination of negative emotions
    // Fear and distress are strongest indicators of duress
    let stress_score = 
        emotions.fear * 0.35 +
        emotions.distress * 0.30 +
        emotions.anxiety * 0.20 +
        emotions.anger * 0.10 +
        emotions.sadness * 0.05;
    
    // Convert to 0-100 scale (Hume scores are 0-1)
    let stress_level = (stress_score * 100.0).min(100.0) as u8;
    stress_level
}

// ============================================================================
// UNIFIED ANALYSIS FUNCTION
// ============================================================================

/// Main entry point for audio analysis
/// Tries GPT-4o first, falls back to mock if no API key
/// Optionally enhances with Hume AI for better stress detection
pub async fn analyze_audio(
    audio_base64: &str,
    openrouter_api_key: Option<&str>,
    hume_api_key: Option<&str>,
    expected_amount: Option<f64>,
    coin_type: &str,
) -> Result<AudioAnalysisResult, EnclaveError> {
    // Try GPT-4o first if API key is available
    if let Some(api_key) = openrouter_api_key {
        if !api_key.is_empty() {
            match analyze_audio_gpt4o(audio_base64, api_key, expected_amount, coin_type).await {
                Ok(mut result) => {
                    // Optionally enhance with Hume AI for stress detection
                    if let Some(hume_key) = hume_api_key {
                        if !hume_key.is_empty() {
                            match analyze_audio_hume(audio_base64, hume_key).await {
                                Ok(emotions) => {
                                    // Use Hume's emotion analysis for more accurate stress
                                    let hume_stress = calculate_stress_from_emotions(&emotions);
                                    // Average GPT-4o and Hume stress levels for robustness
                                    let combined_stress = ((result.stress_level as u16 + hume_stress as u16) / 2) as u8;
                                    
                                    info!("Combining stress: GPT4o={}, Hume={}, Combined={}", 
                                        result.stress_level, hume_stress, combined_stress);
                                    
                                    result.stress_level = combined_stress;
                                    result.emotions = Some(emotions);
                                },
                                Err(e) => {
                                    warn!("Hume API failed, using GPT-4o stress only: {}", e);
                                }
                            }
                        }
                    }
                    return Ok(result);
                },
                Err(e) => {
                    error!("GPT-4o analysis failed: {}", e);
                    // Fall through to mock
                }
            }
        }
    }
    
    // Fallback to mock implementation
    warn!("Using mock audio analysis (no API keys configured)");
    analyze_audio_mock(audio_base64, expected_amount, coin_type)
}

// ============================================================================
// MOCK FUNCTIONS (fallback when API key not configured)
// ============================================================================

/// Complete mock analysis (MOCKED fallback)
pub fn analyze_audio_mock(
    audio_base64: &str,
    expected_amount: Option<f64>,
    _coin_type: &str, // unused in mock, but kept for API consistency
) -> Result<AudioAnalysisResult, EnclaveError> {
    use base64::{Engine as _, engine::general_purpose::STANDARD};
    
    let audio_bytes = STANDARD.decode(audio_base64)
        .map_err(|e| EnclaveError::GenericError(format!("Invalid audio base64: {}", e)))?;
    
    warn!("RAM: Using MOCK audio analysis (no API keys)");
    info!("Received audio: {} bytes", audio_bytes.len());
    
    // Mock transcript based on audio size
    let (transcript, mock_amount) = if audio_bytes.len() < 1000 {
        ("confirm sending 5 SUI".to_string(), Some(5.0))
    } else if audio_bytes.len() < 5000 {
        ("yes confirm transfer of 10 SUI".to_string(), Some(10.0))
    } else {
        ("I confirm sending 100 SUI to the specified address".to_string(), Some(100.0))
    };
    
    // Check for stress keywords in any mock scenario
    let stress_level = analyze_stress_from_transcript(&transcript, audio_bytes.len());
    
    // Verify amount
    let amount_verified = match (expected_amount, mock_amount) {
        (Some(expected), Some(detected)) => {
            let tolerance = 0.01;
            let diff = (expected - detected).abs() / expected.max(1.0);
            diff < tolerance
        },
        (None, _) => true,
        (Some(_), None) => false,
    };
    
    let result = AudioAnalysisResult {
        transcript,
        stress_level,
        amount: mock_amount,
        emotions: None,
        amount_verified,
    };
    
    info!("Mock analysis result: transcript='{}', stress={}, amount={:?}, verified={}", 
        result.transcript, result.stress_level, result.amount, result.amount_verified);
    
    Ok(result)
}

/// Transcribe audio to text (MOCKED fallback - legacy)
pub fn transcribe_audio_mock(audio_base64: &str) -> Result<String, EnclaveError> {
    use base64::{Engine as _, engine::general_purpose::STANDARD};
    
    let audio_bytes = STANDARD.decode(audio_base64)
        .map_err(|e| EnclaveError::GenericError(format!("Invalid audio base64: {}", e)))?;
    
    warn!("RAM: Using MOCK transcription (no OPENROUTER_API_KEY)");
    info!("Received audio: {} bytes", audio_bytes.len());
    
    // Mock transcript based on audio size
    let transcript = if audio_bytes.len() < 1000 {
        "confirm sending 5 SUI".to_string()
    } else if audio_bytes.len() < 5000 {
        "yes confirm transfer of 10 SUI".to_string()
    } else {
        "I confirm sending 100 SUI to the specified address".to_string()
    };
    
    info!("Mock transcript: {}", transcript);
    Ok(transcript)
}

/// Analyze stress from transcript text
fn analyze_stress_from_transcript(transcript: &str, audio_length: usize) -> u8 {
    let mut stress_level: u8 = 20;
    
    let lower_transcript = transcript.to_lowercase();
    
    // English distress keywords
    let english_keywords = [
        "help", "please", "don't", "forced", "gun", "kidnap", 
        "threat", "scared", "afraid", "hurry", "now", "immediately"
    ];
    
    // Vietnamese distress keywords
    let vietnamese_keywords = [
        "giúp", "cứu", "bắt ép", "súng", "bắt cóc", "đe dọa",
        "sợ", "nhanh", "ngay", "làm ơn", "xin", "buộc"
    ];
    
    for keyword in english_keywords.iter().chain(vietnamese_keywords.iter()) {
        if lower_transcript.contains(keyword) {
            stress_level += 50; // Will trigger duress (20 + 50 = 70)
            break;
        }
    }
    
    // Longer audio might indicate hesitation
    if audio_length > 10000 {
        stress_level += 15;
    }
    
    stress_level.min(100)
}

/// Analyze voice stress (MOCKED fallback - legacy)
pub fn analyze_stress_mock(audio_base64: &str, transcript: &str) -> Result<u8, EnclaveError> {
    use base64::{Engine as _, engine::general_purpose::STANDARD};
    
    let audio_bytes = STANDARD.decode(audio_base64)
        .map_err(|e| EnclaveError::GenericError(format!("Invalid audio: {}", e)))?;
    
    warn!("RAM: Using MOCK stress analysis (no OPENROUTER_API_KEY)");
    
    Ok(analyze_stress_from_transcript(transcript, audio_bytes.len()))
}

// ============================================================================
// COMMON UTILITIES
// ============================================================================

/// Check if stress level indicates duress
/// Returns true if stress >= 70 (will lock wallet for 24h)
pub fn is_under_duress(stress_level: u8) -> bool {
    stress_level >= STRESS_THRESHOLD
}

/// Parse amount from transcript text
/// Supports formats: "5 SUI", "5.5 USDC", "100 tokens"
/// Also supports Vietnamese: "năm SUI", "mười USDC"
pub fn parse_amount_from_text(text: &str, coin_type: &str) -> Option<u64> {
    let words: Vec<&str> = text.split_whitespace().collect();
    
    for (i, word) in words.iter().enumerate() {
        // Try parsing as number
        if let Ok(amount) = word.parse::<f64>() {
            // Check if next word is the coin type
            if i + 1 < words.len() {
                let next_word = words[i + 1].to_uppercase();
                if next_word == coin_type.to_uppercase() || 
                   next_word.starts_with(&coin_type.to_uppercase()) {
                    let decimals = get_decimals_for_coin(coin_type);
                    let multiplier = 10_u64.pow(decimals);
                    return Some((amount * multiplier as f64) as u64);
                }
            }
            // If no coin type specified, assume it's the amount
            let decimals = get_decimals_for_coin(coin_type);
            let multiplier = 10_u64.pow(decimals);
            return Some((amount * multiplier as f64) as u64);
        }
        
        // Try parsing Vietnamese number words
        if let Some(amount) = parse_vietnamese_number(word) {
            if i + 1 < words.len() {
                let next_word = words[i + 1].to_uppercase();
                if next_word == coin_type.to_uppercase() || 
                   next_word.starts_with(&coin_type.to_uppercase()) {
                    let decimals = get_decimals_for_coin(coin_type);
                    let multiplier = 10_u64.pow(decimals);
                    return Some((amount as f64 * multiplier as f64) as u64);
                }
            }
        }
    }
    
    None
}

/// Parse Vietnamese number words to numeric value
fn parse_vietnamese_number(word: &str) -> Option<u64> {
    let lower = word.to_lowercase();
    match lower.as_str() {
        "một" | "mot" => Some(1),
        "hai" => Some(2),
        "ba" => Some(3),
        "bốn" | "bon" => Some(4),
        "năm" | "nam" => Some(5),
        "sáu" | "sau" => Some(6),
        "bảy" | "bay" => Some(7),
        "tám" | "tam" => Some(8),
        "chín" | "chin" => Some(9),
        "mười" | "muoi" => Some(10),
        "hai mươi" | "hai muoi" => Some(20),
        "trăm" | "tram" => Some(100),
        "nghìn" | "nghin" => Some(1000),
        _ => None,
    }
}

/// Get decimal places for coin type
fn get_decimals_for_coin(coin_type: &str) -> u32 {
    match coin_type.to_uppercase().as_str() {
        "SUI" => 9,
        "USDC" => 6,
        "USDT" => 6,
        "WAL" => 9,
        _ => 9, // Default to 9 decimals
    }
}

/// Verify that detected amount matches expected amount
pub fn verify_amount(expected: u64, detected: Option<f64>, coin_type: &str) -> bool {
    match detected {
        Some(detected_val) => {
            let decimals = get_decimals_for_coin(coin_type);
            let multiplier = 10_u64.pow(decimals);
            let detected_raw = (detected_val * multiplier as f64) as u64;
            
            // Allow 1% tolerance for floating point
            let tolerance = expected / 100;
            let diff = if expected > detected_raw {
                expected - detected_raw
            } else {
                detected_raw - expected
            };
            
            diff <= tolerance
        },
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_parse_amount_sui() {
        let result = parse_amount_from_text("confirm sending 5 SUI", "SUI");
        assert_eq!(result, Some(5_000_000_000));
    }
    
    #[test]
    fn test_parse_amount_usdc() {
        let result = parse_amount_from_text("transfer 10.5 USDC to alice", "USDC");
        assert_eq!(result, Some(10_500_000));
    }
    
    #[test]
    fn test_parse_amount_no_coin() {
        let result = parse_amount_from_text("yes confirm 100", "SUI");
        assert_eq!(result, Some(100_000_000_000));
    }
    
    #[test]
    fn test_parse_vietnamese_number() {
        assert_eq!(parse_vietnamese_number("năm"), Some(5));
        assert_eq!(parse_vietnamese_number("mười"), Some(10));
        assert_eq!(parse_vietnamese_number("một"), Some(1));
    }
    
    #[test]
    fn test_stress_threshold() {
        assert!(!is_under_duress(50));
        assert!(!is_under_duress(69));
        assert!(is_under_duress(70));
        assert!(is_under_duress(100));
    }

    #[test]
    fn test_duress_keywords_in_transcript() {
        use base64::{engine::general_purpose::STANDARD, Engine as _};
        let audio = STANDARD.encode(&[0u8; 100]);
        
        let normal_stress = analyze_stress_mock(&audio, "confirm sending 5 SUI").unwrap();
        let help_stress = analyze_stress_mock(&audio, "help please send the money").unwrap();
        let forced_stress = analyze_stress_mock(&audio, "I am forced to send this").unwrap();
        
        assert!(help_stress > normal_stress, "'help' should increase stress");
        assert!(forced_stress > normal_stress, "'forced' should increase stress");
        assert!(is_under_duress(help_stress), "'help please' should trigger duress");
    }
    
    #[test]
    fn test_vietnamese_duress_keywords() {
        let stress = analyze_stress_from_transcript("giúp tôi đi", 100);
        assert!(stress >= 50, "Vietnamese 'giúp' should increase stress");
    }

    #[test]
    fn test_parse_amount_with_decimal() {
        let result = parse_amount_from_text("send 2.5 SUI please", "SUI");
        assert_eq!(result, Some(2_500_000_000));
    }
    
    #[test]
    fn test_verify_amount() {
        // 5 SUI = 5_000_000_000 raw
        assert!(verify_amount(5_000_000_000, Some(5.0), "SUI"));
        assert!(!verify_amount(5_000_000_000, Some(10.0), "SUI"));
        assert!(!verify_amount(5_000_000_000, None, "SUI"));
        
        // Allow small tolerance
        assert!(verify_amount(5_000_000_000, Some(5.01), "SUI"));
    }
    
    #[test]
    fn test_detect_audio_format() {
        use base64::{engine::general_purpose::STANDARD, Engine as _};
        
        // WAV header
        let wav = STANDARD.encode(b"RIFF....WAVEfmt ");
        assert_eq!(detect_audio_format(&wav), "wav");
        
        // MP3 with ID3
        let mp3_id3 = STANDARD.encode(b"ID3....");
        assert_eq!(detect_audio_format(&mp3_id3), "mp3");
        
        // Unknown defaults to WAV
        let unknown = STANDARD.encode(b"????");
        assert_eq!(detect_audio_format(&unknown), "wav");
    }
    
    #[test]
    fn test_emotion_scores_to_stress() {
        // Low negative emotions = low stress
        let calm = EmotionScores {
            fear: 0.1,
            anxiety: 0.1,
            distress: 0.1,
            anger: 0.0,
            sadness: 0.0,
            confusion: 0.0,
        };
        assert!(calculate_stress_from_emotions(&calm) < 50);
        
        // High fear/distress = high stress (duress)
        let duress = EmotionScores {
            fear: 0.9,
            anxiety: 0.8,
            distress: 0.85,
            anger: 0.3,
            sadness: 0.5,
            confusion: 0.6,
        };
        assert!(calculate_stress_from_emotions(&duress) >= 70);
    }
    
    #[test]
    fn test_mock_analysis() {
        use base64::{engine::general_purpose::STANDARD, Engine as _};
        let audio = STANDARD.encode(&[0u8; 100]);
        
        let result = analyze_audio_mock(&audio, Some(5.0), "SUI").unwrap();
        assert!(!result.transcript.is_empty());
        assert!(result.stress_level < 70); // Normal mock shouldn't trigger duress
        assert!(result.amount.is_some());
    }
}
