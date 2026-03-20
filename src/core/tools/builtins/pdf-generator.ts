// ============================================================
// OpenClaw Deploy — PDF Generator Tool (Enhanced)
// ============================================================
//
// Creates real binary PDF documents from structured text content.
// Uses pdf-lib (pure JS, no native deps) to generate PDFs.
// Supports: titles, headings, bullet lists, markdown tables,
// cover pages, page numbers + date footer.
// Pushes the result to collectedFiles for Telegram delivery.
// ============================================================

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { ToolDefinition } from '../../../types/index.js';
import type { ToolHandler } from '../registry.js';

export const pdfGeneratorDefinition: ToolDefinition = {
  name: 'generate_pdf',
  description:
    'Generate a professional PDF document from text content and send it to the user. ' +
    'Supports titles, "## " section headings, "- " or "* " bullet lists, ' +
    'markdown tables (| col1 | col2 |), and optional cover page. ' +
    'Start content with "---cover---\\nSubtitle\\nAuthor" for a cover page. ' +
    'The PDF is automatically delivered as a document attachment.',
  parameters: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Document title (displayed as a heading in the PDF).',
      },
      content: {
        type: 'string',
        description:
          'The body text for the PDF. Supported formatting:\n' +
          '- "## " prefix for section headings\n' +
          '- "- " or "* " prefix for bullet points\n' +
          '- Markdown tables: | Header | Header |\\n|---|---|\\n| Cell | Cell |\n' +
          '- "---cover---\\nSubtitle\\nAuthor" at the start for a cover page\n' +
          '- Plain text is wrapped automatically.',
      },
      filename: {
        type: 'string',
        description:
          'Output filename (default: title-based). Must end with .pdf.',
      },
    },
    required: ['title', 'content'],
  },
};

// ── Layout constants ──────────────────────────────────────────

const PAGE_WIDTH = 595.28; // A4
const PAGE_HEIGHT = 841.89;
const MARGIN = 50;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const TITLE_SIZE = 20;
const HEADING_SIZE = 14;
const BODY_SIZE = 11;
const SMALL_SIZE = 8;
const LINE_HEIGHT = 1.4;
const BULLET_INDENT = 20;
const TABLE_CELL_PADDING = 6;
const FOOTER_Y = 25;

// ── Colors ────────────────────────────────────────────────────

const COLOR_TITLE = rgb(0.1, 0.1, 0.1);
const COLOR_BODY = rgb(0.15, 0.15, 0.15);
const COLOR_MUTED = rgb(0.5, 0.5, 0.5);
const COLOR_LINE = rgb(0.7, 0.7, 0.7);
const COLOR_TABLE_HEADER_BG = rgb(0.92, 0.92, 0.95);
const COLOR_TABLE_ALT_BG = rgb(0.97, 0.97, 0.97);
const COLOR_TABLE_BORDER = rgb(0.75, 0.75, 0.75);
const COLOR_COVER_TITLE = rgb(0.15, 0.25, 0.45);
const COLOR_COVER_SUBTITLE = rgb(0.35, 0.35, 0.35);
const COLOR_COVER_LINE = rgb(0.2, 0.4, 0.7);

// ── Handler ───────────────────────────────────────────────────

