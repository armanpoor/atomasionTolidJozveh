import type { DiagramBlock, DiagramItem, DiagramKind } from './bookTypes.ts';
import { toPersianDigits } from './formatParsers.ts';

const SVG_WIDTH = 960;
const SVG_HEIGHT = 480;

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function truncateText(text: string, maxLen: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, maxLen - 1)}…`;
}

function wrapLines(text: string, maxCharsPerLine: number, maxLines = 2): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const lines: string[] = [];
  let current = '';
  for (const w of words) {
    const candidate = current ? `${current} ${w}` : w;
    if (candidate.length <= maxCharsPerLine) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = w;
      if (lines.length >= maxLines - 1) break;
    }
  }
  if (current && lines.length < maxLines) {
    lines.push(truncateText(current, maxCharsPerLine));
  }
  return lines.length > 0 ? lines : [truncateText(text, maxCharsPerLine)];
}

/**
 * Generates clean, publication-grade Persian RTL SVG markup for educational diagrams
 * (flowcharts, process steps, comparison bar charts, and architecture schematics).
 */
export function buildDiagramSvg(
  kind: DiagramKind,
  title: string,
  items: DiagramItem[],
  sourceLabel: string
): string {
  const safeItems = (items.length > 0 ? items : [{ label: title, detail: '' }]).slice(0, 6);
  const fontStack = 'Vazirmatn, Vazir Medium, Tahoma, sans-serif';
  const palette = ['#1E3A5F', '#2C5282', '#14532D', '#854D0E', '#9A3412', '#5B21B6'];

  const defs: string[] = [];
  let bodySvg = '';

  if (kind === 'comparison_bars') {
    const maxVal = Math.max(
      ...safeItems.map((it, idx) => (typeof it.value === 'number' && it.value > 0 ? it.value : (safeItems.length - idx) * 20)),
      1
    );
    const barLeft = 72;
    const barMaxWidth = 530;
    const barRight = barLeft + barMaxWidth; // 602
    const labelCenterX = 774; // Right column from x=626 to x=922 (width 296)
    const rowHeight = Math.min(58, Math.floor(310 / safeItems.length));
    const startY = 114;

    bodySvg = safeItems
      .map((item, idx) => {
        const val = typeof item.value === 'number' && item.value > 0 ? item.value : (safeItems.length - idx) * 18;
        const barW = Math.max(44, Math.round((val / maxVal) * barMaxWidth));
        const y = startY + idx * rowHeight;
        const fill = palette[idx % palette.length];
        const barX = barRight - barW;
        return `
          <g>
            <rect x="626" y="${y + 2}" width="296" height="${rowHeight - 10}" rx="3" fill="#FAF8F3" stroke="#EAE5DA" stroke-width="1"/>
            <text x="${labelCenterX}" y="${y + (item.detail ? 21 : 27)}" text-anchor="middle" direction="rtl" font-family="${fontStack}" font-size="13" font-weight="700" fill="#1A1816">${escapeXml(truncateText(item.label, 30))}</text>
            ${item.detail ? `<text x="${labelCenterX}" y="${y + 39}" text-anchor="middle" direction="rtl" font-family="${fontStack}" font-size="10.5" fill="#57534E">${escapeXml(truncateText(item.detail, 38))}</text>` : ''}
            <rect x="${barLeft}" y="${y + 8}" width="${barMaxWidth}" height="24" rx="3" fill="#EFECE4"/>
            <rect x="${barX}" y="${y + 8}" width="${barW}" height="24" rx="3" fill="${fill}"/>
            <text x="${Math.max(36, barX - 24)}" y="${y + 25}" text-anchor="middle" font-family="${fontStack}" font-size="12.5" font-weight="700" fill="${fill}">${escapeXml(toPersianDigits(val))}</text>
          </g>
        `;
      })
      .join('');
  } else if (kind === 'architecture') {
    // Top central root box + connected module boxes below in RTL order
    const cols = Math.min(3, safeItems.length);
    const rows = Math.ceil(safeItems.length / cols);
    const gapX = 22;
    const marginX = 48;
    const totalInnerW = SVG_WIDTH - marginX * 2;
    const boxW = Math.floor((totalInnerW - (cols - 1) * gapX) / cols);
    const boxH = rows > 1 ? 114 : 162;
    const startY = 178;

    const firstCenterX = marginX + boxW / 2;
    const lastCenterX = marginX + (cols - 1) * (boxW + gapX) + boxW / 2;

    // Hub box
    bodySvg += `
      <rect x="230" y="96" width="500" height="46" rx="4" fill="#1E3A5F"/>
      <text x="${SVG_WIDTH / 2}" y="124" text-anchor="middle" direction="rtl" font-family="${fontStack}" font-size="14.5" font-weight="700" fill="#FFFFFF">${escapeXml(truncateText(title, 52))}</text>
      <line x1="${SVG_WIDTH / 2}" y1="142" x2="${SVG_WIDTH / 2}" y2="162" stroke="#1E3A5F" stroke-width="2"/>
      ${cols > 1 ? `<line x1="${firstCenterX}" y1="162" x2="${lastCenterX}" y2="162" stroke="#B7C7DA" stroke-width="2"/>` : ''}
    `;

    bodySvg += safeItems
      .map((item, idx) => {
        const r = Math.floor(idx / cols);
        const c = idx % cols;
        // RTL horizontal order: right-to-left
        const rtlCol = cols - 1 - c;
        const x = marginX + rtlCol * (boxW + gapX);
        const y = startY + r * (boxH + 20);
        const cx = x + boxW / 2;
        const accent = palette[idx % palette.length];
        const maxTitleChars = cols === 1 ? 56 : cols === 2 ? 32 : 22;
        const maxDetailChars = cols === 1 ? 70 : cols === 2 ? 40 : 28;
        const titleLines = wrapLines(item.label, maxTitleChars, 2);
        const detailLines = item.detail ? wrapLines(item.detail, maxDetailChars, rows > 1 ? 2 : 3) : [];
        const clipId = `arch_clip_${idx}`;
        defs.push(`<clipPath id="${clipId}"><rect x="${x + 8}" y="${y + 8}" width="${boxW - 16}" height="${boxH - 14}" rx="2"/></clipPath>`);

        return `
          <g>
            ${r === 0 ? `<line x1="${cx}" y1="162" x2="${cx}" y2="${y}" stroke="#B7C7DA" stroke-width="2"/>` : ''}
            <rect x="${x}" y="${y}" width="${boxW}" height="${boxH}" rx="4" fill="#FFFFFF" stroke="#D8D2C5" stroke-width="1.5"/>
            <rect x="${x}" y="${y}" width="${boxW}" height="6" rx="2" fill="${accent}"/>
            <g clip-path="url(#${clipId})">
              ${titleLines
                .map(
                  (ln, lIdx) =>
                    `<text x="${cx}" y="${y + 30 + lIdx * 19}" text-anchor="middle" direction="rtl" font-family="${fontStack}" font-size="13" font-weight="700" fill="${accent}">${escapeXml(ln)}</text>`
                )
                .join('')}
              ${detailLines
                .map(
                  (ln, lIdx) =>
                    `<text x="${cx}" y="${y + (titleLines.length > 1 ? 72 : 58) + lIdx * 17}" text-anchor="middle" direction="rtl" font-family="${fontStack}" font-size="11.5" fill="#44403C">${escapeXml(ln)}</text>`
                )
                .join('')}
            </g>
          </g>
        `;
      })
      .join('');
  } else {
    // Flowchart / Process Steps (RTL snake flow: right to left)
    const count = safeItems.length;
    const perRow = count <= 4 ? count : 3;
    const gapX = 34;
    const marginX = 48;
    const totalInnerW = SVG_WIDTH - marginX * 2;
    const boxW = Math.floor((totalInnerW - (perRow - 1) * gapX) / perRow);
    const boxH = count <= 4 ? 196 : 138;
    const startY = count <= 4 ? 140 : 108;

    bodySvg = safeItems
      .map((item, idx) => {
        const row = Math.floor(idx / perRow);
        const colInRow = idx % perRow;
        const rtlCol = perRow - 1 - colInRow;
        const x = marginX + rtlCol * (boxW + gapX);
        const y = startY + row * (boxH + 38);
        const cx = x + boxW / 2;
        const accent = palette[idx % palette.length];
        const stepLabel = `گام ${toPersianDigits(idx + 1)}`;
        const maxTitleChars = perRow <= 2 ? 32 : perRow === 3 ? 21 : 15;
        const maxDetailChars = perRow <= 2 ? 40 : perRow === 3 ? 26 : 19;
        const titleLines = wrapLines(item.label, maxTitleChars, 2);
        const detailLines = item.detail ? wrapLines(item.detail, maxDetailChars, count <= 4 ? 3 : 2) : [];
        const clipId = `flow_clip_${idx}`;
        defs.push(`<clipPath id="${clipId}"><rect x="${x + 8}" y="${y + 8}" width="${boxW - 16}" height="${boxH - 14}" rx="3"/></clipPath>`);

        // Arrow pointing left to next step in the same row
        const hasNextInRow = idx + 1 < count && Math.floor((idx + 1) / perRow) === row;
        const arrow = hasNextInRow
          ? `<g>
               <line x1="${x}" y1="${y + boxH / 2}" x2="${x - 28}" y2="${y + boxH / 2}" stroke="#1E3A5F" stroke-width="2"/>
               <polygon points="${x - 32},${y + boxH / 2} ${x - 22},${y + boxH / 2 - 5} ${x - 22},${y + boxH / 2 + 5}" fill="#1E3A5F"/>
             </g>`
          : '';

        return `
          <g>
            <rect x="${x}" y="${y}" width="${boxW}" height="${boxH}" rx="5" fill="#FFFFFF" stroke="#D8D2C5" stroke-width="1.5"/>
            <rect x="${cx - 32}" y="${y + 12}" width="64" height="22" rx="3" fill="${accent}"/>
            <text x="${cx}" y="${y + 27}" text-anchor="middle" direction="rtl" font-family="${fontStack}" font-size="11.5" font-weight="700" fill="#FFFFFF">${escapeXml(stepLabel)}</text>
            <g clip-path="url(#${clipId})">
              ${titleLines
                .map(
                  (ln, lIdx) =>
                    `<text x="${cx}" y="${y + 58 + lIdx * 20}" text-anchor="middle" direction="rtl" font-family="${fontStack}" font-size="13" font-weight="700" fill="#1A1816">${escapeXml(ln)}</text>`
                )
                .join('')}
              ${detailLines
                .map(
                  (ln, lIdx) =>
                    `<text x="${cx}" y="${y + (titleLines.length > 1 ? 102 : 86) + lIdx * 17}" text-anchor="middle" direction="rtl" font-family="${fontStack}" font-size="11.5" fill="#57534E">${escapeXml(ln)}</text>`
                )
                .join('')}
            </g>
            ${arrow}
          </g>
        `;
      })
      .join('');
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_WIDTH}" height="${SVG_HEIGHT}" viewBox="0 0 ${SVG_WIDTH} ${SVG_HEIGHT}">
    <defs>${defs.join('')}</defs>
    <rect width="100%" height="100%" fill="#FBF9F5"/>
    <rect x="14" y="14" width="${SVG_WIDTH - 28}" height="${SVG_HEIGHT - 28}" rx="4" fill="#FFFFFF" stroke="#D8D2C5" stroke-width="1.5"/>
    <rect x="14" y="14" width="${SVG_WIDTH - 28}" height="64" rx="4" fill="#1E3A5F"/>
    <text x="${SVG_WIDTH / 2}" y="44" text-anchor="middle" direction="rtl" font-family="${fontStack}" font-size="17" font-weight="700" fill="#FFFFFF">${escapeXml(truncateText(title, 62))}</text>
    <text x="${SVG_WIDTH / 2}" y="65" text-anchor="middle" direction="rtl" font-family="${fontStack}" font-size="11" fill="#CBD9EA">${escapeXml(sourceLabel)}</text>
    ${bodySvg}
    <line x1="36" y1="${SVG_HEIGHT - 38}" x2="${SVG_WIDTH - 36}" y2="${SVG_HEIGHT - 38}" stroke="#EAE5DA" stroke-width="1"/>
    <text x="${SVG_WIDTH / 2}" y="${SVG_HEIGHT - 20}" text-anchor="middle" direction="rtl" font-family="${fontStack}" font-size="11" fill="#78716C">نمودار آموزشی تولیدشده به‌صورت خودکار برای درج مستقیم در سند ورد</text>
  </svg>`;
}

