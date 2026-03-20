// ============================================================
// OpenClaw Deploy — Autonomous Task Planner
// ============================================================

import { randomUUID } from 'node:crypto';
import type { Subtask, SafetyTier, AutonomousConfig } from './types.js';
import type { ChatPipelineDeps } from '../../gateway/chat-pipeline.js';
import { processChatMessage } from '../../gateway/chat-pipeline.js';
import { classifyToolSafety } from './safety-classifier.js';

// The system prompt is built dynamically per call so we can inject tool names
function buildPlanningSystemPrompt(toolNames: string[]): string {
  const toolList = toolNames.length > 0
    ? toolNames.join(', ')
    : 'project_read_file, project_write_file, run_code, web_search, fetch_url, generate_image, and other utility tools';

  return `You are an AI task planner. Given a goal, decompose it into concrete, actionable subtasks.

Rules:
1. Each subtask must be a SINGLE, SPECIFIC action — not a compound task. Break complex work into multiple steps.
2. Use as many subtasks as needed to accomplish the goal properly. Aim for thoroughness — don't combine unrelated steps just to reduce count. Simple goals may need 3-5 subtasks; complex projects may need 15-25+.
3. Each subtask's "prompt" must be a clear instruction that tells the AI assistant EXACTLY what to do and which tools to use. Be specific about file paths, tool names, and expected outputs.
4. Available tools: ${toolList}
5. Subtasks with no dependencies can run in PARALLEL — only add depends_on when output from a previous step is truly needed. Maximize parallelism.
6. For multi-file coding projects, you MUST follow this structure:
   a) The FIRST subtask (index 0) MUST be "Architecture Definition" — use project_write_file to create an ARCHITECTURE.md file that defines: the exact directory structure, every file path to be created, every class/function name with full signatures (parameter names, types, return types), all import statements between modules, and naming conventions. Use output_key "architecture". Agent: "coder".
   b) ALL implementation subtasks MUST include 0 in their depends_on array so they receive the architecture definition as context.
   c) Each implementation subtask's prompt MUST include: "Follow the architecture definition exactly — use the specified file paths, class names, method signatures, and import statements. Do not deviate."
   d) The LAST subtask MUST be "Integration Verification" — read ALL created files using project_read_file, verify every import resolves to a real file, verify constructor/function call signatures match their definitions, verify all __init__.py or index files exist, and FIX any inconsistencies using project_write_file. This subtask depends on ALL implementation subtasks. Agent: "coder".
7. If the goal seems unsafe or impossible, respond with REFUSE: <reason>
8. Quality over brevity — the goal MUST be fully accomplished. Every file, feature, and verification step should have its own subtask.

For each subtask, specify:
- description: What this subtask does (concise, human-readable)
- prompt: The EXACT instruction to give the AI assistant. Be specific: mention tool names, file paths, expected output.
- tools_likely: Which tools this subtask will need
- depends_on: Array of 0-based indices of prerequisite subtasks ([] if independent)
- output_key: Short key name for this subtask's result (optional)
- agent: "researcher" (web), "coder" (code), "analyst" (data), or "generalist" (default)

Respond ONLY with valid JSON (no markdown, no explanation):
{
  "plan_summary": "Brief approach description",
  "subtasks": [
    {
      "description": "...",
      "prompt": "...",
      "tools_likely": ["tool1", "tool2"],
      "depends_on": [],
      "output_key": "key",
      "agent": "generalist"
    }
  ]
}`;
}

const TIER_ORDER: SafetyTier[] = ['safe', 'moderate', 'sensitive', 'dangerous'];

export interface PlanResult {
  planSummary: string;
  subtasks: Subtask[];
  tokensUsed: number;
}

export interface PlanRefusal {
  refused: true;
  reason: string;
}

