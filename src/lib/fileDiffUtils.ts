import type { ContentUnitDto, SourceFileDto } from './bookTypes.ts';

export interface HighlightSegment {
  text: string;
  matched: boolean;
}

export interface FilteredSourceFileMatch<T> {
  item: T;
  nameSegments: HighlightSegment[];
}

export interface IngestedFileComparisonSummary {
  sourceFileId: string;
  totalUnits: number;
  uniqueUnits: number;
  mergedUnits: number;
  conflictUnits: number;
  totalWords: number;
  activeWords: number;
  /** Raw text reconstructed from all extracted units belonging to this file */
  allExtractedText: string;
  /** Active ingested version in the system (non-merged canonical units + annotations) */
  activeIngestedText: string;
  units: ContentUnitDto[];
}

export type DiffLineKind = 'equal' | 'added' | 'removed';

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  leftLineNumber: number | null;
  rightLineNumber: number | null;
}

export interface SideBySideDiffRow {
  leftLineNumber: number | null;
  leftText: string | null;
  leftKind: 'equal' | 'removed' | 'empty';
  rightLineNumber: number | null;
  rightText: string | null;
  rightKind: 'equal' | 'added' | 'empty';
}

export interface LineDiffResult {
  lines: DiffLine[];
  sideBySideRows: SideBySideDiffRow[];
  addedCount: number;
  removedCount: number;
  unchangedCount: number;
  similarityPercent: number;
  truncated: boolean;
}

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/**
 * Normalizes Persian/Arabic letter variants and digits for fast, forgiving filename filtering.
 */
export function normalizeFileNameSearchText(input: string): string {
  let out = String(input || '')
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/ة/g, 'ه')
    .replace(/[\u200C\u200E\u200F]/g, ' ')
    .toLowerCase();

  for (let i = 0; i < 10; i++) {
    out = out.split(PERSIAN_DIGITS[i]).join(String(i));
    out = out.split(ARABIC_DIGITS[i]).join(String(i));
  }

  return out.replace(/\s+/g, ' ').trim();
}

/**
 * Splits a filename into matched/unmatched segments for clean inline highlighting.
 */
export function buildHighlightSegments(text: string, rawQuery: string): HighlightSegment[] {
  const queryNorm = normalizeFileNameSearchText(rawQuery);
  if (!queryNorm) {
    return [{ text, matched: false }];
  }

  const chars = Array.from(text);
  const normChars = chars.map((ch) => {
    let n = ch
      .replace(/ي/g, 'ی')
      .replace(/ك/g, 'ک')
      .replace(/ة/g, 'ه')
      .toLowerCase();
    const pIdx = PERSIAN_DIGITS.indexOf(n);
    if (pIdx >= 0) n = String(pIdx);
    const aIdx = ARABIC_DIGITS.indexOf(n);
    if (aIdx >= 0) n = String(aIdx);
    return n;
  });

  const normalizedFull = normChars.join('');
  const segments: HighlightSegment[] = [];
  let cursor = 0;

  while (cursor < chars.length) {
    const foundIdx = normalizedFull.indexOf(queryNorm, cursor);
    if (foundIdx === -1) {
      segments.push({ text: chars.slice(cursor).join(''), matched: false });
      break;
    }
    if (foundIdx > cursor) {
      segments.push({ text: chars.slice(cursor, foundIdx).join(''), matched: false });
    }
    segments.push({
      text: chars.slice(foundIdx, foundIdx + queryNorm.length).join(''),
      matched: true,
    });
    cursor = foundIdx + queryNorm.length;
  }

  return segments.length > 0 ? segments : [{ text, matched: false }];
}

/**
 * Filters project source files by filename (case-, Persian/Arabic-, and digit-insensitive).
 */
export function filterSourceFilesByName(
  files: readonly SourceFileDto[],
  query: string
): FilteredSourceFileMatch<SourceFileDto>[] {
  const trimmed = normalizeFileNameSearchText(query);
  if (!trimmed) {
    return files.map((item) => ({
      item,
      nameSegments: [{ text: item.fileName, matched: false }],
    }));
  }

  const matches: FilteredSourceFileMatch<SourceFileDto>[] = [];
  for (const item of files) {
    const normName = normalizeFileNameSearchText(item.fileName);
    const normFormat = normalizeFileNameSearchText(item.format);
    if (normName.includes(trimmed) || normFormat === trimmed) {
      matches.push({
        item,
        nameSegments: buildHighlightSegments(item.fileName, query),
      });
    }
  }
  return matches;
}

/**
 * Filters queued upload files by filename using the same normalization rules.
 */
