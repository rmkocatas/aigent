import { describe, it, expect } from 'vitest';
import {
  SECURITY_LEVELS,
  DEFAULT_SECURITY_LEVEL,
  getSecurityLevel,
} from '../../../src/core/security/levels.js';
import type { SecurityLevelDefinition } from '../../../src/types/index.js';

describe('SECURITY_LEVELS', () => {
  it('defines all three security levels (L1, L2, L3)', () => {
    expect(SECURITY_LEVELS).toHaveProperty('L1');
    expect(SECURITY_LEVELS).toHaveProperty('L2');
    expect(SECURITY_LEVELS).toHaveProperty('L3');
  });

  it('L2 has correct defaults', () => {
    const l2 = SECURITY_LEVELS.L2;
    expect(l2.sandbox.mode).toBe('non-main');
    expect(l2.gateway.bind).toBe('loopback');
    expect(l2.gateway.authMode).toBe('token');
    expect(l2.channels.dmPolicy).toBe('pairing');
    expect(l2.channels.groupPolicy).toBe('allowlist');
    expect(l2.channels.requireMention).toBe(true);
    expect(l2.docker.readOnlyRoot).toBe(true);
    expect(l2.docker.capDrop).toContain('ALL');
  });

  it('L3 is stricter than L2', () => {
    const l2 = SECURITY_LEVELS.L2;
    const l3 = SECURITY_LEVELS.L3;

    // L3 sandboxes all, L2 only non-main
    expect(l3.sandbox.mode).toBe('all');
    expect(l2.sandbox.mode).toBe('non-main');

    // L3 disables mDNS, L2 allows minimal
    expect(l3.discovery.mdnsMode).toBe('off');
    expect(l2.discovery.mdnsMode).toBe('minimal');

    // L3 has an explicit allow-list for tools
    expect(l3.tools.allow).toBeDefined();
    expect(l2.tools.allow).toBeUndefined();

    // L3 workspace is read-only
    expect(l3.sandbox.workspaceAccess).toBe('ro');

    // L3 redacts all logs
    expect(l3.logging.redactSensitive).toBe('all');
  });

  it('L1 is lighter than L2', () => {
    const l1 = SECURITY_LEVELS.L1;
    const l2 = SECURITY_LEVELS.L2;

    // L1 sandbox is off
    expect(l1.sandbox.mode).toBe('off');
    expect(l2.sandbox.mode).toBe('non-main');

    // L1 does not require mention
    expect(l1.channels.requireMention).toBe(false);
    expect(l2.channels.requireMention).toBe(true);

    // L1 docker root is not read-only
    expect(l1.docker.readOnlyRoot).toBe(false);

    // L1 has fewer denied tools
    expect(l1.tools.deny.length).toBeLessThan(l2.tools.deny.length);
  });

  const requiredFields: (keyof SecurityLevelDefinition)[] = [
    'name',
    'description',
    'gateway',
    'channels',
    'sandbox',
    'tools',
    'docker',
    'logging',
    'discovery',
    'filePermissions',
  ];

  it.each(['L1', 'L2', 'L3'] as const)(
    '%s has all required fields from SecurityLevelDefinition',
    (level) => {
      const def = SECURITY_LEVELS[level];
      for (const field of requiredFields) {
        expect(def).toHaveProperty(field);
      }
      // gateway sub-fields
      expect(def.gateway).toHaveProperty('bind');
      expect(def.gateway).toHaveProperty('authMode');
      // channels sub-fields
      expect(def.channels).toHaveProperty('dmPolicy');
      expect(def.channels).toHaveProperty('groupPolicy');
      expect(def.channels).toHaveProperty('requireMention');
      // sandbox sub-fields
      expect(def.sandbox).toHaveProperty('mode');
      expect(def.sandbox).toHaveProperty('scope');
      expect(def.sandbox).toHaveProperty('workspaceAccess');
    },
  );
});

describe('DEFAULT_SECURITY_LEVEL', () => {
  it('is L2', () => {
    expect(DEFAULT_SECURITY_LEVEL).toBe('L2');
  });
});

describe('getSecurityLevel', () => {
  it('returns the correct definition for each level', () => {
    expect(getSecurityLevel('L1')).toBe(SECURITY_LEVELS.L1);
    expect(getSecurityLevel('L2')).toBe(SECURITY_LEVELS.L2);
    expect(getSecurityLevel('L3')).toBe(SECURITY_LEVELS.L3);
  });
});
