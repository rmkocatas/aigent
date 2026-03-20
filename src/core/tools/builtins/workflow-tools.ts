// ============================================================
// OpenClaw Deploy — Workflow Template Tools
// ============================================================
//
// Pre-built multi-step workflow templates that guide the user
// through common tasks. Templates are text prompts that the
// LLM uses to drive multi-step conversations.
// ============================================================

import type { ToolDefinition } from '../../../types/index.js';
import type { ToolHandler } from '../registry.js';

// ---------------------------------------------------------------------------
// Built-in workflow templates
// ---------------------------------------------------------------------------

interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  steps: string[];
  prompt: string;
}

const TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'morning-routine',
    name: 'Morning Routine',
    description: 'Daily morning briefing with weather, calendar, news, and tasks',
    steps: ['Get current date/time', 'Check weather', 'Show active reminders', 'Get news headlines', 'Recall user preferences'],
    prompt:
      'Execute my morning routine: ' +
      '1) Get the current date/time, ' +
      '2) Check the weather for my location, ' +
      '3) List my active reminders for today, ' +
      '4) Get top news headlines, ' +
      '5) Check if I have any recurring tasks due. ' +
      'Present everything in a concise daily briefing format.',
  },
  {
    id: 'project-setup',
    name: 'New Project Setup',
    description: 'Initialize a new project with recommended structure',
    steps: ['Create directory', 'Initialize package.json', 'Set up TypeScript', 'Create .gitignore', 'Add README'],
    prompt:
      'Help me set up a new project. Ask me: ' +
      '1) What type of project (Node.js, Python, etc.), ' +
      '2) The project name, ' +
      '3) Whether I want TypeScript. ' +
      'Then create the project structure with best practices.',
  },
  {
    id: 'code-review-full',
    name: 'Full Code Review',
    description: 'Comprehensive code review with security, performance, and quality checks',
    steps: ['Read git diff', 'Check for security issues', 'Check for performance issues', 'Review code quality', 'Suggest improvements'],
    prompt:
      'Perform a comprehensive code review. Ask me for the project path, then: ' +
      '1) Review the git diff for recent changes, ' +
      '2) Check for security vulnerabilities (OWASP top 10), ' +
      '3) Look for performance issues, ' +
      '4) Assess code quality and readability, ' +
      '5) Run dep_audit if it\'s a Node.js project. ' +
      'Provide a structured report with severity ratings.',
  },
  {
    id: 'research-deep',
    name: 'Deep Research',
    description: 'Multi-source research on a topic with synthesis',
    steps: ['Web search', 'Read top sources', 'Cross-reference', 'Save to knowledge base', 'Summarize findings'],
    prompt:
      'Help me research a topic thoroughly. Ask me what to research, then: ' +
      '1) Search the web for multiple perspectives, ' +
      '2) Read the top 3-5 sources using fetch_url, ' +
      '3) Cross-reference the information, ' +
      '4) Save the key sources to my knowledge base using web_clip, ' +
      '5) Provide a comprehensive synthesis with citations.',
  },
  {
    id: 'research-report',
    name: 'Research & Report',
    description: 'Full research pipeline: X/Twitter + web search, source reading, and professional PDF report delivery',
    steps: [
      'Compound research (X + web + fetch) via x_research',
      'Review findings and provide conversational summary',
    ],
    prompt:
      'Perform comprehensive research and deliver a professional PDF report.\n\n' +
      'Use x_research with these parameters:\n' +
      '  - topic: the research topic\n' +
      '  - max_x_results: 10\n' +
      '  - max_web_results: 6\n' +
      '  - fetch_top_n: 3\n' +
      '  - generate_pdf: true\n\n' +
      'This single tool call will search X/Twitter, search the web, fetch top sources, ' +
      'and generate a PDF report — all delivered automatically via Telegram.\n\n' +
      'After x_research returns, provide a conversational summary of the key findings, ' +
      'notable X/Twitter sentiment, and any disagreements between sources.\n\n' +
      'If x_research fails, fall back to using web_search + x_search + fetch_url + generate_pdf as separate steps.',
  },
  {
    id: 'research-presentation',
    name: 'Research & Presentation',
    description: 'Research a topic and deliver findings as a PowerPoint presentation',
    steps: [
      'Web search for sources',
      'Read top sources',
      'Synthesize findings',
      'Generate PPTX presentation',
    ],
    prompt:
      'Research a topic and create a PowerPoint presentation. Steps:\n' +
      '1) Use web_search to find 5-8 authoritative sources.\n' +
      '2) Use fetch_url to read the top 3-5 results.\n' +
      '3) Synthesize the information into key themes and talking points.\n' +
      '4) Use generate_presentation to create a PPTX with:\n' +
      '   - Title slide\n' +
      '   - Overview/agenda slide\n' +
      '   - 4-8 content slides with clear titles and bullet points\n' +
      '   - Key takeaways/summary slide\n' +
      '   - Sources slide\n' +
      '5) The presentation will be automatically delivered via Telegram.\n\n' +
      'Keep slides concise — max 5-6 bullet points per slide. Use clear, impactful titles.',
  },
  {
    id: 'weekly-review',
    name: 'Weekly Review',
    description: 'End-of-week review of reminders, notes, and progress',
    steps: ['Review completed reminders', 'Check active notes', 'Search memories', 'Plan next week'],
    prompt:
      'Do a weekly review: ' +
      '1) List all my active reminders, ' +
      '2) Show my recent notes, ' +
      '3) Recall any project progress from this week using memory_recall, ' +
      '4) Summarize what was accomplished, ' +
      '5) Help me plan priorities for next week.',
  },
  {
    id: 'debug-issue',
    name: 'Debug Helper',
    description: 'Systematic debugging workflow',
    steps: ['Understand the issue', 'Read relevant code', 'Identify root cause', 'Suggest fix', 'Generate tests'],
    prompt:
      'Help me debug an issue. Ask me: ' +
      '1) What\'s the error/unexpected behavior? ' +
      '2) What file/module is involved? ' +
      'Then systematically: read the code, trace the logic, identify the root cause, ' +
      'suggest a fix, and generate a test case to prevent regression.',
  },
];

