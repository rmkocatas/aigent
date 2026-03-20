// ============================================================
// OpenClaw Deploy — Telegram Poll Tool
// ============================================================

import type { ToolDefinition } from '../../../types/index.js';
import type { ToolHandler } from '../registry.js';

export const telegramPollDefinition: ToolDefinition = {
  name: 'telegram_poll',
  description: 'Send a native Telegram poll. Creates a poll with 2-10 options that users can vote on. Returns a marker that the pipeline extracts and sends as a real Telegram poll.',
  parameters: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'The poll question (1-300 characters)' },
      options: { type: 'array', description: 'Poll options (2-10 choices, each max 100 chars)', items: { type: 'string' } },
      is_anonymous: { type: 'boolean', description: 'Whether the poll is anonymous (default: true)' },
      allows_multiple_answers: { type: 'boolean', description: 'Allow selecting multiple options (default: false)' },
      type: { type: 'string', enum: ['regular', 'quiz'], description: 'Poll type — regular for voting, quiz for a single correct answer (default: regular)' },
      correct_option_id: { type: 'number', description: 'For quiz type only: 0-based index of the correct answer' },
    },
    required: ['question', 'options'],
  },
  routing: { useWhen: ['create a poll', 'run a vote', 'survey', 'quiz'] },
  categories: ['media'],
};

export const telegramPollHandler: ToolHandler = async (input) => {
  const question = String(input.question ?? '').trim();
  const options = input.options as string[] | undefined;
  const isAnonymous = input.is_anonymous as boolean | undefined;
  const allowsMultipleAnswers = input.allows_multiple_answers as boolean | undefined;
  const type = input.type as 'regular' | 'quiz' | undefined;
  const correctOptionId = input.correct_option_id as number | undefined;

  if (!question) throw new Error('question is required');
  if (question.length > 300) throw new Error('question must be 300 characters or less');
  if (!options || !Array.isArray(options) || options.length < 2) {
    throw new Error('at least 2 options are required');
  }
  if (options.length > 10) throw new Error('maximum 10 options allowed');

  for (const opt of options) {
    if (typeof opt !== 'string' || opt.length === 0 || opt.length > 100) {
      throw new Error('each option must be a non-empty string of 100 characters or less');
    }
  }

  if (type === 'quiz' && (correctOptionId == null || correctOptionId < 0 || correctOptionId >= options.length)) {
    throw new Error('quiz polls require a valid correct_option_id (0-based index)');
  }

  const payload = {
    question,
    options,
    ...(isAnonymous != null ? { isAnonymous } : {}),
    ...(allowsMultipleAnswers != null ? { allowsMultipleAnswers } : {}),
    ...(type ? { type } : {}),
    ...(correctOptionId != null ? { correctOptionId } : {}),
  };

  const marker = `<<TELEGRAM_POLL:${JSON.stringify(payload)}>>`;
  const optionsList = options.map((o, i) => `  ${i + 1}. ${o}`).join('\n');
  return `${marker}\nPoll created: "${question}"\nOptions:\n${optionsList}`;
};
