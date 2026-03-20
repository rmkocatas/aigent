// ============================================================
// OpenClaw Deploy — Presentation Generator Tool (PPTX)
// ============================================================
//
// Creates real .pptx PowerPoint presentations using pptxgenjs.
// Pure JS, no native dependencies.
// Supports themed slides with titles, bullet points, and tables.
// Pushes the result to collectedFiles for Telegram delivery.
// ============================================================

import PptxGenJS from 'pptxgenjs';
import type { ToolDefinition } from '../../../types/index.js';
import type { ToolHandler } from '../registry.js';

export const presentationGeneratorDefinition: ToolDefinition = {
  name: 'generate_presentation',
  description:
    'Generate a PowerPoint presentation (.pptx) and send it to the user. ' +
    'Provide a title and slide content using a simple format: ' +
    'separate slides with "---slide---", use "# " for slide titles, ' +
    '"- " for bullet points. Supports "dark", "light", and "corporate" themes.',
  parameters: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Presentation title (shown on the title slide).',
      },
      slides: {
        type: 'string',
        description:
          'Slide content. Separate slides with "---slide---".\n' +
          'Within each slide:\n' +
          '- "# Title" for the slide title\n' +
          '- "- Bullet point" for bullet items\n' +
          '- Plain text for body content\n' +
          'Example:\n' +
          '---slide---\n# Introduction\n- Point one\n- Point two\n' +
          '---slide---\n# Details\nSome paragraph text here.',
      },
      filename: {
        type: 'string',
        description: 'Output filename (default: title-based). Must end with .pptx.',
      },
      theme: {
        type: 'string',
        enum: ['corporate', 'dark', 'light'],
        description: 'Visual theme (default: corporate).',
      },
    },
    required: ['title', 'slides'],
  },
};

// ── Themes ────────────────────────────────────────────────────

interface Theme {
  bgColor: string;
  titleColor: string;
  bodyColor: string;
  accentColor: string;
  mutedColor: string;
  titleSlideAccent: string;
}

const THEMES: Record<string, Theme> = {
  corporate: {
    bgColor: 'FFFFFF',
    titleColor: '1B3A5C',
    bodyColor: '333333',
    accentColor: '2B6CB0',
    mutedColor: '718096',
    titleSlideAccent: '2B6CB0',
  },
  dark: {
    bgColor: '1A202C',
    titleColor: 'FFFFFF',
    bodyColor: 'E2E8F0',
    accentColor: '63B3ED',
    mutedColor: 'A0AEC0',
    titleSlideAccent: '63B3ED',
  },
  light: {
    bgColor: 'F7FAFC',
    titleColor: '2D3748',
    bodyColor: '4A5568',
    accentColor: '3182CE',
    mutedColor: '718096',
    titleSlideAccent: '3182CE',
  },
};

// ── Handler ───────────────────────────────────────────────────

