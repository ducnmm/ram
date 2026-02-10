import { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { bioAuth, isBioAuthSuccess, getTranscript } from '../services/ramApi';
import type { BioAuthResponse } from '../services/ramApi';
import './VoiceAuth.css';

interface VoiceAuthProps {
  handle: string;
  amount: number;
  coinType: string;
  action?: string;
  recipientAddress?: string;
  recipientHandle?: string;
  onSuccess: (response: BioAuthResponse) => void;
  onCancel: () => void;
}

// NOTE: Frontend is intentionally BLIND to duress detection.
// Both OK and Duress responses are treated as success.
// The signed payload is submitted to blockchain, where the smart contract
// silently handles wallet locking. This prevents attackers from knowing
// that duress was detected.
type AuthState = 'idle' | 'recording' | 'processing' | 'success' | 'error';

export function VoiceAuth({
  handle,
  amount,
  coinType,
  action = 'sending',
  recipientAddress: _recipientAddress,
  recipientHandle: _recipientHandle,
  onSuccess,
  onCancel,
}: VoiceAuthProps) {
  const [state, setState] = useState<AuthState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [_transcript, setTranscript] = useState<string | null>(null);
  const [recordingTime, setRecordingTime] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  const startRecording = useCallback(async () => {
    try {
      setError(null);
      audioChunksRef.current = [];

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000,
        }
      });

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus',
      });

      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());

        // Process the recording
        await processRecording();
      };

      // Start recording
      mediaRecorder.start(100); // Collect data every 100ms
      setState('recording');
      setRecordingTime(0);

      // Start timer
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

    } catch (err) {
      setError('Failed to access microphone. Please grant permission.');
      setState('error');
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
      setState('processing');
    }
  }, []);

  const processRecording = async () => {
    try {
      // Create audio blob
      const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });

      // Convert webm to WAV format (required by backend)
      const wavBlob = await convertToWav(audioBlob);

      // Convert to base64
      const base64 = await blobToBase64(wavBlob);

      // Call BioAuth API - response is now BLIND (no data field)
      const response = await bioAuth(handle, base64, amount, coinType);

      // Decode transcript from payload bytes
      const decodedTranscript = getTranscript(response);
      setTranscript(decodedTranscript);

      // SECURITY: Frontend is BLIND to duress detection.
      // Both OK and Duress are treated identically as "success".
      // The signed payload goes to blockchain where smart contract handles locking.
      // This way, an attacker cannot see that duress was detected.

      if (isBioAuthSuccess(response)) {
        setState('success');
        setTimeout(() => onSuccess(response), 1500);
      } else {
        // Only InvalidAmount gets an error
        setError(`Voice verification failed. Please say "${action} ${amount} ${coinType}" clearly and try again.`);
        setState('error');
      }

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Voice verification failed');
      setState('error');
    }
  };

  const retry = () => {
    setState('idle');
    setError(null);
    setTranscript(null);
    setRecordingTime(0);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getPromptText = () => {
    return `"${action} ${amount} ${coinType}"`;
  };

  return (
    <div className="voice-auth-overlay">
      <motion.div
        className="voice-auth-modal"
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 20 }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
      >
        <motion.button
          className="close-btn"
          onClick={onCancel}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </motion.button>

        <div className="voice-auth-content">
          {/* Prompt text */}
          <AnimatePresence mode="wait">
            {(state === 'idle' || state === 'recording') && (
              <motion.div
                className="prompt-box"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
              >
                <p className="prompt-text">{getPromptText()}</p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Recording indicator */}
          <AnimatePresence mode="wait">
            {state === 'recording' && (
              <motion.div
                className="recording-indicator"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ duration: 0.3 }}
              >
                <div className="recording-pulse"></div>
                <span className="recording-time">{formatTime(recordingTime)}</span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Processing spinner */}
          <AnimatePresence mode="wait">
            {state === 'processing' && (
              <motion.div
                className="processing-spinner"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <div className="spinner"></div>
                <p>Analyzing voice patterns...</p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Success state */}
          <AnimatePresence mode="wait">
            {state === 'success' && (
              <motion.div
                className="success-state"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ type: "spring", damping: 15 }}
              >
                <motion.div
                  className="success-icon"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: 0.1, type: "spring", damping: 10 }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                </motion.div>
                <p className="success-text">Voice verified</p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* NOTE: No duress UI - frontend is intentionally blind to duress detection */}

          {/* Error state */}
          <AnimatePresence mode="wait">
            {state === 'error' && (
              <motion.div
                className="error-state"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
              >
                <motion.div
                  className="error-icon"
                  initial={{ rotate: -90 }}
                  animate={{ rotate: 0 }}
                  transition={{ type: "spring", damping: 15 }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M15 9l-6 6M9 9l6 6" />
                  </svg>
                </motion.div>
                <p className="error-text">{error}</p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Action buttons */}
          <div className="voice-auth-actions">
            {state === 'idle' && (
              <button
                className="record-btn"
                onClick={startRecording}
              >
                Record
              </button>
            )}

            {state === 'recording' && (
              <button
                className="stop-btn"
                onClick={stopRecording}
              >
                Stop
              </button>
            )}

            {(state === 'error') && (
              <button
                className="retry-btn"
                onClick={retry}
              >
                Try Again
              </button>
            )}

            {state !== 'recording' && state !== 'processing' && state !== 'success' && (
              <button
                className="cancel-btn"
                onClick={onCancel}
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// Helper function to convert webm audio to WAV format
async function convertToWav(webmBlob: Blob): Promise<Blob> {
  const audioContext = new AudioContext({ sampleRate: 16000 });

  // Decode webm audio
  const arrayBuffer = await webmBlob.arrayBuffer();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

  // Convert to mono if needed
  const channelData = audioBuffer.numberOfChannels > 1
    ? mergeChannels(audioBuffer)
    : audioBuffer.getChannelData(0);

  // Create WAV file
  const wavBuffer = encodeWav(channelData, audioBuffer.sampleRate);

  await audioContext.close();

  return new Blob([wavBuffer], { type: 'audio/wav' });
}

// Merge stereo to mono
function mergeChannels(audioBuffer: AudioBuffer): Float32Array {
  const left = audioBuffer.getChannelData(0);
  const right = audioBuffer.getChannelData(1);
  const mono = new Float32Array(left.length);

  for (let i = 0; i < left.length; i++) {
    mono[i] = (left[i] + right[i]) / 2;
  }

  return mono;
}

// Encode PCM data to WAV format
function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  // WAV header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(view, 36, 'data');
  view.setUint32(40, samples.length * 2, true);

  // PCM data
  const offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  return buffer;
}

function writeString(view: DataView, offset: number, string: string): void {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

// Helper function to convert Blob to base64
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      // Remove data URL prefix (data:audio/wav;base64,)
      const base64Data = base64.split(',')[1];
      resolve(base64Data);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
