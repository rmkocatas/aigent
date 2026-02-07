// ============================================================
// OpenClaw Deploy — WhatsApp Speech-to-Text
// ============================================================
//
// Re-exports the shared Whisper-based transcription from the
// Telegram module. WhatsApp voice messages use OGG/Opus format
// which Whisper handles natively.
// ============================================================

export { transcribeAudio } from '../telegram/speech-to-text.js';
