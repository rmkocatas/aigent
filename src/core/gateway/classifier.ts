import type { ClassificationResult } from '../../types/index.js';

const CODE_KEYWORDS = /\b(function|class|def|import|export|const|let|var|return|async|await|error|debug|code|script|api|bug|fix|compile|runtime|syntax|exception|refactor|typescript|javascript|python|java|rust|go|sql|html|css|react|node|npm|git|docker|regex|algorithm|interface|implement|method|module|package|library|framework|deploy|test|unit\s*test)\b/i;

const CODE_FENCE = /```/;

const SIMPLE_PATTERNS = /^(hi|hello|hey|thanks|thank you|ok|yes|no|sure|bye|good morning|good night|how are you|what'?s up|what is .{1,30}\??|who is .{1,30}\??|when is .{1,30}\??|where is .{1,30}\??|merhaba|selam|teşekkürler|sağol|evet|hayır|tamam|günaydın|iyi geceler|nasılsın|naber)[\s!?.]*$/i;

const REASONING_KEYWORDS = /\b(analyze|analyse|compare|contrast|explain\s+why|evaluate|assess|critique|reason|trade-?off|pros?\s+and\s+cons?|in\s+depth|step\s+by\s+step|detailed|comprehensive|implications?|consequences?|justify|elaborate|analiz|karşılaştır|değerlendir|açıkla|detaylı|kapsamlı|adım\s+adım|neden|sebep|sonuç)\b/i;

const TOOL_KEYWORDS = /\b(search|find|look\s*up|check|read|write|create|save|remind|schedule|calculate|compute|download|fetch|install|browse|open|scan|weather|convert|translate|backup|restore|status|system\s*health|diagnostics|hazırla|oluştur|yaz|kaydet|gönder|hatırlat|hesapla|ara|bul|oku|indir|yükle|aç|tara|dönüştür|çevir|yedekle|kontrol|rapor|dosya|belge|pdf|doc|send|generate|prepare|make|build|report|document|file|upload|export|twitter|tweet|feed|timeline|retweet|trending|memory|memories|remember|recall|forget|tasks?|todos?|know\s+about\s+me|hatırla|unutma|görev\w*)\b/i;

// Web-specific keywords — triggers Opus for prompt injection resistance
const WEB_KEYWORDS = /\b(search\s+(the\s+)?(web|internet|online|twitter)|look\s*up\s+online|find\s+(on\s+the\s+)?web|browse|news|headlines|what('?s| is)\s+(happening|trending)|latest\s+news|current\s+events|twitter\s+(search|feed|timeline|trends?)|tweets?\s+(about|on|from))\b/i;

// URL pattern — if user pastes a URL, it will involve fetch_url
const URL_PATTERN = /https?:\/\/[^\s]+/i;

function countMatches(text: string, pattern: RegExp): number {
  const globalPattern = new RegExp(pattern.source, 'gi');
  return (text.match(globalPattern) ?? []).length;
}

export function classifyPrompt(message: string): ClassificationResult {
  const trimmed = message.trim();
  if (!trimmed) {
    return { classification: 'simple', confidence: 1, signals: ['empty message'] };
  }

  const signals: string[] = [];

  // 1. Coding check (highest priority)
  const codeKeywordCount = countMatches(trimmed, CODE_KEYWORDS);
  const hasCodeFence = CODE_FENCE.test(trimmed);

  if (hasCodeFence) {
    signals.push('code fence detected');
  }
  if (codeKeywordCount > 0) {
    signals.push(`${codeKeywordCount} code keyword(s)`);
  }

  if (hasCodeFence || codeKeywordCount >= 2) {
    return {
      classification: 'coding',
      confidence: hasCodeFence ? 0.9 : 0.8,
      signals,
    };
  }
  if (codeKeywordCount === 1 && trimmed.length > 100) {
    return { classification: 'coding', confidence: 0.7, signals };
  }

  // 2. Web content check — routes to Opus for injection resistance
  // Must run BEFORE tool_simple so web queries don't downgrade to Haiku
  const hasWebKeywords = WEB_KEYWORDS.test(trimmed);
  const hasUrl = URL_PATTERN.test(trimmed);

  if (hasWebKeywords || hasUrl) {
    if (hasWebKeywords) signals.push('web keywords detected');
    if (hasUrl) signals.push('URL detected');
    return {
      classification: 'web_content',
      confidence: hasWebKeywords ? 0.85 : 0.8,
      signals,
    };
  }

  // 3. Tool keyword check — split into tool_simple vs complex
  const hasToolKeywords = TOOL_KEYWORDS.test(trimmed);
  const hasReasoningKeywords = REASONING_KEYWORDS.test(trimmed);

  if (hasToolKeywords) {
    signals.push('tool keywords detected');
    // If also has reasoning keywords or is long, it's complex (→ Sonnet)
    if (hasReasoningKeywords || trimmed.length > 300) {
      if (hasReasoningKeywords) signals.push('reasoning keywords');
      if (trimmed.length > 300) signals.push(`length: ${trimmed.length} chars`);
      return { classification: 'complex', confidence: 0.85, signals };
    }
    // Simple tool use — weather, reminders, file reads, etc. (→ Haiku)
    return { classification: 'tool_simple', confidence: 0.8, signals };
  }

  // 4. Simple check — only if no tool/web keywords
  if (trimmed.length < 100 && codeKeywordCount === 0) {
    if (SIMPLE_PATTERNS.test(trimmed)) {
      signals.push('matches simple pattern');
      return { classification: 'simple', confidence: 0.85, signals };
    }
    if (trimmed.length < 50 && !trimmed.includes('\n')) {
      signals.push('very short single-line');
      return { classification: 'simple', confidence: 0.7, signals };
    }
  }

  // 5. Complex check
  const isLong = trimmed.length > 500;

  if (hasReasoningKeywords) {
    signals.push('reasoning keywords');
  }
  if (isLong) {
    signals.push(`length: ${trimmed.length} chars`);
  }

  if (isLong && hasReasoningKeywords) {
    return { classification: 'complex', confidence: 0.9, signals };
  }
  if (isLong) {
    return { classification: 'complex', confidence: 0.7, signals };
  }
  if (hasReasoningKeywords) {
    return { classification: 'complex', confidence: 0.75, signals };
  }

  // 6. Default
  signals.push('no strong signals');
  return { classification: 'default', confidence: 0.5, signals };
}