export const pdfGeneratorHandler: ToolHandler = async (input, context) => {
  const title = String(input.title ?? 'Document');
  const content = String(input.content ?? '');
  const filename =
    String(input.filename || '').replace(/[^a-zA-Z0-9_\-. ]/g, '') || slugify(title) + '.pdf';

  if (!filename.endsWith('.pdf')) {
    return 'Error: filename must end with .pdf';
  }

  if (content.length > 100_000) {
    return 'Error: content exceeds 100,000 character limit.';
  }

  try {
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const ctx: DrawContext = {
      doc: pdfDoc,
      font,
      boldFont,
      page: null!,
      y: 0,
      pageIndex: 0,
    };

    // Parse content for cover page
    let bodyContent = content;
    const coverMatch = content.match(/^---cover---\n([\s\S]*?)(?:\n---|\n\n)/);
    if (coverMatch) {
      const coverLines = coverMatch[1].split('\n').map((l) => l.trim()).filter(Boolean);
      const subtitle = coverLines[0] ?? '';
      const author = coverLines[1] ?? '';
      drawCoverPage(ctx, title, subtitle, author);
      bodyContent = content.slice(coverMatch[0].length);
    }

    // Start first content page
    newPage(ctx);

    // Draw title (unless cover page was used)
    if (!coverMatch) {
      drawTitle(ctx, title);
    }

    // Parse and draw content
    const paragraphs = bodyContent.split('\n');
    let i = 0;

    while (i < paragraphs.length) {
      const line = paragraphs[i];
      const trimmed = line.trim();

      // Empty line = spacing
      if (!trimmed) {
        ctx.y -= BODY_SIZE * 0.8;
        i++;
        continue;
      }

      // Table detection: line starts with |
      if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
        const tableLines: string[] = [];
        while (i < paragraphs.length && paragraphs[i].trim().startsWith('|')) {
          tableLines.push(paragraphs[i].trim());
          i++;
        }
        drawTable(ctx, tableLines);
        continue;
      }

      // Section heading
      if (trimmed.startsWith('## ')) {
        drawHeading(ctx, trimmed.slice(3));
        i++;
        continue;
      }

      // Bullet list
      if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        drawBullet(ctx, trimmed.slice(2));
        i++;
        continue;
      }

      // Numbered list (e.g., "1. " or "10. ")
      const numberedMatch = trimmed.match(/^(\d+)\.\s+(.+)/);
      if (numberedMatch) {
        drawNumberedItem(ctx, numberedMatch[1], numberedMatch[2]);
        i++;
        continue;
      }

      // Regular paragraph
      drawParagraph(ctx, trimmed);
      i++;
    }

    // Add page numbers and date footer to all pages
    addFooters(ctx, title);

    // Serialize and deliver
    const pdfBytes = await pdfDoc.save();
    const data = Buffer.from(pdfBytes);
    const pageCount = pdfDoc.getPageCount();

    if (context.collectedFiles) {
      context.collectedFiles.push({
        filename,
        mimeType: 'application/pdf',
        data,
        caption: title,
      });
    }

    return `PDF "${filename}" generated (${pageCount} page${pageCount > 1 ? 's' : ''}, ${(data.length / 1024).toFixed(1)}KB) and queued for delivery.`;
  } catch (err) {
    return `Error generating PDF: ${err instanceof Error ? err.message : String(err)}`;
  }
};

// ── Draw context ──────────────────────────────────────────────

interface DrawContext {
  doc: PDFDocument;
  font: PDFFont;
  boldFont: PDFFont;
  page: PDFPage;
  y: number;
  pageIndex: number;
}

function newPage(ctx: DrawContext): void {
  ctx.page = ctx.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  ctx.y = PAGE_HEIGHT - MARGIN;
  ctx.pageIndex++;
}

function ensureSpace(ctx: DrawContext, needed: number): void {
  if (ctx.y - needed < MARGIN + FOOTER_Y) {
    newPage(ctx);
  }
}

// ── Cover page ────────────────────────────────────────────────

function drawCoverPage(ctx: DrawContext, title: string, subtitle: string, author: string): void {
  const page = ctx.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  ctx.pageIndex++;

  const centerY = PAGE_HEIGHT / 2 + 60;

  // Title
  const titleLines = wrapText(title, ctx.boldFont, 28, CONTENT_WIDTH);
  let y = centerY;
  for (const line of titleLines) {
    const w = ctx.boldFont.widthOfTextAtSize(line, 28);
    page.drawText(line, {
      x: (PAGE_WIDTH - w) / 2,
      y,
      size: 28,
      font: ctx.boldFont,
      color: COLOR_COVER_TITLE,
    });
    y -= 36;
  }

  // Decorative line
  y -= 10;
  page.drawLine({
    start: { x: PAGE_WIDTH / 2 - 80, y },
    end: { x: PAGE_WIDTH / 2 + 80, y },
    thickness: 2,
    color: COLOR_COVER_LINE,
  });
  y -= 30;

  // Subtitle
  if (subtitle) {
    const subLines = wrapText(subtitle, ctx.font, 16, CONTENT_WIDTH);
    for (const line of subLines) {
      const w = ctx.font.widthOfTextAtSize(line, 16);
      page.drawText(line, {
        x: (PAGE_WIDTH - w) / 2,
        y,
        size: 16,
        font: ctx.font,
        color: COLOR_COVER_SUBTITLE,
      });
      y -= 22;
    }
  }

  // Author
  if (author) {
    y -= 20;
    const w = ctx.font.widthOfTextAtSize(author, 12);
    page.drawText(author, {
      x: (PAGE_WIDTH - w) / 2,
      y,
      size: 12,
      font: ctx.font,
      color: COLOR_MUTED,
    });
  }

  // Date at bottom
  const dateStr = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const dateW = ctx.font.widthOfTextAtSize(dateStr, 10);
  page.drawText(dateStr, {
    x: (PAGE_WIDTH - dateW) / 2,
    y: MARGIN + 20,
    size: 10,
    font: ctx.font,
    color: COLOR_MUTED,
  });
}

