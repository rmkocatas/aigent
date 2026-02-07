import type { ClassificationResult } from '../../types/index.js';

const CODE_KEYWORDS = /\b(function|class|def|import|export|const|let|var|return|async|await|error|debug|code|script|api|bug|fix|compile|runtime|syntax|exception|refactor|typescript|javascript|python|java|rust|go|sql|html|css|react|node|npm|git|docker|regex|algorithm|interface|implement|method|module|package|library|framework|deploy|test|unit\s*test)\b/i;

const CODE_FENCE = /```/;

const SIMPLE_PATTERNS = /^(hi|hello|hey|thanks|thank you|ok|yes|no|sure|bye|good morning|good night|how are you|what'?s up|what is .{1,30}\??|who is .{1,30}\??|when is .{1,30}\??|where is .{1,30}\??)[\s!?.]*$/i;

const REASONING_KEYWORDS = /\b(analyze|analyse|compare|contrast|explain\s+why|evaluate|assess|critique|reason|trade-?off|pros?\s+and\s+cons?|in\s+depth|step\s+by\s+step|detailed|comprehensive|implications?|consequences?|justify|elaborate)\b/i;

const TOOL_KEYWORDS = /\b(search|find|look\s*up|check|read|write|create|save|remind|schedule|calculate|compute|download|fetch|install|browse|open|scan|weather|convert|translate)\b/i;

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

  // 2. Tool keyword check — action-oriented requests need a capable provider
  const hasToolKeywords = TOOL_KEYWORDS.test(trimmed);
  if (hasToolKeywords) {
    signals.push('tool keywords detected');
    return { classification: 'complex', confidence: 0.8, signals };
  }

  // 3. Simple check — only if no tool keywords
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

  // 4. Complex check
  const hasReasoningKeywords = REASONING_KEYWORDS.test(trimmed);
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

  // 5. Default
  signals.push('no strong signals');
  return { classification: 'default', confidence: 0.5, signals };
}
