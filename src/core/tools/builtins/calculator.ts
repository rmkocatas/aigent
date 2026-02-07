// ============================================================
// OpenClaw Deploy — Calculator Tool
// ============================================================

import type { ToolDefinition } from '../../../types/index.js';
import type { ToolHandler } from '../registry.js';

export const calculatorDefinition: ToolDefinition = {
  name: 'calculator',
  description: 'Evaluate a mathematical expression. Supports basic arithmetic (+, -, *, /, %), exponentiation (**), parentheses, and common math functions (sqrt, abs, sin, cos, tan, log, ceil, floor, round, pow, min, max, PI, E).',
  parameters: {
    type: 'object',
    properties: {
      expression: {
        type: 'string',
        description: 'The math expression to evaluate (e.g. "2 ** 64", "sqrt(144)", "sin(PI / 2)").',
      },
    },
    required: ['expression'],
  },
};

// Allowed identifiers for safe math evaluation
const ALLOWED_MATH: Record<string, unknown> = {
  Math,
  abs: Math.abs,
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  log: Math.log,
  log2: Math.log2,
  log10: Math.log10,
  exp: Math.exp,
  ceil: Math.ceil,
  floor: Math.floor,
  round: Math.round,
  pow: Math.pow,
  min: Math.min,
  max: Math.max,
  PI: Math.PI,
  E: Math.E,
  Infinity,
};

export const calculatorHandler: ToolHandler = async (input) => {
  const expr = input.expression as string;
  if (!expr || typeof expr !== 'string') {
    throw new Error('Missing expression');
  }

  // Validate: only allow math-safe characters and identifiers
  const sanitized = expr.trim();
  if (sanitized.length > 500) {
    throw new Error('Expression too long (max 500 characters)');
  }

  // Block dangerous patterns
  const dangerous = /\b(eval|Function|require|import|export|process|global|window|document|fetch|XMLHttpRequest|setTimeout|setInterval)\b/;
  if (dangerous.test(sanitized)) {
    throw new Error('Expression contains disallowed keywords');
  }

  // Block assignment, property access chains, template literals
  if (/[=`\[\]]/.test(sanitized) || /\.\s*[a-zA-Z]/.test(sanitized)) {
    throw new Error('Expression contains disallowed syntax');
  }

  try {
    // Build a safe evaluation context
    const argNames = Object.keys(ALLOWED_MATH);
    const argValues = Object.values(ALLOWED_MATH);
    const fn = new Function(...argNames, `"use strict"; return (${sanitized});`);
    const result = fn(...argValues);

    if (typeof result === 'number' || typeof result === 'bigint') {
      return String(result);
    }
    throw new Error('Expression did not evaluate to a number');
  } catch (err) {
    if (err instanceof Error && err.message === 'Expression did not evaluate to a number') {
      throw err;
    }
    throw new Error(`Invalid expression: ${(err as Error).message}`);
  }
};
