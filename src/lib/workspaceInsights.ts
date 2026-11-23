import type {
  ContentUnitDto,
  OutlineNodeDto,
  ParsedBook,
  ProjectBundleDto,
  SourceFileDto,
} from './bookTypes.ts';
import type { OutlineReassignment } from './outlineAutoSave.ts';

export interface ChapterVolumeDatum {
  id: string;
  order: number;
  title: string;
  shortLabel: string;
  uniqueWords: number;
  mergedWords: number;
  totalMappedWords: number;
  unitCount: number;
  sharePercent: number;
  coveragePercent: number;
  hasWebEnrichment: boolean;
}

export interface ProjectChapterCoverageSummary {
  sourceMode: 'outline' | 'book_snapshot' | 'extracted_units' | 'empty';
  chapters: ChapterVolumeDatum[];
  totalInputWords: number;
  preservedUniqueWords: number;
  losslessMergedWords: number;
  unassignedWords: number;
  overallWordCoveragePercent: number;
  chapterCount: number;
  averageWordsPerChapter: number;
  largestChapterTitle: string | null;
}

export interface LivePreviewBlock {
  id: string;
  unitType: string;
  headingPath: string | null;
  sourceFileName: string;
  text: string;
  wordCount: number;
}

export interface LivePreviewChapter {
  nodeId: string;
  order: number;
  title: string;
  summary: string | null;
  unitCount: number;
  wordCount: number;
  sharePercent: number;
  hasWebEnrichment: boolean;
  webEnrichmentTitle?: string;
  webEnrichmentSummary?: string;
  blocks: LivePreviewBlock[];
}

export interface LiveOutlineTextPreview {
  projectTitle: string;
  totalChapters: number;
  totalUnits: number;
  totalWords: number;
  chapters: LivePreviewChapter[];
  plainMarkdown: string;
}

export interface HighlightSegment {
  text: string;
  matched: boolean;
}

export interface ExtractedSearchHit {
  unitId: string;
  sourceFileId: string;
  sourceFileName: string;
  unitOrder: number;
  unitType: string;
  headingPath: string | null;
  status: string;
  outlineNodeId: string | null;
  outlineNodeTitle: string | null;
  wordCount: number;
  matchCount: number;
  rawText: string;
  snippetSegments: HighlightSegment[];
}

export interface ExtractedSearchResult {
  query: string;
  normalizedQuery: string;
  totalMatches: number;
  matchedFilesCount: number;
  hits: ExtractedSearchHit[];
}

const PERSIAN_DIGIT_MAP: Record<string, string> = {
  '۰': '0',
  '۱': '1',
  '۲': '2',
  '۳': '3',
  '۴': '4',
  '۵': '5',
  '۶': '6',
  '۷': '7',
  '۸': '8',
  '۹': '9',
  '٠': '0',
  '١': '1',
  '٢': '2',
  '٣': '3',
  '٤': '4',
  '٥': '5',
  '٦': '6',
  '٧': '7',
  '٨': '8',
  '٩': '9',
};

export function countWordsAccurate(text: string | null | undefined): number {
  if (!text) return 0;
  const cleaned = text.trim();
  if (!cleaned) return 0;
  return cleaned.split(/\s+/).filter(Boolean).length;
}

export function normalizeSearchText(text: string): string {
  return text
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/ۀ/g, 'ه')
    .replace(/ة/g, 'ه')
    .replace(/[أإآ]/g, 'ا')
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[۰-۹٠-٩]/g, (ch) => PERSIAN_DIGIT_MAP[ch] ?? ch)
    .toLowerCase();
}

