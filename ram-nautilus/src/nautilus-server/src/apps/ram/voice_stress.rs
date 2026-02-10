// Copyright (c) RAM
// SPDX-License-Identifier: Apache-2.0

//! Voice Stress Analysis via DSP (Digital Signal Processing)
//!
//! Analyzes raw WAV PCM audio for acoustic indicators of stress/duress:
//! - Pitch jitter (voice tremor/instability)
//! - Energy variance (loudness fluctuation)  
//! - Speech rate (words-per-second via zero-crossing rate)
//! - High-frequency energy ratio (tense voice has more high-freq energy)
//!
//! These are scientifically-validated vocal stress indicators used in
//! voice stress analysis (VSA) systems.

use tracing::info;

/// Acoustic features extracted from voice
#[derive(Debug, Clone)]
pub struct AcousticFeatures {
    /// Pitch jitter (0.0-1.0) - how unstable the pitch is
    /// Normal: 0.01-0.03, Stressed: > 0.05
    pub pitch_jitter: f64,
    /// Energy variance (normalized) - how much loudness fluctuates  
    /// Normal: low, Stressed: high (volume swings)
    pub energy_variance: f64,
    /// Zero-crossing rate - correlates with speech rate and tenseness
    /// Normal: moderate, Stressed-fast: high, Stressed-slow: very low
    pub zero_crossing_rate: f64,
    /// High-frequency energy ratio (0.0-1.0)
    /// Tense/stressed voice has more high-frequency harmonics
    pub high_freq_ratio: f64,
    /// RMS energy level (overall loudness)
    pub rms_energy: f64,
    /// Detected fundamental frequency (Hz)
    pub estimated_f0: f64,
}

/// Result of voice stress analysis
#[derive(Debug, Clone)]
pub struct StressAnalysis {
    pub stress_level: u8,
    pub features: AcousticFeatures,
    pub reasons: Vec<String>,
}

/// Analyze WAV PCM audio bytes for stress indicators
/// Expects standard WAV format (16-bit PCM, mono preferred)
pub fn analyze_voice_stress(wav_bytes: &[u8]) -> StressAnalysis {
    // Parse WAV header
    let (samples, sample_rate) = match parse_wav(wav_bytes) {
        Some(data) => data,
        None => {
            info!("RAM DSP: Failed to parse WAV, returning neutral stress");
            return StressAnalysis {
                stress_level: 30,
                features: AcousticFeatures {
                    pitch_jitter: 0.0,
                    energy_variance: 0.0,
                    zero_crossing_rate: 0.0,
                    high_freq_ratio: 0.0,
                    rms_energy: 0.0,
                    estimated_f0: 0.0,
                },
                reasons: vec!["Could not parse audio".to_string()],
            };
        }
    };

    info!("RAM DSP: Analyzing {} samples at {} Hz ({:.1}s)", 
        samples.len(), sample_rate, samples.len() as f64 / sample_rate as f64);

    // Extract acoustic features
    let features = extract_features(&samples, sample_rate);
    
    // Calculate stress score from features
    let (stress_level, reasons) = calculate_stress(&features);

    info!("RAM DSP: pitch_jitter={:.4}, energy_var={:.4}, zcr={:.4}, hf_ratio={:.4}, f0={:.1}Hz",
        features.pitch_jitter, features.energy_variance, 
        features.zero_crossing_rate, features.high_freq_ratio, features.estimated_f0);
    info!("RAM DSP: Acoustic stress score: {} (reasons: {:?})", stress_level, reasons);

    StressAnalysis {
        stress_level,
        features,
        reasons,
    }
}

