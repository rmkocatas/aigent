// ============================================================
// OpenClaw Deploy — Color Converter Tool
// ============================================================

import type { ToolDefinition } from '../../../types/index.js';
import type { ToolHandler } from '../registry.js';

interface RGB { r: number; g: number; b: number }
interface HSL { h: number; s: number; l: number }

function parseHex(color: string): RGB {
  const hex = color.replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
    throw new Error(`Invalid hex color: ${color}`);
  }
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}

function parseRgb(color: string): RGB {
  const match = color.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
  if (!match) throw new Error(`Invalid RGB format: ${color}`);
  const [, r, g, b] = match.map(Number);
  if (r > 255 || g > 255 || b > 255) throw new Error('RGB values must be 0-255');
  return { r, g, b };
}

function parseHsl(color: string): HSL {
  const match = color.match(/hsl\(\s*([\d.]+)\s*,\s*([\d.]+)%?\s*,\s*([\d.]+)%?\s*\)/i);
  if (!match) throw new Error(`Invalid HSL format: ${color}`);
  const h = Number(match[1]);
  const s = Number(match[2]);
  const l = Number(match[3]);
  if (h > 360 || s > 100 || l > 100) throw new Error('HSL values out of range');
  return { h, s, l };
}

function detectAndParseColor(color: string): { format: string; rgb: RGB } {
  const trimmed = color.trim();
  if (trimmed.startsWith('#')) {
    return { format: 'hex', rgb: parseHex(trimmed) };
  }
  if (/^rgb\(/i.test(trimmed)) {
    return { format: 'rgb', rgb: parseRgb(trimmed) };
  }
  if (/^hsl\(/i.test(trimmed)) {
    return { format: 'hsl', rgb: hslToRgb(parseHsl(trimmed)) };
  }
  // Try bare hex
  if (/^[0-9a-fA-F]{6}$/.test(trimmed)) {
    return { format: 'hex', rgb: parseHex(trimmed) };
  }
  throw new Error(`Cannot parse color: ${color}. Use #RRGGBB, rgb(r,g,b), or hsl(h,s%,l%)`);
}

function rgbToHex(rgb: RGB): string {
  const toHex = (n: number) => Math.round(n).toString(16).padStart(2, '0');
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`.toUpperCase();
}

function rgbToHsl(rgb: RGB): HSL {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

function hslToRgb(hsl: HSL): RGB {
  const h = hsl.h / 360;
  const s = hsl.s / 100;
  const l = hsl.l / 100;

  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }

  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;

  return {
    r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, h) * 255),
    b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  };
}

export const colorConverterDefinition: ToolDefinition = {
  name: 'color_converter',
  description: 'Convert colors between HEX, RGB, and HSL formats.',
  parameters: {
    type: 'object',
    properties: {
      color: { type: 'string', description: 'The color value (e.g. "#FF5733", "rgb(255,87,51)", "hsl(11,100%,60%)").' },
      to_format: { type: 'string', description: 'Target format.', enum: ['hex', 'rgb', 'hsl'] },
    },
    required: ['color', 'to_format'],
  },
};

export const colorConverterHandler: ToolHandler = async (input) => {
  const color = input.color as string;
  const toFormat = input.to_format as string;

  if (!color || typeof color !== 'string') throw new Error('Missing color');
  if (!toFormat) throw new Error('Missing to_format');

  const { rgb } = detectAndParseColor(color);

  switch (toFormat) {
    case 'hex':
      return rgbToHex(rgb);
    case 'rgb':
      return `rgb(${Math.round(rgb.r)}, ${Math.round(rgb.g)}, ${Math.round(rgb.b)})`;
    case 'hsl': {
      const hsl = rgbToHsl(rgb);
      return `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`;
    }
    default:
      throw new Error(`Unknown format: ${toFormat}. Use: hex, rgb, hsl`);
  }
};