function truncateLabel(title: string, maxLen = 18): string {
  const clean = title.replace(/^فصل\s*[۰-۹0-9]+\s*[:：\-–]?\s*/, '').trim() || title.trim();
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, maxLen - 1).trim()}…`;
}

function extractBookChapterWords(book: ParsedBook): ChapterVolumeDatum[] {
  const rawList = book.chapters.map((ch, idx) => {
    let words = countWordsAccurate(ch.title);
    for (const b of ch.introBlocks || []) {
      if (b.type === 'paragraph' || b.type === 'subheading') words += countWordsAccurate(b.text);
      else if (b.type === 'callout') words += b.paragraphs.reduce((s, p) => s + countWordsAccurate(p), 0);
      else if (b.type === 'list') words += b.items.reduce((s, it) => s + countWordsAccurate(it), 0);
      else if (b.type === 'table') {
        words += b.headers.reduce((s, h) => s + countWordsAccurate(h), 0);
        words += b.rows.reduce(
          (s, r) => s + r.reduce((rs, c) => rs + countWordsAccurate(c), 0),
          0
        );
      }
    }
    let unitCount = ch.introBlocks?.length || 0;
    let hasWebEnrichment = false;
    for (const sec of ch.sections || []) {
      words += countWordsAccurate(sec.title);
      for (const b of sec.blocks || []) {
        unitCount += 1;
        if (b.type === 'paragraph' || b.type === 'subheading') words += countWordsAccurate(b.text);
        else if (b.type === 'callout') words += b.paragraphs.reduce((s, p) => s + countWordsAccurate(p), 0);
        else if (b.type === 'list') words += b.items.reduce((s, it) => s + countWordsAccurate(it), 0);
        else if (b.type === 'table') {
          words += b.headers.reduce((s, h) => s + countWordsAccurate(h), 0);
          words += b.rows.reduce(
            (s, r) => s + r.reduce((rs, c) => rs + countWordsAccurate(c), 0),
            0
          );
        } else if (b.type === 'web_enrichment') {
          hasWebEnrichment = true;
          words += countWordsAccurate(b.summary);
        }
      }
    }
    return {
      id: ch.id,
      order: ch.chapterNumber || idx + 1,
      title: ch.title,
      shortLabel: truncateLabel(ch.title),
      uniqueWords: words,
      mergedWords: 0,
      totalMappedWords: words,
      unitCount,
      sharePercent: 0,
      coveragePercent: 100,
      hasWebEnrichment,
    };
  });

  const total = rawList.reduce((s, c) => s + c.uniqueWords, 0);
  return rawList.map((c) => ({
    ...c,
    sharePercent: total > 0 ? Math.round((c.uniqueWords / total) * 1000) / 10 : 0,
  }));
}

/**
 * Computes chapter-by-chapter word volume distribution and word-level content coverage
 * for the Recharts analytics widget in the project dashboard.
 */
export function computeChapterVolumeAndCoverage(
  bundle: ProjectBundleDto | null
): ProjectChapterCoverageSummary {
  if (!bundle) {
    return {
      sourceMode: 'empty',
      chapters: [],
      totalInputWords: 0,
      preservedUniqueWords: 0,
      losslessMergedWords: 0,
      unassignedWords: 0,
      overallWordCoveragePercent: 0,
      chapterCount: 0,
      averageWordsPerChapter: 0,
      largestChapterTitle: null,
    };
  }

  const units = bundle.contentUnits || [];
  const outlineNodes = [...(bundle.outlineNodes || [])].sort((a, b) => a.nodeOrder - b.nodeOrder);
  const sourceFiles = bundle.sourceFiles || [];
  const sourceFilesTotalWords = sourceFiles.reduce((s, f) => s + (f.wordCount || 0), 0);

  // Build lookup from unitId -> unit so merged units map cleanly to their canonical unit's chapter
  const unitById = new Map<string, ContentUnitDto>();
  for (const u of units) {
    unitById.set(u.id, u);
  }

  // Case 1: Outline nodes exist (Stages 2–5)
  if (outlineNodes.length > 0 && units.length > 0) {
    const uniqueByNode = new Map<string, number>();
    const mergedByNode = new Map<string, number>();
    const unitCountByNode = new Map<string, number>();

    let preservedUniqueWords = 0;
    let losslessMergedWords = 0;
    let unassignedWords = 0;

    for (const u of units) {
      const w = countWordsAccurate(u.rawText);
      const isMerged = u.status === 'merged';
      let targetNodeId = u.outlineNodeId;

      if (!targetNodeId && isMerged && u.canonicalUnitId) {
        const canonical = unitById.get(u.canonicalUnitId);
        targetNodeId = canonical?.outlineNodeId ?? null;
      }

      if (targetNodeId && outlineNodes.some((n) => n.id === targetNodeId)) {
        if (isMerged) {
          mergedByNode.set(targetNodeId, (mergedByNode.get(targetNodeId) || 0) + w);
          losslessMergedWords += w;
        } else {
          uniqueByNode.set(targetNodeId, (uniqueByNode.get(targetNodeId) || 0) + w);
          unitCountByNode.set(targetNodeId, (unitCountByNode.get(targetNodeId) || 0) + 1);
          preservedUniqueWords += w;
        }
      } else if (isMerged) {
        losslessMergedWords += w;
      } else {
        unassignedWords += w;
      }
    }

    const totalAssignedUnique = preservedUniqueWords;
    const chapters: ChapterVolumeDatum[] = outlineNodes.map((node, idx) => {
      const uniqueWords = uniqueByNode.get(node.id) || 0;
      const mergedWords = mergedByNode.get(node.id) || 0;
      const totalMappedWords = uniqueWords + mergedWords;
      const unitCount = unitCountByNode.get(node.id) || 0;
      const sharePercent =
        totalAssignedUnique > 0
          ? Math.round((uniqueWords / totalAssignedUnique) * 1000) / 10
          : 0;
      // Coverage of words mapped to this chapter (both unique kept & duplicates consolidated losslessly)
      const coveragePercent =
        totalMappedWords > 0
          ? Math.min(100, Math.round(((uniqueWords + mergedWords) / totalMappedWords) * 100))
          : 0;

      return {
        id: node.id,
        order: node.nodeOrder || idx + 1,
        title: node.title,
        shortLabel: truncateLabel(node.title),
        uniqueWords,
        mergedWords,
        totalMappedWords,
        unitCount,
        sharePercent,
        coveragePercent,
        hasWebEnrichment: Boolean(node.webEnrichmentJson),
      };
    });

    const totalUnitWords = preservedUniqueWords + losslessMergedWords + unassignedWords;
    const totalInputWords = Math.max(totalUnitWords, sourceFilesTotalWords);
    const coveredWords = preservedUniqueWords + losslessMergedWords;
    const overallWordCoveragePercent =
      totalUnitWords > 0
        ? Math.min(100, Math.round((coveredWords / totalUnitWords) * 1000) / 10)
        : bundle.auditReport?.coveragePercent ?? 0;

    const largest = [...chapters].sort((a, b) => b.uniqueWords - a.uniqueWords)[0];

    return {
      sourceMode: 'outline',
      chapters,
      totalInputWords,
      preservedUniqueWords,
      losslessMergedWords,
      unassignedWords,
      overallWordCoveragePercent,
      chapterCount: chapters.length,
      averageWordsPerChapter:
        chapters.length > 0 ? Math.round(preservedUniqueWords / chapters.length) : 0,
      largestChapterTitle: largest && largest.uniqueWords > 0 ? largest.title : null,
    };
  }

  // Case 2: Book snapshot exists without contentUnits/outlineNodes
  const book = bundle.project.bookSnapshotJson;
  if (book && book.chapters.length > 0) {
    const chapters = extractBookChapterWords(book);
    const preservedUniqueWords = chapters.reduce((s, c) => s + c.uniqueWords, 0);
    const totalInputWords = Math.max(preservedUniqueWords, sourceFilesTotalWords);
    const overallWordCoveragePercent =
      bundle.auditReport?.coveragePercent ??
      (totalInputWords > 0
        ? Math.min(100, Math.round((preservedUniqueWords / totalInputWords) * 1000) / 10)
        : 100);
    const largest = [...chapters].sort((a, b) => b.uniqueWords - a.uniqueWords)[0];

    return {
      sourceMode: 'book_snapshot',
      chapters,
      totalInputWords,
      preservedUniqueWords,
      losslessMergedWords: 0,
      unassignedWords: 0,
      overallWordCoveragePercent,
      chapterCount: chapters.length,
      averageWordsPerChapter:
        chapters.length > 0 ? Math.round(preservedUniqueWords / chapters.length) : 0,
      largestChapterTitle: largest && largest.uniqueWords > 0 ? largest.title : null,
    };
  }

  // Case 3: Stage 1 extracted units exist (pre-outline grouping by headingPath or source file)
  if (units.length > 0) {
    const fileMap = new Map(sourceFiles.map((f) => [f.id, f.fileName]));
    const bucketMap = new Map<
      string,
      { title: string; uniqueWords: number; unitCount: number }
    >();

    for (const u of units) {
      const topHeading = u.headingPath?.split(/\s*>\s*/)[0]?.trim();
      const label = topHeading || fileMap.get(u.sourceFileId) || 'بخش استخراج‌شده';
      const entry = bucketMap.get(label) || { title: label, uniqueWords: 0, unitCount: 0 };
      entry.uniqueWords += countWordsAccurate(u.rawText);
      entry.unitCount += 1;
      bucketMap.set(label, entry);
    }

    const entries = Array.from(bucketMap.values());
    const preservedUniqueWords = entries.reduce((s, e) => s + e.uniqueWords, 0);
    const chapters: ChapterVolumeDatum[] = entries.map((e, idx) => ({
      id: `extracted_${idx + 1}`,
      order: idx + 1,
      title: e.title,
      shortLabel: truncateLabel(e.title),
      uniqueWords: e.uniqueWords,
      mergedWords: 0,
      totalMappedWords: e.uniqueWords,
      unitCount: e.unitCount,
      sharePercent:
        preservedUniqueWords > 0
          ? Math.round((e.uniqueWords / preservedUniqueWords) * 1000) / 10
          : 0,
      coveragePercent: 100,
      hasWebEnrichment: false,
    }));

    const totalInputWords = Math.max(preservedUniqueWords, sourceFilesTotalWords);
    const largest = [...chapters].sort((a, b) => b.uniqueWords - a.uniqueWords)[0];

    return {
      sourceMode: 'extracted_units',
      chapters,
      totalInputWords,
      preservedUniqueWords,
      losslessMergedWords: 0,
      unassignedWords: 0,
      overallWordCoveragePercent: totalInputWords > 0 ? 100 : 0,
      chapterCount: chapters.length,
      averageWordsPerChapter:
        chapters.length > 0 ? Math.round(preservedUniqueWords / chapters.length) : 0,
      largestChapterTitle: largest && largest.uniqueWords > 0 ? largest.title : null,
    };
  }

  return {
    sourceMode: 'empty',
    chapters: [],
    totalInputWords: sourceFilesTotalWords,
    preservedUniqueWords: 0,
    losslessMergedWords: 0,
    unassignedWords: 0,
    overallWordCoveragePercent: 0,
    chapterCount: 0,
    averageWordsPerChapter: 0,
    largestChapterTitle: null,
  };
}

/**
 * Resolves chained merge reassignments (e.g. C -> B, then B -> A => C -> A).
 */
export function resolveReassignmentTarget(
  nodeId: string,
  reassignments: OutlineReassignment[]
): string {
  const map = new Map<string, string>();
  for (const r of reassignments) {
    map.set(r.fromNodeId, r.toNodeId);
  }
  let current = nodeId;
  const visited = new Set<string>();
  while (map.has(current) && !visited.has(current)) {
    visited.add(current);
    current = map.get(current)!;
  }
  return current;
}

/**
 * Builds an instant, zero-latency text & Markdown preview of the final document
 * reflecting live Stage 3 outline edits (renaming, reordering, adding, merging).
 */
export function buildLiveOutlineTextPreview(params: {
  projectTitle: string;
  draftNodes: OutlineNodeDto[];
  contentUnits: ContentUnitDto[];
  sourceFiles: SourceFileDto[];
  pendingReassignments?: OutlineReassignment[];
}): LiveOutlineTextPreview {
  const {
    projectTitle,
    draftNodes,
    contentUnits,
    sourceFiles,
    pendingReassignments = [],
  } = params;

  const fileNameById = new Map<string, string>();
  for (const f of sourceFiles) {
    fileNameById.set(f.id, f.fileName);
  }

  const orderedNodes = [...draftNodes];
  const validNodeIds = new Set(orderedNodes.map((n) => n.id));
  const unitsByNode = new Map<string, ContentUnitDto[]>();

  for (const u of contentUnits) {
    if (u.status === 'merged' || !u.outlineNodeId) continue;
    const resolvedId = resolveReassignmentTarget(u.outlineNodeId, pendingReassignments);
    if (!validNodeIds.has(resolvedId)) continue;
    const list = unitsByNode.get(resolvedId) || [];
    list.push(u);
    unitsByNode.set(resolvedId, list);
  }

  const rawChapters = orderedNodes.map((node, idx) => {
    const nodeUnits = [...(unitsByNode.get(node.id) || [])].sort(
      (a, b) => a.unitOrder - b.unitOrder
    );
    const blocks: LivePreviewBlock[] = nodeUnits.map((u) => ({
      id: u.id,
      unitType: u.unitType || 'paragraph',
      headingPath: u.headingPath,
      sourceFileName: fileNameById.get(u.sourceFileId) || 'فایل منبع',
      text: u.rawText.trim(),
      wordCount: countWordsAccurate(u.rawText),
    }));

    const wordCount = blocks.reduce((s, b) => s + b.wordCount, 0);

    return {
      nodeId: node.id,
      order: idx + 1,
      title: node.title.trim() || `فصل ${idx + 1}`,
      summary: node.summary,
      unitCount: blocks.length,
      wordCount,
      sharePercent: 0,
      hasWebEnrichment: Boolean(node.webEnrichmentJson),
      webEnrichmentTitle: node.webEnrichmentJson?.title,
      webEnrichmentSummary: node.webEnrichmentJson?.summary,
      blocks,
    };
  });

  const totalWords = rawChapters.reduce((s, ch) => s + ch.wordCount, 0);
  const totalUnits = rawChapters.reduce((s, ch) => s + ch.unitCount, 0);

  const chapters: LivePreviewChapter[] = rawChapters.map((ch) => ({
    ...ch,
    sharePercent:
      totalWords > 0 ? Math.round((ch.wordCount / totalWords) * 1000) / 10 : 0,
  }));

  const mdLines: string[] = [];
  mdLines.push(`# ${projectTitle || 'سند یکپارچه'}`);
  mdLines.push('');
  mdLines.push('## فهرست مطالب');
  for (const ch of chapters) {
    mdLines.push(`${ch.order}. ${ch.title} (${ch.wordCount} کلمه)`);
  }
  mdLines.push('');

  for (const ch of chapters) {
    mdLines.push(`---`);
    mdLines.push(`## فصل ${ch.order}: ${ch.title}`);
    if (ch.summary) {
      mdLines.push(`> ${ch.summary}`);
    }
    mdLines.push('');
    if (ch.blocks.length === 0) {
      mdLines.push('_(این فصل فعلاً واحد محتوایی ندارد — می‌توانید از دستیار هوشمند یا ادغام فصل‌ها برای افزودن محتوا استفاده کنید.)_');
      mdLines.push('');
    } else {
      let lastHeading = '';
      for (const b of ch.blocks) {
        const subHeading = b.headingPath?.split(/\s*>\s*/).slice(1).join(' / ').trim() || '';
        if (subHeading && subHeading !== lastHeading) {
          mdLines.push(`### ${subHeading}`);
          lastHeading = subHeading;
        }
        mdLines.push(b.text);
        mdLines.push('');
      }
    }
    if (ch.hasWebEnrichment && ch.webEnrichmentSummary) {
      mdLines.push(`> **[تکمیل‌شده با جستجوی گوگل] ${ch.webEnrichmentTitle || ''}**`);
      mdLines.push(`> ${ch.webEnrichmentSummary}`);
      mdLines.push('');
    }
  }

  return {
    projectTitle: projectTitle || 'سند یکپارچه',
    totalChapters: chapters.length,
    totalUnits,
    totalWords,
    chapters,
    plainMarkdown: mdLines.join('\n').trim(),
  };
}

