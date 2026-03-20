// ============================================================
// OpenClaw Deploy — Video Analyzer Tool (Vision-based)
// ============================================================
//
// Analyzes YouTube video thumbnails/frames using vision capabilities.
// Fetches freely-available thumbnails and returns them as image content
// for the LLM to analyze visually alongside any transcript data.
// Cost: ~$0.01-0.05 per analysis (Sonnet vision, few images).
// ============================================================

import type { ToolDefinition } from '../../../types/index.js';
import type { ToolHandler } from '../registry.js';

export const videoAnalyzerDefinition: ToolDefinition = {
  name: 'analyze_video_thumbnail',
  description:
    'Analyze a YouTube video by fetching its thumbnail images. ' +
    'Returns high-resolution thumbnail URLs for visual analysis. ' +
    'Combine with summarize_url for transcript + visual understanding.',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'YouTube video URL.',
      },
      include_transcript: {
        type: 'boolean',
        description: 'Also fetch the video transcript (default: true).',
      },
    },
    required: ['url'],
  },
  routing: {
    useWhen: [
      'User wants to visually analyze a YouTube video',
      'User asks what a video looks like or shows',
    ],
    avoidWhen: [
      'User only wants a text summary (use summarize_url instead)',
    ],
  },
};

function extractYouTubeId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

export const videoAnalyzerHandler: ToolHandler = async (input) => {
  const url = input.url as string;
  const includeTranscript = input.include_transcript !== false;

  if (!url) throw new Error('Missing URL');

  const videoId = extractYouTubeId(url);
  if (!videoId) {
    return 'Error: Only YouTube URLs are supported for thumbnail analysis. Use summarize_url for other platforms.';
  }

  // YouTube provides multiple thumbnail resolutions for free
  const thumbnails = [
    { label: 'Max Resolution', url: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg` },
    { label: 'High Quality', url: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` },
    { label: 'Standard', url: `https://img.youtube.com/vi/${videoId}/sddefault.jpg` },
  ];

  // Verify which thumbnails are available (maxresdefault may not exist)
  const available: { label: string; url: string }[] = [];
  for (const thumb of thumbnails) {
    try {
      const res = await fetch(thumb.url, {
        method: 'HEAD',
        signal: AbortSignal.timeout(5_000),
      });
      if (res.ok) {
        available.push(thumb);
        break; // Only need the highest resolution one
      }
    } catch {
      // Skip unavailable
    }
  }

  if (available.length === 0) {
    return `Could not fetch any thumbnails for YouTube video ${videoId}.`;
  }

  const parts: string[] = [
    `YouTube Video: https://youtube.com/watch?v=${videoId}`,
    '',
    `Thumbnail available at: ${available[0].url}`,
    `(${available[0].label})`,
    '',
    'To analyze the video thumbnail visually, the LLM should use this image URL.',
  ];

  // Optionally include transcript hint
  if (includeTranscript) {
    parts.push(
      '',
      'For a complete analysis, also use the summarize_url tool on this same YouTube URL to get the transcript.',
    );
  }

  return parts.join('\n');
};