/// Parse WAV file and extract f32 samples
fn parse_wav(data: &[u8]) -> Option<(Vec<f32>, u32)> {
    if data.len() < 44 { return None; }
    
    // Check RIFF header
    if &data[0..4] != b"RIFF" || &data[8..12] != b"WAVE" {
        return None;
    }
    
    // Read format info
    let _audio_format = u16::from_le_bytes([data[20], data[21]]);
    let num_channels = u16::from_le_bytes([data[22], data[23]]) as u32;
    let sample_rate = u32::from_le_bytes([data[24], data[25], data[26], data[27]]);
    let bits_per_sample = u16::from_le_bytes([data[34], data[35]]) as u32;
    
    if bits_per_sample != 16 {
        info!("RAM DSP: Unsupported bits_per_sample: {}", bits_per_sample);
        return None;
    }
    
    // Find data chunk
    let data_start = 44; // Standard WAV header
    let pcm_data = &data[data_start..];
    
    // Convert 16-bit PCM to f32 (mono)
    let bytes_per_sample = (bits_per_sample / 8) as usize;
    let frame_size = bytes_per_sample * num_channels as usize;
    let num_frames = pcm_data.len() / frame_size;
    
    let mut samples = Vec::with_capacity(num_frames);
    for i in 0..num_frames {
        let offset = i * frame_size;
        if offset + 1 < pcm_data.len() {
            let sample = i16::from_le_bytes([pcm_data[offset], pcm_data[offset + 1]]);
            samples.push(sample as f32 / 32768.0);
        }
    }
    
    Some((samples, sample_rate))
}

