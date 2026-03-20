// ============================================================
// OpenClaw Deploy — Marketplace Self-Improvement Engine
// ============================================================

import MiniSearch from 'minisearch';
import type { FeedbackEntry } from './types.js';

interface IndexedFeedback extends FeedbackEntry {
  id: string;
  ageWeight: number;
}

export class SelfImprovementEngine {
  private index: MiniSearch<IndexedFeedback>;
  private entries: IndexedFeedback[] = [];

  constructor() {
    this.index = new MiniSearch<IndexedFeedback>({
      fields: ['comment', 'category', 'lessonLearned'],
      storeFields: ['taskId', 'rating', 'comment', 'category', 'receivedAt', 'lessonLearned', 'ageWeight'],
      idField: 'id',
    });
  }

  /**
   * Load feedback entries and build the BM25 index with temporal decay.
   */
  loadFeedback(feedback: FeedbackEntry[]): void {
    this.entries = [];
    this.index.removeAll();

    const now = Date.now();
    const DAY_MS = 24 * 60 * 60 * 1000;

    for (let i = 0; i < feedback.length; i++) {
      const f = feedback[i];
      const ageDays = (now - new Date(f.receivedAt).getTime()) / DAY_MS;
      // Temporal decay: recent feedback weighs more
      const ageWeight = Math.exp(-0.02 * ageDays);

      const entry: IndexedFeedback = {
        ...f,
        id: `fb-${i}`,
        ageWeight,
      };
      this.entries.push(entry);
    }

    this.index.addAll(this.entries);
  }

  /**
   * Search feedback relevant to a task description or category.
   */
  searchRelevantFeedback(query: string, maxResults = 5): IndexedFeedback[] {
    if (this.entries.length === 0) return [];

    const results = this.index.search(query, {
      prefix: true,
      fuzzy: 0.2,
      boost: { lessonLearned: 2, comment: 1.5 },
    });

    // Sort by combined BM25 score * temporal decay weight
    return results
      .map((r) => {
        const entry = this.entries.find((e) => e.id === r.id)!;
        return { ...entry, _score: r.score * entry.ageWeight };
      })
      .sort((a, b) => (b as any)._score - (a as any)._score)
      .slice(0, maxResults);
  }

  /**
   * Generate a structured self-study summary from accumulated feedback.
   */
  generateStudySummary(): string {
    if (this.entries.length === 0) {
      return 'No feedback data available for study session.';
    }

    // Group by category
    const byCategory = new Map<string, IndexedFeedback[]>();
    for (const e of this.entries) {
      const cat = e.category || 'general';
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat)!.push(e);
    }

    const lines: string[] = ['# Self-Improvement Study Session', ''];

    // Overall stats
    const avgRating = this.entries.reduce((s, e) => s + e.rating, 0) / this.entries.length;
    lines.push(`**Overall Rating**: ${avgRating.toFixed(2)}/5 across ${this.entries.length} reviews`);
    lines.push('');

    // Category breakdown
    for (const [cat, entries] of byCategory) {
      const catAvg = entries.reduce((s, e) => s + e.rating, 0) / entries.length;
      lines.push(`## ${cat} (avg: ${catAvg.toFixed(2)}/5, ${entries.length} tasks)`);

      // Find lowest-rated for improvement areas
      const sorted = [...entries].sort((a, b) => a.rating - b.rating);
      const worstN = sorted.slice(0, 3);
      if (worstN.some((e) => e.rating < 4)) {
        lines.push('### Areas for Improvement:');
        for (const e of worstN) {
          if (e.rating < 4) {
            lines.push(`- Task ${e.taskId} (${e.rating}/5): "${e.comment}"`);
            if (e.lessonLearned) lines.push(`  → Lesson: ${e.lessonLearned}`);
          }
        }
      }

      // Lessons learned
      const lessons = entries.filter((e) => e.lessonLearned).map((e) => e.lessonLearned!);
      if (lessons.length > 0) {
        lines.push('### Key Lessons:');
        for (const l of [...new Set(lessons)].slice(0, 5)) {
          lines.push(`- ${l}`);
        }
      }

      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Get improvement recommendations for a specific task category.
   */
  getRecommendations(category: string): string[] {
    const relevant = this.entries.filter((e) => e.category === category && e.rating < 4);
    if (relevant.length === 0) return [];

    const recommendations: string[] = [];
    for (const e of relevant.sort((a, b) => a.rating - b.rating).slice(0, 5)) {
      if (e.lessonLearned) {
        recommendations.push(e.lessonLearned);
      } else {
        recommendations.push(`Review feedback on task ${e.taskId}: "${e.comment}"`);
      }
    }
    return recommendations;
  }
}
