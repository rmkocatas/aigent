import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { imageGeneratorHandler, _resetRateLimits } from '../../../src/core/tools/builtins/image-generator.js';
import type { ToolContext } from '../../../src/core/tools/registry.js';

const context: ToolContext = {
  workspaceDir: '/tmp',
  memoryDir: '/tmp/memory',
  conversationId: 'test',
  userId: 'test-user',
  maxExecutionMs: 60000,
};

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  mockFetch.mockReset();
  _resetRateLimits();
  savedEnv = {
    HF_TOKEN: process.env.HF_TOKEN,
    SD_API_URL: process.env.SD_API_URL,
  };
});

afterEach(() => {
  process.env.HF_TOKEN = savedEnv.HF_TOKEN;
  process.env.SD_API_URL = savedEnv.SD_API_URL;
});

// Helper: mock a successful image response (returns binary data)
function mockImageResponse(size = 5000) {
  const fakeImage = Buffer.alloc(size, 0xff);
  return {
    ok: true,
    arrayBuffer: async () => fakeImage.buffer.slice(
      fakeImage.byteOffset,
      fakeImage.byteOffset + fakeImage.byteLength,
    ),
  };
}

describe('generate_image tool', () => {
  it('returns IMAGE_BASE64 marker on Pollinations success', async () => {
    mockFetch.mockResolvedValueOnce(mockImageResponse());

    const result = await imageGeneratorHandler({ prompt: 'a sunset' }, context);
    expect(result).toMatch(/^<<IMAGE_BASE64:/);
    expect(result).toMatch(/>>$/);

    // Verify the URL includes seed and nologo
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('image.pollinations.ai');
    expect(url).toContain('a%20sunset');
    expect(url).toContain('nologo=true');
    expect(url).toMatch(/seed=\d+/);
  });

  it('falls back to HuggingFace when Pollinations fails', async () => {
    process.env.HF_TOKEN = 'test-token';

    // Pollinations fails
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    // HuggingFace succeeds with binary image data
    const fakeImageBuffer = Buffer.from('fake-png-data');
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => fakeImageBuffer.buffer.slice(
        fakeImageBuffer.byteOffset,
        fakeImageBuffer.byteOffset + fakeImageBuffer.byteLength,
      ),
    });

    const result = await imageGeneratorHandler({ prompt: 'a cat' }, context);
    expect(result).toMatch(/^<<IMAGE_BASE64:/);
    expect(result).toMatch(/>>$/);

    // Verify HF was called with auth header
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const hfCall = mockFetch.mock.calls[1];
    expect(hfCall[0]).toContain('huggingface.co');
    expect(hfCall[1].headers.Authorization).toBe('Bearer test-token');
  });

  it('rejects small Pollinations responses and falls back', async () => {
    process.env.HF_TOKEN = 'test-token';

    // Pollinations returns tiny response (not a real image)
    mockFetch.mockResolvedValueOnce(mockImageResponse(100));
    // HuggingFace succeeds
    mockFetch.mockResolvedValueOnce(mockImageResponse(5000));

    const result = await imageGeneratorHandler({ prompt: 'test' }, context);
    expect(result).toMatch(/^<<IMAGE_BASE64:/);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('falls back to Local SD when Pollinations and HF fail', async () => {
    process.env.HF_TOKEN = 'test-token';
    process.env.SD_API_URL = 'http://127.0.0.1:7860';

    // Pollinations fails
    mockFetch.mockResolvedValueOnce({ ok: false });
    // HuggingFace fails
    mockFetch.mockResolvedValueOnce({ ok: false });
    // Local SD succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ images: ['base64imagedata'] }),
    });

    const result = await imageGeneratorHandler({ prompt: 'a dog' }, context);
    expect(result).toBe('<<IMAGE_BASE64:base64imagedata>>');

    // Verify SD was called
    const sdCall = mockFetch.mock.calls[2];
    expect(sdCall[0]).toBe('http://127.0.0.1:7860/sdapi/v1/txt2img');
  });

  it('throws when all providers fail', async () => {
    delete process.env.HF_TOKEN;
    delete process.env.SD_API_URL;

    // Pollinations fails
    mockFetch.mockResolvedValueOnce({ ok: false });

    await expect(
      imageGeneratorHandler({ prompt: 'a bird' }, context),
    ).rejects.toThrow('All image generation providers failed');
  });

  it('throws on missing prompt', async () => {
    await expect(
      imageGeneratorHandler({}, context),
    ).rejects.toThrow('Missing required parameter: prompt');
  });

  it('throws on prompt too long', async () => {
    const longPrompt = 'x'.repeat(1001);
    await expect(
      imageGeneratorHandler({ prompt: longPrompt }, context),
    ).rejects.toThrow('Prompt too long');
  });

  it('clamps width and height to valid range', async () => {
    mockFetch.mockResolvedValueOnce(mockImageResponse());

    await imageGeneratorHandler(
      { prompt: 'test', width: 2000, height: 100 },
      context,
    );

    // Width clamped to 1024, height clamped to 256
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('width=1024');
    expect(url).toContain('height=256');
  });

  it('uses turbo model when specified', async () => {
    mockFetch.mockResolvedValueOnce(mockImageResponse());

    await imageGeneratorHandler(
      { prompt: 'test', model: 'turbo' },
      context,
    );

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('model=turbo');
  });
});
