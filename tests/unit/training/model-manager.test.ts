import { describe, it, expect } from 'vitest';
import {
  createModelfile,
  nextVersionName,
} from '../../../src/core/training/model-manager.js';

describe('model-manager', () => {
  describe('createModelfile', () => {
    it('should generate a valid Modelfile with FROM directive', () => {
      const result = createModelfile('llama3.1:8b', '/path/to/model.gguf');
      expect(result).toContain('FROM /path/to/model.gguf');
      expect(result).toContain('PARAMETER temperature');
      expect(result).toContain('SYSTEM');
    });
  });

  describe('nextVersionName', () => {
    it('should generate v1 when current version is 0', () => {
      expect(nextVersionName('llama3.1:8b', 0)).toBe('llama3.1:8b-ft-v1');
    });

    it('should increment version number', () => {
      expect(nextVersionName('llama3.1:8b', 3)).toBe('llama3.1:8b-ft-v4');
    });
  });
});
