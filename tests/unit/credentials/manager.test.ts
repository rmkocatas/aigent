import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseEnvFile,
  serializeEnvFile,
  maskCredentialValue,
} from '../../../src/core/credentials/manager.js';

// ---------------------------------------------------------------------------
// parseEnvFile
// ---------------------------------------------------------------------------

describe('parseEnvFile', () => {
  it('parses key=value pairs', () => {
    const content = 'FOO=bar\nBAZ=qux';
    const entries = parseEnvFile(content);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({ key: 'FOO', value: 'bar', source: 'env-file' });
    expect(entries[1]).toEqual({ key: 'BAZ', value: 'qux', source: 'env-file' });
  });

  it('skips comment lines', () => {
    const content = '# This is a comment\nFOO=bar\n# Another comment';
    const entries = parseEnvFile(content);
    expect(entries).toHaveLength(1);
    expect(entries[0].key).toBe('FOO');
  });

  it('skips blank lines', () => {
    const content = 'FOO=bar\n\n\nBAZ=qux\n';
    const entries = parseEnvFile(content);
    expect(entries).toHaveLength(2);
  });

  it('handles values with = in them', () => {
    const content = 'API_KEY=sk-ant-api03-abc=def==';
    const entries = parseEnvFile(content);
    expect(entries).toHaveLength(1);
    expect(entries[0].value).toBe('sk-ant-api03-abc=def==');
  });

  it('trims whitespace from keys and values', () => {
    const content = '  FOO  =  bar  ';
    const entries = parseEnvFile(content);
    expect(entries).toHaveLength(1);
    expect(entries[0].key).toBe('FOO');
    expect(entries[0].value).toBe('bar');
  });

  it('returns empty array for empty content', () => {
    expect(parseEnvFile('')).toHaveLength(0);
    expect(parseEnvFile('\n\n')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// serializeEnvFile
// ---------------------------------------------------------------------------

describe('serializeEnvFile', () => {
  it('updates existing key value', () => {
    const original = 'FOO=old\nBAR=keep';
    const result = serializeEnvFile(original, { FOO: 'new' });
    expect(result).toBe('FOO=new\nBAR=keep');
  });

  it('preserves comments and ordering', () => {
    const original = '# Header comment\nFOO=old\n# Middle comment\nBAR=keep';
    const result = serializeEnvFile(original, { FOO: 'new' });
    expect(result).toBe('# Header comment\nFOO=new\n# Middle comment\nBAR=keep');
  });

  it('appends new keys not in original', () => {
    const original = 'FOO=bar';
    const result = serializeEnvFile(original, { NEW_KEY: 'value' });
    expect(result).toBe('FOO=bar\nNEW_KEY=value');
  });

  it('handles multiple updates at once', () => {
    const original = 'A=1\nB=2\nC=3';
    const result = serializeEnvFile(original, { A: 'x', C: 'z' });
    expect(result).toBe('A=x\nB=2\nC=z');
  });

  it('preserves blank lines', () => {
    const original = 'FOO=bar\n\nBAZ=qux';
    const result = serializeEnvFile(original, { BAZ: 'new' });
    expect(result).toBe('FOO=bar\n\nBAZ=new');
  });
});

// ---------------------------------------------------------------------------
// maskCredentialValue
// ---------------------------------------------------------------------------

describe('maskCredentialValue', () => {
  it('masks long values showing first 4 and last 4', () => {
    expect(maskCredentialValue('sk-ant-api03-abcdef1234567890')).toBe('sk-a****7890');
  });

  it('fully masks short values', () => {
    expect(maskCredentialValue('short')).toBe('****');
    expect(maskCredentialValue('12345678')).toBe('****');
  });

  it('handles empty string', () => {
    expect(maskCredentialValue('')).toBe('****');
  });

  it('masks value of exactly 9 characters', () => {
    const result = maskCredentialValue('123456789');
    expect(result).toBe('1234****6789');
  });

  it('handles very long values', () => {
    const long = 'a'.repeat(100);
    const result = maskCredentialValue(long);
    expect(result).toBe('aaaa****aaaa');
    expect(result.length).toBe(12);
  });
});