// ── Title ─────────────────────────────────────────────────────

function drawTitle(ctx: DrawContext, title: string): void {
  const titleLines = wrapText(title, ctx.boldFont, TITLE_SIZE, CONTENT_WIDTH);
  for (const line of titleLines) {
    ensureSpace(ctx, TITLE_SIZE * LINE_HEIGHT);
    ctx.page.drawText(line, {
      x: MARGIN,
      y: ctx.y - TITLE_SIZE,
      size: TITLE_SIZE,
      font: ctx.boldFont,
      color: COLOR_TITLE,
    });
    ctx.y -= TITLE_SIZE * LINE_HEIGHT;
  }

  // Separator line
  ctx.y -= 8;
  ctx.page.drawLine({
    start: { x: MARGIN, y: ctx.y },
    end: { x: PAGE_WIDTH - MARGIN, y: ctx.y },
    thickness: 0.5,
    color: COLOR_LINE,
  });
  ctx.y -= 16;
}

// ── Heading ───────────────────────────────────────────────────

function drawHeading(ctx: DrawContext, text: string): void {
  ctx.y -= 6;
  const lines = wrapText(text, ctx.boldFont, HEADING_SIZE, CONTENT_WIDTH);
  for (const line of lines) {
    ensureSpace(ctx, HEADING_SIZE * LINE_HEIGHT);
    ctx.page.drawText(line, {
      x: MARGIN,
      y: ctx.y - HEADING_SIZE,
      size: HEADING_SIZE,
      font: ctx.boldFont,
      color: COLOR_TITLE,
    });
    ctx.y -= HEADING_SIZE * LINE_HEIGHT;
  }
  ctx.y -= 4;
}

// ── Paragraph ─────────────────────────────────────────────────

function drawParagraph(ctx: DrawContext, text: string): void {
  const lines = wrapText(text, ctx.font, BODY_SIZE, CONTENT_WIDTH);
  for (const line of lines) {
    ensureSpace(ctx, BODY_SIZE * LINE_HEIGHT);
    ctx.page.drawText(line, {
      x: MARGIN,
      y: ctx.y - BODY_SIZE,
      size: BODY_SIZE,
      font: ctx.font,
      color: COLOR_BODY,
    });
    ctx.y -= BODY_SIZE * LINE_HEIGHT;
  }
}

// ── Bullet list item ──────────────────────────────────────────

function drawBullet(ctx: DrawContext, text: string): void {
  const bulletWidth = CONTENT_WIDTH - BULLET_INDENT;
  const lines = wrapText(text, ctx.font, BODY_SIZE, bulletWidth);

  for (let i = 0; i < lines.length; i++) {
    ensureSpace(ctx, BODY_SIZE * LINE_HEIGHT);
    if (i === 0) {
      // Draw bullet character
      ctx.page.drawText('\u2022', {
        x: MARGIN + 6,
        y: ctx.y - BODY_SIZE,
        size: BODY_SIZE,
        font: ctx.font,
        color: COLOR_BODY,
      });
    }
    ctx.page.drawText(lines[i], {
      x: MARGIN + BULLET_INDENT,
      y: ctx.y - BODY_SIZE,
      size: BODY_SIZE,
      font: ctx.font,
      color: COLOR_BODY,
    });
    ctx.y -= BODY_SIZE * LINE_HEIGHT;
  }
}

// ── Numbered list item ────────────────────────────────────────

function drawNumberedItem(ctx: DrawContext, num: string, text: string): void {
  const bulletWidth = CONTENT_WIDTH - BULLET_INDENT;
  const lines = wrapText(text, ctx.font, BODY_SIZE, bulletWidth);

  for (let i = 0; i < lines.length; i++) {
    ensureSpace(ctx, BODY_SIZE * LINE_HEIGHT);
    if (i === 0) {
      ctx.page.drawText(`${num}.`, {
        x: MARGIN + 2,
        y: ctx.y - BODY_SIZE,
        size: BODY_SIZE,
        font: ctx.boldFont,
        color: COLOR_BODY,
      });
    }
    ctx.page.drawText(lines[i], {
      x: MARGIN + BULLET_INDENT,
      y: ctx.y - BODY_SIZE,
      size: BODY_SIZE,
      font: ctx.font,
      color: COLOR_BODY,
    });
    ctx.y -= BODY_SIZE * LINE_HEIGHT;
  }
}

// ── Table ─────────────────────────────────────────────────────

