// ============================================================
// OpenClaw Deploy — Video Generation Tool
// ============================================================
//
// Provider cascade: Pollinations.ai → HuggingFace
// Pushes the result to collectedFiles for delivery.
// ============================================================

import type { ToolDefinition } from '../../../types/index.js';
import type { ToolHandler } from '../registry.js';

// ---------------------------------------------------------------------------
// Definition
// ---------------------------------------------------------------------------

export const videoGeneratorDefinition: ToolDefinition = {
  name: 'generate_video',
  description:
    'Generate a short video clip from a text prompt. The video is automatically delivered ' +
    'as an MP4 attachment. Generation takes 30–120 seconds depending on duration and model.',
  parameters: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'Text description of the video to generate (max 1000 chars)',
      },
      duration: {
        type: 'number',
        description: 'Video duration in seconds (2–10, default 5)',
      },
      aspect_ratio: {
        type: 'string',
        description: 'Aspect ratio: "16:9" (landscape, default) or "9:16" (portrait)',
        enum: ['16:9', '9:16'],
      },
      model: {
        type: 'string',
        description:
          'Model to use: "wan" (Alibaba, high quality, default), ' +
          '"seedance" (BytePlus, fast), or "ltx-2" (fast with audio)',
        enum: ['wan', 'seedance', 'ltx-2'],
      },
    },
    required: ['prompt'],
  },
  routing: {
    useWhen: ['User explicitly asks to create, generate, or make a video or animation'],
    avoidWhen: ['User asks to analyze, summarize, or describe a video', 'User is asking about video editing conceptually'],
  },
};

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

const MIN_INTERVAL_MS = 30_000; // 30s between requests per user
const lastRequestByUser = new Map<string, number>();

async function throttle(userKey: string): Promise<void> {
  const lastTime = lastRequestByUser.get(userKey) ?? 0;
  const elapsed = Date.now() - lastTime;
  if (elapsed < MIN_INTERVAL_MS) {
    await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS - elapsed));
  }
  lastRequestByUser.set(userKey, Date.now());
}

// ---------------------------------------------------------------------------
// Provider: Pollinations.ai
// ---------------------------------------------------------------------------

async function tryPollinations(
  prompt: string,
  duration: number,
  aspectRatio: string,
  model: string,
  userKey: string,
): Promise<Buffer | null> {
  try {
    await throttle(userKey);

    const encoded = encodeURIComponent(prompt);
    const seed = Math.floor(Math.random() * 1_000_000);
    const url = `https://gen.pollinations.ai/image/${encoded}?model=${model}&duration=${duration}&aspectRatio=${aspectRatio}&nologo=true&seed=${seed}`;

    console.log(`[video-gen] Pollinations (${model}): generating ${duration}s video...`);
    const res = await fetch(url, {
      signal: AbortSignal.timeout(180_000), // 3 min timeout for video
      redirect: 'follow',
      headers: {
        // Send API key if available for higher priority
        ...(process.env.POLLINATIONS_API_KEY
          ? { Authorization: `Bearer ${process.env.POLLINATIONS_API_KEY}` }
          : {}),
      },
    });

    if (!res.ok) {
      console.log(`[video-gen] Pollinations: HTTP ${res.status}`);
      return null;
    }

    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('video')) {
      console.log(`[video-gen] Pollinations: unexpected content-type ${contentType}`);
      return null;
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < 10_000) {
      console.log(`[video-gen] Pollinations: response too small (${buffer.length} bytes)`);
      return null;
    }

    console.log(`[video-gen] Pollinations: success (${(buffer.length / 1024 / 1024).toFixed(1)} MB)`);
    return buffer;
  } catch (err) {
    console.log(`[video-gen] Pollinations: failed - ${(err as Error).message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Provider: HuggingFace Inference API
// ---------------------------------------------------------------------------

async function tryHuggingFace(prompt: string, userKey: string): Promise<Buffer | null> {
  const hfToken = process.env.HF_TOKEN;
  if (!hfToken) return null;

  try {
    await throttle(userKey);

    console.log('[video-gen] HuggingFace: generating video via FLUX-schnell...');
    const res = await fetch(
      'https://router.huggingface.co/hf-inference/models/Lightricks/LTX-Video',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${hfToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ inputs: prompt }),
        signal: AbortSignal.timeout(180_000),
      },
    );

    if (!res.ok) {
      console.log(`[video-gen] HuggingFace: HTTP ${res.status}`);
      return null;
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < 10_000) {
      console.log(`[video-gen] HuggingFace: response too small (${buffer.length} bytes)`);
      return null;
    }

    console.log(`[video-gen] HuggingFace: success (${(buffer.length / 1024 / 1024).toFixed(1)} MB)`);
    return buffer;
  } catch (err) {
    console.log(`[video-gen] HuggingFace: failed - ${(err as Error).message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const videoGeneratorHandler: ToolHandler = async (input, context) => {
  const prompt = input.prompt as string | undefined;
  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    throw new Error('Missing required parameter: prompt');
  }
  if (prompt.length > 1000) {
    throw new Error(`Prompt too long (${prompt.length} chars, max 1000)`);
  }

  const duration = Math.min(10, Math.max(2, Number(input.duration) || 5));
  const aspectRatio = (input.aspect_ratio as string) === '9:16' ? '9:16' : '16:9';
  const model = ['wan', 'seedance', 'ltx-2'].includes(input.model as string)
    ? (input.model as string)
    : 'wan';
  const userKey = context?.userId ?? '_global';

  // Provider cascade
  const pollResult = await tryPollinations(prompt, duration, aspectRatio, model, userKey);
  if (pollResult) {
    if (context.collectedFiles) {
      context.collectedFiles.push({
        filename: `video-${Date.now()}.mp4`,
        mimeType: 'video/mp4',
        data: pollResult,
        caption: prompt.slice(0, 200),
      });
    }
    return `Video generated successfully (${(pollResult.length / 1024 / 1024).toFixed(1)} MB, ${duration}s, ${model} model). The video will be sent as an attachment.`;
  }

  const hfResult = await tryHuggingFace(prompt, userKey);
  if (hfResult) {
    if (context.collectedFiles) {
      context.collectedFiles.push({
        filename: `video-${Date.now()}.mp4`,
        mimeType: 'video/mp4',
        data: hfResult,
        caption: prompt.slice(0, 200),
      });
    }
    return `Video generated successfully (${(hfResult.length / 1024 / 1024).toFixed(1)} MB). The video will be sent as an attachment.`;
  }

  throw new Error(
    'All video generation providers failed. Ensure at least one is available: ' +
    'Pollinations.ai (no config needed), or HuggingFace (HF_TOKEN env var).',
  );
};