export const presentationGeneratorHandler: ToolHandler = async (input, context) => {
  const title = String(input.title ?? 'Presentation');
  const slidesContent = String(input.slides ?? '');
  const themeName = String(input.theme ?? 'corporate');
  const filename =
    String(input.filename || '').replace(/[^a-zA-Z0-9_\-. ]/g, '') || slugify(title) + '.pptx';

  if (!filename.endsWith('.pptx')) {
    return 'Error: filename must end with .pptx';
  }

  if (slidesContent.length > 50_000) {
    return 'Error: slides content exceeds 50,000 character limit.';
  }

  const theme = THEMES[themeName] ?? THEMES.corporate;

  try {
    const pptx = new PptxGenJS();
    pptx.author = 'MoltBot';
    pptx.title = title;
    pptx.layout = 'LAYOUT_WIDE'; // 13.33" x 7.5"

    // ── Title slide ──────────────────────────────────────────
    const titleSlide = pptx.addSlide();
    titleSlide.background = { color: theme.bgColor };

    // Accent bar
    titleSlide.addShape(pptx.ShapeType.rect, {
      x: 0,
      y: 2.8,
      w: 13.33,
      h: 0.06,
      fill: { color: theme.titleSlideAccent },
    });

    // Title
    titleSlide.addText(title, {
      x: 1,
      y: 1.5,
      w: 11.33,
      h: 1.5,
      fontSize: 36,
      fontFace: 'Calibri',
      color: theme.titleColor,
      bold: true,
      align: 'center',
    });

    // Date
    const dateStr = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    titleSlide.addText(dateStr, {
      x: 1,
      y: 3.2,
      w: 11.33,
      h: 0.8,
      fontSize: 14,
      fontFace: 'Calibri',
      color: theme.mutedColor,
      align: 'center',
    });

    // ── Content slides ───────────────────────────────────────
    const slideBlocks = slidesContent
      .split(/---slide---/i)
      .map((s) => s.trim())
      .filter(Boolean);

    for (const block of slideBlocks) {
      const slide = pptx.addSlide();
      slide.background = { color: theme.bgColor };

      const lines = block.split('\n');
      let slideTitle = '';
      const bullets: string[] = [];
      const bodyParts: string[] = [];

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (trimmed.startsWith('# ')) {
          slideTitle = trimmed.slice(2);
        } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
          bullets.push(trimmed.slice(2));
        } else {
          bodyParts.push(trimmed);
        }
      }

      // Accent line under title area
      slide.addShape(pptx.ShapeType.rect, {
        x: 0.5,
        y: 1.25,
        w: 3,
        h: 0.04,
        fill: { color: theme.accentColor },
      });

      // Slide title
      if (slideTitle) {
        slide.addText(slideTitle, {
          x: 0.5,
          y: 0.3,
          w: 12,
          h: 0.9,
          fontSize: 28,
          fontFace: 'Calibri',
          color: theme.titleColor,
          bold: true,
        });
      }

      // Content area starts below title
      const contentY = 1.6;
      const contentH = 5.2;

      if (bullets.length > 0) {
        const bulletItems = bullets.map((text) => ({
          text,
          options: {
            fontSize: 18,
            fontFace: 'Calibri' as const,
            color: theme.bodyColor,
            bullet: { code: '2022' } as { code: string },
            paraSpaceAfter: 8,
          },
        }));

        slide.addText(bulletItems, {
          x: 0.8,
          y: contentY,
          w: 11.5,
          h: contentH,
          valign: 'top',
        });
      }

      if (bodyParts.length > 0) {
        const bodyY = bullets.length > 0
          ? contentY + Math.min(bullets.length * 0.5, contentH * 0.6)
          : contentY;

        slide.addText(bodyParts.join('\n'), {
          x: 0.8,
          y: bodyY,
          w: 11.5,
          h: contentH - (bodyY - contentY),
          fontSize: 16,
          fontFace: 'Calibri',
          color: theme.bodyColor,
          valign: 'top',
        });
      }

      // Page number (bottom right)
      slide.addText(`${slideBlocks.indexOf(block) + 2}`, {
        x: 12,
        y: 6.8,
        w: 1,
        h: 0.5,
        fontSize: 10,
        fontFace: 'Calibri',
        color: theme.mutedColor,
        align: 'right',
      });
    }

    // ── Serialize and deliver ─────────────────────────────────
    const pptxBuffer = await pptx.write({ outputType: 'nodebuffer' }) as Buffer;
    const data = Buffer.from(pptxBuffer);
    const slideCount = slideBlocks.length + 1; // +1 for title slide

    if (context.collectedFiles) {
      context.collectedFiles.push({
        filename,
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        data,
        caption: title,
      });
    }

    return `Presentation "${filename}" generated (${slideCount} slides, ${(data.length / 1024).toFixed(1)}KB) and queued for delivery.`;
  } catch (err) {
    return `Error generating presentation: ${err instanceof Error ? err.message : String(err)}`;
  }
};

// ── Helpers ───────────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'presentation';
}