/**
 * Builds a concise context snippet around the first normalized match, splitting the text
 * into plain & matched segments for safe React highlighting (no raw HTML injection).
 */
function buildHighlightedSnippet(
  rawText: string,
  normalizedQuery: string,
  radius = 64
): { segments: HighlightSegment[]; matchCount: number } {
  const cleanRaw = rawText.replace(/\s+/g, ' ').trim();
  if (!cleanRaw || !normalizedQuery) {
    return {
      segments: [{ text: cleanRaw.slice(0, radius * 2), matched: false }],
      matchCount: 0,
    };
  }

  // Build index mapping from normalized character index back to cleanRaw index
  // (normalizeSearchText preserves 1-to-1 length except diacritics removal)
  const normChars: string[] = [];
  const origIndices: number[] = [];
  for (let i = 0; i < cleanRaw.length; i++) {
    const ch = cleanRaw[i];
    const norm = normalizeSearchText(ch);
    if (norm.length === 0) continue;
    for (let k = 0; k < norm.length; k++) {
      normChars.push(norm[k]);
      origIndices.push(i);
    }
  }
  const normalizedFull = normChars.join('');

  const matchRanges: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  while (cursor < normalizedFull.length) {
    const found = normalizedFull.indexOf(normalizedQuery, cursor);
    if (found === -1) break;
    const origStart = origIndices[found];
    const lastNormIdx = Math.min(found + normalizedQuery.length - 1, origIndices.length - 1);
    const origEnd = origIndices[lastNormIdx] + 1;
    matchRanges.push({ start: origStart, end: origEnd });
    cursor = found + Math.max(1, normalizedQuery.length);
  }

  if (matchRanges.length === 0) {
    const preview =
      cleanRaw.length > radius * 2 ? `${cleanRaw.slice(0, radius * 2).trim()}…` : cleanRaw;
    return {
      segments: [{ text: preview, matched: false }],
      matchCount: 0,
    };
  }

  const first = matchRanges[0];
  const windowStart = Math.max(0, first.start - radius);
  const windowEnd = Math.min(cleanRaw.length, first.end + radius);

  const segments: HighlightSegment[] = [];
  if (windowStart > 0) {
    segments.push({ text: '…', matched: false });
  }

  let pos = windowStart;
  for (const r of matchRanges) {
    if (r.start >= windowEnd) break;
    if (r.end <= windowStart) continue;
    const clippedStart = Math.max(r.start, windowStart);
    const clippedEnd = Math.min(r.end, windowEnd);
    if (clippedStart > pos) {
      segments.push({ text: cleanRaw.slice(pos, clippedStart), matched: false });
    }
    if (clippedEnd > clippedStart) {
      segments.push({ text: cleanRaw.slice(clippedStart, clippedEnd), matched: true });
    }
    pos = clippedEnd;
  }

  if (pos < windowEnd) {
    segments.push({ text: cleanRaw.slice(pos, windowEnd), matched: false });
  }
  if (windowEnd < cleanRaw.length) {
    segments.push({ text: '…', matched: false });
  }

  return { segments, matchCount: matchRanges.length };
}

