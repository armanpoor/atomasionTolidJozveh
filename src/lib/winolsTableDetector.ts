import type { TableBlock, WinolsTableKind, WinolsTableMetadata } from './bookTypes.ts';

function toAsciiDigitsLocal(input: string): string {
  return String(input || '')
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/٬/g, ',')
    .replace(/٫/g, '.');
}

export interface DetectedWinolsTable {
  id: string;
  title: string;
  kind: WinolsTableKind;
  mapCode?: string;
  hexAddress?: string;
  dimensionsLabel: string;
  xAxisLabel: string;
  yAxisLabel: string;
  unit: string;
  factorOffset?: string;
  sourceFormat: NonNullable<WinolsTableMetadata['sourceFormat']>;
  headers: string[];
  rows: string[][];
  /** Present for matrix_2d and hex_dump tables */
  numericMatrix?: (number | null)[][];
  xAxisLabels?: string[];
  yAxisLabels?: string[];
  minValue?: number;
  maxValue?: number;
  meanValue?: number;
  peakCell?: { rowIndex: number; colIndex: number; value: number; xLabel: string; yLabel: string };
  startLine?: number;
  endLine?: number;
}

export interface ParagraphWinolsSegment {
  type: 'text' | 'winols_table';
  text?: string;
  table?: DetectedWinolsTable;
}

const MAP_CODE_RX =
  /\b(KFZW2?|KFZWOP|KFMIOP|KFMIRL|LAMFA|LDRXN|KFLBTS|KFDHBN|KFPED|KFLF|KFLDIMX|KFLDRL|KFMDS|TVUB|KRKTE|SOI|RAIL|IQ_LIMIT|TORQUE_LIM|BOOST_TARGET)\b/i;

const HEX_ADDRESS_RX = /\b(0x[0-9a-f]{4,8}|\$[0-9a-f]{4,8})\b/i;

const WINOLS_CONTEXT_RX =
  /\b(?:winols|damos|a2l|kp|hexdump|kfzw|kfzw2|kfmiop|kfmirl|lamfa|ldrxn|kflbts|kfped|kflf|krkte|tvub|hilo|lohi|checksum|factor|offset|btcd|btdc|mbar|rpm|load|lambda|afr|boost|iq|soi|rail)\b|وینولز|داموس|آدرس\s*هگز|جدول\s*(?:مپ|جرقه|سوخت|گشتاور|توربو|بوست|پدال|بار|آوانس)|نقشه\s*(?:جرقه|سوخت|توربو|گشتاور|پدال|بار)|فکتور|آفست|چکسام|دور\s*موتور|بار\s*موتور/i;

const DAMOS_HEADER_RX =
  /(?:نام\s*مپ|شناسه\s*مپ|کد\s*مپ|آدرس\s*هگز|آدرس\s*شروع|ابعاد|سایز|فکتور|ضریب|آفست|واحد|نوع\s*داده|بیت|چکسام|\bmap\s*(?:id|name|code)\b|\bhex\b|\baddress\b|\bfactor\b|\boffset\b|\bsize\b|\bdimension|\baxis\b|\bwinols\b|\bdamos\b)/i;

const AXIS_HEADER_RX =
  /(?:rpm|load|بار|دور|temp|دما|pedal|پدال|tps|map|pressure|فشار|boost|speed|سرعت|gear|دنده|volt|ولتاژ|mg\/?st|iq|kpa|bar|%|°c)/i;