function drawTable(ctx: DrawContext, tableLines: string[]): void {
  // Parse table cells
  const rows: string[][] = [];
  let hasSeparator = false;

  for (const line of tableLines) {
    const cells = line
      .split('|')
      .slice(1, -1) // Remove first/last empty from split
      .map((c) => c.trim());

    // Check for separator row (---|---|---)
    if (cells.every((c) => /^[-:]+$/.test(c))) {
      hasSeparator = true;
      continue;
    }
    rows.push(cells);
  }

  if (rows.length === 0) return;

  const colCount = Math.max(...rows.map((r) => r.length));
  const colWidth = CONTENT_WIDTH / colCount;
  const rowHeight = BODY_SIZE * LINE_HEIGHT + TABLE_CELL_PADDING * 2;

  // Calculate total table height to check if it fits
  const totalHeight = rows.length * rowHeight;
  ensureSpace(ctx, Math.min(totalHeight, rowHeight * 3)); // At least 3 rows

  ctx.y -= 4;

  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx];
    const isHeader = rowIdx === 0 && hasSeparator;
    const isAltRow = !isHeader && rowIdx % 2 === 0;

    ensureSpace(ctx, rowHeight);

    const cellY = ctx.y - rowHeight;

    // Row background
    if (isHeader) {
      ctx.page.drawRectangle({
        x: MARGIN,
        y: cellY,
        width: CONTENT_WIDTH,
        height: rowHeight,
        color: COLOR_TABLE_HEADER_BG,
      });
    } else if (isAltRow) {
      ctx.page.drawRectangle({
        x: MARGIN,
        y: cellY,
        width: CONTENT_WIDTH,
        height: rowHeight,
        color: COLOR_TABLE_ALT_BG,
      });
    }

    // Cell text
    for (let colIdx = 0; colIdx < colCount; colIdx++) {
      const cellText = (row[colIdx] ?? '').slice(0, 50); // Limit cell text
      const cellFont = isHeader ? ctx.boldFont : ctx.font;
      const x = MARGIN + colIdx * colWidth + TABLE_CELL_PADDING;
      const textY = cellY + TABLE_CELL_PADDING + 2;

      // Truncate text to fit column
      let displayText = cellText;
      while (
        displayText.length > 0 &&
        cellFont.widthOfTextAtSize(displayText, BODY_SIZE) > colWidth - TABLE_CELL_PADDING * 2
      ) {
        displayText = displayText.slice(0, -1);
      }

      ctx.page.drawText(displayText, {
        x,
        y: textY,
        size: BODY_SIZE,
        font: cellFont,
        color: COLOR_BODY,
      });
    }

    // Cell borders
    // Horizontal line below row
    ctx.page.drawLine({
      start: { x: MARGIN, y: cellY },
      end: { x: MARGIN + CONTENT_WIDTH, y: cellY },
      thickness: isHeader ? 1 : 0.5,
      color: COLOR_TABLE_BORDER,
    });

    // Vertical lines
    for (let colIdx = 0; colIdx <= colCount; colIdx++) {
      const x = MARGIN + colIdx * colWidth;
      ctx.page.drawLine({
        start: { x, y: ctx.y },
        end: { x, y: cellY },
        thickness: 0.5,
        color: COLOR_TABLE_BORDER,
      });
    }

    // Top border for first row
    if (rowIdx === 0) {
      ctx.page.drawLine({
        start: { x: MARGIN, y: ctx.y },
        end: { x: MARGIN + CONTENT_WIDTH, y: ctx.y },
        thickness: 1,
        color: COLOR_TABLE_BORDER,
      });
    }

    ctx.y = cellY;
  }

  ctx.y -= 8;
}

// ── Page numbers & footer ─────────────────────────────────────

function addFooters(ctx: DrawContext, _title: string): void {
  const totalPages = ctx.doc.getPageCount();
  const dateStr = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  const pages = ctx.doc.getPages();
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];

    // Page number (right)
    const pageNum = `Page ${i + 1} of ${totalPages}`;
    const numW = ctx.font.widthOfTextAtSize(pageNum, SMALL_SIZE);
    page.drawText(pageNum, {
      x: PAGE_WIDTH - MARGIN - numW,
      y: FOOTER_Y,
      size: SMALL_SIZE,
      font: ctx.font,
      color: COLOR_MUTED,
    });

    // Date (left)
    page.drawText(dateStr, {
      x: MARGIN,
      y: FOOTER_Y,
      size: SMALL_SIZE,
      font: ctx.font,
      color: COLOR_MUTED,
    });
  }
}

// ── Helpers ───────────────────────────────────────────────────

function wrapText(
  text: string,
  font: { widthOfTextAtSize: (text: string, size: number) => number },
  fontSize: number,
  maxWidth: number,
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    const width = font.widthOfTextAtSize(test, fontSize);
    if (width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'document';
}