/**
 * Full-text Persian/English normalized search over Stage 1 extracted content units.
 */
export function searchExtractedContentUnits(params: {
  query: string;
  contentUnits: ContentUnitDto[];
  sourceFiles: SourceFileDto[];
  outlineNodes?: OutlineNodeDto[];
  fileFilterId?: string | null;
  maxResults?: number;
}): ExtractedSearchResult {
  const {
    query,
    contentUnits,
    sourceFiles,
    outlineNodes = [],
    fileFilterId = null,
    maxResults = 40,
  } = params;

  const trimmed = query.trim();
  const normalizedQuery = normalizeSearchText(trimmed).replace(/\s+/g, ' ').trim();

  if (!normalizedQuery) {
    return {
      query: trimmed,
      normalizedQuery: '',
      totalMatches: 0,
      matchedFilesCount: 0,
      hits: [],
    };
  }

  const fileNameById = new Map(sourceFiles.map((f) => [f.id, f.fileName]));
  const outlineTitleById = new Map(outlineNodes.map((n) => [n.id, n.title]));

  const allHits: ExtractedSearchHit[] = [];
  const matchedFiles = new Set<string>();

  for (const unit of contentUnits) {
    if (fileFilterId && unit.sourceFileId !== fileFilterId) continue;

    const sourceFileName = fileNameById.get(unit.sourceFileId) || 'فایل استخراج‌شده';
    const normText = normalizeSearchText(unit.rawText).replace(/\s+/g, ' ');
    const normHeading = normalizeSearchText(unit.headingPath || '').replace(/\s+/g, ' ');
    const normFile = normalizeSearchText(sourceFileName).replace(/\s+/g, ' ');

    const inText = normText.includes(normalizedQuery);
    const inHeading = normHeading.includes(normalizedQuery);
    const inFile = normFile.includes(normalizedQuery);

    if (!inText && !inHeading && !inFile) continue;

    matchedFiles.add(unit.sourceFileId);
    const { segments, matchCount } = buildHighlightedSnippet(unit.rawText, normalizedQuery);
    const effectiveMatchCount = matchCount + (inHeading ? 1 : 0);

    allHits.push({
      unitId: unit.id,
      sourceFileId: unit.sourceFileId,
      sourceFileName,
      unitOrder: unit.unitOrder,
      unitType: unit.unitType,
      headingPath: unit.headingPath,
      status: unit.status,
      outlineNodeId: unit.outlineNodeId,
      outlineNodeTitle: unit.outlineNodeId ? outlineTitleById.get(unit.outlineNodeId) ?? null : null,
      wordCount: countWordsAccurate(unit.rawText),
      matchCount: Math.max(1, effectiveMatchCount),
      rawText: unit.rawText,
      snippetSegments: segments,
    });
  }

  // Rank: higher matchCount first, active before merged, then unitOrder
  allHits.sort((a, b) => {
    if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
    const aActive = a.status === 'merged' ? 0 : 1;
    const bActive = b.status === 'merged' ? 0 : 1;
    if (bActive !== aActive) return bActive - aActive;
    return a.unitOrder - b.unitOrder;
  });

  return {
    query: trimmed,
    normalizedQuery,
    totalMatches: allHits.length,
    matchedFilesCount: matchedFiles.size,
    hits: allHits.slice(0, maxResults),
  };
}
