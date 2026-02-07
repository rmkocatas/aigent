// ============================================================
// OpenClaw Deploy — Unit Converter Tool
// ============================================================

import type { ToolDefinition } from '../../../types/index.js';
import type { ToolHandler } from '../registry.js';

type ConversionTable = Record<string, number>;

const LENGTH: ConversionTable = {
  mm: 0.001, cm: 0.01, m: 1, km: 1000, in: 0.0254, ft: 0.3048,
  yd: 0.9144, mi: 1609.344, nm: 1852, mil: 0.0000254,
};

const WEIGHT: ConversionTable = {
  mg: 0.000001, g: 0.001, kg: 1, t: 1000, oz: 0.028349523125,
  lb: 0.45359237, st: 6.35029318,
};

const DATA: ConversionTable = {
  b: 1, kb: 1024, mb: 1048576, gb: 1073741824, tb: 1099511627776,
  bit: 0.125, kbit: 128, mbit: 131072, gbit: 134217728,
};

const TIME: ConversionTable = {
  ms: 0.001, s: 1, min: 60, h: 3600, d: 86400, wk: 604800, yr: 31536000,
};

const SPEED: ConversionTable = {
  'km/h': 1 / 3.6, 'm/s': 1, mph: 0.44704, kn: 0.514444, 'ft/s': 0.3048,
};

const AREA: ConversionTable = {
  mm2: 1e-6, cm2: 1e-4, m2: 1, km2: 1e6, ha: 10000, acre: 4046.8564224,
  in2: 0.00064516, ft2: 0.09290304, yd2: 0.83612736, mi2: 2589988.110336,
};

const VOLUME: ConversionTable = {
  ml: 0.001, l: 1, m3: 1000, gal: 3.785411784, qt: 0.946352946,
  pt: 0.473176473, cup: 0.2365882365, floz: 0.0295735296, tbsp: 0.0147867648,
  tsp: 0.00492892159,
};

const CATEGORIES: Record<string, ConversionTable> = {
  length: LENGTH, weight: WEIGHT, data_size: DATA, time: TIME,
  speed: SPEED, area: AREA, volume: VOLUME,
};

function findCategory(unit: string): [string, ConversionTable] | null {
  for (const [name, table] of Object.entries(CATEGORIES)) {
    if (unit in table) return [name, table];
  }
  return null;
}

function convertTemperature(value: number, from: string, to: string): number {
  // Normalize to Celsius first
  let celsius: number;
  switch (from) {
    case 'c': celsius = value; break;
    case 'f': celsius = (value - 32) * 5 / 9; break;
    case 'k': celsius = value - 273.15; break;
    default: throw new Error(`Unknown temperature unit: ${from}`);
  }
  // Convert from Celsius to target
  switch (to) {
    case 'c': return celsius;
    case 'f': return celsius * 9 / 5 + 32;
    case 'k': return celsius + 273.15;
    default: throw new Error(`Unknown temperature unit: ${to}`);
  }
}

const TEMP_UNITS = new Set(['c', 'f', 'k']);

export const unitConverterDefinition: ToolDefinition = {
  name: 'unit_converter',
  description: 'Convert between units of measurement. Supports length, weight, temperature, data size, time, speed, area, and volume.',
  parameters: {
    type: 'object',
    properties: {
      value: { type: 'number', description: 'The numeric value to convert.' },
      from_unit: { type: 'string', description: 'Source unit (e.g. km, lb, f, gb, h).' },
      to_unit: { type: 'string', description: 'Target unit (e.g. mi, kg, c, mb, min).' },
    },
    required: ['value', 'from_unit', 'to_unit'],
  },
};

export const unitConverterHandler: ToolHandler = async (input) => {
  const value = input.value as number;
  const from = (input.from_unit as string).toLowerCase().trim();
  const to = (input.to_unit as string).toLowerCase().trim();

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('Missing or invalid value');
  }
  if (!from) throw new Error('Missing from_unit');
  if (!to) throw new Error('Missing to_unit');

  if (from === to) return `${value} ${from} = ${value} ${to}`;

  // Temperature special case
  if (TEMP_UNITS.has(from) && TEMP_UNITS.has(to)) {
    const result = convertTemperature(value, from, to);
    return `${value} ${from.toUpperCase()} = ${parseFloat(result.toFixed(6))} ${to.toUpperCase()}`;
  }

  const fromCat = findCategory(from);
  const toCat = findCategory(to);

  if (!fromCat) throw new Error(`Unknown unit: ${from}`);
  if (!toCat) throw new Error(`Unknown unit: ${to}`);
  if (fromCat[0] !== toCat[0]) {
    throw new Error(`Cannot convert between ${fromCat[0]} and ${toCat[0]}`);
  }

  const table = fromCat[1];
  const baseValue = value * table[from];
  const result = baseValue / table[to];

  return `${value} ${from} = ${parseFloat(result.toFixed(6))} ${to}`;
};
