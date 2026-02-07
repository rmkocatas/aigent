import { describe, it, expect } from 'vitest';
import {
  CHANNEL_DEFINITIONS,
  getChannelDefinition,
  enableChannel,
  disableChannel,
} from '../../../src/core/channels/manager.js';
import type { ChannelSelection } from '../../../src/types/index.js';

describe('CHANNEL_DEFINITIONS', () => {
  it('defines 6 channels', () => {
    expect(CHANNEL_DEFINITIONS).toHaveLength(6);
  });

  it('includes webchat as first channel', () => {
    expect(CHANNEL_DEFINITIONS[0].id).toBe('webchat');
  });

  it('has unique ids', () => {
    const ids = CHANNEL_DEFINITIONS.map((ch) => ch.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(['webchat', 'telegram', 'discord', 'slack', 'whatsapp', 'signal'] as const)(
    'defines %s',
    (id) => {
      const def = getChannelDefinition(id);
      expect(def).toBeDefined();
      expect(def!.name).toBeTruthy();
    },
  );
});

describe('getChannelDefinition', () => {
  it('returns undefined for unknown channel', () => {
    expect(getChannelDefinition('unknown' as 'webchat')).toBeUndefined();
  });

  it('returns correct definition for telegram', () => {
    const def = getChannelDefinition('telegram');
    expect(def!.credentialType).toBe('token');
    expect(def!.configKeys).toContain('TELEGRAM_BOT_TOKEN');
  });
});

describe('enableChannel', () => {
  it('enables a new channel', () => {
    const channels: ChannelSelection[] = [
      { id: 'webchat', enabled: true },
    ];
    const result = enableChannel(channels, 'telegram', 'bot-token');
    expect(result).toHaveLength(2);
    expect(result[1]).toEqual({ id: 'telegram', enabled: true, token: 'bot-token' });
  });

  it('enables an existing disabled channel', () => {
    const channels: ChannelSelection[] = [
      { id: 'webchat', enabled: true },
      { id: 'telegram', enabled: false },
    ];
    const result = enableChannel(channels, 'telegram');
    expect(result).toHaveLength(2);
    expect(result[1].enabled).toBe(true);
  });

  it('updates token when enabling existing channel', () => {
    const channels: ChannelSelection[] = [
      { id: 'webchat', enabled: true },
      { id: 'telegram', enabled: false, token: 'old-token' },
    ];
    const result = enableChannel(channels, 'telegram', 'new-token');
    expect(result[1].token).toBe('new-token');
  });
});

describe('disableChannel', () => {
  it('disables an enabled channel', () => {
    const channels: ChannelSelection[] = [
      { id: 'webchat', enabled: true },
      { id: 'telegram', enabled: true },
    ];
    const result = disableChannel(channels, 'telegram');
    expect(result[1].enabled).toBe(false);
  });

  it('throws when disabling webchat', () => {
    const channels: ChannelSelection[] = [
      { id: 'webchat', enabled: true },
    ];
    expect(() => disableChannel(channels, 'webchat')).toThrow('Cannot disable webchat');
  });

  it('preserves other channels', () => {
    const channels: ChannelSelection[] = [
      { id: 'webchat', enabled: true },
      { id: 'telegram', enabled: true },
      { id: 'discord', enabled: true },
    ];
    const result = disableChannel(channels, 'telegram');
    expect(result[0].enabled).toBe(true);
    expect(result[2].enabled).toBe(true);
  });
});