export function filterQueuedFilesByName<T extends { name: string; format?: string }>(
  files: readonly T[],
  query: string
): T[] {
  const trimmed = normalizeFileNameSearchText(query);
  if (!trimmed) return [...files];
  return files.filter((f) => {
    const normName = normalizeFileNameSearchText(f.name);
    const normFmt = f.format ? normalizeFileNameSearchText(f.format) : '';
    return normName.includes(trimmed) || normFmt === trimmed;
  });
}

function stripExtension(name: string): string {
  return normalizeFileNameSearchText(name).replace(/\.[a-z0-9]{1,8}$/i, '');
}

/**
 * Finds the best matching ingested SourceFileDto for a queued or local file by filename.
 */
export function matchQueuedToIngestedFile(
  fileName: string,
  sourceFiles: readonly SourceFileDto[]
): SourceFileDto | null {
  if (!fileName.trim() || sourceFiles.length === 0) return null;
  const targetExact = normalizeFileNameSearchText(fileName);
  const exact = sourceFiles.find(
    (sf) => normalizeFileNameSearchText(sf.fileName) === targetExact
  );
  if (exact) return exact;

  const targetBase = stripExtension(fileName);
  if (!targetBase) return null;
  return (
    sourceFiles.find((sf) => stripExtension(sf.fileName) === targetBase) || null
  );
}

function countWordsSimple(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter(Boolean).length;
}

function formatUnitForComparison(unit: ContentUnitDto): string {
  const lines: string[] = [];
  if (unit.headingPath && unit.headingPath.trim()) {
    lines.push(`[${unit.headingPath.trim()}]`);
  }
  const raw = (unit.rawText || '').trim();
  if (raw) {
    lines.push(raw);
  }
  return lines.join('\n');
}

/**
 * Reconstructs the ingested text representation of a source file from its persisted Stage 1–2 content units.
 */
export function buildIngestedFileComparisonData(
  sourceFileId: string,
  contentUnits: readonly ContentUnitDto[]
): IngestedFileComparisonSummary {
  const fileUnits = contentUnits
    .filter((u) => u.sourceFileId === sourceFileId)
    .sort((a, b) => a.unitOrder - b.unitOrder);

  let uniqueUnits = 0;
  let mergedUnits = 0;
  let conflictUnits = 0;

  const allParts: string[] = [];
  const activeParts: string[] = [];

  for (const unit of fileUnits) {
    const formatted = formatUnitForComparison(unit);
    if (formatted) {
      allParts.push(formatted);
    }

    if (unit.status === 'merged') {
      mergedUnits += 1;
      continue;
    }

    if (unit.status === 'conflict') {
      conflictUnits += 1;
      if (formatted) activeParts.push(formatted);
      continue;
    }

    uniqueUnits += 1;
    if (formatted) {
      activeParts.push(formatted);
    }
  }

  const allExtractedText = allParts.join('\n');
  const activeIngestedText = activeParts.join('\n');

  return {
    sourceFileId,
    totalUnits: fileUnits.length,
    uniqueUnits,
    mergedUnits,
    conflictUnits,
    totalWords: countWordsSimple(allExtractedText),
    activeWords: countWordsSimple(activeIngestedText),
    allExtractedText,
    activeIngestedText,
    units: fileUnits,
  };
}

function splitToComparableLines(text: string): string[] {
  const normalized = String(text || '').replace(/\r\n?/g, '\n');
  if (!normalized.trim()) return [];
  return normalized.split('\n');
}

/**
 * Converts a unified DiffLine sequence into aligned Side-by-Side rows
 * (pairing adjacent removed/added blocks cleanly on the same visual row).
 */
export function buildSideBySideRows(lines: readonly DiffLine[]): SideBySideDiffRow[] {
  const rows: SideBySideDiffRow[] = [];
  let i = 0;

  while (i < lines.length) {
    const current = lines[i];
    if (current.kind === 'equal') {
      rows.push({
        leftLineNumber: current.leftLineNumber,
        leftText: current.text,
        leftKind: 'equal',
        rightLineNumber: current.rightLineNumber,
        rightText: current.text,
        rightKind: 'equal',
      });
      i += 1;
      continue;
    }

    const removedBatch: DiffLine[] = [];
    const addedBatch: DiffLine[] = [];

    while (i < lines.length && lines[i].kind !== 'equal') {
      if (lines[i].kind === 'removed') {
        removedBatch.push(lines[i]);
      } else {
        addedBatch.push(lines[i]);
      }
      i += 1;
    }

    const maxLen = Math.max(removedBatch.length, addedBatch.length);
    for (let k = 0; k < maxLen; k++) {
      const rem = removedBatch[k];
      const add = addedBatch[k];
      rows.push({
        leftLineNumber: rem ? rem.leftLineNumber : null,
        leftText: rem ? rem.text : null,
        leftKind: rem ? 'removed' : 'empty',
        rightLineNumber: add ? add.rightLineNumber : null,
        rightText: add ? add.text : null,
        rightKind: add ? 'added' : 'empty',
      });
    }
  }

  return rows;
}

