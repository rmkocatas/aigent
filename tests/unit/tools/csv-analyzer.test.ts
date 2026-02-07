import { describe, it, expect } from 'vitest';
import { csvAnalyzerHandler } from '../../../src/core/tools/builtins/csv-analyzer.js';
import type { ToolContext } from '../../../src/core/tools/registry.js';

const ctx: ToolContext = {
  workspaceDir: '/tmp', memoryDir: '/tmp/mem', conversationId: 'test', userId: 'u1', maxExecutionMs: 5000,
};

describe('csv_analyzer tool', () => {
  it('analyzes simple numeric CSV', async () => {
    const csv = 'name,score,age\nAlice,95,25\nBob,87,30\nCarol,92,22';
    const r = await csvAnalyzerHandler({ csv }, ctx);
    expect(r).toContain('Rows: 3');
    expect(r).toContain('Columns: 3');
    expect(r).toContain('score');
    expect(r).toContain('Min:');
    expect(r).toContain('Max:');
    expect(r).toContain('Mean:');
  });

  it('handles CSV without header', async () => {
    const csv = '10,20,30\n40,50,60';
    const r = await csvAnalyzerHandler({ csv, has_header: 'false' }, ctx);
    expect(r).toContain('Rows: 2');
    expect(r).toContain('Column 1');
  });

  it('handles custom delimiter', async () => {
    const csv = 'a;b;c\n1;2;3\n4;5;6';
    const r = await csvAnalyzerHandler({ csv, delimiter: ';' }, ctx);
    expect(r).toContain('Rows: 2');
  });

  it('detects non-numeric columns', async () => {
    const csv = 'name,city\nAlice,NYC\nBob,LA';
    const r = await csvAnalyzerHandler({ csv }, ctx);
    expect(r).toContain('No numeric columns detected');
  });

  it('handles quoted fields', async () => {
    const csv = 'name,value\n"Alice, Jr.",100\n"Bob ""B""",200';
    const r = await csvAnalyzerHandler({ csv }, ctx);
    expect(r).toContain('Rows: 2');
    expect(r).toContain('value');
  });

  it('computes correct stats', async () => {
    const csv = 'val\n10\n20\n30';
    const r = await csvAnalyzerHandler({ csv }, ctx);
    expect(r).toContain('Min: 10');
    expect(r).toContain('Max: 30');
    expect(r).toContain('Sum: 60');
    expect(r).toContain('Mean: 20');
    expect(r).toContain('Count: 3');
  });

  it('throws for empty CSV', async () => {
    await expect(csvAnalyzerHandler({ csv: '' }, ctx)).rejects.toThrow();
  });

  it('throws for missing input', async () => {
    await expect(csvAnalyzerHandler({}, ctx)).rejects.toThrow('Missing');
  });

  it('handles single row with header', async () => {
    const csv = 'a,b\n1,2';
    const r = await csvAnalyzerHandler({ csv }, ctx);
    expect(r).toContain('Rows: 1');
  });

  it('handles mixed numeric and text columns', async () => {
    const csv = 'name,age,city\nAlice,25,NYC\nBob,30,LA\nCarol,28,SF';
    const r = await csvAnalyzerHandler({ csv }, ctx);
    expect(r).toContain('age');
  });

  it('handles negative numbers', async () => {
    const csv = 'val\n-10\n0\n10';
    const r = await csvAnalyzerHandler({ csv }, ctx);
    expect(r).toContain('Min: -10');
    expect(r).toContain('Mean: 0');
  });
});