function parseNumericToken(raw: string): number | null {
  const cleaned = toAsciiDigitsLocal(raw)
    .replace(/[%°℃]/g, '')
    .replace(/\b(?:rpm|bar|mbar|kpa|psi|nm|hp|btdc|deg|ms|mv|v|afr|λ|lambda|c|درجه|درصد|بار|دور)\b/gi, '')
    .replace(/,/g, '.')
    .trim();
  if (!cleaned || cleaned === '-' || cleaned === '—' || cleaned === 'N/A') return null;

  // Hex byte or word inside hex_dump (e.g. 0x1A or pure 2-char hex handled separately)
  if (/^0x[0-9a-f]+$/i.test(cleaned)) {
    const val = parseInt(cleaned, 16);
    return Number.isFinite(val) ? val : null;
  }

  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

function inferUnitFromContext(contextText: string): string {
  const txt = toAsciiDigitsLocal(contextText);
  if (/°\s*btdc|آوانس|جرقه|kfzw|ignition|درجه/i.test(txt)) return '° BTDC';
  if (/lambda|لامبدا|lamfa|λ/i.test(txt)) return 'λ';
  if (/\bafr\b|نسبت\s*سوخت/i.test(txt)) return 'AFR';
  if (/\bmbar\b/i.test(txt)) return 'mbar';
  if (/\bbar\b|بوست|فشار\s*توربو/i.test(txt)) return 'Bar';
  if (/\bkpa\b/i.test(txt)) return 'kPa';
  if (/\bpsi\b/i.test(txt)) return 'PSI';
  if (/\bnm\b|گشتاور|نیوتن|kfmiop|kfmirl/i.test(txt)) return 'Nm';
  if (/°c|سانتی[\s‌]?گراد|دما|egt|iat|ect/i.test(txt)) return '°C';
  if (/\bmg\/?st\b|پاشش|سوخت|iq/i.test(txt)) return 'mg/st';
  if (/\bms\b|میلی[\s‌]?ثانیه/i.test(txt)) return 'ms';
  if (/%|درصد|load|پدال|kfped|ldrxn/i.test(txt)) return '%';
  return 'raw';
}

function inferAxesFromCorner(cornerHeader: string, contextText: string): {
  xAxisLabel: string;
  yAxisLabel: string;
} {
  const corner = toAsciiDigitsLocal(cornerHeader || '').trim();
  const slashMatch = corner.match(/^(.+?)\s*[\\/×x|]\s*(.+)$/);
  if (slashMatch) {
    return {
      yAxisLabel: slashMatch[1].trim(),
      xAxisLabel: slashMatch[2].trim(),
    };
  }
  if (/دما|temp|ect|iat/i.test(corner)) {
    return { yAxisLabel: corner || 'دما (°C)', xAxisLabel: 'RPM / شاخص' };
  }
  if (/فشار|pressure|boost|map/i.test(corner)) {
    return { yAxisLabel: corner || 'فشار (Bar)', xAxisLabel: 'RPM' };
  }
  if (/load|بار/i.test(contextText) && /rpm|دور/i.test(contextText)) {
    return { yAxisLabel: 'Load (%)', xAxisLabel: 'RPM' };
  }
  return {
    yAxisLabel: corner || 'Load / محور عمودی',
    xAxisLabel: 'RPM / محور افقی',
  };
}

function extractFactorOffset(contextText: string): string | undefined {
  const ascii = toAsciiDigitsLocal(contextText);
  const fMatch = ascii.match(/(?:factor|فکتور|ضریب)\s*[:=]\s*([0-9.+-]+)/i);
  const oMatch = ascii.match(/(?:offset|آفست)\s*[:=]\s*([0-9.+-]+)/i);
  const bitMatch = ascii.match(/\b(8|16|32)\s*-?\s*bit\s*(?:hilo|lohi|signed|unsigned)?/i);
  const parts: string[] = [];
  if (fMatch) parts.push(`Factor: ${fMatch[1]}`);
  if (oMatch) parts.push(`Offset: ${oMatch[1]}`);
  if (bitMatch) parts.push(bitMatch[0].replace(/\s+/g, ' '));
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

function computeMatrixStats(
  numericMatrix: (number | null)[][],
  xAxisLabels: string[],
  yAxisLabels: string[]
): {
  minValue: number;
  maxValue: number;
  meanValue: number;
  peakCell?: { rowIndex: number; colIndex: number; value: number; xLabel: string; yLabel: string };
} {
  let minValue = Infinity;
  let maxValue = -Infinity;
  let sum = 0;
  let count = 0;
  let peakCell:
    | { rowIndex: number; colIndex: number; value: number; xLabel: string; yLabel: string }
    | undefined;

  for (let r = 0; r < numericMatrix.length; r++) {
    for (let c = 0; c < numericMatrix[r].length; c++) {
      const v = numericMatrix[r][c];
      if (v === null || !Number.isFinite(v)) continue;
      count += 1;
      sum += v;
      if (v < minValue) minValue = v;
      if (v > maxValue) {
        maxValue = v;
        peakCell = {
          rowIndex: r,
          colIndex: c,
          value: v,
          xLabel: xAxisLabels[c] || `C${c + 1}`,
          yLabel: yAxisLabels[r] || `R${r + 1}`,
        };
      }
    }
  }

  if (count === 0) {
    return { minValue: 0, maxValue: 0, meanValue: 0 };
  }
  return {
    minValue,
    maxValue,
    meanValue: Math.round((sum / count) * 100) / 100,
    peakCell,
  };
}

/**
 * Classifies an already-parsed TableBlock as a WinOLS calibration table (2D matrix,
 * hex dump, or Damos map directory) so BookPreview renders it with the interactive
 * graphical WinOLS component instead of a plain static HTML table.
 */
export function analyzeTableBlockAsWinols(
  block: Pick<TableBlock, 'id' | 'caption' | 'headers' | 'rows' | 'winolsMeta'>,
  surroundingContext = ''
): DetectedWinolsTable | null {
  if (!block.headers || block.headers.length < 3 || !block.rows || block.rows.length < 2) {
    return null;
  }

  const combinedMeta = [
    block.caption || '',
    block.headers.join(' '),
    surroundingContext,
    block.rows
      .slice(0, 8)
      .map((r) => r.join(' '))
      .join(' '),
  ].join('\n');

  const mapCodeMatch = toAsciiDigitsLocal(combinedMeta).match(MAP_CODE_RX);
  const hexMatch = toAsciiDigitsLocal(combinedMeta).match(HEX_ADDRESS_RX);
function formatHexAddress(raw?: string): string | undefined {
  if (!raw) return undefined;
  const clean = raw.trim().replace(/^\$/, '0x');
  if (/^0x/i.test(clean)) {
    return `0x${clean.slice(2).toUpperCase()}`;
  }
  return clean.toUpperCase();
}

  const mapCode = block.winolsMeta?.mapCode || mapCodeMatch?.[1]?.toUpperCase();
  const hexAddress = formatHexAddress(block.winolsMeta?.hexAddress || hexMatch?.[1]);

  // Check 1: Is this a 2D Numeric Calibration Matrix (columns 1..N are numeric values)?
  const xAxisHeaders = block.headers.slice(1);
  const numericHeaderCount = xAxisHeaders.filter((h) => parseNumericToken(h) !== null).length;
  const headerNumericRatio = numericHeaderCount / Math.max(1, xAxisHeaders.length);

  let totalDataCells = 0;
  let numericDataCells = 0;
  const numericMatrix: (number | null)[][] = [];
  const yAxisLabels: string[] = [];

  for (const row of block.rows) {
    yAxisLabels.push((row[0] || '').trim());
    const numRow: (number | null)[] = [];
    for (let c = 1; c < block.headers.length; c++) {
      const cell = (row[c] || '').trim();
      totalDataCells += 1;
      const parsed = parseNumericToken(cell);
      if (parsed !== null) numericDataCells += 1;
      numRow.push(parsed);
    }
    numericMatrix.push(numRow);
  }

  const bodyNumericRatio = totalDataCells > 0 ? numericDataCells / totalDataCells : 0;
  const hasExplicitWinolsMeta = Boolean(block.winolsMeta);
  const hasWinolsSignal =
    hasExplicitWinolsMeta ||
    Boolean(mapCode) ||
    Boolean(hexAddress) ||
    WINOLS_CONTEXT_RX.test(combinedMeta) ||
    AXIS_HEADER_RX.test(block.headers[0] || '');

  const is2DMatrix =
    (block.winolsMeta?.kind === 'matrix_2d' || block.winolsMeta?.kind === 'hex_dump') ||
    (xAxisHeaders.length >= 3 &&
      block.rows.length >= 2 &&
      bodyNumericRatio >= 0.72 &&
      (headerNumericRatio >= 0.65 || hasWinolsSignal));

  if (is2DMatrix && bodyNumericRatio >= 0.6) {
    const { xAxisLabel, yAxisLabel } = inferAxesFromCorner(block.headers[0] || '', combinedMeta);
    const stats = computeMatrixStats(numericMatrix, xAxisHeaders, yAxisLabels);
    const kind: WinolsTableKind = block.winolsMeta?.kind || 'matrix_2d';
    const unit = block.winolsMeta?.unit || inferUnitFromContext(combinedMeta);
    const dimensionsLabel =
      block.winolsMeta?.dimensionsLabel || `${block.rows.length}×${xAxisHeaders.length}`;
    const title =
      block.caption?.trim() ||
      (mapCode
        ? `نقشه کالیبراسیون WinOLS — ${mapCode}${hexAddress ? ` (${hexAddress})` : ''}`
        : `جدول ماتریسی WinOLS (${dimensionsLabel})`);

    return {
      id: block.id,
      title,
      kind,
      mapCode,
      hexAddress,
      dimensionsLabel,
      xAxisLabel: block.winolsMeta?.xAxisLabel || xAxisLabel,
      yAxisLabel: block.winolsMeta?.yAxisLabel || yAxisLabel,
      unit,
      factorOffset: block.winolsMeta?.factorOffset || extractFactorOffset(combinedMeta),
      sourceFormat: block.winolsMeta?.sourceFormat || 'markdown_pipe',
      headers: block.headers,
      rows: block.rows,
      numericMatrix,
      xAxisLabels: xAxisHeaders,
      yAxisLabels,
      minValue: stats.minValue,
      maxValue: stats.maxValue,
      meanValue: stats.meanValue,
      peakCell: stats.peakCell,
    };
  }

  // Check 2: Is this a WinOLS Damos / Map-Directory specification table?
  const damosHeaderHits = block.headers.filter((h) => DAMOS_HEADER_RX.test(h)).length;
  const rowsWithHexOrMap = block.rows.filter((r) => {
    const joined = toAsciiDigitsLocal(r.join(' '));
    return MAP_CODE_RX.test(joined) || HEX_ADDRESS_RX.test(joined) || /\b\d{1,2}\s*[×xX]\s*\d{1,2}\b/.test(joined);
  }).length;

  const isDamosDirectory =
    block.winolsMeta?.kind === 'damos_directory' ||
    (damosHeaderHits >= 2 && (rowsWithHexOrMap >= 1 || WINOLS_CONTEXT_RX.test(combinedMeta))) ||
    (rowsWithHexOrMap >= Math.max(2, Math.ceil(block.rows.length * 0.5)) &&
      (damosHeaderHits >= 1 || WINOLS_CONTEXT_RX.test(combinedMeta)));

  if (isDamosDirectory) {
    const dimensionsLabel = `${block.rows.length} نقشه · ${block.headers.length} ستون`;
    return {
      id: block.id,
      title:
        block.caption?.trim() ||
        (mapCode ? `جدول مشخصات WinOLS / Damos — ${mapCode}` : 'فهرست نقشه‌ها و آدرس‌های WinOLS'),
      kind: 'damos_directory',
      mapCode,
      hexAddress,
      dimensionsLabel,
      xAxisLabel: 'مشخصات فنی نقشه',
      yAxisLabel: 'ردیف نقشه',
      unit: inferUnitFromContext(combinedMeta),
      factorOffset: extractFactorOffset(combinedMeta),
      sourceFormat: block.winolsMeta?.sourceFormat || 'markdown_pipe',
      headers: block.headers,
      rows: block.rows,
    };
  }

  return null;
}

function splitDelimitedLine(
  line: string
): { cells: string[]; delimiter: 'pipe' | 'tab' | 'semicolon' | 'spaces' } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Markdown pipe row
  if (trimmed.includes('|') && (trimmed.match(/\|/g) || []).length >= 2) {
    const stripped = trimmed.replace(/^\|/, '').replace(/\|$/, '');
    const cells = stripped.split('|').map((c) => c.trim());
    if (cells.length >= 3) return { cells, delimiter: 'pipe' };
  }

  // Tab-separated row (classic WinOLS copy-paste directly from WinOLS 2.24!)
  if (trimmed.includes('\t')) {
    const cells = trimmed.split(/\t+/).map((c) => c.trim()).filter((_, idx, arr) => idx < arr.length);
    if (cells.length >= 3) return { cells, delimiter: 'tab' };
  }

  // Semicolon-separated CSV (European WinOLS / OLS export format)
  if (trimmed.includes(';') && (trimmed.match(/;/g) || []).length >= 2) {
    const cells = trimmed.split(';').map((c) => c.trim()).filter((c) => c.length > 0);
    if (cells.length >= 3) return { cells, delimiter: 'semicolon' };
  }

  // Multi-space aligned numeric row (2+ spaces between columns)
  if (/\s{2,}/.test(trimmed)) {
    const cells = trimmed.split(/\s{2,}/).map((c) => c.trim()).filter(Boolean);
    if (cells.length >= 4) return { cells, delimiter: 'spaces' };
  }

  // Compact single-space numeric matrix row (e.g. "20% 14.5 18.0 22.5 27.0 31.5")
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length >= 4 && tokens.length <= 20) {
    const numericTail = tokens.slice(1).filter((t) => parseNumericToken(t) !== null).length;
    if (numericTail / (tokens.length - 1) >= 0.85) {
      return { cells: tokens, delimiter: 'spaces' };
    }
  }

  return null;
}

