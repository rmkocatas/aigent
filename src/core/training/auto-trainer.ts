// ============================================================
// OpenClaw Deploy — Automatic Training Trigger
// ============================================================

import type { TrainingStats } from '../../types/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AutoTrainerConfig {
  enabled: boolean;
  threshold: number;          // min entries before training (default 500)
  checkIntervalMs: number;    // how often to check (default 1 hour)
  maxTrainsPerDay: number;    // rate limit (default 1)
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Get default auto-trainer configuration. */
export function getAutoTrainerDefaults(): AutoTrainerConfig {
  return {
    enabled: true,
    threshold: 500,
    checkIntervalMs: 3_600_000, // 1 hour
    maxTrainsPerDay: 1,
  };
}

// ---------------------------------------------------------------------------
// Training trigger logic
// ---------------------------------------------------------------------------

/** Check if automatic training should be triggered. */
export async function shouldTriggerTraining(
  stats: TrainingStats,
  config: AutoTrainerConfig,
  lastTrainTimestamp?: string,
): Promise<{ shouldTrain: boolean; reason: string }> {
  // 1. Check if auto-training is enabled
  if (!config.enabled) {
    return { shouldTrain: false, reason: 'Auto-training is disabled' };
  }

  // 2. Check if we have enough entries
  if (stats.totalEntries < config.threshold) {
    const remaining = config.threshold - stats.totalEntries;
    return {
      shouldTrain: false,
      reason: `Need ${remaining} more entries (${stats.totalEntries}/${config.threshold})`,
    };
  }

  // 3. Check rate limit — was training already done today?
  if (lastTrainTimestamp) {
    const lastDate = new Date(lastTrainTimestamp);
    const today = new Date();
    const sameDay =
      lastDate.getFullYear() === today.getFullYear() &&
      lastDate.getMonth() === today.getMonth() &&
      lastDate.getDate() === today.getDate();

    if (sameDay && config.maxTrainsPerDay <= 1) {
      return {
        shouldTrain: false,
        reason: 'Rate limit reached — already trained today',
      };
    }
  }

  // 4. Check if there are new entries since last training
  if (lastTrainTimestamp && stats.newestEntry) {
    const lastTrainDate = new Date(lastTrainTimestamp);
    const newestEntryDate = new Date(stats.newestEntry);
    if (newestEntryDate <= lastTrainDate) {
      return {
        shouldTrain: false,
        reason: 'No new entries since last training',
      };
    }
  }

  // 5. All checks passed
  return {
    shouldTrain: true,
    reason: `Ready to train with ${stats.totalEntries} entries`,
  };
}

// ---------------------------------------------------------------------------
// Status formatting
// ---------------------------------------------------------------------------

/** Format a human-readable status message for the training system. */
export function formatTrainingStatus(
  stats: TrainingStats,
  config: AutoTrainerConfig,
): string {
  const lines: string[] = [];

  lines.push(`Training data: ${stats.totalEntries} entries (${stats.dataFileSizeMB.toFixed(1)} MB)`);

  if (stats.oldestEntry && stats.newestEntry) {
    lines.push(`Date range: ${stats.oldestEntry} — ${stats.newestEntry}`);
  }

  lines.push(`Current model: ${stats.currentModel}`);

  if (stats.fineTunedVersions.length > 0) {
    lines.push(`Fine-tuned versions: ${stats.fineTunedVersions.join(', ')}`);
  } else {
    lines.push('Fine-tuned versions: none');
  }

  if (config.enabled) {
    const progress = Math.min(100, Math.round((stats.totalEntries / config.threshold) * 100));
    lines.push(`Auto-train: enabled (${progress}% of ${config.threshold} entry threshold)`);
    lines.push(`Check interval: ${config.checkIntervalMs / 60_000} min`);
  } else {
    lines.push('Auto-train: disabled');
  }

  lines.push(`Ready for training: ${stats.readyForTraining ? 'yes' : 'no'}`);

  return lines.join('\n');
}
