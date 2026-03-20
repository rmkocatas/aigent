// ============================================================
// OpenClaw Deploy — Skill Matcher
// ============================================================
//
// Matches user messages to skills based on keyword triggers,
// regex patterns, classification, and avoidWhen filters.
// ============================================================

import type { Skill, ClassificationResult } from '../../types/index.js';

interface ScoredSkill {
  skill: Skill;
  score: number;
}

/**
 * Match skills against a user message and return the top N by score.
 *
 * Scoring:
 * - Each keyword hit: +2 points
 * - Each regex pattern match: +3 points
 * - Classification match: +2 points
 * - Any avoidWhen keyword hit: disqualifies the skill
 */
export function matchSkills(
  message: string,
  classification: ClassificationResult,
  skills: Skill[],
  maxResults: number,
): Skill[] {
  const messageLower = message.toLowerCase();
  const scored: ScoredSkill[] = [];

  for (const skill of skills) {
    const { triggers, avoidWhen } = skill.manifest;

    // Check avoidWhen — if any phrase matches, skip this skill
    if (avoidWhen?.length) {
      const avoided = avoidWhen.some((phrase) =>
        messageLower.includes(phrase.toLowerCase()),
      );
      if (avoided) continue;
    }

    let score = 0;

    // Keyword matching
    if (triggers.keywords?.length) {
      for (const keyword of triggers.keywords) {
        if (messageLower.includes(keyword.toLowerCase())) {
          score += 2;
        }
      }
    }

    // Regex pattern matching
    if (triggers.patterns?.length) {
      for (const pattern of triggers.patterns) {
        try {
          const re = new RegExp(pattern, 'i');
          if (re.test(message)) {
            score += 3;
          }
        } catch {
          // Skip invalid patterns
        }
      }
    }

    // Classification matching
    if (triggers.classifications?.length) {
      if (triggers.classifications.includes(classification.classification)) {
        score += 2;
      }
    }

    if (score > 0) {
      scored.push({ skill, score });
    }
  }

  // Sort by score descending, return top N
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxResults).map((s) => s.skill);
}
