import { describe, it, expect } from 'vitest';
import {
  shouldTriggerTraining,
  getAutoTrainerDefaults,
  formatTrainingStatus,
} from '../../../src/core/training/auto-trainer.js';
import type { TrainingStats } from '../../../src/types/index.js';

function makeStats(overrides: Partial<TrainingStats> = {}): TrainingStats {
  return {
    totalEntries: 0,
    dataFileSizeMB: 0,
    readyForTraining: false,
    fineTunedVersions: [],
    currentModel: 'llama3.1:8b',
    ...overrides,
  };
}

describe('auto-trainer', () => {
  describe('getAutoTrainerDefaults', () => {
    it('should return sensible defaults', () => {
      const defaults = getAutoTrainerDefaults();
      expect(defaults.enabled).toBe(true);
      expect(defaults.threshold).toBe(500);
      expect(defaults.maxTrainsPerDay).toBe(1);
    });
  });

  describe('shouldTriggerTraining', () => {
    it('should return false when disabled', async () => {
      const config = { ...getAutoTrainerDefaults(), enabled: false };
      const result = await shouldTriggerTraining(makeStats(), config);
      expect(result.shouldTrain).toBe(false);
      expect(result.reason).toContain('disabled');
    });

    it('should return false when below threshold', async () => {
      const config = getAutoTrainerDefaults();
      const stats = makeStats({ totalEntries: 100 });
      const result = await shouldTriggerTraining(stats, config);
      expect(result.shouldTrain).toBe(false);
      expect(result.reason).toContain('400 more');
    });

    it('should return true when threshold met', async () => {
      const config = getAutoTrainerDefaults();
      const stats = makeStats({
        totalEntries: 500,
        newestEntry: new Date().toISOString(),
      });
      const result = await shouldTriggerTraining(stats, config);
      expect(result.shouldTrain).toBe(true);
    });

    it('should enforce rate limit when already trained today', async () => {
      const config = getAutoTrainerDefaults();
      const stats = makeStats({
        totalEntries: 600,
        newestEntry: new Date().toISOString(),
      });
      const result = await shouldTriggerTraining(stats, config, new Date().toISOString());
      expect(result.shouldTrain).toBe(false);
      expect(result.reason).toContain('Rate limit');
    });

    it('should return false if no new entries since last training', async () => {
      const config = getAutoTrainerDefaults();
      const oldDate = '2025-01-01T00:00:00.000Z';
      const stats = makeStats({
        totalEntries: 600,
        newestEntry: oldDate,
      });
      const result = await shouldTriggerTraining(stats, config, '2025-06-01T00:00:00.000Z');
      expect(result.shouldTrain).toBe(false);
      expect(result.reason).toContain('No new entries');
    });
  });

  describe('formatTrainingStatus', () => {
    it('should format a readable status string', () => {
      const config = getAutoTrainerDefaults();
      const stats = makeStats({
        totalEntries: 250,
        dataFileSizeMB: 1.5,
        currentModel: 'llama3.1:8b',
      });
      const output = formatTrainingStatus(stats, config);
      expect(output).toContain('250 entries');
      expect(output).toContain('1.5 MB');
      expect(output).toContain('llama3.1:8b');
      expect(output).toContain('50%');
    });
  });
});
