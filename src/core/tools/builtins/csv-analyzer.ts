// ============================================================
// OpenClaw Deploy — CSV Analyzer Tool
// ============================================================

import type { ToolDefinition } from '../../../types/index.js';
import type { ToolHandler } from '../registry.js';

const MAX_INPUT = 1_048_576; // 1MB
const MAX_ROWS = 10_000;
const MAX_COLS = 100;

function parseCSVLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

interface ColumnStats {
  name: string;
  count: number;
  min: number;
  max: number;
  sum: number;
  mean: number;
}

export const csvAnalyzerDefinition: ToolDefinition = {
  name: 'csv_analyzer',
  description: 'Parse CSV data and compute basic statistics (count, min, max, mean, sum) for numeric columns.',
  parameters: {
    type: 'object',
    properties: {
      csv: { type: 'string', description: 'The CSV data as a string.' },
      delimiter: { type: 'string', description: 'Column delimiter (default ",").' },
      has_header: { type: 'string', description: 'Whether first row is a header.', enum: ['true', 'false'] },
    },
    required: ['csv'],
  },
};

export const csvAnalyzerHandler: ToolHandler = async (input) => {
  const csv = input.csv as string;
  const delimiter = (input.delimiter as string) ?? ',';
  const hasHeader = (input.has_header as string) !== 'false';

  if (!csv || typeof csv !== 'string') throw new Error('Missing csv input');
  if (csv.length > MAX_INPUT) throw new Error('CSV too large (max 1MB)');

  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) throw new Error('Empty CSV');
  if (lines.length > MAX_ROWS + 1) throw new Error(`Too many rows (max ${MAX_ROWS})`);

  const headerRow = parseCSVLine(lines[0], delimiter);
  if (headerRow.length > MAX_COLS) throw new Error(`Too many columns (max ${MAX_COLS})`);

  const headers = hasHeader
    ? headerRow
    : headerRow.map((_, i) => `Column ${i + 1}`);

  const dataLines = hasHeader ? lines.slice(1) : lines;
  const colCount = headers.length;

  // Collect numeric values per column
  const numericCols: Map<number, number[]> = new Map();

  for (const line of dataLines) {
    const fields = parseCSVLine(line, delimiter);
    for (let i = 0; i < Math.min(fields.length, colCount); i++) {
      const val = Number(fields[i]);
      if (fields[i] !== '' && !isNaN(val) && isFinite(val)) {
        if (!numericCols.has(i)) numericCols.set(i, []);
        numericCols.get(i)!.push(val);
      }
    }
  }

  const output: string[] = [];
  output.push(`Rows: ${dataLines.length}, Columns: ${colCount}`);
  output.push(`Headers: ${headers.join(', ')}`);
  output.push('');

  if (numericCols.size === 0) {
    output.push('No numeric columns detected.');
    return output.join('\n');
  }

  output.push('Numeric Column Statistics:');
  output.push('─'.repeat(60));

  const stats: ColumnStats[] = [];
  for (const [idx, values] of numericCols) {
    if (values.length < dataLines.length * 0.5) continue; // Skip if less than 50% numeric
    const min = Math.min(...values);
    const max = Math.max(...values);
    const sum = values.reduce((a, b) => a + b, 0);
    stats.push({
      name: headers[idx],
      count: values.length,
      min,
      max,
      sum,
      mean: sum / values.length,
    });
  }

  if (stats.length === 0) {
    output.push('No predominantly numeric columns found.');
    return output.join('\n');
  }

  for (const s of stats) {
    output.push(`${s.name}:`);
    output.push(`  Count: ${s.count}`);
    output.push(`  Min: ${s.min}`);
    output.push(`  Max: ${s.max}`);
    output.push(`  Sum: ${parseFloat(s.sum.toFixed(4))}`);
    output.push(`  Mean: ${parseFloat(s.mean.toFixed(4))}`);
  }

  return output.join('\n');
};
