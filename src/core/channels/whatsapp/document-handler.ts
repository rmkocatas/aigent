// ============================================================
// OpenClaw Deploy — WhatsApp Document Handler
// ============================================================
//
// Re-exports the shared document text extraction from the
// Telegram module. Both channels handle the same document
// types (text, PDF, code files).
// ============================================================

export { extractTextFromDocument } from '../telegram/document-handler.js';
