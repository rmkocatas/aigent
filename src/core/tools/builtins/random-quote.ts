// ============================================================
// OpenClaw Deploy — Random Quote Tool
// ============================================================

import { randomInt } from 'node:crypto';
import type { ToolDefinition } from '../../../types/index.js';
import type { ToolHandler } from '../registry.js';

interface Quote {
  text: string;
  author: string;
  category: string;
}

const QUOTES: Quote[] = [
  // Inspirational
  { text: 'The only way to do great work is to love what you do.', author: 'Steve Jobs', category: 'inspirational' },
  { text: 'Innovation distinguishes between a leader and a follower.', author: 'Steve Jobs', category: 'inspirational' },
  { text: 'Stay hungry, stay foolish.', author: 'Steve Jobs', category: 'inspirational' },
  { text: 'The best time to plant a tree was 20 years ago. The second best time is now.', author: 'Chinese Proverb', category: 'inspirational' },
  { text: 'It does not matter how slowly you go as long as you do not stop.', author: 'Confucius', category: 'inspirational' },
  { text: 'Everything you can imagine is real.', author: 'Pablo Picasso', category: 'inspirational' },
  { text: 'What we think, we become.', author: 'Buddha', category: 'inspirational' },
  { text: 'The future belongs to those who believe in the beauty of their dreams.', author: 'Eleanor Roosevelt', category: 'inspirational' },
  { text: 'Do what you can, with what you have, where you are.', author: 'Theodore Roosevelt', category: 'inspirational' },
  { text: 'Believe you can and you are halfway there.', author: 'Theodore Roosevelt', category: 'inspirational' },
  { text: 'In the middle of difficulty lies opportunity.', author: 'Albert Einstein', category: 'inspirational' },
  { text: 'Happiness is not something ready made. It comes from your own actions.', author: 'Dalai Lama', category: 'inspirational' },

  // Funny
  { text: 'I am not superstitious, but I am a little stitious.', author: 'Michael Scott', category: 'funny' },
  { text: 'Before software can be reusable it first has to be usable.', author: 'Ralph Johnson', category: 'funny' },
  { text: 'A day without sunshine is like, you know, night.', author: 'Steve Martin', category: 'funny' },
  { text: 'I find that the harder I work, the more luck I seem to have.', author: 'Thomas Jefferson', category: 'funny' },
  { text: 'People say nothing is impossible, but I do nothing every day.', author: 'A.A. Milne', category: 'funny' },
  { text: "I'm not lazy. I'm on energy saving mode.", author: 'Unknown', category: 'funny' },
  { text: 'The road to success is always under construction.', author: 'Lily Tomlin', category: 'funny' },
  { text: 'If at first you don\'t succeed, then skydiving definitely isn\'t for you.', author: 'Steven Wright', category: 'funny' },
  { text: 'I told my wife she was drawing her eyebrows too high. She looked surprised.', author: 'Unknown', category: 'funny' },
  { text: 'My fake plants died because I did not pretend to water them.', author: 'Mitch Hedberg', category: 'funny' },

  // Wisdom
  { text: 'The unexamined life is not worth living.', author: 'Socrates', category: 'wisdom' },
  { text: 'Knowing yourself is the beginning of all wisdom.', author: 'Aristotle', category: 'wisdom' },
  { text: 'The only true wisdom is in knowing you know nothing.', author: 'Socrates', category: 'wisdom' },
  { text: 'Turn your wounds into wisdom.', author: 'Oprah Winfrey', category: 'wisdom' },
  { text: 'The mind is everything. What you think you become.', author: 'Buddha', category: 'wisdom' },
  { text: 'An investment in knowledge pays the best interest.', author: 'Benjamin Franklin', category: 'wisdom' },
  { text: 'The only thing I know is that I know nothing.', author: 'Socrates', category: 'wisdom' },
  { text: 'He who has a why to live can bear almost any how.', author: 'Friedrich Nietzsche', category: 'wisdom' },
  { text: 'We are what we repeatedly do. Excellence, then, is not an act, but a habit.', author: 'Aristotle', category: 'wisdom' },
  { text: 'Judge a man by his questions rather than by his answers.', author: 'Voltaire', category: 'wisdom' },

  // Tech
  { text: 'Any sufficiently advanced technology is indistinguishable from magic.', author: 'Arthur C. Clarke', category: 'tech' },
  { text: 'First, solve the problem. Then, write the code.', author: 'John Johnson', category: 'tech' },
  { text: 'Code is like humor. When you have to explain it, it\'s bad.', author: 'Cory House', category: 'tech' },
  { text: 'Make it work, make it right, make it fast.', author: 'Kent Beck', category: 'tech' },
  { text: 'Simplicity is the soul of efficiency.', author: 'Austin Freeman', category: 'tech' },
  { text: 'Talk is cheap. Show me the code.', author: 'Linus Torvalds', category: 'tech' },
  { text: 'Programs must be written for people to read, and only incidentally for machines to execute.', author: 'Harold Abelson', category: 'tech' },
  { text: 'The best error message is the one that never shows up.', author: 'Thomas Fuchs', category: 'tech' },
  { text: 'Deleted code is debugged code.', author: 'Jeff Sickel', category: 'tech' },
  { text: 'Perfection is achieved not when there is nothing more to add, but when there is nothing left to take away.', author: 'Antoine de Saint-Exupery', category: 'tech' },
  { text: 'There are only two hard things in Computer Science: cache invalidation and naming things.', author: 'Phil Karlton', category: 'tech' },
  { text: 'The most disastrous thing that you can ever learn is your first programming language.', author: 'Alan Kay', category: 'tech' },
];

export const randomQuoteDefinition: ToolDefinition = {
  name: 'random_quote',
  description: 'Get a random inspirational, funny, wisdom, or tech quote.',
  parameters: {
    type: 'object',
    properties: {
      category: { type: 'string', description: 'Filter by category.', enum: ['inspirational', 'funny', 'wisdom', 'tech'] },
    },
  },
};

export const randomQuoteHandler: ToolHandler = async (input) => {
  const category = input.category as string | undefined;
  let pool = QUOTES;

  if (category) {
    pool = QUOTES.filter((q) => q.category === category);
    if (pool.length === 0) {
      throw new Error(`Unknown category: ${category}. Use: inspirational, funny, wisdom, tech`);
    }
  }

  const idx = randomInt(pool.length);
  const quote = pool[idx];
  return `"${quote.text}"\n— ${quote.author}`;
};