/**
 * Renders an SVG string into a crisp high-DPI PNG Uint8Array + Data URL in the browser.
 * Safely skips Canvas rasterization in headless Node tests (where window/document is undefined).
 */
export async function rasterizeSvgToPng(
  svgMarkup: string,
  width = SVG_WIDTH,
  height = SVG_HEIGHT
): Promise<{ pngBytes?: Uint8Array; pngDataUrl?: string }> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    return {};
  }

  try {
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) return {};

    ctx.scale(scale, scale);
    ctx.fillStyle = '#FBF9F5';
    ctx.fillRect(0, 0, width, height);

    const svgBlob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);

    await new Promise<void>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, width, height);
        URL.revokeObjectURL(url);
        resolve();
      };
      img.onerror = (err) => {
        URL.revokeObjectURL(url);
        reject(err);
      };
      img.src = url;
    });

    const pngDataUrl = canvas.toDataURL('image/png');
    const base64 = pngDataUrl.split(',')[1] || '';
    const binary = atob(base64);
    const pngBytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      pngBytes[i] = binary.charCodeAt(i);
    }
    return { pngBytes, pngDataUrl };
  } catch {
    return {};
  }
}

export function createDiagramBlock(params: {
  id: string;
  kind: DiagramKind;
  title: string;
  caption: string;
  rationale?: string;
  items: DiagramItem[];
  generatedBy: 'ai' | 'local';
}): DiagramBlock {
  const sourceLabel = params.generatedBy === 'ai' ? 'تولیدشده با هوش مصنوعی' : 'نمودار تحلیلی ساختاریافته';
  const svgMarkup = buildDiagramSvg(params.kind, params.title, params.items, sourceLabel);
  return {
    type: 'diagram',
    id: params.id,
    kind: params.kind,
    title: params.title,
    caption: params.caption,
    rationale: params.rationale,
    items: params.items,
    svgMarkup,
    widthPx: SVG_WIDTH,
    heightPx: SVG_HEIGHT,
    generatedBy: params.generatedBy,
  };
}
