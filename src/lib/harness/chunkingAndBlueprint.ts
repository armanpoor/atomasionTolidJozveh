import { extractEcuPlatforms } from '../ecuTechnicalIntegrity.ts';
import { toPersianDigits } from '../formatParsers.ts';
import { estimateTokens } from '../tokenOptimizer.ts';
import { deterministicHash } from '../zeroLossPipeline.ts';
import type {
  BlueprintAuditReport,
  BlueprintSection,
  HarnessSourceChunk,
  MasterBlueprint,
} from './types.ts';

export const DEFAULT_MAX_SECTION_INPUT_TOKENS = 7000;

function countWords(text: string): number {
  const cleaned = (text || '').trim();
  if (!cleaned) return 0;
  return cleaned.split(/\s+/).filter(Boolean).length;
}

interface AtomicSegment {
  kind: 'prose' | 'table' | 'formula' | 'hex_or_pinout' | 'code';
  text: string;
}

const TABLE_LINE_RX = /^\s*\|.+\|\s*$/;
const HEX_OR_PINOUT_LINE_RX =
  /(?:0x[0-9A-Fa-f]{2,8}|\$[0-9A-Fa-f]{3,8}|^\s*(?:pin|پین|پایه)\s*[-:#]?\s*\d+|\b[0-9A-Fa-f]{2}(?:\s+[0-9A-Fa-f]{2}){5,}\b)/i;
const FORMULA_LINE_RX = /^\s*(?:\$\$|\\\[|فرمول\s*:|Formula\s*:|[A-Za-z_][A-Za-z0-9_]*\s*=\s*[^=]{3,})/i;

/**
 * Parses raw text into atomic structural segments so tables, fenced blocks, formulas,
 * pinout listings, and hex dumps are never sliced mid-structure across chunks.
 */
function parseAtomicSegments(rawText: string): AtomicSegment[] {
  const lines = (rawText || '').replace(/\r\n/g, '\n').split('\n');
  const segments: AtomicSegment[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 1. Fenced code / hex / formula block
    if (/^\s*```/.test(line)) {
      const buf = [line];
      i += 1;
      while (i < lines.length) {
        buf.push(lines[i]);
        if (/^\s*```/.test(lines[i])) {
          i += 1;
          break;
        }
        i += 1;
      }
      segments.push({ kind: 'code', text: buf.join('\n').trim() });
      continue;
    }

    // 2. Display LaTeX formula block $$ ... $$
    if (/^\s*\$\$/.test(line)) {
      const buf = [line];
      const closedOnSameLine = /\$\$\s*$/.test(line.replace(/^\s*\$\$/, '')) && line.trim().length > 2;
      i += 1;
      if (!closedOnSameLine) {
        while (i < lines.length) {
          buf.push(lines[i]);
          if (/\$\$/.test(lines[i])) {
            i += 1;
            break;
          }
          i += 1;
        }
      }
      segments.push({ kind: 'formula', text: buf.join('\n').trim() });
      continue;
    }

    // 3. Markdown / pipe table (keep header + separator + rows together as one atomic segment)
    if (TABLE_LINE_RX.test(line)) {
      const buf = [line];
      i += 1;
      while (i < lines.length && TABLE_LINE_RX.test(lines[i])) {
        buf.push(lines[i]);
        i += 1;
      }
      segments.push({ kind: 'table', text: buf.join('\n').trim() });
      continue;
    }

    // 4. Multi-line Pinout or Hex block (2+ contiguous lines matching hex/pinout signature)
    if (HEX_OR_PINOUT_LINE_RX.test(line) && i + 1 < lines.length && HEX_OR_PINOUT_LINE_RX.test(lines[i + 1])) {
      const buf = [line];
      i += 1;
      while (i < lines.length && (HEX_OR_PINOUT_LINE_RX.test(lines[i]) || /^\s*[-•*]/.test(lines[i]))) {
        buf.push(lines[i]);
        i += 1;
      }
      segments.push({ kind: 'hex_or_pinout', text: buf.join('\n').trim() });
      continue;
    }

    // 5. Single-line formula
    if (FORMULA_LINE_RX.test(line)) {
      segments.push({ kind: 'formula', text: line.trim() });
      i += 1;
      continue;
    }

    // 6. Blank separator
    if (!line.trim()) {
      i += 1;
      continue;
    }

    // 7. Regular prose paragraph (stop before table, fence, formula, hex/pinout block, or blank line)
    const buf = [line];
    i += 1;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !TABLE_LINE_RX.test(lines[i]) &&
      !/^\s*```/.test(lines[i]) &&
      !/^\s*\$\$/.test(lines[i]) &&
      !(HEX_OR_PINOUT_LINE_RX.test(lines[i]) && i + 1 < lines.length && HEX_OR_PINOUT_LINE_RX.test(lines[i + 1]))
    ) {
      buf.push(lines[i]);
      i += 1;
    }
    segments.push({ kind: 'prose', text: buf.join('\n').trim() });
  }

  return segments.filter((s) => s.text.length > 0);
}

function splitOversizedSegmentByLines(
  segment: AtomicSegment,
  maxTokensPerChunk: number
): string[] {
  const lines = segment.text.split('\n');
  if (lines.length <= 1) return [segment.text];

  // For oversized tables, repeat header + separator lines on each continued part for full self-containment
  const isTable = segment.kind === 'table' && lines.length >= 3 && /^\s*\|[\s:-]+\|/.test(lines[1]);
  const tableHeaderPrefix = isTable ? `${lines[0]}\n${lines[1]}` : '';
  const bodyLines = isTable ? lines.slice(2) : lines;

  const parts: string[] = [];
  let current: string[] = isTable ? [tableHeaderPrefix] : [];

  for (const line of bodyLines) {
    const candidate = [...current, line].join('\n');
    if (current.length > (isTable ? 1 : 0) && estimateTokens(candidate) > maxTokensPerChunk) {
      parts.push(current.join('\n').trim());
      current = isTable ? [tableHeaderPrefix, line] : [line];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) {
    parts.push(current.join('\n').trim());
  }
  return parts.filter(Boolean);
}

/**
 * Structure-Aware Chunker:
 * Never breaks tables, formulas, pinout lists, or hex blocks mid-structure across two chunks.
 * If a single atomic structure exceeds maxTokensPerChunk, splits cleanly along line/row boundaries
 * and records bidirectional continuity links (`continuedFromChunkId` / `continuesToChunkId`).
 */
export function chunkSourceTextStructureAware(params: {
  text: string;
  baseId: string;
  fileName: string;
  headingPath?: string | null;
  maxTokensPerChunk?: number;
}): HarnessSourceChunk[] {
  const maxTokens = Math.max(120, params.maxTokensPerChunk ?? 900);
  const segments = parseAtomicSegments(params.text);
  if (segments.length === 0) return [];

  const rawChunks: Array<{
    text: string;
    unitType: string;
    isContinuationOfPrev: boolean;
  }> = [];

  let bufferTexts: string[] = [];
  let bufferTokens = 0;

  const flushBuffer = () => {
    if (bufferTexts.length === 0) return;
    const joined = bufferTexts.join('\n\n').trim();
    if (joined) {
      rawChunks.push({
        text: joined,
        unitType: 'paragraph',
        isContinuationOfPrev: false,
      });
    }
    bufferTexts = [];
    bufferTokens = 0;
  };

  for (const seg of segments) {
    const segTokens = estimateTokens(seg.text);

    // Oversized atomic block (e.g., giant 16x16 table or long pinout) -> split cleanly with continuity links
    if (segTokens > maxTokens) {
      flushBuffer();
      const splitParts = splitOversizedSegmentByLines(seg, maxTokens);
      splitParts.forEach((part, idx) => {
        rawChunks.push({
          text: part,
          unitType: seg.kind,
          isContinuationOfPrev: idx > 0,
        });
      });
      continue;
    }

    // If appending this atomic structure would exceed the chunk cap, flush first so structure stays 100% intact
    if (bufferTexts.length > 0 && bufferTokens + segTokens > maxTokens) {
      flushBuffer();
    }

    bufferTexts.push(seg.text);
    bufferTokens += segTokens;
  }

  flushBuffer();

  const chunks: HarnessSourceChunk[] = rawChunks.map((rc, idx) => {
    const id = rawChunks.length === 1 ? params.baseId : `${params.baseId}_p${idx + 1}`;
    return {
      id,
      fileName: params.fileName,
      headingPath: params.headingPath ?? null,
      unitType: rc.unitType,
      text: rc.text,
      wordCount: countWords(rc.text),
      continuedFromChunkId: null,
      continuesToChunkId: null,
      ecuPlatformTags: Array.from(extractEcuPlatforms(rc.text)).sort(),
      contentHash: deterministicHash(rc.text.trim()),
    };
  });

  // Wire bidirectional continuity pointers for linked multi-part atomic blocks
  for (let idx = 1; idx < chunks.length; idx++) {
    if (rawChunks[idx].isContinuationOfPrev) {
      chunks[idx].continuedFromChunkId = chunks[idx - 1].id;
      chunks[idx - 1].continuesToChunkId = chunks[idx].id;
    }
  }

  return chunks;
}

/**
 * Groups chunks into indivisible continuity groups so linked chunks
 * (`continuedFromChunkId` / `continuesToChunkId`) are always co-assigned to the same subsection.
 */
export function groupLinkedChunksIndivisible(chunks: HarnessSourceChunk[]): HarnessSourceChunk[][] {
  const groups: HarnessSourceChunk[][] = [];
  const byId = new Map(chunks.map((c) => [c.id, c]));
  const visited = new Set<string>();

  for (const chunk of chunks) {
    if (visited.has(chunk.id)) continue;

    // Walk backward to the start of any continuity chain present in this list
    let head: HarnessSourceChunk = chunk;
    while (head.continuedFromChunkId && byId.has(head.continuedFromChunkId) && !visited.has(head.continuedFromChunkId)) {
      head = byId.get(head.continuedFromChunkId)!;
    }

    const chain: HarnessSourceChunk[] = [];
    let cur: HarnessSourceChunk | undefined = head;
    while (cur && !visited.has(cur.id)) {
      visited.add(cur.id);
      chain.push(cur);
      cur = cur.continuesToChunkId ? byId.get(cur.continuesToChunkId) : undefined;
    }

    if (chain.length > 0) {
      groups.push(chain);
    }
  }

  return groups;
}

/**
 * Computes deterministic hashes over the source corpus and individual chunks for Source Mutation Drift locking.
 */
export function computeSourceCorpusFingerprint(chunks: HarnessSourceChunk[]): {
  sourceCorpusHash: string;
  chunkContentHashes: Record<string, string>;
} {
  const chunkContentHashes: Record<string, string> = {};
  const sorted = [...chunks].sort((a, b) => a.id.localeCompare(b.id));
  const signatureParts: string[] = [];

  for (const chunk of sorted) {
    const hash = chunk.contentHash || deterministicHash((chunk.text || '').trim());
    chunkContentHashes[chunk.id] = hash;
    signatureParts.push(`${chunk.id}:${hash}`);
  }

  return {
    sourceCorpusHash: deterministicHash(signatureParts.join('|')),
    chunkContentHashes,
  };
}

export interface SourceDriftCheckResult {
  drifted: boolean;
  code: 'source_drift_detected' | null;
  changedChunkIds: string[];
  addedChunkIds: string[];
  removedChunkIds: string[];
  messageFa?: string;
}

/**
 * Detects whether Stage 1 source chunks have been mutated, added, or removed since HITL Blueprint approval.
 */
export function detectSourceCorpusDrift(
  blueprint: Pick<MasterBlueprint, 'sourceCorpusHash' | 'chunkContentHashes' | 'sections'>,
  currentChunks: HarnessSourceChunk[]
): SourceDriftCheckResult {
  if (!blueprint.sourceCorpusHash && !blueprint.chunkContentHashes) {
    return {
      drifted: false,
      code: null,
      changedChunkIds: [],
      addedChunkIds: [],
      removedChunkIds: [],
    };
  }

  const currentFp = computeSourceCorpusFingerprint(currentChunks);
  const expectedHashes = blueprint.chunkContentHashes || {};
  const changedChunkIds: string[] = [];
  const addedChunkIds: string[] = [];
  const removedChunkIds: string[] = [];

  for (const [id, oldHash] of Object.entries(expectedHashes)) {
    const curHash = currentFp.chunkContentHashes[id];
    if (!curHash) {
      removedChunkIds.push(id);
    } else if (curHash !== oldHash) {
      changedChunkIds.push(id);
    }
  }

  for (const id of Object.keys(currentFp.chunkContentHashes)) {
    if (!expectedHashes[id]) {
      addedChunkIds.push(id);
    }
  }

  const corpusChanged =
    Boolean(blueprint.sourceCorpusHash) &&
    blueprint.sourceCorpusHash !== currentFp.sourceCorpusHash;

  const drifted =
    corpusChanged ||
    changedChunkIds.length > 0 ||
    addedChunkIds.length > 0 ||
    removedChunkIds.length > 0;

  if (!drifted) {
    return {
      drifted: false,
      code: null,
      changedChunkIds: [],
      addedChunkIds: [],
      removedChunkIds: [],
    };
  }

  return {
    drifted: true,
    code: 'source_drift_detected',
    changedChunkIds,
    addedChunkIds,
    removedChunkIds,
    messageFa: `تغییر در منابع مرحله ۱ پس از تأیید HITL شناسایی شد (source_drift_detected): ${toPersianDigits(changedChunkIds.length)} قطعه ویرایش، ${toPersianDigits(addedChunkIds.length)} قطعه اضافه و ${toPersianDigits(removedChunkIds.length)} قطعه حذف شده است. لطفاً نقشه راه (MasterBlueprint) را مجدداً به‌روزرسانی و تأیید کنید.`,
  };
}

/**
 * Pre-HITL Blueprint Auditor:
 * Checks orphan (unassigned) chunks, duplicated chunk assignments, broken continuity chains,
 * and oversized subsections exceeding the hard input token cap (default 7,000 tokens).
 */
export function auditMasterBlueprint(params: {
  sections: BlueprintSection[];
  allChunks: HarnessSourceChunk[];
  maxSectionInputTokens?: number;
}): BlueprintAuditReport {
  const maxSectionInputTokens = Math.max(
    1000,
    params.maxSectionInputTokens ?? DEFAULT_MAX_SECTION_INPUT_TOKENS
  );
  const chunkById = new Map(params.allChunks.map((c) => [c.id, c]));
  const chunkAssignments = new Map<string, string[]>();
  const oversizedSectionIds: BlueprintAuditReport['oversizedSectionIds'] = [];

  for (const sec of params.sections) {
    let secTokens = 0;
    for (const cid of sec.sourceChunkIds) {
      const list = chunkAssignments.get(cid) || [];
      list.push(sec.sectionId);
      chunkAssignments.set(cid, list);

      const chunk = chunkById.get(cid);
      if (chunk) {
        secTokens += estimateTokens(chunk.text);
      }
    }

    if (secTokens > maxSectionInputTokens) {
      oversizedSectionIds.push({
        sectionId: sec.sectionId,
        title: sec.title,
        estimatedTokens: secTokens,
        maxAllowedTokens: maxSectionInputTokens,
        suggestedSplitCount: Math.max(2, Math.ceil(secTokens / maxSectionInputTokens)),
      });
    }
  }

  const unassignedChunkIds: string[] = [];
  const duplicatedChunkIds: string[] = [];
  const brokenContinuityChunkIds: string[] = [];

  for (const chunk of params.allChunks) {
    const assignedSections = chunkAssignments.get(chunk.id) || [];
    if (assignedSections.length === 0) {
      unassignedChunkIds.push(chunk.id);
    } else if (assignedSections.length > 1) {
      duplicatedChunkIds.push(chunk.id);
    }

    if (chunk.continuesToChunkId && chunkById.has(chunk.continuesToChunkId)) {
      const nextAssigned = chunkAssignments.get(chunk.continuesToChunkId) || [];
      const sameSection = assignedSections.some((sid) => nextAssigned.includes(sid));
      if (!sameSection) {
        brokenContinuityChunkIds.push(chunk.id);
      }
    }
  }

  const passed =
    unassignedChunkIds.length === 0 &&
    duplicatedChunkIds.length === 0 &&
    oversizedSectionIds.length === 0 &&
    brokenContinuityChunkIds.length === 0;

  return {
    unassignedChunkIds,
    duplicatedChunkIds,
    oversizedSectionIds,
    brokenContinuityChunkIds,
    maxSectionInputTokens,
    passed,
  };
}

/**
 * Deterministically splits oversized Blueprint sections so every subsection respects
 * maxSectionInputTokens (6,000–8,000 tokens) while keeping continuity-linked chunks indivisible.
 */
export function autoSplitOversizedBlueprintSections(params: {
  sections: BlueprintSection[];
  chunkById: Map<string, HarnessSourceChunk>;
  maxSectionInputTokens?: number;
}): BlueprintSection[] {
  const maxTokens = Math.max(1000, params.maxSectionInputTokens ?? DEFAULT_MAX_SECTION_INPUT_TOKENS);
  const result: BlueprintSection[] = [];

  for (const sec of params.sections) {
    const secChunks = sec.sourceChunkIds
      .map((id) => params.chunkById.get(id))
      .filter((c): c is HarnessSourceChunk => Boolean(c));

    const totalTokens = secChunks.reduce((acc, c) => acc + estimateTokens(c.text), 0);
    if (totalTokens <= maxTokens || secChunks.length <= 1) {
      const platforms = new Set<string>();
      for (const c of secChunks) {
        for (const p of c.ecuPlatformTags || extractEcuPlatforms(c.text)) {
          platforms.add(p);
        }
      }
      result.push({
        ...sec,
        ecuPlatformTags: Array.from(platforms).sort(),
      });
      continue;
    }

    const indivisibleGroups = groupLinkedChunksIndivisible(secChunks);
    const buckets: HarnessSourceChunk[][] = [];
    let currentBucket: HarnessSourceChunk[] = [];
    let currentTokens = 0;

    for (const grp of indivisibleGroups) {
      const grpTokens = grp.reduce((acc, c) => acc + estimateTokens(c.text), 0);
      if (currentBucket.length > 0 && currentTokens + grpTokens > maxTokens) {
        buckets.push(currentBucket);
        currentBucket = [...grp];
        currentTokens = grpTokens;
      } else {
        currentBucket.push(...grp);
        currentTokens += grpTokens;
      }
    }
    if (currentBucket.length > 0) {
      buckets.push(currentBucket);
    }

    buckets.forEach((bucket, idx) => {
      const platforms = new Set<string>();
      let words = 0;
      for (const c of bucket) {
        words += c.wordCount || countWords(c.text);
        for (const p of c.ecuPlatformTags || extractEcuPlatforms(c.text)) {
          platforms.add(p);
        }
      }
      result.push({
        ...sec,
        sectionId: buckets.length === 1 ? sec.sectionId : `${sec.sectionId}__split_${idx + 1}`,
        sectionOrder: sec.sectionOrder * 100 + idx + 1,
        title:
          buckets.length === 1
            ? sec.title
            : `${sec.title} (بخش ${toPersianDigits(idx + 1)})`,
        sourceChunkIds: bucket.map((c) => c.id),
        sourceWordCount: words,
        ecuPlatformTags: Array.from(platforms).sort(),
      });
    });
  }

  return result;
}