export async function planTask(
  goal: string,
  taskId: string,
  deps: ChatPipelineDeps,
  config: AutonomousConfig,
): Promise<PlanResult | PlanRefusal> {
  // Collect available tool names from the registry for context-aware planning
  const toolNames: string[] = deps.toolRegistry?.allToolNames ?? [];

  const systemPrompt = buildPlanningSystemPrompt(toolNames);
  const planningPrompt = `Goal to decompose into subtasks:\n\n${goal}`;
  const planningConversationId = `autonomous-planning-${randomUUID()}`;

  // Clean pipeline: override system prompt, disable context injectors.
  // We inject tool awareness directly in the system prompt above instead of through
  // pipeline machinery (memory, strategies, persona) which adds formatting that
  // breaks JSON-only output.
  // In single routing mode, use the configured Ollama model instead of cloud Anthropic.
  const isSingleMode = deps.config.routing?.mode === 'single';
  const planningRouting = isSingleMode
    ? deps.config.routing
    : {
        mode: 'hybrid' as const,
        primary: 'anthropic' as const,
        rules: [
          { condition: 'simple', provider: 'anthropic', model: 'claude-sonnet-4-5-20250929' },
          { condition: 'default', provider: 'anthropic', model: 'claude-sonnet-4-5-20250929' },
          { condition: 'tool_simple', provider: 'anthropic', model: 'claude-sonnet-4-5-20250929' },
          { condition: 'coding', provider: 'anthropic', model: 'claude-sonnet-4-5-20250929' },
          { condition: 'complex', provider: 'anthropic', model: 'claude-sonnet-4-5-20250929' },
          { condition: 'web_content', provider: 'anthropic', model: 'claude-sonnet-4-5-20250929' },
        ],
      };
  const planningDeps: ChatPipelineDeps = {
    ...deps,
    config: {
      ...deps.config,
      systemPrompt,
      routing: planningRouting,
    },
    // No tools for the planner — it should only output a JSON plan
    toolRegistry: undefined,
    // Disable pipeline context injectors — we provide context in the system prompt instead
    memoryEngine: undefined,
    strategyEngine: undefined,
    skillLoader: undefined,
    personaManager: undefined,
    documentMemory: undefined,
    responseCache: undefined,
  };

  const result = await processChatMessage(
    {
      message: planningPrompt,
      conversationId: planningConversationId,
      source: 'api',
    },
    planningDeps,
  );

  const responseText = result.response.trim();

  // Check for refusal
  if (responseText.startsWith('REFUSE:')) {
    return { refused: true, reason: responseText.slice(7).trim() };
  }

  // Extract JSON from response (may be wrapped in code fences)
  let jsonText: string | null = null;

  // Strategy 1: Match content between ```json ... ``` fences
  const fenceMatch = responseText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (fenceMatch) {
    jsonText = fenceMatch[1];
  }

  // Strategy 2: Find the outermost { ... } block
  if (!jsonText) {
    const braceMatch = responseText.match(/\{[\s\S]*\}/);
    if (braceMatch) {
      jsonText = braceMatch[0];
    }
  }

  // Fallback: single-subtask plan when structured planning fails
  const makeFallbackPlan = (reason: string): PlanResult => {
    console.warn(`[planner] ${reason}, falling back to single-subtask plan`);
    console.warn(`[planner] LLM response (first 500 chars): ${responseText.slice(0, 500)}`);
    return {
      planSummary: 'Direct execution (planning fallback)',
      subtasks: [{
        id: randomUUID(),
        parentTaskId: taskId,
        index: 0,
        description: goal.slice(0, 200),
        prompt: goal,
        safetyTier: 'moderate' as SafetyTier,
        status: 'pending' as const,
        toolsUsed: [],
        tokensUsed: 0,
        depth: 0,
      }],
      tokensUsed: Math.ceil((planningPrompt.length + responseText.length) / 4),
    };
  };

  if (!jsonText) {
    return makeFallbackPlan('No JSON found in LLM response');
  }

  let parsed: {
    plan_summary: string;
    subtasks: Array<{
      description: string;
      prompt: string;
      tools_likely: string[];
      depends_on?: number[];
      output_key?: string;
      agent?: string;
    }>;
  };

  try {
    parsed = JSON.parse(jsonText);
  } catch (parseErr) {
    console.error('[planner] JSON parse error:', (parseErr as Error).message, '\nExtracted text:', jsonText.slice(0, 500));
    return makeFallbackPlan('JSON parse error in LLM response');
  }

  if (!parsed.subtasks || parsed.subtasks.length === 0) {
    return makeFallbackPlan('Planning produced zero subtasks');
  }

  console.log(`[planner] Plan decomposed into ${parsed.subtasks.length} subtasks`);

  // Convert to Subtask objects with safety classification
  const subtasks: Subtask[] = parsed.subtasks.map((s, i) => {
    // Determine safety tier from the most dangerous tool likely used
    const tiers: SafetyTier[] = (s.tools_likely ?? []).map((t) =>
      classifyToolSafety(t, config.safetyTierOverrides),
    );
    const maxTier = tiers.reduce(
      (max, t) => (TIER_ORDER.indexOf(t) > TIER_ORDER.indexOf(max) ? t : max),
      'safe' as SafetyTier,
    );

    // Validate depends_on indices
    const validDeps = (s.depends_on ?? []).filter(
      (d) => d >= 0 && d < parsed.subtasks.length && d !== i,
    );

    return {
      id: randomUUID(),
      parentTaskId: taskId,
      index: i,
      description: s.description,
      prompt: s.prompt,
      safetyTier: maxTier,
      status: 'pending' as const,
      toolsUsed: [],
      tokensUsed: 0,
      depth: 0,
      dependsOn: validDeps.length > 0 ? validDeps : undefined,
      outputKey: s.output_key || undefined,
      agentProfile: s.agent && s.agent !== 'generalist' ? s.agent : undefined,
    };
  });

  const estimatedPlanTokens = Math.ceil((planningPrompt.length + responseText.length) / 4);

  return {
    planSummary: parsed.plan_summary,
    subtasks,
    tokensUsed: estimatedPlanTokens,
  };
}
