// ============================================================
// OpenClaw Deploy — Image Generation Tool
// ============================================================
//
// Provider cascade: Pollinations.ai → HuggingFace → Local SD
// Returns markers that the chat pipeline extracts as images.
// ============================================================

import type { ToolDefinition } from '../../../types/index.js';
import type { ToolHandler } from '../registry.js';

// ---------------------------------------------------------------------------
// Definition
// ---------------------------------------------------------------------------

export const imageGeneratorDefinition: ToolDefinition = {
  name: 'generate_image',
  description:
    'Generate an image from a text prompt. Returns the generated image which will be sent as a photo.',
  parameters: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'Text description of the image to generate (max 1000 chars)',
      },
      width: {
        type: 'number',
        description: 'Image width in pixels (256–1024, default 1024)',
      },
      height: {
        type: 'number',
        description: 'Image height in pixels (256–1024, default 1024)',
      },
      model: {
        type: 'string',
        description: 'Model to use: "flux" (high quality) or "turbo" (faster)',
        enum: ['flux', 'turbo'],
      },
    },
    required: ['prompt'],
  },
  routing: {
    useWhen: ['User explicitly asks to create, generate, or draw an image or picture'],
    avoidWhen: ['User asks you to describe or explain an image', 'User is asking about image editing or formats conceptually'],
  },
};

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

const POLLINATIONS_MIN_INTERVAL_MS = 15_000;
const HF_MIN_INTERVAL_MS = 2_000;

// Per-user rate limiters
const lastPollinationsByUser = new Map<string, number>();
const lastHfByUser = new Map<string, number>();

/** @internal Reset rate limits for testing */
export function _resetRateLimits(): void {
  lastPollinationsByUser.clear();
  lastHfByUser.clear();
}

async function throttle(rateMap: Map<string, number>, userKey: string, minInterval: number): Promise<void> {
  const lastTime = rateMap.get(userKey) ?? 0;
  const elapsed = Date.now() - lastTime;
  if (elapsed < minInterval) {
    await new Promise((r) => setTimeout(r, minInterval - elapsed));
  }
  rateMap.set(userKey, Date.now());
}

// ---------------------------------------------------------------------------
// Provider: Pollinations.ai (free, no key)
// ---------------------------------------------------------------------------

async function tryPollinations(
  prompt: string,
  width: number,
  height: number,
  model: string,
  userKey: string,
): Promise<string | null> {
  try {
    await throttle(lastPollinationsByUser, userKey, POLLINATIONS_MIN_INTERVAL_MS);

    const encoded = encodeURIComponent(prompt);
    const seed = Math.floor(Math.random() * 1_000_000);
    const url = `https://image.pollinations.ai/prompt/${encoded}?model=${model}&width=${width}&height=${height}&nologo=true&seed=${seed}`;

    // Download the image directly — Pollinations generates on-the-fly (20-30s)
    console.log(`[image-gen] Pollinations: generating image (seed=${seed})...`);
    const res = await fetch(url, {
      signal: AbortSignal.timeout(120_000),
      redirect: 'follow',
    });

    if (!res.ok) {
      console.log(`[image-gen] Pollinations: HTTP ${res.status}`);
      return null;
    }

    // Validate content type is actually an image
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.startsWith('image/')) {
      console.log(`[image-gen] Pollinations: unexpected content-type "${contentType}"`);
      return null;
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < 1000) {
      console.log(`[image-gen] Pollinations: response too small (${buffer.length} bytes)`);
      return null;
    }

    console.log(`[image-gen] Pollinations: success (${buffer.length} bytes, ${contentType})`);
    return `<<IMAGE_BASE64:${buffer.toString('base64')}>>`;
  } catch (err) {
    console.log(`[image-gen] Pollinations: failed - ${(err as Error).message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Provider: HuggingFace Inference API (free with HF_TOKEN)
// ---------------------------------------------------------------------------

async function tryHuggingFace(prompt: string, userKey: string): Promise<string | null> {
  const hfToken = process.env.HF_TOKEN;
  if (!hfToken) return null;

  try {
    await throttle(lastHfByUser, userKey, HF_MIN_INTERVAL_MS);

    const res = await fetch(
      'https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${hfToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ inputs: prompt }),
        signal: AbortSignal.timeout(60_000),
      },
    );

    if (!res.ok) {
      console.log(`[image-gen] HuggingFace: HTTP ${res.status}`);
      return null;
    }

    const hfContentType = res.headers.get('content-type') ?? '';
    if (!hfContentType.startsWith('image/')) {
      console.log(`[image-gen] HuggingFace: unexpected content-type "${hfContentType}"`);
      return null;
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    console.log(`[image-gen] HuggingFace: success (${buffer.length} bytes)`);
    return `<<IMAGE_BASE64:${buffer.toString('base64')}>>`;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Provider: Local Stable Diffusion (Automatic1111 WebUI --api)
// ---------------------------------------------------------------------------

async function tryLocalSD(
  prompt: string,
  width: number,
  height: number,
): Promise<string | null> {
  const sdUrl = process.env.SD_API_URL;
  if (!sdUrl) return null;

  try {
    const res = await fetch(`${sdUrl}/sdapi/v1/txt2img`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        steps: 20,
        width,
        height,
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!res.ok) return null;

    const data = (await res.json()) as { images?: string[] };
    if (data.images && data.images[0]) {
      return `<<IMAGE_BASE64:${data.images[0]}>>`;
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const imageGeneratorHandler: ToolHandler = async (input, context) => {
  const prompt = input.prompt as string | undefined;
  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    throw new Error('Missing required parameter: prompt');
  }
  if (prompt.length > 1000) {
    throw new Error(`Prompt too long (${prompt.length} chars, max 1000)`);
  }

  const width = Math.min(1024, Math.max(256, Number(input.width) || 1024));
  const height = Math.min(1024, Math.max(256, Number(input.height) || 1024));
  const model = (input.model as string) === 'turbo' ? 'turbo' : 'flux';
  const userKey = context?.userId ?? '_global';

  // Provider cascade
  const pollResult = await tryPollinations(prompt, width, height, model, userKey);
  if (pollResult) return pollResult;

  const hfResult = await tryHuggingFace(prompt, userKey);
  if (hfResult) return hfResult;

  const sdResult = await tryLocalSD(prompt, width, height);
  if (sdResult) return sdResult;

  throw new Error(
    'All image generation providers failed. Ensure at least one is available: ' +
    'Pollinations.ai (no config needed), HuggingFace (HF_TOKEN env var), ' +
    'or Local Stable Diffusion (SD_API_URL env var).',
  );
};
