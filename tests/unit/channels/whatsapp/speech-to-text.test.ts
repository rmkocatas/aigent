import { describe, it, expect } from 'vitest';
import { transcribeAudio } from '../../../../src/core/channels/whatsapp/speech-to-text.js';

describe('WhatsApp speech-to-text re-export', () => {
  it('re-exports transcribeAudio from telegram module', () => {
    expect(typeof transcribeAudio).toBe('function');
  });
});