/// Extract acoustic features from audio samples
fn extract_features(samples: &[f32], sample_rate: u32) -> AcousticFeatures {
    if samples.is_empty() {
        return AcousticFeatures {
            pitch_jitter: 0.0,
            energy_variance: 0.0,
            zero_crossing_rate: 0.0,
            high_freq_ratio: 0.0,
            rms_energy: 0.0,
            estimated_f0: 0.0,
        };
    }
    
    // 1. RMS Energy
    let rms_energy = (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt();
    
    // 2. Zero-Crossing Rate (per second)
    let zero_crossings = samples.windows(2)
        .filter(|w| (w[0] >= 0.0) != (w[1] >= 0.0))
        .count();
    let duration_secs = samples.len() as f64 / sample_rate as f64;
    let zero_crossing_rate = if duration_secs > 0.0 {
        zero_crossings as f64 / duration_secs
    } else {
        0.0
    };
    
    // 3. Energy variance across frames
    let energy_variance = calculate_energy_variance(samples, sample_rate);
    
    // 4. Fundamental frequency (F0) estimation via autocorrelation + pitch jitter
    let (estimated_f0, pitch_jitter) = estimate_pitch_and_jitter(samples, sample_rate);
    
    // 5. High-frequency energy ratio
    let high_freq_ratio = calculate_high_freq_ratio(samples, sample_rate);
    
    AcousticFeatures {
        pitch_jitter,
        energy_variance,
        zero_crossing_rate,
        high_freq_ratio,
        rms_energy: rms_energy as f64,
        estimated_f0,
    }
}

/// Calculate energy variance across short frames
fn calculate_energy_variance(samples: &[f32], sample_rate: u32) -> f64 {
    let frame_size = (sample_rate as usize) / 50; // 20ms frames
    if frame_size == 0 || samples.len() < frame_size * 2 {
        return 0.0;
    }
    
    let frame_energies: Vec<f64> = samples.chunks(frame_size)
        .filter(|chunk| chunk.len() == frame_size)
        .map(|frame| {
            let energy: f32 = frame.iter().map(|s| s * s).sum();
            (energy / frame.len() as f32).sqrt() as f64
        })
        .collect();
    
    if frame_energies.len() < 2 { return 0.0; }
    
    // Only consider frames with enough energy (voiced segments)
    let threshold = 0.01;
    let voiced_energies: Vec<f64> = frame_energies.iter()
        .filter(|&&e| e > threshold)
        .copied()
        .collect();
    
    if voiced_energies.len() < 2 { return 0.0; }
    
    let mean = voiced_energies.iter().sum::<f64>() / voiced_energies.len() as f64;
    if mean < 0.001 { return 0.0; }
    
    let variance = voiced_energies.iter()
        .map(|e| (e - mean) * (e - mean))
        .sum::<f64>() / voiced_energies.len() as f64;
    
    // Coefficient of variation (normalized by mean)
    (variance.sqrt() / mean).min(2.0)
}

/// Estimate pitch (F0) using autocorrelation and calculate pitch jitter
fn estimate_pitch_and_jitter(samples: &[f32], sample_rate: u32) -> (f64, f64) {
    let frame_size = (sample_rate as usize) / 25; // 40ms frames  
    let hop_size = frame_size / 2; // 50% overlap
    
    if samples.len() < frame_size {
        return (0.0, 0.0);
    }
    
    // F0 range: 80-400 Hz (covers male and female voices)
    let min_lag = sample_rate as usize / 400; // Max frequency
    let max_lag = sample_rate as usize / 80;  // Min frequency
    
    let mut periods: Vec<f64> = Vec::new();
    
    let mut offset = 0;
    while offset + frame_size <= samples.len() {
        let frame = &samples[offset..offset + frame_size];
        
        // Check if frame has enough energy (voiced)
        let energy: f32 = frame.iter().map(|s| s * s).sum::<f32>() / frame.len() as f32;
        if energy < 0.0001 {
            offset += hop_size;
            continue;
        }
        
        // Autocorrelation to find pitch period
        if let Some(period) = autocorrelation_pitch(frame, min_lag, max_lag) {
            periods.push(period as f64);
        }
        
        offset += hop_size;
    }
    
    if periods.is_empty() {
        return (0.0, 0.0);
    }
    
    // Calculate average F0
    let avg_period = periods.iter().sum::<f64>() / periods.len() as f64;
    let estimated_f0 = if avg_period > 0.0 {
        sample_rate as f64 / avg_period
    } else {
        0.0
    };
    
    // Calculate jitter (period-to-period variation)
    let jitter = if periods.len() >= 2 {
        let diffs: Vec<f64> = periods.windows(2)
            .map(|w| (w[1] - w[0]).abs())
            .collect();
        let avg_diff = diffs.iter().sum::<f64>() / diffs.len() as f64;
        if avg_period > 0.0 {
            (avg_diff / avg_period).min(1.0) // Normalize by average period
        } else {
            0.0
        }
    } else {
        0.0
    };
    
    (estimated_f0, jitter)
}

/// Find pitch period using autocorrelation
fn autocorrelation_pitch(frame: &[f32], min_lag: usize, max_lag: usize) -> Option<usize> {
    let max_lag = max_lag.min(frame.len() / 2);
    if min_lag >= max_lag {
        return None;
    }
    
    // Compute autocorrelation at lag 0 for normalization
    let r0: f64 = frame.iter().map(|s| (*s as f64) * (*s as f64)).sum();
    if r0 < 1e-10 {
        return None;
    }
    
    let mut best_lag = min_lag;
    let mut best_corr: f64 = -1.0;
    
    for lag in min_lag..max_lag {
        let mut corr: f64 = 0.0;
        let mut norm: f64 = 0.0;
        for i in 0..(frame.len() - lag) {
            corr += frame[i] as f64 * frame[i + lag] as f64;
            norm += frame[i + lag] as f64 * frame[i + lag] as f64;
        }
        
        let normalized = if norm > 1e-10 { corr / (r0 * norm).sqrt() } else { 0.0 };
        
        if normalized > best_corr {
            best_corr = normalized;
            best_lag = lag;
        }
    }
    
    // Only accept if correlation is strong enough
    if best_corr > 0.3 {
        Some(best_lag)
    } else {
        None
    }
}

/// Calculate ratio of high-frequency energy (> 2kHz) to total energy
/// Stressed/tense voices have more high-frequency harmonics
fn calculate_high_freq_ratio(samples: &[f32], sample_rate: u32) -> f64 {
    if samples.len() < 512 {
        return 0.0;
    }
    
    // Simple approach: use energy of high-pass filtered signal vs total
    // High-pass filter at ~2kHz using first-order difference
    let cutoff_samples = sample_rate as f64 / 2000.0; // Period of 2kHz
    let alpha = 1.0 / (1.0 + cutoff_samples / (2.0 * std::f64::consts::PI));
    
    let mut total_energy: f64 = 0.0;
    let mut high_energy: f64 = 0.0;
    let mut prev = samples[0] as f64;
    let mut hp_prev = 0.0;
    
    for &sample in &samples[1..] {
        let s = sample as f64;
        total_energy += s * s;
        
        // First-order high-pass filter
        let hp = alpha * (hp_prev + s - prev);
        high_energy += hp * hp;
        
        prev = s;
        hp_prev = hp;
    }
    
    if total_energy < 1e-10 {
        return 0.0;
    }
    
    (high_energy / total_energy).min(1.0)
}

/// Calculate stress level from acoustic features
fn calculate_stress(features: &AcousticFeatures) -> (u8, Vec<String>) {
    let mut stress_score: f64 = 0.0;
    let mut reasons = Vec::new();
    
    // 1. Pitch jitter (most important indicator)
    // Normal: < 0.02, Mild stress: 0.02-0.05, High stress: > 0.05
    let jitter_score = if features.pitch_jitter > 0.08 {
        reasons.push(format!("High voice tremor (jitter={:.3})", features.pitch_jitter));
        30.0
    } else if features.pitch_jitter > 0.05 {
        reasons.push(format!("Moderate voice instability (jitter={:.3})", features.pitch_jitter));
        20.0
    } else if features.pitch_jitter > 0.03 {
        reasons.push(format!("Slight voice instability (jitter={:.3})", features.pitch_jitter));
        10.0
    } else {
        0.0
    };
    stress_score += jitter_score;
    
    // 2. Energy variance (loudness fluctuation)
    // Normal: < 0.3, Stressed: > 0.5, Very stressed: > 0.8
    let energy_score = if features.energy_variance > 0.8 {
        reasons.push(format!("High volume instability (var={:.3})", features.energy_variance));
        25.0
    } else if features.energy_variance > 0.5 {
        reasons.push(format!("Moderate volume fluctuation (var={:.3})", features.energy_variance));
        15.0
    } else if features.energy_variance > 0.35 {
        reasons.push(format!("Slight volume fluctuation (var={:.3})", features.energy_variance));
        8.0
    } else {
        0.0
    };
    stress_score += energy_score;
    
    // 3. High-frequency ratio (tense voice)
    // Normal: < 0.3, Tense: > 0.4, Very tense: > 0.55
    let hf_score = if features.high_freq_ratio > 0.55 {
        reasons.push(format!("Very tense voice (hf_ratio={:.3})", features.high_freq_ratio));
        25.0
    } else if features.high_freq_ratio > 0.40 {
        reasons.push(format!("Tense voice detected (hf_ratio={:.3})", features.high_freq_ratio));
        15.0
    } else if features.high_freq_ratio > 0.30 {
        reasons.push(format!("Slightly tense voice (hf_ratio={:.3})", features.high_freq_ratio));
        5.0
    } else {
        0.0
    };
    stress_score += hf_score;
    
    // 4. Pitch height (elevated pitch = stress)
    // Normal male: 100-150 Hz, Normal female: 180-250 Hz
    // Under stress, F0 typically rises ~15-30%
    let pitch_score = if features.estimated_f0 > 300.0 {
        reasons.push(format!("Very high pitch (F0={:.0}Hz)", features.estimated_f0));
        20.0
    } else if features.estimated_f0 > 250.0 {
        reasons.push(format!("Elevated pitch (F0={:.0}Hz)", features.estimated_f0));
        12.0
    } else if features.estimated_f0 > 200.0 {
        // Could be normal female voice, mild score
        5.0
    } else {
        0.0
    };
    stress_score += pitch_score;
    
    // Add base level (nobody is at zero stress when speaking to a security system)
    stress_score += 10.0;
    
    if reasons.is_empty() {
        reasons.push("Voice sounds calm".to_string());
    }
    
    let stress_level = (stress_score as u8).min(100);
    (stress_level, reasons)
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_parse_wav() {
        // Create a minimal valid WAV file
        let wav = create_test_wav(16000, &generate_sine_wave(440.0, 16000, 0.5));
        let (samples, sr) = parse_wav(&wav).expect("Should parse WAV");
        assert_eq!(sr, 16000);
        assert!(!samples.is_empty());
    }
    
    #[test]
    fn test_calm_voice() {
        // Steady sine wave = calm voice
        let steady_sine = generate_sine_wave(150.0, 16000, 1.0);
        let wav = create_test_wav(16000, &steady_sine);
        let analysis = analyze_voice_stress(&wav);
        assert!(analysis.stress_level < 50, "Steady tone should be low stress, got {}", analysis.stress_level);
    }
    
    #[test]
    fn test_trembling_voice() {
        // Sine wave with frequency modulation (trembling) = stressed voice
        let trembling = generate_trembling_voice(150.0, 16000, 1.0, 6.0, 30.0);
        let wav = create_test_wav(16000, &trembling);
        let analysis = analyze_voice_stress(&wav);
        assert!(analysis.stress_level > 30, "Trembling voice should show stress, got {}", analysis.stress_level);
    }
    
    #[test]
    fn test_stress_features_extraction() {
        let samples = generate_sine_wave(200.0, 16000, 0.5);
        let features = extract_features(&samples, 16000);
        assert!(features.estimated_f0 > 150.0 && features.estimated_f0 < 250.0,
            "F0 should be ~200Hz, got {:.1}", features.estimated_f0);
    }
    
    // Helper: generate a pure sine wave
    fn generate_sine_wave(freq: f64, sample_rate: u32, duration: f64) -> Vec<f32> {
        let num_samples = (sample_rate as f64 * duration) as usize;
        (0..num_samples)
            .map(|i| {
                let t = i as f64 / sample_rate as f64;
                (2.0 * std::f64::consts::PI * freq * t).sin() as f32 * 0.5
            })
            .collect()
    }
    
    // Helper: generate a trembling voice (frequency-modulated sine)
    fn generate_trembling_voice(
        base_freq: f64, sample_rate: u32, duration: f64,
        tremor_rate: f64, tremor_depth: f64
    ) -> Vec<f32> {
        let num_samples = (sample_rate as f64 * duration) as usize;
        let mut phase = 0.0;
        (0..num_samples)
            .map(|i| {
                let t = i as f64 / sample_rate as f64;
                let freq = base_freq + tremor_depth * (2.0 * std::f64::consts::PI * tremor_rate * t).sin();
                phase += 2.0 * std::f64::consts::PI * freq / sample_rate as f64;
                // Add some amplitude variation too
                let amp = 0.5 + 0.2 * (2.0 * std::f64::consts::PI * tremor_rate * 0.7 * t).sin();
                (phase.sin() * amp) as f32
            })
            .collect()
    }
    
    // Helper: create WAV file from samples
    fn create_test_wav(sample_rate: u32, samples: &[f32]) -> Vec<u8> {
        let data_size = samples.len() * 2;
        let file_size = 36 + data_size;
        let mut wav = Vec::with_capacity(44 + data_size);
        
        // RIFF header
        wav.extend_from_slice(b"RIFF");
        wav.extend_from_slice(&(file_size as u32).to_le_bytes());
        wav.extend_from_slice(b"WAVE");
        // fmt chunk
        wav.extend_from_slice(b"fmt ");
        wav.extend_from_slice(&16u32.to_le_bytes());
        wav.extend_from_slice(&1u16.to_le_bytes()); // PCM
        wav.extend_from_slice(&1u16.to_le_bytes()); // Mono
        wav.extend_from_slice(&sample_rate.to_le_bytes());
        wav.extend_from_slice(&(sample_rate * 2).to_le_bytes()); // byte rate
        wav.extend_from_slice(&2u16.to_le_bytes()); // block align
        wav.extend_from_slice(&16u16.to_le_bytes()); // bits per sample
        // data chunk
        wav.extend_from_slice(b"data");
        wav.extend_from_slice(&(data_size as u32).to_le_bytes());
        
        for &s in samples {
            let val = (s.max(-1.0).min(1.0) * 32767.0) as i16;
            wav.extend_from_slice(&val.to_le_bytes());
        }
        
        wav
    }
}