function isMarkdownDividerLine(line: string): boolean {
  return /^\|?[\s:|-]+\|?$/.test(line.trim()) && line.includes('-');
}

function isHexDumpLine(line: string): { address: string; bytes: string[] } | null {
  const ascii = toAsciiDigitsLocal(line).trim();
  const match = ascii.match(/^(0x[0-9a-f]{4,8}|[0-9a-f]{5,8})\s*[:|]\s*((?:[0-9a-f]{2,4}\s+){3,}[0-9a-f]{2,4})\s*$/i);
  if (!match) return null;
  const address = match[1].toLowerCase().startsWith('0x')
    ? `0x${match[1].slice(2).toUpperCase()}`
    : `0x${match[1].toUpperCase()}`;
  const bytes = match[2].trim().split(/\s+/).map((b) => b.toUpperCase());
  return { address, bytes };
}

/**
 * Scans raw plain-text or markdown content for WinOLS calibration matrices
 * (tab-separated copy-paste, multi-space aligned tables, semicolon CSV exports,
 * Markdown pipe tables, and hex-dump address blocks).
 */
export function detectWinolsTablesInRawText(rawText: string): DetectedWinolsTable[] {
  const lines = rawText.replace(/\r\n/g, '\n').split('\n');
  const results: DetectedWinolsTable[] = [];
  let seq = 0;
  let i = 0;

  while (i < lines.length) {
    // 1. Check Hex Dump block (at least 2 consecutive hex address lines)
    const hexStart = isHexDumpLine(lines[i]);
    if (hexStart) {
      const hexRows: Array<{ address: string; bytes: string[] }> = [hexStart];
      let j = i + 1;
      while (j < lines.length) {
        const nextHex = isHexDumpLine(lines[j]);
        if (!nextHex) break;
        hexRows.push(nextHex);
        j += 1;
      }
      if (hexRows.length >= 2) {
        const colCount = Math.max(...hexRows.map((r) => r.bytes.length));
        const headers = [
          'Address',
          ...Array.from({ length: colCount }, (_, idx) => `+0x${idx.toString(16).toUpperCase().padStart(2, '0')}`),
        ];
        const rows = hexRows.map((hr) => [
          hr.address,
          ...Array.from({ length: colCount }, (_, idx) => hr.bytes[idx] ?? '00'),
        ]);
        const numericMatrix = hexRows.map((hr) =>
          Array.from({ length: colCount }, (_, idx) => {
            const b = hr.bytes[idx];
            return b ? parseInt(b, 16) : null;
          })
        );
        const contextBefore = lines.slice(Math.max(0, i - 3), i).join('\n');
        const mapMatch = toAsciiDigitsLocal(contextBefore).match(MAP_CODE_RX);
        const stats = computeMatrixStats(
          numericMatrix,
          headers.slice(1),
          hexRows.map((r) => r.address)
        );
        seq += 1;
        results.push({
          id: `winols_hex_${seq}`,
          title: mapMatch
            ? `هگزدامپ نقشه ${mapMatch[1].toUpperCase()} (${hexRows[0].address})`
            : `جدول هگزدامپ WinOLS از آدرس ${hexRows[0].address}`,
          kind: 'hex_dump',
          mapCode: mapMatch?.[1]?.toUpperCase(),
          hexAddress: hexRows[0].address,
          dimensionsLabel: `${hexRows.length}×${colCount} Bytes`,
          xAxisLabel: 'Offset',
          yAxisLabel: 'Hex Address',
          unit: 'HEX',
          factorOffset: extractFactorOffset(contextBefore),
          sourceFormat: 'hex_dump',
          headers,
          rows,
          numericMatrix,
          xAxisLabels: headers.slice(1),
          yAxisLabels: hexRows.map((r) => r.address),
          minValue: stats.minValue,
          maxValue: stats.maxValue,
          meanValue: stats.meanValue,
          peakCell: stats.peakCell,
          startLine: i,
          endLine: j - 1,
        });
        i = j;
        continue;
      }
    }

    // 2. Check Delimited Table Block (tab / semicolon / multi-space / pipe)
    const first = splitDelimitedLine(lines[i]);
    if (!first || isMarkdownDividerLine(lines[i])) {
      i += 1;
      continue;
    }

    const blockRows: string[][] = [first.cells];
    const delim = first.delimiter;
    let j = i + 1;

    while (j < lines.length) {
      if (delim === 'pipe' && isMarkdownDividerLine(lines[j])) {
        j += 1;
        continue;
      }
      const next = splitDelimitedLine(lines[j]);
      if (!next) break;
      // Allow slight ±1 column difference on headers (e.g. omitted corner cell)
      if (Math.abs(next.cells.length - first.cells.length) > 1) break;
      blockRows.push(next.cells);
      j += 1;
    }

    if (blockRows.length >= 3) {
      const maxCols = Math.max(...blockRows.map((r) => r.length));
      // Normalize if header row missed the top-left corner label (common in WinOLS paste)
      let headers = [...blockRows[0]];
      const dataRows = blockRows.slice(1).map((r) => {
        const copy = [...r];
        while (copy.length < maxCols) copy.push('');
        return copy.slice(0, maxCols);
      });
      if (headers.length === maxCols - 1 && parseNumericToken(headers[0]) !== null) {
        headers = ['Load \\ RPM', ...headers];
      } else {
        while (headers.length < maxCols) headers.push(`C${headers.length + 1}`);
        headers = headers.slice(0, maxCols);
      }

      const contextBefore = lines.slice(Math.max(0, i - 3), i).join('\n');
      const captionCandidate = lines[i - 1]?.trim();
      const hasUsefulCaption =
        Boolean(captionCandidate) &&
        captionCandidate.length >= 4 &&
        captionCandidate.length <= 130 &&
        (WINOLS_CONTEXT_RX.test(captionCandidate) ||
          MAP_CODE_RX.test(captionCandidate) ||
          HEX_ADDRESS_RX.test(captionCandidate) ||
          /^جدول|^نقشه|^مپ/i.test(captionCandidate));

      const sourceFormat: NonNullable<WinolsTableMetadata['sourceFormat']> =
        delim === 'pipe'
          ? 'markdown_pipe'
          : delim === 'tab'
            ? 'tab_separated'
            : delim === 'semicolon'
              ? 'semicolon_csv'
              : 'space_aligned';

      const classified = analyzeTableBlockAsWinols(
        {
          id: `winols_raw_${seq + 1}`,
          caption: hasUsefulCaption ? captionCandidate.replace(/^#+\s*/, '').replace(/\*\*/g, '') : undefined,
          headers,
          rows: dataRows,
          winolsMeta: undefined,
        },
        contextBefore
      );

      if (classified) {
        seq += 1;
        classified.id = `winols_raw_${seq}`;
        classified.sourceFormat = sourceFormat;
        classified.startLine = i;
        classified.endLine = j - 1;
        results.push(classified);
        i = j;
        continue;
      }
    }

    i += 1;
  }

  return results;
}

/**
 * Converts raw tab-separated, space-aligned, semicolon-separated, or hex-dump WinOLS
 * tables inside plain text files into standard Markdown pipe tables with a clean caption
 * so parseMarkdownDocument preserves them as structured TableBlocks instead of raw paragraphs.
 */
export function convertRawWinolsTablesToMarkdown(rawText: string): {
  markdown: string;
  convertedCount: number;
} {
  const detected = detectWinolsTablesInRawText(rawText).filter(
    (t) => t.sourceFormat !== 'markdown_pipe' && t.startLine !== undefined && t.endLine !== undefined
  );

  if (detected.length === 0) {
    return { markdown: rawText, convertedCount: 0 };
  }

  const lines = rawText.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let cursor = 0;

  for (const tbl of detected) {
    const start = tbl.startLine!;
    const end = tbl.endLine!;
    if (start < cursor) continue;

    for (let k = cursor; k < start; k++) {
      out.push(lines[k]);
    }

    out.push('');
    out.push(`**جدول WinOLS: ${tbl.title}**`);
    const safeHeaders = tbl.headers.map((h) => h.replace(/\|/g, '/').trim() || '—');
    out.push(`| ${safeHeaders.join(' | ')} |`);
    out.push(`| ${safeHeaders.map(() => '---').join(' | ')} |`);
    for (const row of tbl.rows) {
      const safeRow = row.map((c) => (c || '—').replace(/\|/g, '/').trim());
      out.push(`| ${safeRow.join(' | ')} |`);
    }
    out.push('');

    cursor = end + 1;
  }

  for (let k = cursor; k < lines.length; k++) {
    out.push(lines[k]);
  }

  return {
    markdown: out.join('\n'),
    convertedCount: detected.length,
  };
}

/**
 * Safety net for BookPreview: if any existing paragraph still contains raw WinOLS
 * tabular text (e.g. pasted space/tab/hex map without markdown pipes), split the
 * paragraph into prose + graphical WinOLS table segments with zero text loss.
 */
export function extractWinolsTableSegmentsFromParagraph(
  text: string
): ParagraphWinolsSegment[] | null {
  if (!text || text.length < 28 || !text.includes('\n')) return null;

  const detected = detectWinolsTablesInRawText(text);
  if (detected.length === 0) return null;

  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const segments: ParagraphWinolsSegment[] = [];
  let cursor = 0;

  for (const tbl of detected) {
    const start = tbl.startLine ?? 0;
    const end = tbl.endLine ?? lines.length - 1;
    if (start > cursor) {
      const before = lines.slice(cursor, start).join('\n').trim();
      if (before) segments.push({ type: 'text', text: before });
    }
    segments.push({ type: 'winols_table', table: tbl });
    cursor = end + 1;
  }

  if (cursor < lines.length) {
    const after = lines.slice(cursor).join('\n').trim();
    if (after) segments.push({ type: 'text', text: after });
  }

  return segments.some((s) => s.type === 'winols_table') ? segments : null;
}