const MAX_LCS_LINES = 450;

/**
 * Computes a deterministic line-by-line visual diff between a source file (`leftText`)
 * and its ingested version in the system (`rightText`).
 * Uses exact LCS DP up to MAX_LCS_LINES per side with a safe prefix/suffix + window cap
 * so huge technical manuals remain instant and never block the UI thread.
 */
export function computeLineDiff(leftText: string, rightText: string): LineDiffResult {
  const fullLeft = splitToComparableLines(leftText);
  const fullRight = splitToComparableLines(rightText);

  const truncated = fullLeft.length > MAX_LCS_LINES || fullRight.length > MAX_LCS_LINES;
  const left = truncated ? fullLeft.slice(0, MAX_LCS_LINES) : fullLeft;
  const right = truncated ? fullRight.slice(0, MAX_LCS_LINES) : fullRight;

  const m = left.length;
  const n = right.length;

  // Trim common prefix & suffix first for fast O(N) performance on mostly-identical files
  let prefixLen = 0;
  while (prefixLen < m && prefixLen < n && left[prefixLen] === right[prefixLen]) {
    prefixLen++;
  }

  let suffixLen = 0;
  while (
    suffixLen < m - prefixLen &&
    suffixLen < n - prefixLen &&
    left[m - 1 - suffixLen] === right[n - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  const midLeft = left.slice(prefixLen, m - suffixLen);
  const midRight = right.slice(prefixLen, n - suffixLen);
  const ml = midLeft.length;
  const mr = midRight.length;

  const diffLines: DiffLine[] = [];

  for (let p = 0; p < prefixLen; p++) {
    diffLines.push({
      kind: 'equal',
      text: left[p],
      leftLineNumber: p + 1,
      rightLineNumber: p + 1,
    });
  }

  if (ml > 0 || mr > 0) {
    // Standard LCS table on the differing middle window
    const width = mr + 1;
    const dp = new Uint16Array((ml + 1) * width);

    for (let i = ml - 1; i >= 0; i--) {
      for (let j = mr - 1; j >= 0; j--) {
        if (midLeft[i] === midRight[j]) {
          dp[i * width + j] = dp[(i + 1) * width + (j + 1)] + 1;
        } else {
          const down = dp[(i + 1) * width + j];
          const rightVal = dp[i * width + (j + 1)];
          dp[i * width + j] = down >= rightVal ? down : rightVal;
        }
      }
    }

    let i = 0;
    let j = 0;
    while (i < ml && j < mr) {
      if (midLeft[i] === midRight[j]) {
        diffLines.push({
          kind: 'equal',
          text: midLeft[i],
          leftLineNumber: prefixLen + i + 1,
          rightLineNumber: prefixLen + j + 1,
        });
        i++;
        j++;
      } else if (dp[(i + 1) * width + j] >= dp[i * width + (j + 1)]) {
        diffLines.push({
          kind: 'removed',
          text: midLeft[i],
          leftLineNumber: prefixLen + i + 1,
          rightLineNumber: null,
        });
        i++;
      } else {
        diffLines.push({
          kind: 'added',
          text: midRight[j],
          leftLineNumber: null,
          rightLineNumber: prefixLen + j + 1,
        });
        j++;
      }
    }

    while (i < ml) {
      diffLines.push({
        kind: 'removed',
        text: midLeft[i],
        leftLineNumber: prefixLen + i + 1,
        rightLineNumber: null,
      });
      i++;
    }

    while (j < mr) {
      diffLines.push({
        kind: 'added',
        text: midRight[j],
        leftLineNumber: null,
        rightLineNumber: prefixLen + j + 1,
      });
      j++;
    }
  }

  for (let s = 0; s < suffixLen; s++) {
    const li = m - suffixLen + s;
    const ri = n - suffixLen + s;
    diffLines.push({
      kind: 'equal',
      text: left[li],
      leftLineNumber: li + 1,
      rightLineNumber: ri + 1,
    });
  }

  let addedCount = 0;
  let removedCount = 0;
  let unchangedCount = 0;

  for (const dl of diffLines) {
    if (dl.kind === 'added') addedCount++;
    else if (dl.kind === 'removed') removedCount++;
    else unchangedCount++;
  }

  const totalBase = unchangedCount + Math.max(addedCount, removedCount);
  const similarityPercent =
    totalBase === 0 ? 100 : Math.round((unchangedCount / totalBase) * 100);

  return {
    lines: diffLines,
    sideBySideRows: buildSideBySideRows(diffLines),
    addedCount,
    removedCount,
    unchangedCount,
    similarityPercent,
    truncated,
  };
}