// ---------------------------------------------------------------------------
// workflow_list
// ---------------------------------------------------------------------------

export const workflowListDefinition: ToolDefinition = {
  name: 'workflow_list',
  description: 'List available workflow templates. Each workflow is a pre-built multi-step task.',
  parameters: { type: 'object', properties: {} },
  routing: {
    useWhen: ['User asks about available workflows', 'User wants to see what automations are available'],
    avoidWhen: [],
  },
};

export const workflowListHandler: ToolHandler = async () => {
  const lines = TEMPLATES.map((t) => {
    const stepList = t.steps.map((s, i) => `  ${i + 1}. ${s}`).join('\n');
    return `**${t.name}** (${t.id})\n  ${t.description}\n${stepList}`;
  });

  return `Available workflows (${TEMPLATES.length}):\n\n${lines.join('\n\n')}\n\n` +
    'Use workflow_run with the workflow ID to start one.';
};

// ---------------------------------------------------------------------------
// workflow_run
// ---------------------------------------------------------------------------

export const workflowRunDefinition: ToolDefinition = {
  name: 'workflow_run',
  description: 'Start a workflow template. Returns instructions for the LLM to follow the multi-step workflow.',
  parameters: {
    type: 'object',
    properties: {
      workflow_id: {
        type: 'string',
        description: 'The workflow template ID to run',
      },
      context: {
        type: 'string',
        description: 'Optional additional context or parameters for the workflow',
      },
    },
    required: ['workflow_id'],
  },
  routing: {
    useWhen: ['User wants to run a workflow', 'User mentions a workflow by name or ID'],
    avoidWhen: ['User wants to list workflows (use workflow_list)'],
  },
};

export const workflowRunHandler: ToolHandler = async (input) => {
  const workflowId = input.workflow_id as string;
  const extraContext = input.context as string | undefined;

  if (!workflowId) throw new Error('Missing workflow_id');

  const template = TEMPLATES.find((t) => t.id === workflowId);
  if (!template) {
    const ids = TEMPLATES.map((t) => t.id).join(', ');
    throw new Error(`Unknown workflow: ${workflowId}. Available: ${ids}`);
  }

  let prompt = template.prompt;
  if (extraContext) {
    prompt += `\n\nAdditional context from the user: ${extraContext}`;
  }

  return prompt;
};
